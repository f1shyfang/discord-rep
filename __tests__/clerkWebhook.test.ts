import { createServer } from "node:http";
import type { NextApiRequest, NextApiResponse } from "next";
import { Webhook } from "standardwebhooks";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  secret: `whsec_${Buffer.from("offline-webhook-fixture-32-bytes!!").toString("base64")}`,
}));
vi.mock("~/env", () => ({
  env: { CLERK_WEBHOOK_SIGNING_SECRET: fixture.secret },
}));
vi.mock("~/server/chat-db", () => ({
  withChatDb: (run: (db: unknown) => unknown) =>
    run({ transaction: (fn: (tx: unknown) => unknown) => fn({}) }),
}));
vi.mock("~/server/chat/identity", () => ({ applyClerkEvent: vi.fn() }));
import handler from "~/pages/api/webhooks/clerk";
import { applyClerkEvent } from "~/server/chat/identity";
let server: ReturnType<typeof createServer>;
let base: string;
beforeAll(async () => {
  server = createServer((req, res) => {
    const response = res as NextApiResponse;
    response.status = (code) => {
      response.statusCode = code;
      return response;
    };
    void handler(req as NextApiRequest, response).catch(() => {
      res.statusCode = 500;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No listening address");
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(
  () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
);
beforeEach(() => vi.clearAllMocks());
const payload =
  '{ "type": "user.deleted", "data": { "id": "user_fixture", "deleted": true, "object": "user" } }';
const signedHeaders = (body: string, when = new Date()) => ({
  "content-type": "application/json",
  "svix-id": "delivery_fixture",
  "svix-timestamp": String(Math.floor(when.getTime() / 1000)),
  "svix-signature": new Webhook(fixture.secret).sign(
    "delivery_fixture",
    when,
    body,
  ),
});
it("verifies exact signed raw JSON without reserialization", async () => {
  const result = await fetch(base, {
    method: "POST",
    headers: signedHeaders(payload),
    body: payload,
  });
  expect(result.status).toBe(200);
  expect(applyClerkEvent).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ type: "user.deleted" }),
    "delivery_fixture",
    expect.any(Date),
  );
});
it("rejects altered bytes, stale deliveries and missing signatures", async () => {
  for (const request of [
    {
      headers: signedHeaders(payload),
      body: payload.replace("user_fixture", "attacker"),
    },
    {
      headers: signedHeaders(payload, new Date(Date.now() - 3600000)),
      body: payload,
    },
    { headers: { "content-type": "application/json" }, body: payload },
  ]) {
    expect((await fetch(base, { method: "POST", ...request })).status).toBe(
      400,
    );
  }
  expect(applyClerkEvent).not.toHaveBeenCalled();
});

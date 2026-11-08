import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createHTTPServer } from "@trpc/server/adapters/standalone";
import superjson from "superjson";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { type SQL } from "drizzle-orm";
import { type db } from "~/server/db";
import { postRouter } from "~/server/api/routers/post";

vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/libs/buildHelpers", () => ({
  userJobHelper: { insertJob: vi.fn(), getJobs: vi.fn() },
}));

import { userJobHelper } from "~/libs/buildHelpers";

describe("postRouter authentication and ownership", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps public greetings accessible", async () => {
    const caller = postRouter.createCaller({
      userId: null,
      db: {} as typeof db,
    });
    await expect(caller.hello({ text: "world" })).resolves.toEqual({
      greeting: "Hello world",
    });
  });

  it("rejects every protected operation without authentication", async () => {
    const caller = postRouter.createCaller({
      userId: null,
      db: {} as typeof db,
    });
    for (const request of [
      () => caller.create({ name: "post" }),
      () => caller.getLatest(),
      () => caller.createJob(),
      () => caller.getJobs(),
      () => caller.getSecretMessage(),
    ]) {
      await expect(request()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
    expect(userJobHelper.insertJob).not.toHaveBeenCalled();
    expect(userJobHelper.getJobs).not.toHaveBeenCalled();
  });

  it("assigns posts to the verified Clerk user", async () => {
    const returning = vi
      .fn()
      .mockResolvedValue([{ id: 1, name: "test", createdById: "user_owner" }]);
    const values = vi.fn().mockReturnValue({ returning });
    const database = {
      insert: vi.fn().mockReturnValue({ values }),
    } as unknown as typeof db;
    const caller = postRouter.createCaller({
      userId: "user_owner",
      db: database,
    });
    await caller.create({ name: "test" });
    expect(values).toHaveBeenCalledWith({
      name: "test",
      createdById: "user_owner",
    });
  });

  it("filters latest posts by the verified user ID", async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const orderBy = vi.fn().mockReturnValue({ limit });
    const where = vi.fn().mockReturnValue({ orderBy });
    const database = {
      select: vi
        .fn()
        .mockReturnValue({ from: vi.fn().mockReturnValue({ where }) }),
    } as unknown as typeof db;
    const caller = postRouter.createCaller({
      userId: "user_owner",
      db: database,
    });
    await expect(caller.getLatest()).resolves.toBeNull();
    const condition = where.mock.calls[0]?.[0] as SQL;
    const query = new PgDialect().sqlToQuery(condition);
    expect(query.sql).toContain('"posts"."created_by_id"');
    expect(query.params).toEqual(["user_owner"]);
  });

  it("passes the verified user ID to job operations", async () => {
    const caller = postRouter.createCaller({
      userId: "user_owner",
      db: {} as typeof db,
    });
    await caller.createJob();
    await caller.getJobs();
    expect(userJobHelper.insertJob).toHaveBeenCalledWith("user_owner");
    expect(userJobHelper.getJobs).toHaveBeenCalledWith("user_owner");
  });
});

describe("tRPC 11 HTTP protocol", () => {
  it("serializes requests and enforces auth and Zod validation over HTTP", async () => {
    const server = createHTTPServer({
      router: postRouter,
      createContext: () => ({ userId: null, db: {} as typeof db }),
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Missing test server address");
      const client = createTRPCClient<typeof postRouter>({
        links: [
          httpBatchLink({
            url: `http://127.0.0.1:${address.port}`,
            transformer: superjson,
          }),
        ],
      });
      await expect(
        client.hello.query({ text: "HTTP client" }),
      ).resolves.toEqual({ greeting: "Hello HTTP client" });
      await expect(client.getSecretMessage.query()).rejects.toMatchObject({
        data: { code: "UNAUTHORIZED" },
      });
      // Simulate a malformed request from an untyped client.
      await expect(
        client.hello.query({ text: 42 } as unknown as { text: string }),
      ).rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});

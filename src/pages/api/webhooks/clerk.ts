import type { NextApiRequest, NextApiResponse } from "next";
import { NextRequest } from "next/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { env } from "~/env";
import { withChatDb } from "~/server/chat-db";
import { applyClerkEvent } from "~/server/chat/identity";

export const config = { api: { bodyParser: false } };
export default async function clerkWebhook(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).end();
    return;
  }
  if (!env.CLERK_WEBHOOK_SIGNING_SECRET) {
    res.status(503).end();
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 262144) {
      res.status(413).end();
      return;
    }
    chunks.push(bytes);
  }
  const headers = new Headers();
  for (const key of ["svix-id", "svix-timestamp", "svix-signature"]) {
    const value = req.headers[key];
    if (typeof value !== "string") {
      res.status(400).end();
      return;
    }
    headers.set(key, value);
  }
  let event;
  try {
    // Preserve exact raw bytes. Clerk's Pages adapter JSON-stringifies req.body,
    // which would invalidate signatures on a differently formatted JSON payload.
    event = await verifyWebhook(
      new NextRequest("https://gather.invalid/api/webhooks/clerk", {
        method: "POST",
        headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }),
      { signingSecret: env.CLERK_WEBHOOK_SIGNING_SECRET },
    );
  } catch {
    res.status(400).end();
    return;
  }
  try {
    await withChatDb((db) =>
      db.transaction((tx) =>
        applyClerkEvent(
          tx,
          event,
          headers.get("svix-id")!,
          new Date(Number(headers.get("svix-timestamp")) * 1000),
        ),
      ),
    );
    res.status(200).end();
  } catch {
    res.status(503).end();
  }
}

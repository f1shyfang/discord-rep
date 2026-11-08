import { assertIdentity } from "~/server/chat/identity";
import type { NextApiRequest, NextApiResponse } from "next";
import { getAuth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { withChatDb } from "~/server/chat-db";
import { actorFor, conversationAccess, uuid } from "~/server/chat/core";

export const config = { api: { responseLimit: false } };
// SSE sends only invalidation hints. Every message body is fetched through an
// independently authorized tRPC read, and every stream tick rechecks access.
export default async function chatEvents(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).end();
    return;
  }
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).end();
    return;
  }
  const parsed = uuid.safeParse(req.query.conversationId);
  if (!parsed.success) {
    res.status(400).end();
    return;
  }
  let closed = false;
  let initialized = false;
  let lastSeq: string | null = null;
  let lastPermissions: number | null = null;
  const stop = () => {
    closed = true;
  };
  res.on("close", stop);
  try {
    await withChatDb(async (db) => {
      // Bound connection lifetime and JWT validity. Reconnect goes through Clerk
      // middleware again and reconciles durable state, without URL auth tokens.
      const exp = auth.sessionClaims?.exp;
      const deadline = Math.min(
        Date.now() + 25000,
        exp ? exp * 1000 : Date.now() + 25000,
      );
      while (!closed && Date.now() < deadline) {
        const state = await db.transaction(async (tx) => {
          await assertIdentity(tx, auth.userId!, auth.sessionId);
          const actor = await actorFor(tx, auth.userId!);
          return conversationAccess(tx, actor, parsed.data);
        });
        if (closed) break;
        if (!initialized) {
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/event-stream");
          res.setHeader(
            "Cache-Control",
            "private, no-cache, no-store, no-transform",
          );
          res.setHeader("X-Accel-Buffering", "no");
          initialized = true;
          res.write("retry: 1000\n\n");
        }
        const seq = state.conversation.lastEventSeq.toString();
        const event = lastSeq === null ? "ready" : "changed";
        if (lastSeq !== seq || lastPermissions !== state.permissions) {
          if (
            !res.write(`event: ${event}\ndata: ${JSON.stringify({ seq })}\n\n`)
          )
            break;
          lastSeq = seq;
          lastPermissions = state.permissions;
        } else if (!res.write(": heartbeat\n\n")) break;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(done, 1000);
          function done() {
            clearTimeout(timer);
            res.off("close", done);
            resolve();
          }
          res.once("close", done);
        });
      }
    });
  } catch (error) {
    const revoked =
      error instanceof TRPCError &&
      [
        "UNAUTHORIZED",
        "FORBIDDEN",
        "NOT_FOUND",
        "PRECONDITION_FAILED",
      ].includes(error.code);
    if (!closed && initialized && revoked)
      res.write("event: revoked\ndata: {}\n\n");
    else if (!closed && !initialized) res.status(revoked ? 404 : 503);
  } finally {
    res.off("close", stop);
    if (!closed) res.end();
  }
}

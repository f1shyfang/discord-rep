import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import type { WebhookEvent } from "@clerk/nextjs/webhooks";
import type { Tx } from "./core";
import * as s from "~/server/db/chat-schema";

export async function assertIdentity(
  tx: Tx,
  clerkId: string,
  sessionId?: string | null,
) {
  const [identity] = await tx
    .select()
    .from(s.identityRevocations)
    .where(eq(s.identityRevocations.clerkId, clerkId));
  if (identity)
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Account unavailable.",
    });
  if (sessionId) {
    const [session] = await tx
      .select()
      .from(s.sessionRevocations)
      .where(eq(s.sessionRevocations.sessionId, sessionId));
    if (session)
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Session ended. Please sign in again.",
      });
  }
}
export async function applyClerkEvent(
  tx: Tx,
  event: WebhookEvent,
  deliveryId: string,
  signedAt: Date,
) {
  const inserted = await tx
    .insert(s.webhookReceipts)
    .values({ deliveryId, eventType: event.type, signedAt })
    .onConflictDoNothing()
    .returning();
  if (!inserted.length) return;
  if (event.type === "user.deleted" && event.data.id) {
    // Deletion is terminal. Delayed user.updated/created deliveries never resurrect
    // an identity, even when deletion arrived before the first onboarding request.
    await tx
      .insert(s.identityRevocations)
      .values({ clerkId: event.data.id })
      .onConflictDoNothing();
    await tx
      .update(s.appUsers)
      .set({ disabledAt: new Date(), status: "invisible" })
      .where(eq(s.appUsers.clerkId, event.data.id));
  } else if (
    ["session.ended", "session.removed", "session.revoked"].includes(
      event.type,
    ) &&
    "id" in event.data &&
    typeof event.data.id === "string"
  ) {
    await tx
      .insert(s.sessionRevocations)
      .values({ sessionId: event.data.id })
      .onConflictDoNothing();
  }
}

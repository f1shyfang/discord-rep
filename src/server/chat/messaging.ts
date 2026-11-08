import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  blockedPair,
  conversationAccess,
  fail,
  userDTO,
  type Actor,
  type Tx,
} from "./core";
import * as s from "~/server/db/chat-schema";

export const bodyInput = z
  .string()
  .refine(
    (s) => Array.from(s).length <= 2000,
    "Messages can contain up to 2,000 characters.",
  )
  .refine((s) => s.trim().length > 0, "Write a message before sending.");
export async function messageDTOs(
  tx: Tx,
  actor: Actor,
  rows: (typeof s.messages.$inferSelect)[],
) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const people = await tx
    .select()
    .from(s.appUsers)
    .where(inArray(s.appUsers.id, [...new Set(rows.map((r) => r.authorId))]));
  const reactionRows = await tx
    .select()
    .from(s.reactions)
    .where(inArray(s.reactions.messageId, ids));
  const blocked = await tx
    .select()
    .from(s.blocks)
    .where(eq(s.blocks.blockerId, actor.id));
  return rows.map(({ requestHash, ...m }) => {
    void requestHash;
    return {
      ...m,
      seq: m.seq.toString(),
      author: userDTO(people.find((u) => u.id === m.authorId)!),
      blocked: blocked.some((b) => b.blockedId === m.authorId),
      reactions: [
        ...new Set(
          reactionRows.filter((r) => r.messageId === m.id).map((r) => r.emoji),
        ),
      ].map((emoji) => {
        const matches = reactionRows.filter(
          (r) => r.messageId === m.id && r.emoji === emoji,
        );
        return {
          emoji,
          count: matches.length,
          mine: matches.some((r) => r.userId === actor.id),
        };
      }),
    };
  });
}
export async function replaceMentions(
  tx: Tx,
  actor: Actor,
  conversation: typeof s.conversations.$inferSelect,
  messageId: string,
  body: string,
) {
  await tx.delete(s.mentions).where(eq(s.mentions.messageId, messageId));
  const ids = [
    ...new Set(
      [
        ...body.matchAll(
          /<@([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})>/g,
        ),
      ].map((m) => m[1]!),
    ),
  ];
  for (const id of ids) {
    if (id === actor.id) continue;
    const [user] = await tx
      .select()
      .from(s.appUsers)
      .where(eq(s.appUsers.id, id));
    if (!user || user.disabledAt || (await blockedPair(tx, actor.id, user.id)))
      continue;
    // A failed permission check has no SQL side effects; do not leak inaccessible mentions.
    try {
      await conversationAccess(tx, user, conversation.id);
    } catch {
      continue;
    }
    await tx
      .insert(s.mentions)
      .values({ messageId, userId: id })
      .onConflictDoNothing();
  }
}
export async function messageForAction(
  tx: Tx,
  actor: Actor,
  messageId: string,
  permission: number,
) {
  const [initial] = await tx
    .select()
    .from(s.messages)
    .where(eq(s.messages.id, messageId));
  if (!initial) fail("NOT_FOUND", "Message unavailable.");
  const access = await conversationAccess(
    tx,
    actor,
    initial.conversationId,
    permission,
  );
  await tx
    .select()
    .from(s.conversations)
    .where(eq(s.conversations.id, initial.conversationId))
    .for("update");
  const [message] = await tx
    .select()
    .from(s.messages)
    .where(eq(s.messages.id, messageId));
  return { ...access, message: message! };
}
export async function ackRead(
  tx: Tx,
  actor: Actor,
  conversationId: string,
  seq: bigint,
) {
  const { conversation } = await conversationAccess(tx, actor, conversationId);
  if (seq > conversation.lastMessageSeq)
    fail("BAD_REQUEST", "Read position is ahead of the conversation.");
  const [read] = await tx
    .insert(s.conversationReads)
    .values({ conversationId, userId: actor.id, lastReadSeq: seq })
    .onConflictDoUpdate({
      target: [s.conversationReads.conversationId, s.conversationReads.userId],
      set: {
        lastReadSeq: sql`greatest(${s.conversationReads.lastReadSeq}, excluded.last_read_seq)`,
      },
    })
    .returning();
  return { lastReadSeq: read!.lastReadSeq.toString() };
}
export const messageWhere = (conversationId: string) =>
  eq(s.messages.conversationId, conversationId);

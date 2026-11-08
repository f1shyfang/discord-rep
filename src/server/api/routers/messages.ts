import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { createTRPCRouter } from "~/server/api/trpc";
import { chatProcedure } from "~/server/chat/procedure";
import {
  ackRead,
  bodyInput,
  messageDTOs,
  messageForAction,
  replaceMentions,
} from "~/server/chat/messaging";
import {
  conversationAccess,
  fail,
  hash,
  rateLimit,
  recordEvent,
  seq,
  uuid,
} from "~/server/chat/core";
import { P } from "~/server/chat/permissions";
import * as s from "~/server/db/chat-schema";

const conversationInput = z.object({ conversationId: uuid });
const pageInput = conversationInput.extend({
  cursor: seq.optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export const messagesRouter = createTRPCRouter({
  list: chatProcedure.input(pageInput).query(async ({ ctx, input }) => {
    const access = await conversationAccess(
      ctx.tx,
      ctx.actor,
      input.conversationId,
    );
    const [snapshot] = await ctx.tx
      .select()
      .from(s.conversations)
      .where(eq(s.conversations.id, input.conversationId))
      .for("share");
    const [read] = await ctx.tx
      .select()
      .from(s.conversationReads)
      .where(
        and(
          eq(s.conversationReads.conversationId, input.conversationId),
          eq(s.conversationReads.userId, ctx.actor.id),
        ),
      );
    const rows = await ctx.tx
      .select()
      .from(s.messages)
      .where(
        and(
          eq(s.messages.conversationId, input.conversationId),
          input.cursor ? lt(s.messages.seq, BigInt(input.cursor)) : undefined,
        ),
      )
      .orderBy(desc(s.messages.seq))
      .limit(input.limit + 1);
    const hasMore = rows.length > input.limit;
    if (hasMore) rows.pop();
    return {
      items: await messageDTOs(ctx.tx, ctx.actor, rows.reverse()),
      before: hasMore ? rows[0]!.seq.toString() : null,
      permissions: access.permissions,
      lastReadSeq: read?.lastReadSeq.toString() ?? "0",
      latestSeq: snapshot!.lastMessageSeq.toString(),
      eventSeq: snapshot!.lastEventSeq.toString(),
    };
  }),
  send: chatProcedure
    .input(
      conversationInput.extend({
        clientNonce: uuid,
        body: bodyInput,
        replyToId: uuid.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await conversationAccess(
        ctx.tx,
        ctx.actor,
        input.conversationId,
        P.SEND_MESSAGES,
      );
      const [conversation] = await ctx.tx
        .select()
        .from(s.conversations)
        .where(eq(s.conversations.id, input.conversationId))
        .for("update");
      const requestHash = hash({
        body: input.body,
        replyToId: input.replyToId ?? null,
      });
      const [existing] = await ctx.tx
        .select()
        .from(s.messages)
        .where(
          and(
            eq(s.messages.conversationId, input.conversationId),
            eq(s.messages.authorId, ctx.actor.id),
            eq(s.messages.clientNonce, input.clientNonce),
          ),
        );
      if (existing) {
        if (existing.requestHash !== requestHash)
          fail(
            "CONFLICT",
            "This message retry has different content. Start a new message.",
          );
        return (await messageDTOs(ctx.tx, ctx.actor, [existing]))[0]!;
      }
      await rateLimit(ctx.tx, `send:second:${ctx.actor.id}`, 5, 1);
      await rateLimit(
        ctx.tx,
        `send:minute:${ctx.actor.id}:${input.conversationId}`,
        30,
        60,
      );
      if (input.replyToId) {
        const [reply] = await ctx.tx
          .select()
          .from(s.messages)
          .where(
            and(
              eq(s.messages.id, input.replyToId),
              eq(s.messages.conversationId, input.conversationId),
              isNull(s.messages.deletedAt),
            ),
          );
        if (!reply) fail("BAD_REQUEST", "The reply target is unavailable.");
      }
      const nextSeq = conversation!.lastMessageSeq + 1n;
      const [message] = await ctx.tx
        .insert(s.messages)
        .values({ ...input, authorId: ctx.actor.id, requestHash, seq: nextSeq })
        .returning();
      await ctx.tx
        .update(s.conversations)
        .set({ lastMessageSeq: nextSeq })
        .where(eq(s.conversations.id, input.conversationId));
      await replaceMentions(
        ctx.tx,
        ctx.actor,
        access.conversation,
        message!.id,
        input.body,
      );
      await recordEvent(
        ctx.tx,
        input.conversationId,
        "message.created",
        message!.id,
      );
      return (await messageDTOs(ctx.tx, ctx.actor, [message!]))[0]!;
    }),
  edit: chatProcedure
    .input(
      z.object({
        messageId: uuid,
        body: bodyInput,
        expectedVersion: z.number().int().positive(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { message, conversation } = await messageForAction(
        ctx.tx,
        ctx.actor,
        input.messageId,
        P.SEND_MESSAGES,
      );
      if (message.authorId !== ctx.actor.id || message.deletedAt)
        fail("FORBIDDEN", "Only your own available messages can be edited.");
      if (message.version !== input.expectedVersion)
        fail("CONFLICT", "This message changed. Reload before editing.");
      const [edited] = await ctx.tx
        .update(s.messages)
        .set({
          body: input.body,
          editedAt: new Date(),
          version: message.version + 1,
        })
        .where(eq(s.messages.id, input.messageId))
        .returning();
      await replaceMentions(
        ctx.tx,
        ctx.actor,
        conversation,
        message.id,
        input.body,
      );
      await recordEvent(
        ctx.tx,
        message.conversationId,
        "message.updated",
        message.id,
      );
      return (await messageDTOs(ctx.tx, ctx.actor, [edited!]))[0]!;
    }),
  delete: chatProcedure
    .input(
      z.object({
        messageId: uuid,
        expectedVersion: z.number().int().positive(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { message, permissions } = await messageForAction(
        ctx.tx,
        ctx.actor,
        input.messageId,
        P.VIEW_CHANNEL,
      );
      if (
        message.authorId !== ctx.actor.id &&
        !(permissions & P.MANAGE_MESSAGES)
      )
        fail("FORBIDDEN", "You cannot delete this message.");
      if (message.deletedAt)
        return (await messageDTOs(ctx.tx, ctx.actor, [message]))[0]!;
      if (message.version !== input.expectedVersion)
        fail("CONFLICT", "This message changed. Reload before deleting.");
      const [deleted] = await ctx.tx
        .update(s.messages)
        .set({ body: "", deletedAt: new Date(), version: message.version + 1 })
        .where(eq(s.messages.id, message.id))
        .returning();
      await ctx.tx
        .delete(s.mentions)
        .where(eq(s.mentions.messageId, message.id));
      await ctx.tx
        .delete(s.reactions)
        .where(eq(s.reactions.messageId, message.id));
      await recordEvent(
        ctx.tx,
        message.conversationId,
        "message.deleted",
        message.id,
      );
      return (await messageDTOs(ctx.tx, ctx.actor, [deleted!]))[0]!;
    }),
  react: chatProcedure
    .input(
      z.object({
        messageId: uuid,
        emoji: z
          .string()
          .max(32)
          .regex(
            /^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:\uFE0F|\p{Emoji_Modifier}|\u200D\p{Extended_Pictographic})*$/u,
            "Choose a Unicode emoji.",
          ),
        present: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { message } = await messageForAction(
        ctx.tx,
        ctx.actor,
        input.messageId,
        P.ADD_REACTIONS,
      );
      if (message.deletedAt)
        fail("BAD_REQUEST", "Deleted messages cannot receive reactions.");
      await rateLimit(ctx.tx, `reaction:${ctx.actor.id}`, 30, 60);
      if (input.present)
        await ctx.tx
          .insert(s.reactions)
          .values({
            messageId: message.id,
            userId: ctx.actor.id,
            emoji: input.emoji,
          })
          .onConflictDoNothing();
      else
        await ctx.tx
          .delete(s.reactions)
          .where(
            and(
              eq(s.reactions.messageId, message.id),
              eq(s.reactions.userId, ctx.actor.id),
              eq(s.reactions.emoji, input.emoji),
            ),
          );
      await ctx.tx
        .update(s.messages)
        .set({ version: message.version + 1 })
        .where(eq(s.messages.id, message.id));
      await recordEvent(
        ctx.tx,
        message.conversationId,
        "reaction.updated",
        message.id,
      );
      return { ok: true };
    }),
  around: chatProcedure
    .input(conversationInput.extend({ messageId: uuid }))
    .query(async ({ ctx, input }) => {
      await conversationAccess(ctx.tx, ctx.actor, input.conversationId);
      const [target] = await ctx.tx
        .select()
        .from(s.messages)
        .where(
          and(
            eq(s.messages.id, input.messageId),
            eq(s.messages.conversationId, input.conversationId),
          ),
        );
      if (!target) fail("NOT_FOUND", "Message unavailable.");
      const older = await ctx.tx
        .select()
        .from(s.messages)
        .where(
          and(
            eq(s.messages.conversationId, input.conversationId),
            lt(s.messages.seq, target.seq),
          ),
        )
        .orderBy(desc(s.messages.seq))
        .limit(25);
      const newer = await ctx.tx
        .select()
        .from(s.messages)
        .where(
          and(
            eq(s.messages.conversationId, input.conversationId),
            gt(s.messages.seq, target.seq),
          ),
        )
        .orderBy(asc(s.messages.seq))
        .limit(25);
      return messageDTOs(ctx.tx, ctx.actor, [
        ...older.reverse(),
        target,
        ...newer,
      ]);
    }),
});
export const readsRouter = createTRPCRouter({
  ack: chatProcedure
    .input(conversationInput.extend({ seq }))
    .mutation(({ ctx, input }) =>
      ackRead(ctx.tx, ctx.actor, input.conversationId, BigInt(input.seq)),
    ),
  summary: chatProcedure
    .input(z.object({ conversationIds: z.array(uuid).max(100) }))
    .query(async ({ ctx, input }) => {
      const preferences = input.conversationIds.length
        ? await ctx.tx
            .select()
            .from(s.conversationPreferences)
            .where(
              and(
                eq(s.conversationPreferences.userId, ctx.actor.id),
                inArray(
                  s.conversationPreferences.conversationId,
                  input.conversationIds,
                ),
              ),
            )
        : [];
      const results = [];
      for (const id of [...new Set(input.conversationIds)].sort()) {
        try {
          await conversationAccess(ctx.tx, ctx.actor, id);
        } catch {
          continue;
        }
        const [read] = await ctx.tx
          .select()
          .from(s.conversationReads)
          .where(
            and(
              eq(s.conversationReads.conversationId, id),
              eq(s.conversationReads.userId, ctx.actor.id),
            ),
          );
        const lastRead = read?.lastReadSeq ?? 0n;
        const [counts] = await ctx.tx
          .select({
            unread: sql<number>`count(*)::int`,
            mentions: sql<number>`count(${s.mentions.userId})::int`,
          })
          .from(s.messages)
          .leftJoin(
            s.mentions,
            and(
              eq(s.mentions.messageId, s.messages.id),
              eq(s.mentions.userId, ctx.actor.id),
            ),
          )
          .where(
            and(
              eq(s.messages.conversationId, id),
              gt(s.messages.seq, lastRead),
              isNull(s.messages.deletedAt),
              sql`${s.messages.authorId} <> ${ctx.actor.id}`,
            ),
          );
        results.push({
          conversationId: id,
          lastReadSeq: lastRead.toString(),
          notificationMode:
            preferences.find((p) => p.conversationId === id)
              ?.notificationMode ?? ("all" as const),
          unread: counts!.unread,
          mentions: counts!.mentions,
        });
      }
      return results;
    }),
});
export const searchRouter = createTRPCRouter({
  messages: chatProcedure
    .input(pageInput.extend({ query: z.string().trim().min(2).max(200) }))
    .query(async ({ ctx, input }) => {
      await conversationAccess(ctx.tx, ctx.actor, input.conversationId);
      await rateLimit(ctx.tx, `search:${ctx.actor.id}`, 20, 60);
      const rows = await ctx.tx
        .select()
        .from(s.messages)
        .where(
          and(
            eq(s.messages.conversationId, input.conversationId),
            isNull(s.messages.deletedAt),
            sql`to_tsvector('simple', ${s.messages.body}) @@ plainto_tsquery('simple', ${input.query})`,
            input.cursor ? lt(s.messages.seq, BigInt(input.cursor)) : undefined,
          ),
        )
        .orderBy(desc(s.messages.seq))
        .limit(input.limit + 1);
      const hasMore = rows.length > input.limit;
      if (hasMore) rows.pop();
      return {
        items: await messageDTOs(ctx.tx, ctx.actor, rows),
        before: hasMore ? rows.at(-1)!.seq.toString() : null,
      };
    }),
});
export const syncRouter = createTRPCRouter({
  delta: chatProcedure
    .input(conversationInput.extend({ after: seq }))
    .query(async ({ ctx, input }) => {
      const { conversation } = await conversationAccess(
        ctx.tx,
        ctx.actor,
        input.conversationId,
      );
      if (BigInt(input.after) > conversation.lastEventSeq)
        fail("CONFLICT", "Reset this conversation to recover.");
      if (BigInt(input.after) < conversation.lastEventSeq) {
        const [oldest] = await ctx.tx
          .select()
          .from(s.outboxEvents)
          .where(eq(s.outboxEvents.conversationId, input.conversationId))
          .orderBy(s.outboxEvents.eventSeq)
          .limit(1);
        if (!oldest || BigInt(input.after) < oldest.eventSeq - 1n)
          fail(
            "CONFLICT",
            "Recovery history expired. Reload this conversation.",
          );
      }
      const events = await ctx.tx
        .select()
        .from(s.outboxEvents)
        .where(
          and(
            eq(s.outboxEvents.conversationId, input.conversationId),
            gt(s.outboxEvents.eventSeq, BigInt(input.after)),
          ),
        )
        .orderBy(s.outboxEvents.eventSeq)
        .limit(101);
      const hasMore = events.length > 100;
      if (hasMore) events.pop();
      const rows = events.length
        ? await ctx.tx
            .select()
            .from(s.messages)
            .where(
              and(
                eq(s.messages.conversationId, input.conversationId),
                inArray(
                  s.messages.id,
                  events.map((e) => e.entityId),
                ),
              ),
            )
        : [];
      return {
        items: await messageDTOs(ctx.tx, ctx.actor, rows),
        next: events.at(-1)?.eventSeq.toString() ?? input.after,
        hasMore,
      };
    }),
});
export const preferencesRouter = createTRPCRouter({
  get: chatProcedure.input(conversationInput).query(async ({ ctx, input }) => {
    await conversationAccess(ctx.tx, ctx.actor, input.conversationId);
    const [pref] = await ctx.tx
      .select()
      .from(s.conversationPreferences)
      .where(
        and(
          eq(s.conversationPreferences.conversationId, input.conversationId),
          eq(s.conversationPreferences.userId, ctx.actor.id),
        ),
      );
    return { notificationMode: pref?.notificationMode ?? ("all" as const) };
  }),
  set: chatProcedure
    .input(
      conversationInput.extend({
        notificationMode: z.enum(["all", "mentions", "none"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await conversationAccess(ctx.tx, ctx.actor, input.conversationId);
      await ctx.tx
        .insert(s.conversationPreferences)
        .values({ ...input, userId: ctx.actor.id })
        .onConflictDoUpdate({
          target: [
            s.conversationPreferences.conversationId,
            s.conversationPreferences.userId,
          ],
          set: { notificationMode: input.notificationMode },
        });
      return { ok: true };
    }),
});

import { and, eq, gt, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { createTRPCRouter } from "~/server/api/trpc";
import { chatProcedure } from "~/server/chat/procedure";
import {
  blockedPair,
  conversationAccess,
  serverAccess,
  uuid,
} from "~/server/chat/core";
import { P } from "~/server/chat/permissions";
import * as s from "~/server/db/chat-schema";

export const activityRouter = createTRPCRouter({
  heartbeat: chatProcedure.mutation(async ({ ctx }) => {
    await ctx.tx
      .insert(s.activity)
      .values({ userId: ctx.actor.id, seenAt: new Date() })
      .onConflictDoUpdate({
        target: s.activity.userId,
        set: { seenAt: new Date() },
      });
    return { ok: true };
  }),
  typing: chatProcedure
    .input(z.object({ conversationId: uuid, active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await conversationAccess(
        ctx.tx,
        ctx.actor,
        input.conversationId,
        P.SEND_MESSAGES,
      );
      if (input.active)
        await ctx.tx
          .insert(s.typing)
          .values({
            conversationId: input.conversationId,
            userId: ctx.actor.id,
            expiresAt: new Date(Date.now() + 6000),
          })
          .onConflictDoUpdate({
            target: [s.typing.conversationId, s.typing.userId],
            set: { expiresAt: new Date(Date.now() + 6000) },
          });
      else
        await ctx.tx
          .delete(s.typing)
          .where(
            and(
              eq(s.typing.conversationId, input.conversationId),
              eq(s.typing.userId, ctx.actor.id),
            ),
          );
      return { ok: true };
    }),
  typists: chatProcedure
    .input(z.object({ conversationId: uuid }))
    .query(async ({ ctx, input }) => {
      await conversationAccess(ctx.tx, ctx.actor, input.conversationId);
      const rows = await ctx.tx
        .select({ user: s.appUsers })
        .from(s.typing)
        .innerJoin(s.appUsers, eq(s.appUsers.id, s.typing.userId))
        .where(
          and(
            eq(s.typing.conversationId, input.conversationId),
            gt(s.typing.expiresAt, new Date()),
          ),
        );
      const result = [];
      for (const row of rows) {
        if (
          row.user.id === ctx.actor.id ||
          row.user.disabledAt ||
          (await blockedPair(ctx.tx, ctx.actor.id, row.user.id))
        )
          continue;
        try {
          await conversationAccess(ctx.tx, row.user, input.conversationId);
        } catch {
          continue;
        }
        result.push({ id: row.user.id, displayName: row.user.displayName });
      }
      return result;
    }),
  list: chatProcedure
    .input(z.object({ serverId: uuid.optional() }))
    .query(async ({ ctx, input }) => {
      let ids: string[];
      if (input.serverId) {
        await serverAccess(ctx.tx, ctx.actor, input.serverId);
        ids = (
          await ctx.tx
            .select()
            .from(s.serverMembers)
            .where(eq(s.serverMembers.serverId, input.serverId))
        ).map((m) => m.userId);
      } else {
        ids = (
          await ctx.tx
            .select()
            .from(s.friendships)
            .where(
              and(
                eq(s.friendships.status, "accepted"),
                or(
                  eq(s.friendships.userLow, ctx.actor.id),
                  eq(s.friendships.userHigh, ctx.actor.id),
                ),
              ),
            )
        ).map((f) => (f.userLow === ctx.actor.id ? f.userHigh : f.userLow));
      }
      if (!ids.length) return [];
      const people = await ctx.tx
        .select({ user: s.appUsers, activity: s.activity })
        .from(s.appUsers)
        .leftJoin(s.activity, eq(s.activity.userId, s.appUsers.id))
        .where(inArray(s.appUsers.id, ids));
      const blocks = await ctx.tx
        .select()
        .from(s.blocks)
        .where(
          or(
            eq(s.blocks.blockerId, ctx.actor.id),
            eq(s.blocks.blockedId, ctx.actor.id),
          ),
        );
      const blocked = new Set(
        blocks.map((b) =>
          b.blockerId === ctx.actor.id ? b.blockedId : b.blockerId,
        ),
      );
      const result = people
        .filter((row) => !blocked.has(row.user.id))
        .map((row) => ({
          userId: row.user.id,
          status:
            !row.user.disabledAt &&
            row.user.status !== "invisible" &&
            row.activity &&
            row.activity.seenAt.getTime() > Date.now() - 75000
              ? row.user.status
              : ("offline" as const),
        }));
      return result;
    }),
});

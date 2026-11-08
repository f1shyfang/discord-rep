import { and, eq, or } from "drizzle-orm";
import { z } from "zod";
import { createTRPCRouter } from "~/server/api/trpc";
import {
  attemptLimitedChatProcedure,
  chatProcedure,
} from "~/server/chat/procedure";
import {
  blockedPair,
  fail,
  handle,
  pairLock,
  userDTO,
  uuid,
} from "~/server/chat/core";
import * as s from "~/server/db/chat-schema";

const target = z.object({ userId: uuid });
export const friendsRouter = createTRPCRouter({
  list: chatProcedure.query(async ({ ctx }) => {
    const rows = await ctx.tx
      .select()
      .from(s.friendships)
      .where(
        or(
          eq(s.friendships.userLow, ctx.actor.id),
          eq(s.friendships.userHigh, ctx.actor.id),
        ),
      );
    const blocked = await ctx.tx
      .select()
      .from(s.blocks)
      .where(eq(s.blocks.blockerId, ctx.actor.id));
    const ids = [
      ...rows.map((r) => (r.userLow === ctx.actor.id ? r.userHigh : r.userLow)),
      ...blocked.map((b) => b.blockedId),
    ];
    const users = ids.length
      ? await ctx.tx
          .select()
          .from(s.appUsers)
          .where(or(...ids.map((id) => eq(s.appUsers.id, id))))
      : [];
    return {
      friends: rows.map((r) => ({
        user: userDTO(
          users.find(
            (u) =>
              u.id === (r.userLow === ctx.actor.id ? r.userHigh : r.userLow),
          )!,
        ),
        status: r.status,
        incoming: r.requesterId !== ctx.actor.id,
      })),
      blocked: blocked.map((b) =>
        userDTO(users.find((u) => u.id === b.blockedId)!),
      ),
    };
  }),
  request: attemptLimitedChatProcedure("friend-request", 10, 3600)
    .input(z.object({ handle }))
    .mutation(async ({ ctx, input }) => {
      const [user] = await ctx.tx
        .select()
        .from(s.appUsers)
        .where(eq(s.appUsers.handle, input.handle));
      if (!user || user.disabledAt || user.id === ctx.actor.id)
        fail("BAD_REQUEST", "Friend request unavailable. Check the handle.");
      const pair = await pairLock(ctx.tx, ctx.actor.id, user.id);
      if (await blockedPair(ctx.tx, ctx.actor.id, user.id))
        fail("BAD_REQUEST", "Friend request unavailable. Check the handle.");
      await ctx.tx
        .insert(s.friendships)
        .values({ ...pair, requesterId: ctx.actor.id, status: "pending" })
        .onConflictDoNothing();
      return { ok: true };
    }),
  respond: chatProcedure
    .input(target.extend({ action: z.enum(["accept", "decline"]) }))
    .mutation(async ({ ctx, input }) => {
      const pair = await pairLock(ctx.tx, ctx.actor.id, input.userId);
      const where = and(
        eq(s.friendships.userLow, pair.userLow),
        eq(s.friendships.userHigh, pair.userHigh),
      );
      const [friendship] = await ctx.tx
        .select()
        .from(s.friendships)
        .where(where);
      if (
        !friendship ||
        friendship.status !== "pending" ||
        friendship.requesterId === ctx.actor.id
      )
        fail("NOT_FOUND", "Incoming request unavailable.");
      if (await blockedPair(ctx.tx, ctx.actor.id, input.userId))
        fail("FORBIDDEN", "Friend request unavailable.");
      if (input.action === "accept")
        await ctx.tx
          .update(s.friendships)
          .set({ status: "accepted" })
          .where(where);
      else await ctx.tx.delete(s.friendships).where(where);
      return { ok: true };
    }),
  remove: chatProcedure.input(target).mutation(async ({ ctx, input }) => {
    const pair = await pairLock(ctx.tx, ctx.actor.id, input.userId);
    const where = and(
      eq(s.friendships.userLow, pair.userLow),
      eq(s.friendships.userHigh, pair.userHigh),
    );
    const [friendship] = await ctx.tx.select().from(s.friendships).where(where);
    if (
      friendship?.status === "pending" &&
      friendship.requesterId !== ctx.actor.id
    )
      fail("FORBIDDEN", "Use decline for an incoming request.");
    await ctx.tx.delete(s.friendships).where(where);
    return { ok: true };
  }),
  block: chatProcedure
    .input(target.extend({ blocked: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.actor.id === input.userId)
        fail("BAD_REQUEST", "You cannot block yourself.");
      const pair = await pairLock(ctx.tx, ctx.actor.id, input.userId);
      if (input.blocked) {
        const [user] = await ctx.tx
          .select()
          .from(s.appUsers)
          .where(eq(s.appUsers.id, input.userId));
        if (!user) fail("NOT_FOUND", "User unavailable.");
        await ctx.tx
          .insert(s.blocks)
          .values({ blockerId: ctx.actor.id, blockedId: input.userId })
          .onConflictDoNothing();
        await ctx.tx
          .delete(s.friendships)
          .where(
            and(
              eq(s.friendships.userLow, pair.userLow),
              eq(s.friendships.userHigh, pair.userHigh),
            ),
          );
      } else
        await ctx.tx
          .delete(s.blocks)
          .where(
            and(
              eq(s.blocks.blockerId, ctx.actor.id),
              eq(s.blocks.blockedId, input.userId),
            ),
          );
      return { ok: true };
    }),
});
export const dmRouter = createTRPCRouter({
  open: chatProcedure.input(target).mutation(async ({ ctx, input }) => {
    if (input.userId === ctx.actor.id)
      fail("BAD_REQUEST", "Choose another user.");
    const pair = await pairLock(ctx.tx, ctx.actor.id, input.userId);
    if (await blockedPair(ctx.tx, ctx.actor.id, input.userId))
      fail("FORBIDDEN", "Conversation unavailable.");
    const [existing] = await ctx.tx
      .select()
      .from(s.conversations)
      .where(
        and(
          eq(s.conversations.dmUserLow, pair.userLow),
          eq(s.conversations.dmUserHigh, pair.userHigh),
        ),
      );
    if (existing) return existing;
    const [friendship] = await ctx.tx
      .select()
      .from(s.friendships)
      .where(
        and(
          eq(s.friendships.userLow, pair.userLow),
          eq(s.friendships.userHigh, pair.userHigh),
          eq(s.friendships.status, "accepted"),
        ),
      );
    if (!friendship)
      fail(
        "FORBIDDEN",
        "Add this person as a friend before starting a conversation.",
      );
    const [conversation] = await ctx.tx
      .insert(s.conversations)
      .values({ dmUserLow: pair.userLow, dmUserHigh: pair.userHigh })
      .returning();
    return conversation!;
  }),
});

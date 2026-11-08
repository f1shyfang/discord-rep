import { and, eq, isNull, or } from "drizzle-orm";
import { createTRPCRouter } from "~/server/api/trpc";
import { identityProcedure, chatProcedure } from "~/server/chat/procedure";
import { fail, profileInput, userDTO } from "~/server/chat/core";
import * as s from "~/server/db/chat-schema";

export const usersRouter = createTRPCRouter({
  me: identityProcedure.query(async ({ ctx }) => {
    const [user] = await ctx.tx
      .select()
      .from(s.appUsers)
      .where(eq(s.appUsers.clerkId, ctx.userId));
    return user && !user.disabledAt ? user : null;
  }),
  save: identityProcedure
    .input(profileInput)
    .mutation(async ({ ctx, input }) => {
      // Serialize handle claims so duplicate handles become a field-level conflict.
      await ctx.tx.execute(
        (await import("drizzle-orm"))
          .sql`select pg_advisory_xact_lock(hashtextextended(${"handle:" + input.handle}, 0))`,
      );
      const [existing] = await ctx.tx
        .select()
        .from(s.appUsers)
        .where(eq(s.appUsers.handle, input.handle));
      if (existing && existing.clerkId !== ctx.userId)
        fail("CONFLICT", "That handle is taken. Try another.");
      const [current] = await ctx.tx
        .select()
        .from(s.appUsers)
        .where(eq(s.appUsers.clerkId, ctx.userId));
      if (current?.disabledAt) fail("FORBIDDEN", "Account unavailable.");
      const [user] = await ctx.tx
        .insert(s.appUsers)
        .values({ ...input, clerkId: ctx.userId })
        .onConflictDoUpdate({ target: s.appUsers.clerkId, set: input })
        .returning();
      return user!;
    }),
  bootstrap: chatProcedure.query(async ({ ctx }) => {
    const servers = await ctx.tx
      .select({
        id: s.servers.id,
        name: s.servers.name,
        ownerId: s.servers.ownerId,
      })
      .from(s.servers)
      .innerJoin(s.serverMembers, eq(s.serverMembers.serverId, s.servers.id))
      .where(
        and(
          eq(s.serverMembers.userId, ctx.actor.id),
          isNull(s.servers.deletedAt),
        ),
      )
      .orderBy(s.servers.createdAt);
    const dms = await ctx.tx
      .select()
      .from(s.conversations)
      .where(
        or(
          eq(s.conversations.dmUserLow, ctx.actor.id),
          eq(s.conversations.dmUserHigh, ctx.actor.id),
        ),
      )
      .orderBy(s.conversations.createdAt)
      .limit(100);
    const people = dms.length
      ? await ctx.tx
          .select()
          .from(s.appUsers)
          .where(
            or(
              ...dms.map((d) =>
                eq(
                  s.appUsers.id,
                  d.dmUserLow === ctx.actor.id ? d.dmUserHigh! : d.dmUserLow!,
                ),
              ),
            ),
          )
      : [];
    const blocked = await ctx.tx
      .select({ userId: s.blocks.blockedId })
      .from(s.blocks)
      .where(eq(s.blocks.blockerId, ctx.actor.id));
    return {
      user: ctx.actor,
      servers,
      dms: dms.map((d) => ({
        id: d.id,
        user: userDTO(
          people.find(
            (u) =>
              u.id ===
              (d.dmUserLow === ctx.actor.id ? d.dmUserHigh : d.dmUserLow),
          )!,
        ),
      })),
      blockedUserIds: blocked.map((b) => b.userId),
    };
  }),
});

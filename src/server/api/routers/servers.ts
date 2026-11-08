import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { createTRPCRouter } from "~/server/api/trpc";
import { chatProcedure } from "~/server/chat/procedure";
import {
  fail,
  name,
  remember,
  replay,
  requirePermission,
  serverAccess,
  userDTO,
  uuid,
  visibleChannels,
} from "~/server/chat/core";
import { DEFAULT_PERMISSIONS, P } from "~/server/chat/permissions";
import * as s from "~/server/db/chat-schema";

const serverInput = z.object({ serverId: uuid });
export const serversRouter = createTRPCRouter({
  create: chatProcedure
    .input(z.object({ name: name.min(2), requestId: uuid }))
    .mutation(async ({ ctx, input }) => {
      await ctx.tx
        .select()
        .from(s.appUsers)
        .where(eq(s.appUsers.id, ctx.actor.id))
        .for("update");
      const prior = await replay(
        ctx.tx,
        ctx.actor,
        "server.create",
        input.requestId,
        input,
      );
      if (prior) {
        const access = await serverAccess(ctx.tx, ctx.actor, prior);
        return {
          server: access.server,
          channelId:
            (await visibleChannels(ctx.tx, ctx.actor, prior)).find(
              (c) => c.kind === "text",
            )?.id ?? null,
        };
      }
      const [count] = await ctx.tx
        .select({ count: sql<number>`count(*)::int` })
        .from(s.serverMembers)
        .where(eq(s.serverMembers.userId, ctx.actor.id));
      if (count!.count >= 100)
        fail("CONFLICT", "You can join up to 100 servers.");
      const [server] = await ctx.tx
        .insert(s.servers)
        .values({ name: input.name, ownerId: ctx.actor.id })
        .returning();
      await ctx.tx
        .insert(s.serverMembers)
        .values({ serverId: server!.id, userId: ctx.actor.id });
      await ctx.tx
        .insert(s.roles)
        .values({
          serverId: server!.id,
          name: "everyone",
          position: 0,
          isEveryone: true,
          permissions: DEFAULT_PERMISSIONS,
        });
      const [category] = await ctx.tx
        .insert(s.categories)
        .values({ serverId: server!.id, name: "Text channels" })
        .returning();
      const [general] = await ctx.tx
        .insert(s.channels)
        .values({
          serverId: server!.id,
          categoryId: category!.id,
          name: "general",
          kind: "text",
        })
        .returning();
      await ctx.tx
        .insert(s.channels)
        .values({
          serverId: server!.id,
          name: "Lounge",
          kind: "voice",
          position: 1,
        });
      await ctx.tx.insert(s.conversations).values({ channelId: general!.id });
      await remember(
        ctx.tx,
        ctx.actor,
        "server.create",
        input.requestId,
        input,
        server!.id,
      );
      return { server: server!, channelId: general!.id };
    }),
  get: chatProcedure.input(serverInput).query(async ({ ctx, input }) => {
    const access = await serverAccess(ctx.tx, ctx.actor, input.serverId);
    const channels = await visibleChannels(ctx.tx, ctx.actor, input.serverId);
    const categories = await ctx.tx
      .select()
      .from(s.categories)
      .where(eq(s.categories.serverId, input.serverId))
      .orderBy(s.categories.position, s.categories.id);
    const members = await ctx.tx
      .select({ user: s.appUsers })
      .from(s.appUsers)
      .innerJoin(s.serverMembers, eq(s.serverMembers.userId, s.appUsers.id))
      .where(eq(s.serverMembers.serverId, input.serverId))
      .orderBy(s.appUsers.displayName)
      .limit(1000);
    const memberRoles = await ctx.tx
      .select()
      .from(s.memberRoles)
      .where(eq(s.memberRoles.serverId, input.serverId));
    const overwrites = await ctx.tx
      .select()
      .from(s.channelOverwrites)
      .where(eq(s.channelOverwrites.serverId, input.serverId));
    return {
      server: access.server,
      permissions: access.permissions,
      channels,
      categories,
      roles: access.roles,
      members: members.map((m) => ({
        ...userDTO(m.user),
        roleIds: memberRoles
          .filter((r) => r.userId === m.user.id)
          .map((r) => r.roleId),
      })),
      overwrites: access.permissions & P.MANAGE_ROLES ? overwrites : [],
    };
  }),
  update: chatProcedure
    .input(serverInput.extend({ name: name.min(2) }))
    .mutation(async ({ ctx, input }) => {
      const access = await serverAccess(
        ctx.tx,
        ctx.actor,
        input.serverId,
        true,
      );
      requirePermission(access.permissions, P.MANAGE_SERVER);
      await ctx.tx
        .update(s.servers)
        .set({ name: input.name })
        .where(eq(s.servers.id, input.serverId));
      return { ok: true };
    }),
  transfer: chatProcedure
    .input(serverInput.extend({ userId: uuid }))
    .mutation(async ({ ctx, input }) => {
      const { server } = await serverAccess(
        ctx.tx,
        ctx.actor,
        input.serverId,
        true,
      );
      if (server.ownerId !== ctx.actor.id)
        fail("FORBIDDEN", "Only the owner can transfer ownership.");
      const [member] = await ctx.tx
        .select()
        .from(s.serverMembers)
        .where(
          and(
            eq(s.serverMembers.serverId, input.serverId),
            eq(s.serverMembers.userId, input.userId),
          ),
        );
      if (!member) fail("NOT_FOUND", "Member unavailable.");
      await ctx.tx
        .update(s.servers)
        .set({
          ownerId: input.userId,
          authRevision: sql`${s.servers.authRevision} + 1`,
        })
        .where(eq(s.servers.id, input.serverId));
      return { ok: true };
    }),
  leave: chatProcedure.input(serverInput).mutation(async ({ ctx, input }) => {
    const { server } = await serverAccess(
      ctx.tx,
      ctx.actor,
      input.serverId,
      true,
    );
    if (server.ownerId === ctx.actor.id)
      fail("CONFLICT", "Transfer ownership before leaving.");
    await ctx.tx
      .delete(s.serverMembers)
      .where(
        and(
          eq(s.serverMembers.serverId, input.serverId),
          eq(s.serverMembers.userId, ctx.actor.id),
        ),
      );
    return { ok: true };
  }),
  delete: chatProcedure
    .input(serverInput.extend({ confirmation: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { server } = await serverAccess(
        ctx.tx,
        ctx.actor,
        input.serverId,
        true,
      );
      if (server.ownerId !== ctx.actor.id)
        fail("FORBIDDEN", "Only the owner can delete a server.");
      if (server.name !== input.confirmation)
        fail("BAD_REQUEST", "Enter the server name to confirm.");
      await ctx.tx
        .update(s.servers)
        .set({ deletedAt: new Date() })
        .where(eq(s.servers.id, input.serverId));
      return { ok: true };
    }),
});

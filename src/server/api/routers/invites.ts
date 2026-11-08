import { randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { withChatDb } from "~/server/chat-db";
import {
  attemptLimitedChatProcedure,
  chatProcedure,
} from "~/server/chat/procedure";
import {
  fail,
  remember,
  replay,
  requirePermission,
  serverAccess,
  tokenHash,
  uuid,
  visibleChannels,
} from "~/server/chat/core";
import { P } from "~/server/chat/permissions";
import * as s from "~/server/db/chat-schema";

const tokenInput = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
export const invitesRouter = createTRPCRouter({
  preview: publicProcedure.input(tokenInput).query(({ input }) =>
    withChatDb((db) =>
      db.transaction(async (tx) => {
        const [row] = await tx
          .select({ invite: s.invites, serverName: s.servers.name })
          .from(s.invites)
          .innerJoin(s.servers, eq(s.servers.id, s.invites.serverId))
          .where(
            and(
              eq(s.invites.tokenHash, tokenHash(input.token)),
              isNull(s.servers.deletedAt),
            ),
          );
        if (
          !row ||
          row.invite.revokedAt ||
          (row.invite.expiresAt && row.invite.expiresAt <= new Date()) ||
          (row.invite.maxUses !== null && row.invite.uses >= row.invite.maxUses)
        )
          fail("NOT_FOUND", "Invite unavailable or expired.");
        const [count] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(s.serverMembers)
          .where(eq(s.serverMembers.serverId, row.invite.serverId));
        return {
          serverName: row.serverName,
          memberCount: count!.count,
          expiresAt: row.invite.expiresAt,
        };
      }),
    ),
  ),
  create: chatProcedure
    .input(
      z.object({
        serverId: uuid,
        requestId: uuid,
        expiresInSeconds: z
          .union([z.literal(3600), z.literal(86400), z.literal(604800)])
          .nullable(),
        maxUses: z.number().int().min(1).max(1000).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await serverAccess(
        ctx.tx,
        ctx.actor,
        input.serverId,
        true,
      );
      requirePermission(access.permissions, P.CREATE_INVITE);
      const prior = await replay(
        ctx.tx,
        ctx.actor,
        "invite.create",
        input.requestId,
        input,
      );
      if (prior) return { id: prior, token: null };
      const token = randomBytes(32).toString("base64url");
      const [invite] = await ctx.tx
        .insert(s.invites)
        .values({
          serverId: input.serverId,
          creatorId: ctx.actor.id,
          tokenHash: tokenHash(token),
          maxUses: input.maxUses,
          expiresAt: input.expiresInSeconds
            ? new Date(Date.now() + input.expiresInSeconds * 1000)
            : null,
        })
        .returning();
      await remember(
        ctx.tx,
        ctx.actor,
        "invite.create",
        input.requestId,
        input,
        invite!.id,
      );
      return { id: invite!.id, token };
    }),
  accept: attemptLimitedChatProcedure("invite-attempt", 10, 60)
    .input(tokenInput)
    .mutation(async ({ ctx, input }) => {
      const [initial] = await ctx.tx
        .select()
        .from(s.invites)
        .where(eq(s.invites.tokenHash, tokenHash(input.token)));
      if (!initial) fail("NOT_FOUND", "Invite unavailable or expired.");
      const [server] = await ctx.tx
        .select()
        .from(s.servers)
        .where(
          and(eq(s.servers.id, initial.serverId), isNull(s.servers.deletedAt)),
        )
        .for("update");
      if (!server) fail("NOT_FOUND", "Invite unavailable or expired.");
      const [invite] = await ctx.tx
        .select()
        .from(s.invites)
        .where(eq(s.invites.id, initial.id))
        .for("update");
      const [ban] = await ctx.tx
        .select()
        .from(s.serverBans)
        .where(
          and(
            eq(s.serverBans.serverId, server.id),
            eq(s.serverBans.userId, ctx.actor.id),
          ),
        );
      if (ban) fail("NOT_FOUND", "Invite unavailable or expired.");
      const [member] = await ctx.tx
        .select()
        .from(s.serverMembers)
        .where(
          and(
            eq(s.serverMembers.serverId, server.id),
            eq(s.serverMembers.userId, ctx.actor.id),
          ),
        );
      if (!member) {
        if (
          !invite ||
          invite.revokedAt ||
          (invite.expiresAt && invite.expiresAt <= new Date()) ||
          (invite.maxUses !== null && invite.uses >= invite.maxUses)
        )
          fail("NOT_FOUND", "Invite unavailable or expired.");
        await ctx.tx
          .select()
          .from(s.appUsers)
          .where(eq(s.appUsers.id, ctx.actor.id))
          .for("update");
        const [userCount] = await ctx.tx
          .select({ count: sql<number>`count(*)::int` })
          .from(s.serverMembers)
          .where(eq(s.serverMembers.userId, ctx.actor.id));
        const [serverCount] = await ctx.tx
          .select({ count: sql<number>`count(*)::int` })
          .from(s.serverMembers)
          .where(eq(s.serverMembers.serverId, server.id));
        if (userCount!.count >= 100 || serverCount!.count >= 1000)
          fail("CONFLICT", "Membership limit reached.");
        await ctx.tx
          .insert(s.serverMembers)
          .values({ serverId: server.id, userId: ctx.actor.id });
        await ctx.tx
          .update(s.invites)
          .set({ uses: sql`${s.invites.uses} + 1` })
          .where(eq(s.invites.id, invite.id));
      }
      return {
        server,
        channelId:
          (await visibleChannels(ctx.tx, ctx.actor, server.id)).find(
            (c) => c.kind === "text",
          )?.id ?? null,
      };
    }),
  list: chatProcedure
    .input(z.object({ serverId: uuid }))
    .query(async ({ ctx, input }) => {
      const access = await serverAccess(ctx.tx, ctx.actor, input.serverId);
      requirePermission(access.permissions, P.MANAGE_SERVER);
      return ctx.tx
        .select({
          id: s.invites.id,
          creatorId: s.invites.creatorId,
          uses: s.invites.uses,
          maxUses: s.invites.maxUses,
          expiresAt: s.invites.expiresAt,
          revokedAt: s.invites.revokedAt,
        })
        .from(s.invites)
        .where(eq(s.invites.serverId, input.serverId))
        .orderBy(s.invites.createdAt)
        .limit(100);
    }),
  revoke: chatProcedure
    .input(z.object({ inviteId: uuid }))
    .mutation(async ({ ctx, input }) => {
      const [invite] = await ctx.tx
        .select()
        .from(s.invites)
        .where(eq(s.invites.id, input.inviteId));
      if (!invite) fail("NOT_FOUND", "Invite unavailable.");
      const access = await serverAccess(
        ctx.tx,
        ctx.actor,
        invite.serverId,
        true,
      );
      if (invite.creatorId !== ctx.actor.id)
        requirePermission(access.permissions, P.MANAGE_SERVER);
      await ctx.tx
        .update(s.invites)
        .set({ revokedAt: new Date() })
        .where(eq(s.invites.id, input.inviteId));
      return { ok: true };
    }),
});

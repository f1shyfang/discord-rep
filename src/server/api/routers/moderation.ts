import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { createTRPCRouter } from "~/server/api/trpc";
import { chatProcedure } from "~/server/chat/procedure";
import {
  channelAccess,
  fail,
  name,
  requirePermission,
  serverAccess,
  uuid,
} from "~/server/chat/core";
import { ALL_PERMISSIONS, highestRole, P } from "~/server/chat/permissions";
import * as s from "~/server/db/chat-schema";

const bits = z.number().int().min(0).max(ALL_PERMISSIONS);
const serverInput = z.object({ serverId: uuid });
async function revision(
  tx: Parameters<typeof serverAccess>[0],
  serverId: string,
) {
  await tx
    .update(s.servers)
    .set({ authRevision: sql`${s.servers.authRevision} + 1` })
    .where(eq(s.servers.id, serverId));
}
export const moderationRouter = createTRPCRouter({
  roleSave: chatProcedure
    .input(
      serverInput.extend({
        roleId: uuid.optional(),
        name,
        permissions: bits,
        position: z.number().int().min(0).max(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await serverAccess(
        ctx.tx,
        ctx.actor,
        input.serverId,
        true,
      );
      requirePermission(access.permissions, P.MANAGE_ROLES);
      const role = access.roles.find((r) => r.id === input.roleId);
      if (input.roleId && !role) fail("NOT_FOUND", "Role unavailable.");
      const owner = access.server.ownerId === ctx.actor.id;
      const rank = highestRole(access.roles, access.assigned);
      if (
        !owner &&
        ((role && role.position >= rank) ||
          input.position >= rank ||
          (input.permissions & ~access.permissions) !== 0)
      )
        fail(
          "FORBIDDEN",
          "You can only manage lower roles and permissions you hold.",
        );
      if (
        (role?.isEveryone && input.position !== 0) ||
        (!role?.isEveryone && input.position === 0)
      )
        fail("BAD_REQUEST", "Only the everyone role has position zero.");
      if (!role && access.roles.length >= 20)
        fail("CONFLICT", "Role limit reached.");
      const values = {
        name: input.name,
        permissions: input.permissions,
        position: input.position,
      };
      const [result] = role
        ? await ctx.tx
            .update(s.roles)
            .set(values)
            .where(eq(s.roles.id, role.id))
            .returning()
        : await ctx.tx
            .insert(s.roles)
            .values({ ...values, serverId: input.serverId })
            .returning();
      await revision(ctx.tx, input.serverId);
      return result!;
    }),
  roleDelete: chatProcedure
    .input(serverInput.extend({ roleId: uuid }))
    .mutation(async ({ ctx, input }) => {
      const access = await serverAccess(
        ctx.tx,
        ctx.actor,
        input.serverId,
        true,
      );
      requirePermission(access.permissions, P.MANAGE_ROLES);
      const role = access.roles.find((r) => r.id === input.roleId);
      if (!role || role.isEveryone)
        fail("FORBIDDEN", "This role cannot be removed.");
      if (
        access.server.ownerId !== ctx.actor.id &&
        role.position >= highestRole(access.roles, access.assigned)
      )
        fail("FORBIDDEN", "You can only remove lower roles.");
      await ctx.tx.delete(s.roles).where(eq(s.roles.id, role.id));
      await revision(ctx.tx, input.serverId);
      return { ok: true };
    }),
  roleAssign: chatProcedure
    .input(
      serverInput.extend({ userId: uuid, roleId: uuid, assigned: z.boolean() }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await serverAccess(
        ctx.tx,
        ctx.actor,
        input.serverId,
        true,
      );
      requirePermission(access.permissions, P.MANAGE_ROLES);
      const role = access.roles.find((r) => r.id === input.roleId);
      const [target] = await ctx.tx
        .select()
        .from(s.serverMembers)
        .where(
          and(
            eq(s.serverMembers.serverId, input.serverId),
            eq(s.serverMembers.userId, input.userId),
          ),
        );
      if (!role || role.isEveryone || !target)
        fail("NOT_FOUND", "Role or member unavailable.");
      const targetRoles = await ctx.tx
        .select()
        .from(s.memberRoles)
        .where(
          and(
            eq(s.memberRoles.serverId, input.serverId),
            eq(s.memberRoles.userId, input.userId),
          ),
        );
      const owner = access.server.ownerId === ctx.actor.id;
      const rank = highestRole(access.roles, access.assigned);
      if (
        !owner &&
        (input.userId === access.server.ownerId ||
          role.position >= rank ||
          highestRole(
            access.roles,
            targetRoles.map((r) => r.roleId),
          ) >= rank ||
          (role.permissions & ~access.permissions) !== 0)
      )
        fail(
          "FORBIDDEN",
          "You can only assign lower roles to lower-ranked members.",
        );
      const values = {
        serverId: input.serverId,
        userId: input.userId,
        roleId: input.roleId,
      };
      if (input.assigned)
        await ctx.tx.insert(s.memberRoles).values(values).onConflictDoNothing();
      else
        await ctx.tx
          .delete(s.memberRoles)
          .where(
            and(
              eq(s.memberRoles.serverId, input.serverId),
              eq(s.memberRoles.userId, input.userId),
              eq(s.memberRoles.roleId, input.roleId),
            ),
          );
      await revision(ctx.tx, input.serverId);
      return { ok: true };
    }),
  overwrite: chatProcedure
    .input(
      z
        .object({
          channelId: uuid,
          roleId: uuid.optional(),
          userId: uuid.optional(),
          allow: bits,
          deny: bits,
        })
        .refine(
          (i) => !!i.roleId !== !!i.userId,
          "Choose one overwrite target.",
        )
        .refine((i) => !(i.allow & i.deny), "Allow and deny cannot overlap."),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await channelAccess(
        ctx.tx,
        ctx.actor,
        input.channelId,
        P.MANAGE_ROLES,
        true,
      );
      const owner = access.server.ownerId === ctx.actor.id;
      const role = access.roles.find((r) => r.id === input.roleId);
      if (input.roleId && !role) fail("NOT_FOUND", "Role unavailable.");
      if (
        !owner &&
        (((input.allow | input.deny) & ~access.permissions) !== 0 ||
          (role &&
            !role.isEveryone &&
            role.position >= highestRole(access.roles, access.assigned)))
      )
        fail("FORBIDDEN", "You can only manage lower permissions and roles.");
      if (input.userId) {
        const [member] = await ctx.tx
          .select()
          .from(s.serverMembers)
          .where(
            and(
              eq(s.serverMembers.serverId, access.server.id),
              eq(s.serverMembers.userId, input.userId),
            ),
          );
        if (!member) fail("NOT_FOUND", "Member unavailable.");
        const targetRoles = await ctx.tx
          .select()
          .from(s.memberRoles)
          .where(
            and(
              eq(s.memberRoles.serverId, access.server.id),
              eq(s.memberRoles.userId, input.userId),
            ),
          );
        if (
          !owner &&
          (input.userId === access.server.ownerId ||
            highestRole(
              access.roles,
              targetRoles.map((r) => r.roleId),
            ) >= highestRole(access.roles, access.assigned))
        )
          fail("FORBIDDEN", "You can only manage lower-ranked members.");
      }
      const target = input.roleId
        ? eq(s.channelOverwrites.roleId, input.roleId)
        : eq(s.channelOverwrites.userId, input.userId!);
      await ctx.tx
        .delete(s.channelOverwrites)
        .where(and(eq(s.channelOverwrites.channelId, input.channelId), target));
      if (input.allow || input.deny)
        await ctx.tx
          .insert(s.channelOverwrites)
          .values({
            serverId: access.server.id,
            channelId: input.channelId,
            roleId: input.roleId,
            userId: input.userId,
            allow: input.allow,
            deny: input.deny,
          });
      await revision(ctx.tx, access.server.id);
      return { ok: true };
    }),
  memberAction: chatProcedure
    .input(
      serverInput.extend({
        userId: uuid,
        action: z.enum(["kick", "ban"]),
        reason: z.string().max(500).default(""),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await serverAccess(
        ctx.tx,
        ctx.actor,
        input.serverId,
        true,
      );
      requirePermission(
        access.permissions,
        input.action === "ban" ? P.BAN_MEMBERS : P.KICK_MEMBERS,
      );
      if (
        input.userId === access.server.ownerId ||
        input.userId === ctx.actor.id
      )
        fail("FORBIDDEN", "This member cannot be removed.");
      const targetRoles = await ctx.tx
        .select()
        .from(s.memberRoles)
        .where(
          and(
            eq(s.memberRoles.serverId, input.serverId),
            eq(s.memberRoles.userId, input.userId),
          ),
        );
      if (
        access.server.ownerId !== ctx.actor.id &&
        highestRole(
          access.roles,
          targetRoles.map((r) => r.roleId),
        ) >= highestRole(access.roles, access.assigned)
      )
        fail("FORBIDDEN", "You can only moderate lower-ranked members.");
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
      if (input.action === "ban")
        await ctx.tx
          .insert(s.serverBans)
          .values({
            serverId: input.serverId,
            userId: input.userId,
            actorId: ctx.actor.id,
            reason: input.reason,
          })
          .onConflictDoNothing();
      await ctx.tx
        .delete(s.serverMembers)
        .where(
          and(
            eq(s.serverMembers.serverId, input.serverId),
            eq(s.serverMembers.userId, input.userId),
          ),
        );
      await ctx.tx
        .insert(s.auditEvents)
        .values({
          serverId: input.serverId,
          actorId: ctx.actor.id,
          targetId: input.userId,
          action: input.action,
          metadata: { reason: input.reason },
        });
      await revision(ctx.tx, input.serverId);
      return { ok: true };
    }),
  bans: chatProcedure.input(serverInput).query(async ({ ctx, input }) => {
    const access = await serverAccess(ctx.tx, ctx.actor, input.serverId);
    requirePermission(access.permissions, P.BAN_MEMBERS);
    return ctx.tx
      .select({
        userId: s.serverBans.userId,
        displayName: s.appUsers.displayName,
        reason: s.serverBans.reason,
      })
      .from(s.serverBans)
      .innerJoin(s.appUsers, eq(s.appUsers.id, s.serverBans.userId))
      .where(eq(s.serverBans.serverId, input.serverId))
      .limit(1000);
  }),
  unban: chatProcedure
    .input(serverInput.extend({ userId: uuid }))
    .mutation(async ({ ctx, input }) => {
      const access = await serverAccess(
        ctx.tx,
        ctx.actor,
        input.serverId,
        true,
      );
      requirePermission(access.permissions, P.BAN_MEMBERS);
      await ctx.tx
        .delete(s.serverBans)
        .where(
          and(
            eq(s.serverBans.serverId, input.serverId),
            eq(s.serverBans.userId, input.userId),
          ),
        );
      return { ok: true };
    }),
});

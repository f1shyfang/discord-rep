import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { ChatTransaction } from "~/server/chat-db";
import * as s from "~/server/db/chat-schema";
import { P, permissionsFor } from "./permissions";

export const uuid = z.string().uuid();
export const name = z.string().trim().min(1).max(100);
export const handle = z
  .string()
  .regex(
    /^[a-z0-9_]{3,32}$/,
    "Use 3–32 lowercase letters, digits or underscores.",
  );
export const seq = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,18})$/)
  .refine((n) => BigInt(n) <= 9223372036854775807n);
export const profileInput = z.object({
  handle,
  displayName: z.string().trim().min(1).max(80),
  bio: z.string().max(190).default(""),
  status: z.enum(["online", "idle", "dnd", "invisible"]).default("online"),
  theme: z.enum(["dark", "light", "system"]).default("dark"),
});
export type Actor = typeof s.appUsers.$inferSelect;
export type Tx = ChatTransaction;
export function fail(
  code:
    | "FORBIDDEN"
    | "NOT_FOUND"
    | "CONFLICT"
    | "BAD_REQUEST"
    | "TOO_MANY_REQUESTS"
    | "PRECONDITION_FAILED",
  message: string,
): never {
  throw new TRPCError({ code, message });
}
export const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const userDTO = (u: Actor) => ({
  id: u.id,
  handle: u.handle,
  displayName: u.displayName,
  bio: u.bio,
});
export async function actorFor(tx: Tx, clerkId: string) {
  const [actor] = await tx
    .select()
    .from(s.appUsers)
    .where(eq(s.appUsers.clerkId, clerkId));
  if (!actor || actor.disabledAt)
    fail("PRECONDITION_FAILED", "Complete your profile to continue.");
  return actor;
}
export async function rateLimit(
  tx: Tx,
  key: string,
  limit: number,
  seconds: number,
) {
  const [row] = await tx
    .insert(s.rateLimits)
    .values({ key, windowStart: new Date(), count: 1 })
    .onConflictDoUpdate({
      target: s.rateLimits.key,
      set: {
        windowStart: sql`case when ${s.rateLimits.windowStart} <= now() - ${seconds} * interval '1 second' then now() else ${s.rateLimits.windowStart} end`,
        count: sql`case when ${s.rateLimits.windowStart} <= now() - ${seconds} * interval '1 second' then 1 else ${s.rateLimits.count} + 1 end`,
      },
    })
    .returning();
  if (row!.count > limit)
    fail("TOO_MANY_REQUESTS", "Too many requests. Please try again later.");
}
export async function serverAccess(
  tx: Tx,
  actor: Actor,
  serverId: string,
  exclusive = false,
) {
  const [server] = await tx
    .select()
    .from(s.servers)
    .where(and(eq(s.servers.id, serverId), isNull(s.servers.deletedAt)))
    .for(exclusive ? "update" : "share");
  if (!server) fail("NOT_FOUND", "Server unavailable.");
  const [member] = await tx
    .select()
    .from(s.serverMembers)
    .where(
      and(
        eq(s.serverMembers.serverId, serverId),
        eq(s.serverMembers.userId, actor.id),
      ),
    );
  const [ban] = await tx
    .select()
    .from(s.serverBans)
    .where(
      and(
        eq(s.serverBans.serverId, serverId),
        eq(s.serverBans.userId, actor.id),
      ),
    );
  if (!member || ban) fail("NOT_FOUND", "Server unavailable.");
  const roles = await tx
    .select()
    .from(s.roles)
    .where(eq(s.roles.serverId, serverId));
  const assigned = await tx
    .select()
    .from(s.memberRoles)
    .where(
      and(
        eq(s.memberRoles.serverId, serverId),
        eq(s.memberRoles.userId, actor.id),
      ),
    );
  const input = {
    userId: actor.id,
    ownerId: server.ownerId,
    member: true,
    banned: false,
    roles,
    assignedRoleIds: assigned.map((r) => r.roleId),
  };
  return {
    server,
    roles,
    assigned: input.assignedRoleIds,
    input,
    permissions: permissionsFor(input),
  };
}
export function requirePermission(bits: number, permission: number) {
  if ((bits & permission) !== permission)
    fail("FORBIDDEN", "You do not have permission for this action.");
}
export async function channelAccess(
  tx: Tx,
  actor: Actor,
  channelId: string,
  permission: number = P.VIEW_CHANNEL,
  exclusive = false,
) {
  const [channel] = await tx
    .select()
    .from(s.channels)
    .where(and(eq(s.channels.id, channelId), isNull(s.channels.deletedAt)));
  if (!channel) fail("NOT_FOUND", "Channel unavailable.");
  const access = await serverAccess(tx, actor, channel.serverId, exclusive);
  // Re-read after acquiring the server lock so channel deletion and permission changes linearize.
  const [current] = await tx
    .select()
    .from(s.channels)
    .where(and(eq(s.channels.id, channelId), isNull(s.channels.deletedAt)));
  if (!current) fail("NOT_FOUND", "Channel unavailable.");
  const overwrites = await tx
    .select()
    .from(s.channelOverwrites)
    .where(eq(s.channelOverwrites.channelId, channelId));
  const permissions = permissionsFor({ ...access.input, overwrites });
  if (!(permissions & P.VIEW_CHANNEL))
    fail("NOT_FOUND", "Channel unavailable.");
  requirePermission(permissions, permission);
  return { ...access, channel: current, permissions };
}
export function canonicalPair(a: string, b: string) {
  return a < b ? ([a, b] as const) : ([b, a] as const);
}
export async function pairLock(tx: Tx, a: string, b: string) {
  const [low, high] = canonicalPair(a, b);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${low + ":" + high}, 0))`,
  );
  return { userLow: low, userHigh: high };
}
export async function blockedPair(tx: Tx, a: string, b: string) {
  const rows = await tx
    .select()
    .from(s.blocks)
    .where(
      or(
        and(eq(s.blocks.blockerId, a), eq(s.blocks.blockedId, b)),
        and(eq(s.blocks.blockerId, b), eq(s.blocks.blockedId, a)),
      ),
    );
  return rows.length > 0;
}
export async function conversationAccess(
  tx: Tx,
  actor: Actor,
  conversationId: string,
  permission: number = P.VIEW_CHANNEL,
) {
  const [conversation] = await tx
    .select()
    .from(s.conversations)
    .where(eq(s.conversations.id, conversationId));
  if (!conversation) fail("NOT_FOUND", "Conversation unavailable.");
  if (conversation.channelId) {
    const access = await channelAccess(
      tx,
      actor,
      conversation.channelId,
      permission,
    );
    return { conversation, permissions: access.permissions };
  }
  if (
    conversation.dmUserLow !== actor.id &&
    conversation.dmUserHigh !== actor.id
  )
    fail("NOT_FOUND", "Conversation unavailable.");
  await pairLock(tx, conversation.dmUserLow!, conversation.dmUserHigh!);
  const blocked = await blockedPair(
    tx,
    conversation.dmUserLow!,
    conversation.dmUserHigh!,
  );
  if (permission !== P.VIEW_CHANNEL && blocked)
    fail("FORBIDDEN", "Messaging is unavailable for this conversation.");
  return {
    conversation,
    permissions: blocked
      ? P.VIEW_CHANNEL
      : P.VIEW_CHANNEL | P.SEND_MESSAGES | P.ADD_REACTIONS,
  };
}
export async function visibleChannels(tx: Tx, actor: Actor, serverId: string) {
  const access = await serverAccess(tx, actor, serverId);
  const rows = await tx
    .select()
    .from(s.channels)
    .where(and(eq(s.channels.serverId, serverId), isNull(s.channels.deletedAt)))
    .orderBy(s.channels.position, s.channels.id);
  const overwrites = await tx
    .select()
    .from(s.channelOverwrites)
    .where(eq(s.channelOverwrites.serverId, serverId));
  const conversations = rows.length
    ? await tx
        .select()
        .from(s.conversations)
        .where(
          inArray(
            s.conversations.channelId,
            rows.map((c) => c.id),
          ),
        )
    : [];
  return rows.flatMap((c) => {
    const permissions = permissionsFor({
      ...access.input,
      overwrites: overwrites.filter((o) => o.channelId === c.id),
    });
    return permissions & P.VIEW_CHANNEL
      ? [
          {
            ...c,
            permissions,
            conversationId:
              conversations.find((x) => x.channelId === c.id)?.id ?? null,
          },
        ]
      : [];
  });
}
export async function recordEvent(
  tx: Tx,
  conversationId: string,
  eventType: string,
  entityId: string,
) {
  const [conversation] = await tx
    .update(s.conversations)
    .set({ lastEventSeq: sql`${s.conversations.lastEventSeq} + 1` })
    .where(eq(s.conversations.id, conversationId))
    .returning();
  await tx.insert(s.outboxEvents).values({
    conversationId,
    eventSeq: conversation!.lastEventSeq,
    eventType,
    entityId,
  });
}
export async function replay(
  tx: Tx,
  actor: Actor,
  operation: string,
  requestId: string,
  input: unknown,
) {
  const [row] = await tx
    .select()
    .from(s.mutationKeys)
    .where(
      and(
        eq(s.mutationKeys.actorId, actor.id),
        eq(s.mutationKeys.operation, operation),
        eq(s.mutationKeys.requestId, requestId),
      ),
    );
  if (row && row.requestHash !== hash(input))
    fail("CONFLICT", "This request ID was already used with different input.");
  return row?.resultId;
}
export async function remember(
  tx: Tx,
  actor: Actor,
  operation: string,
  requestId: string,
  input: unknown,
  resultId: string,
) {
  await tx.insert(s.mutationKeys).values({
    actorId: actor.id,
    operation,
    requestId,
    requestHash: hash(input),
    resultId,
  });
}

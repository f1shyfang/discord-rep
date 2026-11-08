import { TRPCError } from "@trpc/server";
import { createTRPCRouter } from "~/server/api/trpc";
import { attemptLimitedChatProcedure } from "~/server/chat/procedure";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { ChatDatabase } from "~/server/chat-db";
import * as schema from "~/server/db/schema";
import * as s from "~/server/db/chat-schema";
import { P } from "~/server/chat/permissions";

let database: ChatDatabase;
vi.mock("~/env", () => ({ env: {} }));
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/chat-db", () => ({
  withChatDb: (run: (db: ChatDatabase) => Promise<unknown>) => run(database),
}));
import { applyClerkEvent } from "~/server/chat/identity";
import type { WebhookEvent } from "@clerk/nextjs/webhooks";
import { appRouter } from "~/server/api/root";

// This suite only runs against an explicitly supplied disposable database.
const connectionString = process.env.CHAT_TEST_DATABASE_URL;
describe.skipIf(!connectionString)("chat PostgreSQL integration", () => {
  let pool: Pool;
  const testSchema = `chat_test_${randomUUID().replaceAll("-", "")}`;
  type Caller = ReturnType<typeof appRouter.createCaller>;
  let owner: Caller, member: Caller, outsider: Caller, third: Caller;
  let ownerId: string, memberId: string, outsiderId: string, thirdId: string;
  let serverId: string, channelId: string, conversationId: string;
  const caller = (userId: string | null) =>
    appRouter.createCaller({ userId, db: {} as never });
  const newServer = () =>
    owner.servers.create({ name: "Test community", requestId: randomUUID() });
  const invite = (maxUses: number | null = null) =>
    owner.invites.create({
      serverId,
      requestId: randomUUID(),
      expiresInSeconds: 3600,
      maxUses,
    });
  const send = (
    c: Caller,
    body: string,
    nonce = randomUUID(),
    conversation = conversationId,
  ) =>
    c.messages.send({ conversationId: conversation, clientNonce: nonce, body });
  beforeAll(async () => {
    const admin = new Pool({ connectionString });
    await admin.query(`create schema "${testSchema}"`);
    await admin.end();
    pool = new Pool({
      connectionString,
      options: `-c search_path=${testSchema}`,
      max: 12,
    });
    database = drizzle(pool, { schema }) as unknown as ChatDatabase;
    for (const migration of (
      await readdir(new URL("../drizzle", import.meta.url))
    )
      .filter((f) => /^\d+.*\.sql$/.test(f))
      .sort()) {
      const migrationSql = await readFile(
        new URL(`../drizzle/${migration}`, import.meta.url),
        "utf8",
      );
      await pool.query(
        migrationSql.replaceAll('"public".', `"${testSchema}".`),
      );
    }
    owner = caller("clerk_owner");
    member = caller("clerk_member");
    outsider = caller("clerk_outsider");
    third = caller("clerk_third");
    ownerId = (
      await owner.users.save({ handle: "owner", displayName: "Owner" })
    ).id;
    memberId = (
      await member.users.save({ handle: "member", displayName: "Member" })
    ).id;
    outsiderId = (
      await outsider.users.save({ handle: "outsider", displayName: "Outsider" })
    ).id;
    thirdId = (
      await third.users.save({ handle: "third", displayName: "Third" })
    ).id;
    const created = await newServer();
    serverId = created.server.id;
    channelId = created.channelId!;
    conversationId = (await owner.servers.get({ serverId })).channels.find(
      (c) => c.id === channelId,
    )!.conversationId!;
    const link = await invite();
    await member.invites.accept({ token: link.token! });
  });
  afterAll(async () => {
    await pool?.end();
    const admin = new Pool({ connectionString });
    await admin.query(`drop schema if exists "${testSchema}" cascade`);
    await admin.end();
  });
  it("rejects anonymous and unregistered requests before private reads", async () => {
    await expect(caller(null).users.me()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      caller("new_clerk").servers.get({ serverId }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      outsider.messages.list({ conversationId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      outsider.search.messages({ conversationId, query: "test" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      outsider.sync.delta({ conversationId, after: "0" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      outsider.activity.typists({ conversationId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("validates and serializes unique handles", async () => {
    await expect(
      outsider.users.save({ handle: "Owner", displayName: "X" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      outsider.users.save({ handle: "owner", displayName: "X" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const results = await Promise.allSettled([
      caller("signup_a").users.save({ handle: "contended", displayName: "A" }),
      caller("signup_b").users.save({ handle: "contended", displayName: "B" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("creates all server defaults atomically and deduplicates retries", async () => {
    const requestId = randomUUID();
    const results = await Promise.all([
      owner.servers.create({ name: "One server", requestId }),
      owner.servers.create({ name: "One server", requestId }),
    ]);
    expect(results[0].server.id).toBe(results[1].server.id);
    const detail = await owner.servers.get({ serverId: results[0].server.id });
    expect(detail.members.map((m) => m.id)).toEqual([ownerId]);
    expect(detail.channels.map((c) => c.kind).sort()).toEqual([
      "text",
      "voice",
    ]);
    expect(detail.roles.filter((r) => r.isEveryone)).toHaveLength(1);
    await expect(
      owner.servers.create({ name: "Changed", requestId }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      member.servers.leave({ serverId: results[0].server.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("admits only one concurrent last-use invite join, without consuming existing memberships", async () => {
    const link = await invite(1);
    const attempts = await Promise.allSettled([
      outsider.invites.accept({ token: link.token! }),
      third.invites.accept({ token: link.token! }),
    ]);
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
    const [row] = await database
      .select()
      .from(s.invites)
      .where(eq(s.invites.id, link.id));
    expect(row!.uses).toBe(1);
    const admitted = attempts[0].status === "fulfilled" ? outsider : third;
    await admitted.invites.accept({ token: link.token! });
    expect(
      (
        await database.select().from(s.invites).where(eq(s.invites.id, link.id))
      )[0]!.uses,
    ).toBe(1);
    const [stored] = await database
      .select()
      .from(s.invites)
      .where(eq(s.invites.id, link.id));
    expect(stored!.tokenHash).not.toContain(link.token!);
    await owner.invites.revoke({ inviteId: link.id });
    await expect(
      owner.invites.preview({ token: link.token! }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Remove the newly admitted member to restore outsider fixtures.
    const admittedId =
      attempts[0].status === "fulfilled" ? outsiderId : thirdId;
    await owner.moderation.memberAction({
      serverId,
      userId: admittedId,
      action: "kick",
    });
  });
  it("rolls back a late resolver failure without rolling back the attempt quota", async () => {
    const testRouter = createTRPCRouter({
      fail: attemptLimitedChatProcedure("rollback-fixture", 1, 60).mutation(
        async ({ ctx }) => {
          await ctx.tx
            .update(s.appUsers)
            .set({ bio: "Uncommitted write" })
            .where(eq(s.appUsers.id, ctx.actor.id));
          throw new TRPCError({
            code: "CONFLICT",
            message: "Injected resolver failure",
          });
        },
      ),
    });
    const c = testRouter.createCaller({
      userId: "clerk_owner",
      db: {} as never,
    });
    await expect(c.fail()).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await owner.users.me())!.bio).toBe("");
    await expect(c.fail()).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
  it("limits failed invite attempts even when the join transaction rolls back", async () => {
    const attacker = caller("clerk_invalid_invites");
    await attacker.users.save({
      handle: "invalid_invites",
      displayName: "Invalid invites",
    });
    for (let i = 0; i < 10; i++) {
      await expect(
        attacker.invites.accept({ token: "a".repeat(43) }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    await expect(
      attacker.invites.accept({ token: "a".repeat(43) }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
  it("limits unsuccessful friend requests as well as accepted requests", async () => {
    const requester = caller("clerk_invalid_friends");
    await requester.users.save({
      handle: "invalid_friends",
      displayName: "Invalid friends",
    });
    for (let i = 0; i < 10; i++)
      await expect(
        requester.friends.request({ handle: "does_not_exist" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      requester.friends.request({ handle: "does_not_exist" }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
  it("deduplicates concurrent sends and rejects nonce reuse with changed text", async () => {
    const nonce = randomUUID();
    const results = await Promise.all([
      send(owner, "First durable message", nonce),
      send(owner, "First durable message", nonce),
    ]);
    expect(results[0].id).toBe(results[1].id);
    expect(results[0]).not.toHaveProperty("requestHash");
    await expect(send(owner, "Changed content", nonce)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const persisted = await member.messages.list({ conversationId });
    expect(persisted.items.filter((m) => m.id === results[0].id)).toHaveLength(
      1,
    );
    expect(BigInt(persisted.latestSeq)).toBeGreaterThan(0n);
    expect(
      (await member.sync.delta({ conversationId, after: "0" })).items.some(
        (m) => m.id === results[0].id,
      ),
    ).toBe(true);
  });
  it("supports replies and rejects cross-conversation reply targets", async () => {
    const original = await send(member, "Reply target");
    const reply = await owner.messages.send({
      conversationId,
      body: "A reply",
      clientNonce: randomUUID(),
      replyToId: original.id,
    });
    expect(reply.replyToId).toBe(original.id);
    const other = await owner.channels.create({
      serverId,
      name: "other",
      kind: "text",
    });
    const otherConversation = (
      await owner.servers.get({ serverId })
    ).channels.find((c) => c.id === other.id)!.conversationId!;
    await expect(
      owner.messages.send({
        conversationId: otherConversation,
        clientNonce: randomUUID(),
        body: "Bad reply",
        replyToId: original.id,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("enforces optimistic edit versions and returns tombstones on delete", async () => {
    const message = await send(member, "Original text");
    await expect(
      owner.messages.edit({
        messageId: message.id,
        body: "Not yours",
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const edited = await member.messages.edit({
      messageId: message.id,
      body: "Edited searchableword",
      expectedVersion: 1,
    });
    expect(edited.version).toBe(2);
    await expect(
      member.messages.edit({
        messageId: message.id,
        body: "Stale edit",
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (
        await member.search.messages({
          conversationId,
          query: "searchableword",
        })
      ).items.map((m) => m.id),
    ).toContain(message.id);
    const deleted = await owner.messages.delete({
      messageId: message.id,
      expectedVersion: 2,
    });
    expect(deleted.body).toBe("");
    expect(deleted.deletedAt).not.toBeNull();
    expect(
      (
        await member.search.messages({
          conversationId,
          query: "searchableword",
        })
      ).items,
    ).toHaveLength(0);
    expect(
      (await member.sync.delta({ conversationId, after: "0" })).items.find(
        (m) => m.id === message.id,
      )!.body,
    ).toBe("");
  });
  it("sets reactions idempotently and bounds monotonic read positions", async () => {
    const message = await send(member, "Reaction target");
    await owner.messages.react({
      messageId: message.id,
      emoji: "👍",
      present: true,
    });
    await owner.messages.react({
      messageId: message.id,
      emoji: "👍",
      present: true,
    });
    const stored = (await member.messages.list({ conversationId })).items.find(
      (m) => m.id === message.id,
    )!;
    expect(stored.reactions).toEqual([{ emoji: "👍", count: 1, mine: false }]);
    await member.reads.ack({ conversationId, seq: message.seq });
    await member.reads.ack({ conversationId, seq: "0" });
    expect((await member.messages.list({ conversationId })).lastReadSeq).toBe(
      message.seq,
    );
    expect(
      (await member.reads.summary({ conversationIds: [conversationId] }))[0]!
        .lastReadSeq,
    ).toBe(message.seq);
    await expect(
      member.reads.ack({ conversationId, seq: "999999" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("persists only authorized user mentions and preferences", async () => {
    // Reset the one-second send window for this independent scenario.
    await database
      .delete(s.rateLimits)
      .where(eq(s.rateLimits.key, `send:second:${ownerId}`));
    const message = await send(
      owner,
      `Hello <@${memberId}> and <@${outsiderId}>`,
    );
    const rows = await database
      .select()
      .from(s.mentions)
      .where(eq(s.mentions.messageId, message.id));
    expect(rows.map((m) => m.userId)).toEqual([memberId]);
    expect(
      (await member.reads.summary({ conversationIds: [conversationId] }))[0]!
        .mentions,
    ).toBe(1);
    await member.preferences.set({
      conversationId,
      notificationMode: "mentions",
    });
    expect(await member.preferences.get({ conversationId })).toEqual({
      notificationMode: "mentions",
    });
  });
  it("revokes channel read and write access through member overwrites", async () => {
    await owner.moderation.overwrite({
      channelId,
      userId: memberId,
      allow: 0,
      deny: P.VIEW_CHANNEL,
    });
    expect(
      (await member.servers.get({ serverId })).channels.map((c) => c.id),
    ).not.toContain(channelId);
    await expect(
      member.messages.list({ conversationId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(send(member, "No access")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      member.sync.delta({ conversationId, after: "0" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await owner.moderation.overwrite({
      channelId,
      userId: memberId,
      allow: 0,
      deny: 0,
    });
    expect(
      (await member.messages.list({ conversationId })).items.length,
    ).toBeGreaterThan(0);
  });
  it("rejects cross-server categories, role assignment and protected owner moderation", async () => {
    const other = await newServer();
    const role = (await owner.servers.get({ serverId: other.server.id }))
      .roles[0]!;
    await expect(
      owner.moderation.roleAssign({
        serverId,
        userId: memberId,
        roleId: role.id,
        assigned: true,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const category = (await owner.servers.get({ serverId: other.server.id }))
      .categories[0]!;
    await expect(
      owner.channels.create({
        serverId,
        name: "bad",
        categoryId: category.id,
        kind: "text",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      member.moderation.memberAction({
        serverId,
        userId: ownerId,
        action: "ban",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(owner.servers.leave({ serverId })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(
      member.moderation.roleSave({
        serverId,
        name: "Admin",
        permissions: P.ADMINISTRATOR,
        position: 99,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("prevents equal-role moderation and privilege escalation", async () => {
    const role = await owner.moderation.roleSave({
      serverId,
      name: "Moderator",
      permissions:
        P.VIEW_CHANNEL | P.SEND_MESSAGES | P.KICK_MEMBERS | P.MANAGE_ROLES,
      position: 10,
    });
    await owner.moderation.roleAssign({
      serverId,
      userId: memberId,
      roleId: role.id,
      assigned: true,
    });
    await expect(
      member.moderation.roleSave({
        serverId,
        name: "Escalation",
        position: 9,
        permissions: P.ADMINISTRATOR,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      member.moderation.roleSave({
        serverId,
        roleId: role.id,
        name: "Self elevation",
        position: 11,
        permissions: role.permissions,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await owner.moderation.roleAssign({
      serverId,
      userId: memberId,
      roleId: role.id,
      assigned: false,
    });
  });
  it("creates a canonical friend-only DM and blocks sends in both directions without deleting history", async () => {
    await expect(owner.dm.open({ userId: outsiderId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await owner.friends.request({ handle: "member" });
    await member.friends.respond({ userId: ownerId, action: "accept" });
    const [dm1, dm2] = await Promise.all([
      owner.dm.open({ userId: memberId }),
      member.dm.open({ userId: ownerId }),
    ]);
    expect(dm1.id).toBe(dm2.id);
    await database
      .delete(s.rateLimits)
      .where(eq(s.rateLimits.key, `send:second:${ownerId}`));
    const message = await send(owner, "Private message", randomUUID(), dm1.id);
    await expect(
      member.messages.delete({ messageId: message.id, expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      outsider.messages.list({ conversationId: dm1.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await member.friends.block({ userId: ownerId, blocked: true });
    await expect(
      send(owner, "Blocked", randomUUID(), dm1.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      send(member, "Also blocked", randomUUID(), dm1.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      (await owner.messages.list({ conversationId: dm1.id })).items[0]!.body,
    ).toBe("Private message");
    expect((await member.friends.list()).friends).toHaveLength(0);
    await member.friends.block({ userId: ownerId, blocked: false });
    expect((await send(member, "Unblocked", randomUUID(), dm1.id)).body).toBe(
      "Unblocked",
    );
  });
  it("ends typing/presence visibility after blocks and access revocation", async () => {
    await owner.activity.heartbeat();
    await owner.activity.typing({ conversationId, active: true });
    expect(
      (await member.activity.typists({ conversationId })).map((u) => u.id),
    ).toContain(ownerId);
    await member.friends.block({ userId: ownerId, blocked: true });
    expect(await member.activity.typists({ conversationId })).toHaveLength(0);
    expect(
      (await member.activity.list({ serverId })).map((p) => p.userId),
    ).not.toContain(ownerId);
    await member.friends.block({ userId: ownerId, blocked: false });
    await owner.moderation.overwrite({
      channelId,
      userId: memberId,
      allow: 0,
      deny: P.VIEW_CHANNEL,
    });
    await expect(
      member.activity.typists({ conversationId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await owner.moderation.overwrite({
      channelId,
      userId: memberId,
      allow: 0,
      deny: 0,
    });
  });

  it("serializes simultaneous edits so exactly one expected version wins", async () => {
    await database
      .delete(s.rateLimits)
      .where(eq(s.rateLimits.key, `send:second:${ownerId}`));
    const message = await send(owner, "Concurrent edit fixture");
    const results = await Promise.allSettled([
      owner.messages.edit({
        messageId: message.id,
        body: "Edit A",
        expectedVersion: 1,
      }),
      owner.messages.edit({
        messageId: message.id,
        body: "Edit B",
        expectedVersion: 1,
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: { code: "CONFLICT" },
    });
  });
  it("orders concurrent messages from multiple members without losing an acknowledged send", async () => {
    const created = await newServer();
    const detail = await owner.servers.get({ serverId: created.server.id });
    const id = detail.channels.find((c) => c.kind === "text")!.conversationId!;
    const link = await owner.invites.create({
      serverId: created.server.id,
      requestId: randomUUID(),
      expiresInSeconds: 3600,
      maxUses: null,
    });
    const members = [];
    for (let i = 0; i < 8; i++) {
      const c = caller(`concurrent_${i}`);
      await c.users.save({
        handle: `concurrent_${i}`,
        displayName: `Concurrent ${i}`,
      });
      await c.invites.accept({ token: link.token! });
      members.push(c);
    }
    const sent = await Promise.all(
      members.flatMap((c, i) =>
        Array.from({ length: 4 }, (_, j) =>
          send(c, `Parallel ${i}/${j}`, randomUUID(), id),
        ),
      ),
    );
    expect(new Set(sent.map((m) => m.id)).size).toBe(32);
    const page = await owner.messages.list({ conversationId: id, limit: 100 });
    expect(page.items.map((m) => m.seq)).toEqual(
      Array.from({ length: 32 }, (_, i) => String(i + 1)),
    );
    expect(page.latestSeq).toBe("32");
    expect(page.eventSeq).toBe("32");
  });
  it("bans authoritatively, revokes access and allows joining again after unban", async () => {
    const link = await invite();
    await owner.moderation.memberAction({
      serverId,
      userId: memberId,
      action: "ban",
      reason: "test",
    });
    await expect(
      member.invites.accept({ token: link.token! }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      member.messages.list({ conversationId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await owner.moderation.unban({ serverId, userId: memberId });
    await member.invites.accept({ token: link.token! });
    expect(
      (await member.servers.get({ serverId })).members.map((m) => m.id),
    ).toContain(memberId);
  });
  it("soft deletion prevents all further private reads and joins", async () => {
    const link = await invite();
    await expect(
      owner.servers.delete({ serverId, confirmation: "Wrong name" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await owner.servers.delete({ serverId, confirmation: "Test community" });
    await expect(
      member.messages.list({ conversationId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      outsider.invites.accept({ token: link.token! }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("deduplicates verified identity events and prevents deleted users or revoked sessions from returning", async () => {
    const revokedUser = caller("clerk_deleted");
    await revokedUser.users.save({
      handle: "deleted",
      displayName: "Deleted user",
    });
    const event = {
      type: "user.deleted",
      data: { id: "clerk_deleted", deleted: true, object: "user" },
    } as WebhookEvent;
    await database.transaction(async (tx) => {
      await applyClerkEvent(tx, event, "delivery_deleted", new Date());
      await applyClerkEvent(tx, event, "delivery_deleted", new Date());
    });
    await expect(revokedUser.users.me()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      revokedUser.users.save({
        handle: "revived",
        displayName: "Cannot return",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    // Delete before onboarding must also be terminal.
    await database.transaction((tx) =>
      applyClerkEvent(
        tx,
        {
          ...event,
          data: { id: "deleted_before_setup", deleted: true, object: "user" },
        } as WebhookEvent,
        "delivery_early",
        new Date(),
      ),
    );
    await expect(
      caller("deleted_before_setup").users.save({
        handle: "late_setup",
        displayName: "Late",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await database.transaction((tx) =>
      applyClerkEvent(
        tx,
        {
          type: "session.revoked",
          data: { id: "session_revoked" },
        } as WebhookEvent,
        "delivery_session",
        new Date(),
      ),
    );
    const revokedSession = appRouter.createCaller({
      userId: "clerk_owner",
      sessionId: "session_revoked",
      db: {} as never,
    });
    await expect(revokedSession.users.me()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect((await owner.users.me())!.id).toBe(ownerId);
  });

  it("purges expired deleted communities atomically while preserving recent data", async () => {
    const created = await newServer();
    const detail = await owner.servers.get({ serverId: created.server.id });
    const conversation = detail.channels.find(
      (c) => c.kind === "text",
    )!.conversationId!;
    await database
      .delete(s.rateLimits)
      .where(eq(s.rateLimits.key, `send:second:${ownerId}`));
    await send(owner, "Scheduled purge fixture", randomUUID(), conversation);
    await owner.servers.delete({
      serverId: created.server.id,
      confirmation: "Test community",
    });
    await database
      .update(s.servers)
      .set({ deletedAt: new Date(Date.now() - 8 * 86400000) })
      .where(eq(s.servers.id, created.server.id));
    const maintenance = await readFile(
      new URL("../src/server/chat/maintenance.sql", import.meta.url),
      "utf8",
    );
    const connection = await pool.connect();
    try {
      await connection.query("begin");
      await connection.query(maintenance);
      await connection.query("commit");
    } catch (error) {
      await connection.query("rollback");
      throw error;
    } finally {
      connection.release();
    }
    expect(
      await database
        .select()
        .from(s.servers)
        .where(eq(s.servers.id, created.server.id)),
    ).toHaveLength(0);
    expect(
      await database
        .select()
        .from(s.messages)
        .where(eq(s.messages.conversationId, conversation)),
    ).toHaveLength(0);
    expect(
      await database.select().from(s.servers).where(eq(s.servers.id, serverId)),
    ).toHaveLength(1);
  });
});

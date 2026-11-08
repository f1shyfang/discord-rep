import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
  primaryKey,
  uniqueIndex,
  index,
  check,
  foreignKey,
  jsonb,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").defaultRandom().primaryKey();
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
export const appUsers = pgTable(
  "app_users",
  {
    id: id(),
    clerkId: text("clerk_id").notNull().unique(),
    handle: text("handle").notNull().unique(),
    displayName: text("display_name").notNull(),
    bio: text("bio").notNull().default(""),
    status: text("status", { enum: ["online", "idle", "dnd", "invisible"] })
      .notNull()
      .default("online"),
    theme: text("theme", { enum: ["dark", "light", "system"] })
      .notNull()
      .default("dark"),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check("valid_handle", sql`${t.handle} ~ '^[a-z0-9_]{3,32}$'`),
    check(
      "valid_display_name",
      sql`char_length(${t.displayName}) between 1 and 80`,
    ),
    check("valid_bio", sql`char_length(${t.bio}) <= 190`),
  ],
);
export const servers = pgTable(
  "servers",
  {
    id: id(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => appUsers.id),
    name: text("name").notNull(),
    authRevision: integer("auth_revision").notNull().default(1),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check("valid_server_name", sql`char_length(${t.name}) between 2 and 100`),
  ],
);
export const serverMembers = pgTable(
  "server_members",
  {
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id),
    joinedAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.serverId, t.userId] }),
    index("members_by_user").on(t.userId, t.serverId),
  ],
);
export const roles = pgTable(
  "roles",
  {
    id: id(),
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    permissions: integer("permissions").notNull().default(0),
    isEveryone: boolean("is_everyone").notNull().default(false),
  },
  (t) => [
    uniqueIndex("role_server_id").on(t.serverId, t.id),
    uniqueIndex("one_everyone_role")
      .on(t.serverId)
      .where(sql`${t.isEveryone}`),
    check("valid_role_bits", sql`${t.permissions} between 0 and 16383`),
    check(
      "valid_role_position",
      sql`${t.position} >= 0 and (not ${t.isEveryone} or ${t.position} = 0)`,
    ),
  ],
);
export const memberRoles = pgTable(
  "member_roles",
  {
    serverId: uuid("server_id").notNull(),
    userId: uuid("user_id").notNull(),
    roleId: uuid("role_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.serverId, t.userId, t.roleId] }),
    foreignKey({
      columns: [t.serverId, t.userId],
      foreignColumns: [serverMembers.serverId, serverMembers.userId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.serverId, t.roleId],
      foreignColumns: [roles.serverId, roles.id],
    }).onDelete("cascade"),
  ],
);
export const categories = pgTable(
  "categories",
  {
    id: id(),
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [uniqueIndex("category_server_id").on(t.serverId, t.id)],
);
export const channels = pgTable(
  "channels",
  {
    id: id(),
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id),
    categoryId: uuid("category_id"),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["text", "voice"] }).notNull(),
    topic: text("topic").notNull().default(""),
    position: integer("position").notNull().default(0),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("channel_server_id").on(t.serverId, t.id),
    index("channels_in_server").on(t.serverId, t.position, t.id),
    foreignKey({
      columns: [t.serverId, t.categoryId],
      foreignColumns: [categories.serverId, categories.id],
    }),
    check("valid_channel_name", sql`char_length(${t.name}) between 1 and 100`),
    check("valid_topic", sql`char_length(${t.topic}) <= 1024`),
  ],
);
export const channelOverwrites = pgTable(
  "channel_overwrites",
  {
    id: id(),
    serverId: uuid("server_id").notNull(),
    channelId: uuid("channel_id").notNull(),
    roleId: uuid("role_id"),
    userId: uuid("user_id"),
    allow: integer("allow_bits").notNull().default(0),
    deny: integer("deny_bits").notNull().default(0),
  },
  (t) => [
    foreignKey({
      columns: [t.serverId, t.channelId],
      foreignColumns: [channels.serverId, channels.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.serverId, t.roleId],
      foreignColumns: [roles.serverId, roles.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.serverId, t.userId],
      foreignColumns: [serverMembers.serverId, serverMembers.userId],
    }).onDelete("cascade"),
    uniqueIndex("overwrite_role_once").on(t.channelId, t.roleId),
    uniqueIndex("overwrite_user_once").on(t.channelId, t.userId),
    check(
      "one_overwrite_target",
      sql`(${t.roleId} is null) <> (${t.userId} is null)`,
    ),
    check(
      "valid_overwrite_bits",
      sql`${t.allow} between 0 and 16383 and ${t.deny} between 0 and 16383 and (${t.allow} & ${t.deny}) = 0`,
    ),
  ],
);
export const serverBans = pgTable(
  "server_bans",
  {
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => appUsers.id),
    reason: text("reason").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.serverId, t.userId] })],
);
export const invites = pgTable(
  "invites",
  {
    id: id(),
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => appUsers.id),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    maxUses: integer("max_uses"),
    uses: integer("uses").notNull().default(0),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "valid_invite_uses",
      sql`${t.uses} >= 0 and (${t.maxUses} is null or (${t.maxUses} > 0 and ${t.uses} <= ${t.maxUses}))`,
    ),
  ],
);
export const friendships = pgTable(
  "friendships",
  {
    userLow: uuid("user_low")
      .notNull()
      .references(() => appUsers.id),
    userHigh: uuid("user_high")
      .notNull()
      .references(() => appUsers.id),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => appUsers.id),
    status: text("status", { enum: ["pending", "accepted"] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userLow, t.userHigh] }),
    check(
      "valid_friend_pair",
      sql`${t.userLow} < ${t.userHigh} and ${t.requesterId} in (${t.userLow}, ${t.userHigh})`,
    ),
  ],
);
export const blocks = pgTable(
  "blocks",
  {
    blockerId: uuid("blocker_id")
      .notNull()
      .references(() => appUsers.id),
    blockedId: uuid("blocked_id")
      .notNull()
      .references(() => appUsers.id),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.blockerId, t.blockedId] }),
    check("no_self_block", sql`${t.blockerId} <> ${t.blockedId}`),
  ],
);
export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    channelId: uuid("channel_id")
      .unique()
      .references(() => channels.id),
    dmUserLow: uuid("dm_user_low").references(() => appUsers.id),
    dmUserHigh: uuid("dm_user_high").references(() => appUsers.id),
    lastMessageSeq: bigint("last_message_seq", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    lastEventSeq: bigint("last_event_seq", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("unique_dm_pair").on(t.dmUserLow, t.dmUserHigh),
    check(
      "valid_conversation",
      sql`(${t.channelId} is not null and ${t.dmUserLow} is null and ${t.dmUserHigh} is null) or (${t.channelId} is null and ${t.dmUserLow} is not null and ${t.dmUserHigh} is not null and ${t.dmUserLow} < ${t.dmUserHigh})`,
    ),
  ],
);
export const messages = pgTable(
  "messages",
  {
    id: id(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    authorId: uuid("author_id")
      .notNull()
      .references(() => appUsers.id),
    clientNonce: uuid("client_nonce").notNull(),
    requestHash: text("request_hash").notNull(),
    seq: bigint("seq", { mode: "bigint" }).notNull(),
    body: text("body").notNull(),
    replyToId: uuid("reply_to_id"),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("message_conversation_id").on(t.conversationId, t.id),
    uniqueIndex("message_sequence").on(t.conversationId, t.seq),
    index("messages_search")
      .using("gin", sql`to_tsvector('simple', ${t.body})`)
      .where(sql`${t.deletedAt} is null`),
    uniqueIndex("message_nonce").on(
      t.conversationId,
      t.authorId,
      t.clientNonce,
    ),
    foreignKey({
      columns: [t.conversationId, t.replyToId],
      foreignColumns: [t.conversationId, t.id],
    }),
    check(
      "valid_message",
      sql`${t.seq} > 0 and ${t.version} > 0 and char_length(${t.body}) <= 2000 and (${t.deletedAt} is null or ${t.body} = '')`,
    ),
  ],
);
export const reactions = pgTable(
  "reactions",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id),
    emoji: text("emoji").notNull(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId, t.emoji] })],
);
export const mentions = pgTable(
  "mentions",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.userId] }),
    index("mentions_by_user").on(t.userId, t.messageId),
  ],
);
export const conversationReads = pgTable(
  "conversation_reads",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id),
    lastReadSeq: bigint("last_read_seq", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.userId] })],
);
export const conversationPreferences = pgTable(
  "conversation_preferences",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id),
    notificationMode: text("notification_mode", {
      enum: ["all", "mentions", "none"],
    })
      .notNull()
      .default("all"),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.userId] })],
);
export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: id(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    eventSeq: bigint("event_seq", { mode: "bigint" }).notNull(),
    eventType: text("event_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("event_sequence").on(t.conversationId, t.eventSeq)],
);
export const mutationKeys = pgTable(
  "mutation_keys",
  {
    actorId: uuid("actor_id")
      .notNull()
      .references(() => appUsers.id),
    operation: text("operation").notNull(),
    requestId: uuid("request_id").notNull(),
    requestHash: text("request_hash").notNull(),
    resultId: uuid("result_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.actorId, t.operation, t.requestId] })],
);
export const auditEvents = pgTable("audit_events", {
  id: id(),
  serverId: uuid("server_id").references(() => servers.id),
  actorId: uuid("actor_id")
    .notNull()
    .references(() => appUsers.id),
  action: text("action").notNull(),
  targetId: uuid("target_id"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: createdAt(),
});
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull(),
});
export const activity = pgTable("user_activity", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => appUsers.id),
  seenAt: timestamp("seen_at", { withTimezone: true }).notNull(),
});
export const typing = pgTable(
  "typing",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.userId] })],
);
export const identityRevocations = pgTable("identity_revocations", {
  clerkId: text("clerk_id").primaryKey(),
  revokedAt: timestamp("revoked_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const sessionRevocations = pgTable("session_revocations", {
  sessionId: text("session_id").primaryKey(),
  revokedAt: timestamp("revoked_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const webhookReceipts = pgTable("webhook_receipts", {
  deliveryId: text("delivery_id").primaryKey(),
  eventType: text("event_type").notNull(),
  signedAt: timestamp("signed_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

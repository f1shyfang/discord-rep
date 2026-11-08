-- Unique indexes must exist before composite foreign keys reference them.
CREATE TABLE "app_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_id" text NOT NULL,
	"handle" text NOT NULL,
	"display_name" text NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'online' NOT NULL,
	"theme" text DEFAULT 'dark' NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_users_clerk_id_unique" UNIQUE("clerk_id"),
	CONSTRAINT "app_users_handle_unique" UNIQUE("handle"),
	CONSTRAINT "valid_handle" CHECK ("app_users"."handle" ~ '^[a-z0-9_]{3,32}$'),
	CONSTRAINT "valid_display_name" CHECK (char_length("app_users"."display_name") between 1 and 80),
	CONSTRAINT "valid_bio" CHECK (char_length("app_users"."bio") <= 190)
);--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "blocks" (
	"blocker_id" uuid NOT NULL,
	"blocked_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocks_blocker_id_blocked_id_pk" PRIMARY KEY("blocker_id","blocked_id"),
	CONSTRAINT "no_self_block" CHECK ("blocks"."blocker_id" <> "blocks"."blocked_id")
);--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);--> statement-breakpoint
CREATE TABLE "channel_overwrites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"role_id" uuid,
	"user_id" uuid,
	"allow_bits" integer DEFAULT 0 NOT NULL,
	"deny_bits" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "one_overwrite_target" CHECK (("channel_overwrites"."role_id" is null) <> ("channel_overwrites"."user_id" is null)),
	CONSTRAINT "valid_overwrite_bits" CHECK ("channel_overwrites"."allow_bits" between 0 and 16383 and "channel_overwrites"."deny_bits" between 0 and 16383 and ("channel_overwrites"."allow_bits" & "channel_overwrites"."deny_bits") = 0)
);--> statement-breakpoint
CREATE TABLE "channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"category_id" uuid,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"topic" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valid_channel_name" CHECK (char_length("channels"."name") between 1 and 100),
	CONSTRAINT "valid_topic" CHECK (char_length("channels"."topic") <= 1024)
);--> statement-breakpoint
CREATE TABLE "conversation_preferences" (
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"notification_mode" text DEFAULT 'all' NOT NULL,
	CONSTRAINT "conversation_preferences_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);--> statement-breakpoint
CREATE TABLE "conversation_reads" (
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_read_seq" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "conversation_reads_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid,
	"dm_user_low" uuid,
	"dm_user_high" uuid,
	"last_message_seq" bigint DEFAULT 0 NOT NULL,
	"last_event_seq" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_channel_id_unique" UNIQUE("channel_id"),
	CONSTRAINT "valid_conversation" CHECK (("conversations"."channel_id" is not null and "conversations"."dm_user_low" is null and "conversations"."dm_user_high" is null) or ("conversations"."channel_id" is null and "conversations"."dm_user_low" is not null and "conversations"."dm_user_high" is not null and "conversations"."dm_user_low" < "conversations"."dm_user_high"))
);--> statement-breakpoint
CREATE TABLE "friendships" (
	"user_low" uuid NOT NULL,
	"user_high" uuid NOT NULL,
	"requester_id" uuid NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friendships_user_low_user_high_pk" PRIMARY KEY("user_low","user_high"),
	CONSTRAINT "valid_friend_pair" CHECK ("friendships"."user_low" < "friendships"."user_high" and "friendships"."requester_id" in ("friendships"."user_low", "friendships"."user_high"))
);--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "valid_invite_uses" CHECK ("invites"."uses" >= 0 and ("invites"."max_uses" is null or ("invites"."max_uses" > 0 and "invites"."uses" <= "invites"."max_uses")))
);--> statement-breakpoint
CREATE TABLE "member_roles" (
	"server_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	CONSTRAINT "member_roles_server_id_user_id_role_id_pk" PRIMARY KEY("server_id","user_id","role_id")
);--> statement-breakpoint
CREATE TABLE "mentions" (
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "mentions_message_id_user_id_pk" PRIMARY KEY("message_id","user_id")
);--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"client_nonce" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"seq" bigint NOT NULL,
	"body" text NOT NULL,
	"reply_to_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "valid_message" CHECK ("messages"."seq" > 0 and "messages"."version" > 0 and char_length("messages"."body") <= 2000 and ("messages"."deleted_at" is null or "messages"."body" = ''))
);--> statement-breakpoint
CREATE TABLE "mutation_keys" (
	"actor_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"request_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"result_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mutation_keys_actor_id_operation_request_id_pk" PRIMARY KEY("actor_id","operation","request_id")
);--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"event_seq" bigint NOT NULL,
	"event_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);--> statement-breakpoint
CREATE TABLE "reactions" (
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	CONSTRAINT "reactions_message_id_user_id_emoji_pk" PRIMARY KEY("message_id","user_id","emoji")
);--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"permissions" integer DEFAULT 0 NOT NULL,
	"is_everyone" boolean DEFAULT false NOT NULL,
	CONSTRAINT "valid_role_bits" CHECK ("roles"."permissions" between 0 and 16383),
	CONSTRAINT "valid_role_position" CHECK ("roles"."position" >= 0 and (not "roles"."is_everyone" or "roles"."position" = 0))
);--> statement-breakpoint
CREATE TABLE "server_bans" (
	"server_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "server_bans_server_id_user_id_pk" PRIMARY KEY("server_id","user_id")
);--> statement-breakpoint
CREATE TABLE "server_members" (
	"server_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "server_members_server_id_user_id_pk" PRIMARY KEY("server_id","user_id")
);--> statement-breakpoint
CREATE TABLE "servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"auth_revision" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valid_server_name" CHECK (char_length("servers"."name") between 2 and 100)
);--> statement-breakpoint
CREATE UNIQUE INDEX "category_server_id" ON "categories" USING btree ("server_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "overwrite_role_once" ON "channel_overwrites" USING btree ("channel_id","role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "overwrite_user_once" ON "channel_overwrites" USING btree ("channel_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_server_id" ON "channels" USING btree ("server_id","id");--> statement-breakpoint
CREATE INDEX "channels_in_server" ON "channels" USING btree ("server_id","position","id");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_dm_pair" ON "conversations" USING btree ("dm_user_low","dm_user_high");--> statement-breakpoint
CREATE INDEX "mentions_by_user" ON "mentions" USING btree ("user_id","message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "message_conversation_id" ON "messages" USING btree ("conversation_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "message_sequence" ON "messages" USING btree ("conversation_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "message_nonce" ON "messages" USING btree ("conversation_id","author_id","client_nonce");--> statement-breakpoint
CREATE UNIQUE INDEX "event_sequence" ON "outbox_events" USING btree ("conversation_id","event_seq");--> statement-breakpoint
CREATE UNIQUE INDEX "role_server_id" ON "roles" USING btree ("server_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_everyone_role" ON "roles" USING btree ("server_id") WHERE "roles"."is_everyone";--> statement-breakpoint
CREATE INDEX "members_by_user" ON "server_members" USING btree ("user_id","server_id");--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_app_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocker_id_app_users_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocked_id_app_users_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_overwrites" ADD CONSTRAINT "channel_overwrites_server_id_channel_id_channels_server_id_id_fk" FOREIGN KEY ("server_id","channel_id") REFERENCES "public"."channels"("server_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_overwrites" ADD CONSTRAINT "channel_overwrites_server_id_role_id_roles_server_id_id_fk" FOREIGN KEY ("server_id","role_id") REFERENCES "public"."roles"("server_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_overwrites" ADD CONSTRAINT "channel_overwrites_server_id_user_id_server_members_server_id_user_id_fk" FOREIGN KEY ("server_id","user_id") REFERENCES "public"."server_members"("server_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_server_id_category_id_categories_server_id_id_fk" FOREIGN KEY ("server_id","category_id") REFERENCES "public"."categories"("server_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_preferences" ADD CONSTRAINT "conversation_preferences_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_preferences" ADD CONSTRAINT "conversation_preferences_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_reads" ADD CONSTRAINT "conversation_reads_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_reads" ADD CONSTRAINT "conversation_reads_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_dm_user_low_app_users_id_fk" FOREIGN KEY ("dm_user_low") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_dm_user_high_app_users_id_fk" FOREIGN KEY ("dm_user_high") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_low_app_users_id_fk" FOREIGN KEY ("user_low") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_high_app_users_id_fk" FOREIGN KEY ("user_high") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_requester_id_app_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_creator_id_app_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_roles" ADD CONSTRAINT "member_roles_server_id_user_id_server_members_server_id_user_id_fk" FOREIGN KEY ("server_id","user_id") REFERENCES "public"."server_members"("server_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_roles" ADD CONSTRAINT "member_roles_server_id_role_id_roles_server_id_id_fk" FOREIGN KEY ("server_id","role_id") REFERENCES "public"."roles"("server_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_id_app_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_reply_to_id_messages_conversation_id_id_fk" FOREIGN KEY ("conversation_id","reply_to_id") REFERENCES "public"."messages"("conversation_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mutation_keys" ADD CONSTRAINT "mutation_keys_actor_id_app_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_bans" ADD CONSTRAINT "server_bans_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_bans" ADD CONSTRAINT "server_bans_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_bans" ADD CONSTRAINT "server_bans_actor_id_app_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_members" ADD CONSTRAINT "server_members_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_members" ADD CONSTRAINT "server_members_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "servers" ADD CONSTRAINT "servers_owner_id_app_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "servers" ADD CONSTRAINT "owner_is_member" FOREIGN KEY ("id", "owner_id") REFERENCES "server_members" ("server_id", "user_id") DEFERRABLE INITIALLY DEFERRED;

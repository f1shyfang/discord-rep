-- Proposed reference schema, not an application migration. Do not apply to production.
-- PostgreSQL; translate into Drizzle migrations and verify on an isolated database.
CREATE TABLE app_users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clerk_id text UNIQUE,
 handle text NOT NULL UNIQUE CHECK (handle ~ '^[a-z0-9_]{3,32}$'),
 display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
 avatar_key text, bio text NOT NULL DEFAULT '' CHECK (char_length(bio) <= 190),
 status text NOT NULL DEFAULT 'online' CHECK (status IN ('online','idle','dnd','invisible')),
 theme text NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark','light','system')),
 identity_event_at timestamptz, onboarding_complete boolean NOT NULL DEFAULT false,
 disabled_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE servers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES app_users,
 name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 100), icon_key text,
 auth_revision bigint NOT NULL DEFAULT 1, deleted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE server_members (
 server_id uuid NOT NULL REFERENCES servers, user_id uuid NOT NULL REFERENCES app_users,
 nickname text, joined_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(server_id,user_id)
);
CREATE INDEX members_by_user ON server_members(user_id,server_id);
-- Deferred so create-server can insert server before owner membership in one transaction.
ALTER TABLE servers ADD CONSTRAINT owner_is_member FOREIGN KEY(id,owner_id)
 REFERENCES server_members(server_id,user_id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE roles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), server_id uuid NOT NULL REFERENCES servers,
 name text NOT NULL, position integer NOT NULL CHECK(position >= 0),
 permissions bigint NOT NULL DEFAULT 0 CHECK(permissions BETWEEN 0 AND 16383),
 color text, is_everyone boolean NOT NULL DEFAULT false, UNIQUE(server_id,id),
 CHECK (NOT is_everyone OR position = 0)
);
CREATE UNIQUE INDEX one_everyone_role ON roles(server_id) WHERE is_everyone;
CREATE TABLE member_roles (
 server_id uuid NOT NULL, user_id uuid NOT NULL, role_id uuid NOT NULL,
 PRIMARY KEY(server_id,user_id,role_id),
 FOREIGN KEY(server_id,user_id) REFERENCES server_members ON DELETE CASCADE,
 FOREIGN KEY(server_id,role_id) REFERENCES roles(server_id,id) ON DELETE CASCADE
);
CREATE TABLE categories (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), server_id uuid NOT NULL REFERENCES servers,
 name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 100), position integer NOT NULL DEFAULT 0,
 UNIQUE(server_id,id)
);
CREATE TABLE channels (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), server_id uuid NOT NULL REFERENCES servers,
 category_id uuid, kind text NOT NULL CHECK(kind IN ('text','voice')),
 name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 100),
 topic text NOT NULL DEFAULT '' CHECK(char_length(topic) <= 1024),
 position integer NOT NULL DEFAULT 0, deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(server_id,id), FOREIGN KEY(server_id,category_id) REFERENCES categories(server_id,id)
);
CREATE INDEX channels_in_server ON channels(server_id,position,id) WHERE deleted_at IS NULL;
CREATE TABLE channel_overwrites (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), server_id uuid NOT NULL, channel_id uuid NOT NULL,
 role_id uuid, user_id uuid,
 allow_bits bigint NOT NULL DEFAULT 0 CHECK(allow_bits BETWEEN 0 AND 16383),
 deny_bits bigint NOT NULL DEFAULT 0 CHECK(deny_bits BETWEEN 0 AND 16383),
 CHECK((role_id IS NULL) <> (user_id IS NULL)), CHECK((allow_bits & deny_bits) = 0),
 FOREIGN KEY(server_id,channel_id) REFERENCES channels(server_id,id) ON DELETE CASCADE,
 FOREIGN KEY(server_id,role_id) REFERENCES roles(server_id,id) ON DELETE CASCADE,
 FOREIGN KEY(server_id,user_id) REFERENCES server_members(server_id,user_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX overwrite_role_once ON channel_overwrites(channel_id,role_id) WHERE role_id IS NOT NULL;
CREATE UNIQUE INDEX overwrite_user_once ON channel_overwrites(channel_id,user_id) WHERE user_id IS NOT NULL;
CREATE TABLE server_bans (
 server_id uuid NOT NULL REFERENCES servers, user_id uuid NOT NULL REFERENCES app_users,
 actor_id uuid NOT NULL REFERENCES app_users, reason text, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(server_id,user_id)
);
CREATE TABLE invites (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), server_id uuid NOT NULL REFERENCES servers,
 creator_id uuid NOT NULL REFERENCES app_users, token_hash text NOT NULL UNIQUE,
 expires_at timestamptz, max_uses integer CHECK(max_uses > 0), uses integer NOT NULL DEFAULT 0 CHECK(uses >= 0),
 revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(max_uses IS NULL OR uses <= max_uses)
);
CREATE TABLE friendships (
 user_low uuid NOT NULL REFERENCES app_users, user_high uuid NOT NULL REFERENCES app_users,
 requester_id uuid NOT NULL REFERENCES app_users,
 status text NOT NULL CHECK(status IN ('pending','accepted')),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_low,user_high),
 CHECK(user_low < user_high), CHECK(requester_id IN (user_low,user_high))
);
CREATE INDEX friendships_high ON friendships(user_high,status);
CREATE TABLE blocks (
 blocker_id uuid NOT NULL REFERENCES app_users, blocked_id uuid NOT NULL REFERENCES app_users,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(blocker_id,blocked_id), CHECK(blocker_id <> blocked_id)
);
CREATE INDEX blocks_reverse ON blocks(blocked_id,blocker_id);
CREATE TABLE conversations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL CHECK(kind IN ('channel','dm')),
 channel_id uuid UNIQUE REFERENCES channels, dm_user_low uuid REFERENCES app_users, dm_user_high uuid REFERENCES app_users,
 last_message_seq bigint NOT NULL DEFAULT 0, last_event_seq bigint NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(dm_user_low,dm_user_high),
 CHECK((kind='channel' AND channel_id IS NOT NULL AND dm_user_low IS NULL AND dm_user_high IS NULL)
    OR (kind='dm' AND channel_id IS NULL AND dm_user_low IS NOT NULL AND dm_user_high IS NOT NULL AND dm_user_low < dm_user_high))
);
CREATE INDEX dms_by_high ON conversations(dm_user_high) WHERE kind='dm';
CREATE TABLE messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL REFERENCES conversations,
 author_id uuid NOT NULL REFERENCES app_users, client_nonce uuid NOT NULL, request_hash text NOT NULL,
 seq bigint NOT NULL CHECK(seq > 0), body text NOT NULL CHECK(char_length(body) <= 2000),
 reply_to_id uuid, version integer NOT NULL DEFAULT 1 CHECK(version > 0),
 created_at timestamptz NOT NULL DEFAULT now(), edited_at timestamptz, deleted_at timestamptz,
 search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple',body)) STORED,
 UNIQUE(conversation_id,id), UNIQUE(conversation_id,seq), UNIQUE(conversation_id,author_id,client_nonce),
 FOREIGN KEY(conversation_id,reply_to_id) REFERENCES messages(conversation_id,id),
 CHECK(deleted_at IS NULL OR body='')
);
CREATE INDEX messages_search ON messages USING gin(search_vector) WHERE deleted_at IS NULL;
CREATE TABLE uploads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES app_users,
 conversation_id uuid NOT NULL REFERENCES conversations, message_id uuid,
 upload_key text NOT NULL UNIQUE, final_key text UNIQUE, filename text NOT NULL,
 declared_type text NOT NULL, verified_type text, size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 1 AND 10485760),
 checksum text, state text NOT NULL CHECK(state IN ('pending','uploaded','scanning','ready','attached','rejected','expired')),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(conversation_id,message_id) REFERENCES messages(conversation_id,id),
 CHECK((state='attached') = (message_id IS NOT NULL)),
 CHECK(state NOT IN ('ready','attached') OR final_key IS NOT NULL)
);
CREATE INDEX uploads_by_message ON uploads(message_id) WHERE message_id IS NOT NULL;
CREATE INDEX uploads_cleanup ON uploads(expires_at) WHERE message_id IS NULL;
CREATE TABLE reactions (
 message_id uuid NOT NULL REFERENCES messages ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES app_users,
 emoji text NOT NULL CHECK(char_length(emoji) BETWEEN 1 AND 32), PRIMARY KEY(message_id,user_id,emoji)
);
CREATE TABLE mentions (
 message_id uuid NOT NULL REFERENCES messages ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES app_users,
 PRIMARY KEY(message_id,user_id)
);
CREATE INDEX mentions_by_user ON mentions(user_id,message_id);
CREATE TABLE conversation_reads (
 conversation_id uuid NOT NULL REFERENCES conversations, user_id uuid NOT NULL REFERENCES app_users,
 last_read_seq bigint NOT NULL DEFAULT 0 CHECK(last_read_seq >= 0),
 PRIMARY KEY(conversation_id,user_id)
);
CREATE INDEX reads_by_user ON conversation_reads(user_id,conversation_id);
CREATE TABLE conversation_preferences (
 conversation_id uuid NOT NULL REFERENCES conversations, user_id uuid NOT NULL REFERENCES app_users,
 notification_mode text NOT NULL DEFAULT 'all' CHECK(notification_mode IN ('all','mentions','none')),
 muted_until timestamptz, PRIMARY KEY(conversation_id,user_id)
);
CREATE TABLE voice_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES app_users,
 channel_id uuid NOT NULL REFERENCES channels, provider_session_id text UNIQUE,
 self_mute boolean NOT NULL DEFAULT false, self_deaf boolean NOT NULL DEFAULT false,
 server_mute boolean NOT NULL DEFAULT false, lease_expires_at timestamptz NOT NULL,
 joined_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz
);
CREATE UNIQUE INDEX one_active_voice_per_user ON voice_sessions(user_id) WHERE ended_at IS NULL;
CREATE TABLE outbox_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid REFERENCES conversations,
 event_seq bigint, audience_kind text NOT NULL CHECK(audience_kind IN ('conversation','server','user')),
 audience_id uuid NOT NULL, event_type text NOT NULL, entity_id uuid, entity_version integer,
 payload jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz, delivered_at timestamptz, dead_lettered_at timestamptz, last_error text,
 UNIQUE(conversation_id,event_seq), CHECK((conversation_id IS NULL) = (event_seq IS NULL))
);
CREATE INDEX outbox_pending ON outbox_events(next_attempt_at) WHERE delivered_at IS NULL AND dead_lettered_at IS NULL;
CREATE TABLE audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), server_id uuid REFERENCES servers,
 actor_id uuid REFERENCES app_users, action text NOT NULL, target_id uuid,
 metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_by_server ON audit_events(server_id,created_at DESC,id);
CREATE TABLE mutation_keys (
 actor_id uuid NOT NULL REFERENCES app_users, operation text NOT NULL, request_id uuid NOT NULL,
 request_hash text NOT NULL, result_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id,operation,request_id)
);
CREATE TABLE webhook_receipts (
 provider text NOT NULL, event_id text NOT NULL, event_time timestamptz NOT NULL,
 processed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(provider,event_id)
);

CREATE TABLE asset_uploads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES app_users,
 purpose text NOT NULL CHECK(purpose IN ('avatar','serverIcon')), server_id uuid REFERENCES servers,
 upload_key text NOT NULL UNIQUE, final_key text UNIQUE, filename text NOT NULL,
 size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 1 AND 2097152), checksum text NOT NULL,
 state text NOT NULL CHECK(state IN ('pending','scanning','ready','attached','rejected','expired')),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((purpose='avatar' AND server_id IS NULL) OR (purpose='serverIcon' AND server_id IS NOT NULL)),
 CHECK(state NOT IN ('ready','attached') OR final_key IS NOT NULL)
);
CREATE INDEX assets_cleanup ON asset_uploads(expires_at) WHERE state <> 'attached';

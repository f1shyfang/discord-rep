ALTER TABLE "servers" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
-- Invoker rights: the application role needs ordinary DML, not ownership or DDL.
-- Requests take a shared lifecycle lock before any account/server/pair locks.
-- Account deletion takes it exclusively, making transfer + erasure one atomic
-- operation, including when two administrators delete their accounts together.
CREATE FUNCTION "public"."delete_chat_account"(deleted_clerk_id text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  deleted_user_id uuid;
  community record;
  successor_id uuid;
  erased_handle text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('gather:identity-lifecycle', 0));
  INSERT INTO "public"."identity_revocations" (clerk_id)
    VALUES (deleted_clerk_id) ON CONFLICT DO NOTHING;
  SELECT id INTO deleted_user_id FROM "public"."app_users"
    WHERE clerk_id = deleted_clerk_id FOR UPDATE;
  IF deleted_user_id IS NULL THEN RETURN; END IF;

  -- Notify connected clients and require fresh snapshots for delta recovery.
  WITH changed AS (
    UPDATE "public"."conversations" SET last_event_seq = last_event_seq + 1
    WHERE id IN (
      SELECT conversation_id FROM "public"."messages" WHERE author_id = deleted_user_id
      UNION SELECT m.conversation_id FROM "public"."messages" m
        JOIN "public"."reactions" r ON r.message_id = m.id WHERE r.user_id = deleted_user_id
      UNION SELECT id FROM "public"."conversations"
        WHERE dm_user_low = deleted_user_id OR dm_user_high = deleted_user_id
    ) RETURNING id, last_event_seq
  )
  INSERT INTO "public"."outbox_events" (conversation_id, event_seq, event_type, entity_id)
    SELECT id, last_event_seq, 'identity.deleted', deleted_user_id FROM changed;

  FOR community IN
    SELECT id FROM "public"."servers"
    WHERE owner_id = deleted_user_id AND deleted_at IS NULL
    ORDER BY id FOR UPDATE
  LOOP
    -- Only a current, active, unbanned administrator can inherit ownership.
    -- Highest admin-role position wins; ties use join time, then stable user ID.
    SELECT sm.user_id INTO successor_id
    FROM "public"."server_members" sm
    JOIN "public"."app_users" u ON u.id = sm.user_id
    JOIN "public"."roles" r ON r.server_id = sm.server_id
    LEFT JOIN "public"."member_roles" mr ON mr.server_id = sm.server_id
      AND mr.user_id = sm.user_id AND mr.role_id = r.id
    WHERE sm.server_id = community.id AND sm.user_id <> deleted_user_id
      AND u.disabled_at IS NULL
      AND (r.is_everyone OR mr.role_id IS NOT NULL)
      AND (r.permissions & 4096) <> 0
      AND NOT EXISTS (SELECT 1 FROM "public"."server_bans" b
        WHERE b.server_id = sm.server_id AND b.user_id = sm.user_id)
      AND NOT EXISTS (SELECT 1 FROM "public"."identity_revocations" ir
        WHERE ir.clerk_id = u.clerk_id)
    GROUP BY sm.user_id, sm.created_at
    ORDER BY max(r.position) DESC, sm.created_at, sm.user_id
    LIMIT 1;
    IF successor_id IS NOT NULL THEN
      UPDATE "public"."servers" SET owner_id = successor_id,
        auth_revision = auth_revision + 1 WHERE id = community.id;
      INSERT INTO "public"."audit_events" (server_id, actor_id, action, target_id)
        VALUES (community.id, deleted_user_id, 'owner.deletion_transferred', successor_id);
    ELSE
      -- Archive is read-only retention, not the seven-day server deletion path.
      UPDATE "public"."servers" SET archived_at = coalesce(archived_at, now()),
        auth_revision = auth_revision + 1 WHERE id = community.id;
      INSERT INTO "public"."audit_events" (server_id, actor_id, action, target_id)
        VALUES (community.id, deleted_user_id, 'owner.deletion_archived', deleted_user_id);
    END IF;
  END LOOP;

  UPDATE "public"."invites" SET revoked_at = coalesce(revoked_at, now())
    WHERE creator_id = deleted_user_id OR server_id IN (
      SELECT id FROM "public"."servers" WHERE owner_id = deleted_user_id
    );
  -- A deleted owner remains only as a tombstone membership on an archived or
  -- already-deleted server to preserve the deferred owner-is-member constraint.
  DELETE FROM "public"."server_members" sm WHERE user_id = deleted_user_id
    AND NOT EXISTS (SELECT 1 FROM "public"."servers" s
      WHERE s.id = sm.server_id AND s.owner_id = deleted_user_id);
  DELETE FROM "public"."member_roles" WHERE user_id = deleted_user_id;
  DELETE FROM "public"."channel_overwrites" WHERE user_id = deleted_user_id;
  DELETE FROM "public"."friendships" WHERE user_low = deleted_user_id OR user_high = deleted_user_id;
  DELETE FROM "public"."blocks" WHERE blocker_id = deleted_user_id OR blocked_id = deleted_user_id;
  DELETE FROM "public"."reactions" WHERE user_id = deleted_user_id;
  DELETE FROM "public"."mentions" WHERE user_id = deleted_user_id;
  DELETE FROM "public"."conversation_reads" WHERE user_id = deleted_user_id;
  DELETE FROM "public"."conversation_preferences" WHERE user_id = deleted_user_id;
  DELETE FROM "public"."typing" WHERE user_id = deleted_user_id;
  DELETE FROM "public"."user_activity" WHERE user_id = deleted_user_id;
  DELETE FROM "public"."mutation_keys" WHERE actor_id = deleted_user_id;
  DELETE FROM "public"."posts" WHERE created_by_id = deleted_clerk_id;
  DELETE FROM "public"."jobs" WHERE user_id = deleted_clerk_id;

  -- Free the original handle without relying on a reserved prefix or truncating
  -- a public UUID. The exclusive lock excludes concurrent profile handle claims.
  LOOP
    erased_handle := 'deleted_' || substr(md5(gen_random_uuid()::text), 1, 24);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM "public"."app_users" WHERE handle = erased_handle);
  END LOOP;
  UPDATE "public"."app_users" SET clerk_id = 'deleted:' || id::text,
    handle = erased_handle, display_name = 'Deleted user', bio = '',
    status = 'invisible', theme = 'dark', disabled_at = coalesce(disabled_at, now())
    WHERE id = deleted_user_id;
END;
$$;
--> statement-breakpoint
-- Bring previously disabled identities under the same retention policy.
DO $$
DECLARE identity record;
BEGIN
  FOR identity IN SELECT clerk_id FROM "public"."app_users"
    WHERE disabled_at IS NOT NULL AND clerk_id NOT LIKE 'deleted:%' ORDER BY id
  LOOP
    PERFORM "public"."delete_chat_account"(identity.clerk_id);
  END LOOP;
END;
$$;

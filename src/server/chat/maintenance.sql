-- Run inside one transaction. Only data already inaccessible for seven days is purged.
SELECT pg_advisory_xact_lock(hashtextextended('gather:maintenance', 0));
SELECT id FROM servers WHERE deleted_at < now() - interval '7 days' FOR UPDATE;
CREATE TEMP TABLE purge_servers ON COMMIT DROP AS
 SELECT id FROM servers WHERE deleted_at < now() - interval '7 days';
CREATE TEMP TABLE purge_channels ON COMMIT DROP AS
 SELECT id FROM channels WHERE deleted_at < now() - interval '7 days'
 OR server_id IN (SELECT id FROM purge_servers);
CREATE TEMP TABLE purge_conversations ON COMMIT DROP AS
 SELECT id FROM conversations WHERE channel_id IN (SELECT id FROM purge_channels);
DELETE FROM mentions WHERE message_id IN (SELECT id FROM messages WHERE conversation_id IN (SELECT id FROM purge_conversations));
DELETE FROM reactions WHERE message_id IN (SELECT id FROM messages WHERE conversation_id IN (SELECT id FROM purge_conversations));
DELETE FROM messages WHERE conversation_id IN (SELECT id FROM purge_conversations);
DELETE FROM outbox_events WHERE conversation_id IN (SELECT id FROM purge_conversations) OR created_at < now() - interval '7 days';
DELETE FROM conversation_reads WHERE conversation_id IN (SELECT id FROM purge_conversations);
DELETE FROM conversation_preferences WHERE conversation_id IN (SELECT id FROM purge_conversations);
DELETE FROM typing WHERE conversation_id IN (SELECT id FROM purge_conversations) OR expires_at < now();
DELETE FROM conversations WHERE id IN (SELECT id FROM purge_conversations);
DELETE FROM channel_overwrites WHERE channel_id IN (SELECT id FROM purge_channels);
DELETE FROM channels WHERE id IN (SELECT id FROM purge_channels);
DELETE FROM categories WHERE server_id IN (SELECT id FROM purge_servers);
DELETE FROM invites WHERE server_id IN (SELECT id FROM purge_servers);
DELETE FROM member_roles WHERE server_id IN (SELECT id FROM purge_servers);
DELETE FROM server_members WHERE server_id IN (SELECT id FROM purge_servers);
DELETE FROM roles WHERE server_id IN (SELECT id FROM purge_servers);
DELETE FROM server_bans WHERE server_id IN (SELECT id FROM purge_servers);
UPDATE audit_events SET server_id = NULL WHERE server_id IN (SELECT id FROM purge_servers);
DELETE FROM servers WHERE id IN (SELECT id FROM purge_servers);
DELETE FROM rate_limits WHERE window_start < now() - interval '1 day';
DELETE FROM user_activity WHERE seen_at < now() - interval '1 day';
DELETE FROM mutation_keys WHERE created_at < now() - interval '7 days';
DELETE FROM webhook_receipts WHERE created_at < now() - interval '30 days';
DELETE FROM session_revocations WHERE revoked_at < now() - interval '30 days';
-- Keep identity tombstones permanently; delayed events cannot restore deleted identities.

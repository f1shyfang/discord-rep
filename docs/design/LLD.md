# Low-Level Design

## 1. Proposed code organization

```text
src/pages/channels/...              # Pages Router navigation and screen composition
src/components/chat/...             # shell, timeline, composer, member list
src/features/{servers,friends,voice,settings}/
src/server/api/routers/{users,servers,channels,messages,friends,dm,...}.ts
src/server/services/{membership,permissions,messaging,attachments,...}.ts
src/server/repositories/...         # Drizzle queries behind injected interfaces
src/server/db/schema/...            # split domain table definitions
src/server/realtime/...             # event creation and ticket authorization
workers/realtime/...                # gateway deployment, independent entrypoint
workers/jobs/...                    # outbox, scan orchestration and cleanup
```

Names describe future modules, not existing files. Routers validate with Zod and obtain actor from Clerk context; services enforce business rules; repositories accept a transaction handle. UI uses existing TanStack Query/tRPC caches. Add routers to the existing root explicitly.

## 2. Permission evaluator

Permission bits in this app (not Discord-compatible IDs): VIEW_CHANNEL=1, SEND_MESSAGES=2, ATTACH_FILES=4, ADD_REACTIONS=8, MANAGE_MESSAGES=16, MANAGE_CHANNELS=32, MANAGE_ROLES=64, KICK_MEMBERS=128, BAN_MEMBERS=256, CREATE_INVITE=512, CONNECT=1024, SPEAK=2048, ADMINISTRATOR=4096, MANAGE_SERVER=8192. Store bigint; serialize decimal strings. Supported mask is 16383; reject unknown bits.

1. Require active user, active server, membership and no ban. Reject before considering owner/admin.
2. Owner receives all permissions. Otherwise OR everyone-role permissions and assigned-role permissions.
3. ADMINISTRATOR bypasses channel overwrites; it does not bypass owner protection or role hierarchy.
4. Apply everyone channel overwrite: `(base & ~deny) | allow`.
5. Aggregate all assigned-role overwrite denies and allows; remove aggregate denies, then add aggregate allows.
6. Apply member-specific deny, then allow.
7. Without VIEW_CHANNEL deny all channel actions. Sending requires SEND_MESSAGES; attachments additionally ATTACH_FILES. Voice requires CONNECT; publishing additionally SPEAK.

This adapts Discord's layered overwrite model to a smaller permission vocabulary. [Discord permissions reference](https://github.com/discord/discord-api-docs/blob/main/developers/topics/permissions.mdx)

Role position only gates role assignment/editing and moderation of other members. Highest actor role must strictly exceed target role; owner can manage all other members. Never grant permissions the actor does not hold, change the everyone role ID, assign an equal/higher role, or remove the owner. Use server-level permissions for moderation/settings. Category moves do not change access in v1. Effective permissions are returned for UI hints but recalculated on each mutation.

Authorization linearization: access-affecting writes acquire the server row exclusively; server-domain mutations acquire a shared server lock before checking access and writing. Thus a send begun before revocation may finish before revocation commits; no send authorized after commit succeeds. Reads evaluate access in their query snapshot. For DMs, lock the canonical user pair before checking blocks and creating/sending; block changes use the same lock order. Never rely on asynchronous invalidations for write authorization.

## 3. Transaction recipes

### Server create and invite join

Create: reserve a per-actor requestId in `mutation_keys`, lock the actor's quota row, validate server limit, insert server → everyone role → owner member → default channels → general conversation, append outbox, store resultId and commit. A repeated key with different input hash yields CONFLICT.

Join: lock server then invite; check active/expiry/maxUses/ban; an existing member succeeds without consuming a use. Lock joining user's quota row, check limits, insert member with next onboarding state, increment uses, append event. All server member count modifications use the same server lock. Invitation token has 32 random bytes; only SHA-256 hash is stored. Revocation and join share the invite lock.

### Message send

```text
begin
  lock server shared (or lock canonical DM pair)
  re-evaluate actor and conversation access
  lock conversation row
  find (conversationId, authorId, clientNonce)
  if existing and request hash matches: return original
  if existing but hash differs: CONFLICT
  validate text, reply target in same conversation, and upload ownership/readiness
  increment conversation.last_message_seq and last_event_seq
  insert message(seq, version=1), link ready attachments, persist user mentions
  insert event in outbox with conversation event sequence
commit
return committed MessageDTO
```

Attachment IDs must be owned by actor, reserved for this conversation, clean and not already attached. Attachment-only messages are valid; empty text without attachments is not. Parse user mentions from explicit composer mention tokens and validate mentioned users can access the conversation. Plain `@name` text does not notify anyone.

Edit/delete: same access checks and conversation lock; require `expectedVersion`, update version, allocate next event sequence and insert outbox. Edit only own undeleted message; delete own or MANAGE_MESSAGES. Clear deleted content and mention records in the same transaction. Reactions are set/unset, not toggle; uniqueness makes retries safe. Deleted messages cannot be edited/reacted to. Delete retries return the tombstone if already deleted.

### Ownership and moderation

Transfer locks server and target member and verifies actor is current owner. Replace owner_id atomically. Owner leave/kick/ban is rejected. Ban adds ban row and removes membership/assigned roles in one transaction, records audit event, revokes voice and emits personal/server invalidations. Permission changes increment server.auth_revision. Server deletion sets deleted_at and emits revocation before asynchronous purge.

## 4. Realtime and recovery

Client states: disconnected → connecting → authenticating → synchronizing → ready; network failure returns to connecting with exponential backoff 1–30 seconds plus jitter. Offline suspends retries until online. A new ticket is required for a new connection. Heartbeat every 25 seconds, connection considered stale after 75 seconds.

Tickets expire after 60 seconds, are single-use, and bind user/session/origin. Send ticket in the initial websocket auth frame within 5 seconds, never in URL. Gateway revalidates session at least every 60 seconds and responds to identity revocations. Private channel subscriptions authorize on join. Durable payloads contain only opaque IDs, event type and cursor; no message content, names or mention contents.

Snapshot protocol: subscribe and buffer hints, fetch snapshot with event watermark in a consistent DB snapshot, then fetch `sync.delta(after=watermark)` and apply higher-version entities. Continue deltas until caught up; discard duplicate event IDs. Per-conversation event sequence allocation is serialized with domain commit, avoiding timestamp/global-sequence commit-order gaps. Replay returns only currently authorized data. After 7 days, a stale cursor receives RESET_REQUIRED and client refetches snapshot. A revoked subscription receives access.revoked, clears private caches and closes associated media; API checks remain authoritative even if that event is delayed.

Outbox rows are claimed with a lease using `FOR UPDATE SKIP LOCKED`, committed before network calls. Publication success marks delivered; failure increments attempts and next_attempt_at. A crashed worker's lease expires. Duplicate publication is harmless. Retain rows for replay 7 days; never purge undelivered/dead-letter rows. Snapshot/delta endpoints read the DB, not gateway memory.

Typing events are sent at most once every 3 seconds and expire after 6 seconds. Presence aggregates active devices; idle after 5 minutes without activity; offline after all device leases expire. DND changes alert behavior, invisible masks presence. Reauthorize ephemeral delivery with a current permission check before fanout; fail closed on check errors. Shared-server blocking hides presence and typing between the pair.

## 5. Reads, pagination, search and cache

Timeline: `WHERE conversation_id = :id AND seq < :before ORDER BY seq DESC LIMIT :limit`, reverse page for display. Cursor includes conversation ID, boundary, direction and recovery epoch; sign it to reject tampering. Latest snapshot is 50 messages, max page size 100. Search uses parameterized PostgreSQL full-text queries with the conversation filter and GIN index; sort by seq descending for stable keyset pagination. `messages.around` loads up to 25 before and after a message for jump/reply navigation.

Read ACK verifies that seq belongs to a visible message (including tombstone), then applies `GREATEST(last_read_seq, incoming)`. First join initializes channel read states to current high-water marks; channel creation initializes existing members lazily from channel creation boundary. Existing DM starts at 0. Unread count excludes own/deleted messages; mention count counts only unread persisted user mentions. Summary polling/realtime invalidation reconciles counts rather than trusting client increments.

Cache keys include user ID and conversation/server ID; clear all private cache on sign-out/account switch. Drafts are per-user/per-conversation in memory/session storage and are purged on sign-out and access loss. Optimistic rows reconcile by author + nonce; versions prevent stale edit responses overwriting newer ones.

## 6. Attachment lifecycle

`pending → uploaded → scanning → ready → attached`; errors lead to rejected; unattached objects expire. Reserve validates declared count/type/size/quota and issues a five-minute signed upload. Complete inspects actual stored size and checksum, then schedules scan; never trust browser MIME. Scan failure keeps file unavailable. Ready objects are immutable: copy verified upload bytes to a fresh final key inaccessible to upload signatures before marking ready, eliminating overwrite-after-scan races. Original signed-upload keys are never served.

Send locks ready upload rows and binds them to one message. Download checks current conversation permission and message deletion before signing a 60-second URL. Existing issued URLs remain valid until expiry; this bounded residual access must be accepted for signed downloads or replaced with a per-request authenticated proxy. Cleanup deletes pending/unattached objects after 24 hours; deleted-message objects purge within 7 days. Use quota reservation plus release on reject/expiry.

## 7. Voice state machine

`idle → requesting_permission → connecting → connected → reconnecting → disconnected/error`. Listen-only is supported when no microphone is granted. API join verifies CONNECT, room limit and membership, allocates a unique voice session lease per user, and issues a short-lived room-scoped credential. Publish permission reflects SPEAK. SFU room admission enforces the 25-person limit atomically; the database count is not the sole gate.

Only one voice room per user is active; joining another room revokes the old session before issuing the new credential. Deafen disables playback and forces microphone mute; undeafen restores previous user mute setting. Server mute overrides self-unmute. Leave, ban, logout and access revocation revoke media credentials/session and remove participant state. Provider webhooks reconcile joins/leaves; lease expiry handles crashes. Audio packets go directly to SFU/TURN, never through tRPC or PostgreSQL. No recording in v1.

## 8. Verification plan

| Layer              | Meaningful cases                                                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Permission units   | Owner/admin, no membership, everyone deny, conflicting role overwrites, member override, private channel, hierarchy                                        |
| DB integration     | Same nonce concurrent send; final-use invite race; duplicate DM creation; block vs send race; cross-server role/parent/reply rejection; stale edit version |
| Worker integration | Crash before publish, after publish before marking, lease expiry, replay ordering, deleted body absent                                                     |
| Storage            | Oversized/spoofed file, overwrite after scan, foreign upload, revoked download, orphan cleanup                                                             |
| Browser            | Two users send/edit/delete/react; reconnect recovers old-message edits; scroll anchor; keyboard/mobile/auth redirects                                      |
| Voice              | Denied mic, TURN-only network, reconnect, switch device/room, ban while connected, 26th participant denied                                                 |
| Load/operations    | SDD budgets, outbox backlog/drain, restore to isolated DB, no credentials/content in logs                                                                  |

Use injected repositories for unit tests, a disposable database for real constraints/concurrency, and browser tests for the user flows. Offline mocks alone cannot validate realtime, media or persistence readiness.

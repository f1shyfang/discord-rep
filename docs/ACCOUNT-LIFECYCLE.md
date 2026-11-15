# Account deletion and abandoned communities

Policy selected on 15 November 2026: erase profile details while retaining shared
messages; transfer communities to an existing administrator or archive them.

## What a member sees

Settings → Delete your account explains the consequences and opens Clerk's account
settings. Security → Delete account uses Clerk's confirmation and reverification
flow. The production Clerk instance has self-service deletion enabled.

Clerk sends a signed `user.deleted` event. Until delivery succeeds, deletion of
application data is asynchronous. Failed processing returns 503 so Clerk retries;
operators can replay failed deliveries. Application requests from the deleted
identity are rejected once its permanent revocation record is committed.

Shared channel and DM messages remain, attributed to **Deleted user**. Message
contents may contain personal information their author typed; members should
remove unwanted messages before deleting their account. Private conversations
remain readable to their other participant, with new sends/reactions disabled.

## Data handling

The deletion transaction clears the original display name, handle, bio, status and
appearance preferences, replaces the app profile's Clerk identifier with a local
tombstone, and removes friendships, blocks, reactions, mention notifications,
read positions, notification preferences, typing/presence and mutation history.
It revokes invitations created by the account and deletes its private starter
posts/jobs. The original handle becomes available again.

A minimal stable app-user tombstone preserves message and audit references. The
original Clerk user identifier remains in a permanent revocation record so old
sessions and delayed deliveries cannot restore access. Moderation audit records
remain as security history with an anonymized actor. This policy does not promise
to erase personal information written into message bodies, moderation reasons or
other members' content. Backups have a separate retention period; a restore must
replay subsequent deletion events before serving users again.

Chat uploads and custom avatar/icon uploads remain deferred. This policy makes no
claim about deleting files from the unused starter R2 integration.

## Ownership and archives

For each live owned community, choose a current administrator who is neither
banned nor disabled/revoked. Prefer the highest administrator-role position, then
the earliest membership date, then user ID for a stable tie-break. Ordinary members
and members with only management permissions do not automatically become owners.
A member can explicitly transfer ownership in Server settings before deletion.

If no eligible administrator exists, archive the community. Existing members keep
their existing channel visibility and can search/read history or leave. They cannot
send, edit/delete messages, react, invite new members, change channels/roles or
perform moderation actions. An archive never expands access to private channels.
The deleted owner's tombstone membership is retained only where needed to satisfy
the database owner-membership constraint; it is hidden from the member list.

Archives are retained indefinitely and are distinct from deleted servers, whose
inaccessible content is purged after seven days. There is no automatic promotion
of ordinary members and no self-service archive recovery. Any later operator
recovery/removal process must verify authority before changing access.

## Deployment and verification

Migration `0005_account_lifecycle.sql` adds archive state and an invoker-rights
lifecycle function, then reconciles profiles disabled by earlier deployments.
Daily cleanup also reconciles any remaining old disabled profiles before starting
the separate purge transaction. Keep this migration's reviewed function and
backfill when generating future schema changes.

Authenticated operations take a shared lifecycle lock; deletion takes it
exclusively before account/server/conversation locks. Normal operations remain
concurrent. Deletion, transfer/archive, anonymization, invalidation events and the
webhook receipt commit or roll back together. Repeated deliveries are safe.
The brief global deletion lock still needs capacity testing for large accounts.

Real PostgreSQL tests cover retained messages, erased details, handle reuse,
administrator succession, archive restrictions, DM restrictions, stale-session
rejection across chat and starter APIs, concurrent deletion, rollback/retry,
legacy migration/backfill and separation from the seven-day purge. Browser tests
exercise both the existing chat journey and signed deletion deliveries, live
anonymization, ownership transfer and a mobile archive view using disposable
Neon schemas and Clerk development users.

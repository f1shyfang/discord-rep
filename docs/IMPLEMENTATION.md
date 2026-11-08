# Discord-style text-chat implementation

Issue: [#1](https://github.com/f1shyfang/lyrainspiredfullstacktemp/issues/1).
The design package under `design/` remains the full proposed baseline. Voice and
file uploads/scanning (including custom avatar/icon uploads) were explicitly
deferred during implementation. These features are not simulated by the UI.

## Implemented

- Clerk sign-in/up/recovery, local profile onboarding, unique handles, bio,
  status preference, dark/light/system appearance, and private-cache isolation
  when switching identities. Public invitation previews preserve the invitation
  through sign-in and onboarding.
- Responsive server/channel/DM navigation, keyboard-accessible native dialogs,
  focus restoration, member list, mobile navigation, conversation search and
  Ctrl/Cmd+K switcher. Ctrl/Cmd+F focuses conversation search.
- Atomic, retry-safe server creation with owner, everyone role, general text
  conversation and deferred Lounge voice entry. Categories/channels can be
  created, renamed, reordered, moved and deleted.
- Hashed, expiring, limited-use invitations with revocation and serialized
  acceptance. Existing memberships are idempotent. Owner transfer, leave,
  name-confirmed deletion, roles, member assignments, layered channel overwrites,
  lower-ranked kick/ban, unban and moderation audit records.
- Persisted text messages, backward pagination, replies, expected-version edits
  and deletes, tombstones, Unicode reactions, validated user mentions, full-text
  search and jump to context. Nonce retries cannot duplicate a stored send or
  silently change its payload. Failed sends retain their draft/nonce for retry.
- Exact-handle friend requests, accept/decline/cancel/remove, blocks/unblocks and
  canonical friend-only new DMs. Existing DM history survives friendship removal
  and blocking; blocks prevent sends in both directions.
- Server-sent event hints with authorization checks on every tick, bounded stream
  and JWT lifetime, message refetch on reconnect, and five-second polling fallback.
  Durable events commit in the message transaction. Bodies always come from
  independently authorized API reads. No credential is placed in a stream URL.
- Per-conversation monotonic reads, unread/mention badges, notification preferences,
  expiring typing and presence heartbeats. Invisible and blocked users are hidden
  from presence. Read advancement requires the visible, focused latest timeline.
- Verified raw Clerk webhook deliveries, durable dedupe, permanent deleted-user
  tombstones and session revocations. Webhooks never gate initial onboarding.
- Transactional seven-day purge of deleted servers/channels; event/idempotency
  history cleanup; stale presence/typing/rate-limit cleanup. Expired delta cursors
  require a fresh snapshot. Maintenance has an opt-in scheduled Actions workflow.

## Running

1. Install with `npm ci`; use the Node version in `.nvmrc`.
2. Configure existing Clerk development keys and Neon URLs through Doppler or
   `.env.local`. Runtime `DATABASE_URL` supports the pooled Neon URL. Migrations
   need `DIRECT_DATABASE_URL` (the existing `DATABASE_URL_UNPOOLED` secret is also accepted as the
   equivalent direct URL).
3. Review `drizzle/0001` through `0004`, then run `npm run db:migrate` against the
   intended development branch. The deployed database has migrations `0000`–`0004`
   applied; automated browser tests use isolated disposable schemas.
   Migration `0001` includes a deferred owner-membership constraint and orders
   composite unique indexes before their foreign keys; preserve those reviewed
   statements when regenerating migrations. Prefer migrations over `db:push`.
4. Run `npm run dev:secrets` or `npm run dev`, then visit `/channels/@me`.
5. Complete your profile, create a server, and share an invitation with a second
   signed-in user. Settings are available in the channel sidebar and user footer.

The existing starter `/jobs`, `post` router and user-owned R2 signed-URL helper
remain available. Those generic R2 procedures do not create chat attachments;
chat intentionally has no upload action until a scanner is provisioned.

For immediate Clerk deletion/session-revocation propagation, configure a Clerk
webhook to `/api/webhooks/clerk` for `user.deleted`, `session.ended`,
`session.removed`, and `session.revoked`, and set `CLERK_WEBHOOK_SIGNING_SECRET`.
Without it the endpoint returns 503, and Clerk's normal signed-token expiration
continues to apply. Include the secret in the Cloudflare worker bindings when
configuring this optional integration. Signature failures return 400 and database
failures return 503 so delivery can retry; no payloads or credentials are logged.

Run `npm run chat:cleanup` with a direct database URL in Doppler. To schedule the
included daily workflow, configure the `chat-maintenance` GitHub environment's
`DIRECT_DATABASE_URL`, review its environment protection settings, and set
`CHAT_MAINTENANCE_ENABLED=true` as a repository variable. It is disabled by default.
The workflow can also be dispatched manually. Deleted data remains inaccessible
immediately and is physically purged after seven days when maintenance runs.

## Validation

```sh
npm run typecheck
npm run lint
npm test
# Use an explicitly disposable PostgreSQL database; each suite creates/removes
# only its own randomly named schema. Without this variable integration skips.
CHAT_TEST_DATABASE_URL=postgresql://user:password@localhost/chat_test npm run test:coverage
npx playwright install chromium
npm run test:e2e
# Same journey through the existing Cloudflare/vinext development runtime:
E2E_RUNTIME=vinext npm run test:e2e
npm run build
npm run build:vinext
```

Browser tests require real Clerk **development** keys and an existing Neon direct
URL (`DATABASE_URL_UNPOOLED`). The runner creates a temporary Neon schema, applies
all migrations there, starts the app with that scoped URL, creates three temporary
Clerk test users, and removes both users and schema afterward. Tests cover a
three-user community, invitations, persisted chat, edits, disconnection recovery,
mobile overflow, private DM blocking, outsiders and channel access revocation.
One client uses event streaming and another deliberately uses the polling fallback.
The `chat-browser` Actions workflow is manual and reads these secrets from the
`chat-e2e` environment. Browser traces can contain private test-session data; failure
artifacts expire after three days and should remain private.

CI runs the PostgreSQL integration suite against a PostgreSQL 18 service, alongside
lint, typecheck, unit tests, audit and production compilation. Integration tests
exercise real SQL transactions, final-use invitation races, nonce races, edit
races, parallel sends, hierarchy boundaries, unauthorized access, blocks, signature
verification, deletion/revocation and purge rollback constraints.

## Runtime choices and release gates

- SSE replaces the proposed separate websocket gateway for this implementation.
  Streams send only opaque event cursors; authorization-sensitive state still
  refreshes from the API. There is no separate gateway, ticket store or outbox
  publisher to deploy. Membership/navigation/presence reconcile periodically.
- Keep the existing Neon HTTP database for starter features. Chat uses
  request-scoped Neon WebSocket pools for interactive Drizzle transactions;
  pools close with the request, including on Workers. The runner uses an unpooled
  URL because PgBouncer rejects a custom `search_path` startup option.
- The server row is the permission lock; message writes also lock a conversation.
  Canonical DM-pair advisory locks serialize blocking, friend changes and sends.
  Message sequence and event sequence allocation are committed atomically.
- The live deployment has passed the smoke checks recorded below. The design's
  1,000-client latency/load budget, WCAG audit, monitored
  backups/restore drill, cost targets and regional failure recovery remain release
  verification gates. Member lists currently use bounded snapshots;
  further friends/member pagination and virtualization is needed before claiming those scale targets.
- Voice, file scanning and safe attachment/avatar/icon storage remain deferred.
  Profile/account data retention and owner succession for deleted accounts need
  an operational policy before a public release.

## Verification record — 8 November 2026

- 63 Vitest tests passed, including real PostgreSQL integration and signed webhook
  verification; typecheck, lint and dependency audit passed (zero advisories).
- Three-user Playwright journey passed on Next.js and on the Cloudflare/vinext
  development runtime with real Clerk development sessions and disposable Neon
  schemas. Desktop and 390 px screenshots were inspected; mobile overflow was
  checked in the browser at 320, 390, 768 and 1024 px.
- Next.js production build and vinext Cloudflare production bundle passed.
- Regenerating the Drizzle schema found no pending differences.
- Browser test users and temporary schemas were removed after testing.
- Production deployment and migrations were completed subsequently, as recorded below.

### Follow-up verification and corrections

Verification reproduced and corrected these additional cases:

- Rejected invite and unknown-handle requests now consume rate-limit quota in a
  separate committed transaction. Business writes still roll back on failure.
- Live event streams invalidate clients when effective permissions change even
  when no message was written. A blocked DM sender loses the composer without
  having to reload; the browser regression checks this within eight seconds.
- Live changes invalidate active conversation searches, removing another user's
  deleted message from visible search results.
- The initial conversation response now includes the persisted read position.
  The timeline captures its unread boundary from that response instead of racing
  the separately loaded sidebar summaries. A component regression reproduces late
  loading, and the browser journey verifies a cold deep link after unread activity.
- The desktop member-list toggle now adds/removes the member panel, keeping its
  visible state consistent with the button's expanded state.

## Cloudflare deployment — 8 November 2026

Live app: [discord.michaelfeng.me](https://discord.michaelfeng.me), served by the
`discord` Worker using the vinext bundle and custom domain. Migrations
`0000`–`0004` were applied to the existing Neon database; the application tables
were confirmed afterward.

Doppler project `discord`, config `prd`, stores the production Clerk keys,
webhook signing secret, pooled runtime URL and direct maintenance URL. The Worker
receives only the pooled URL, Clerk keys and signing secret. `APP_ORIGIN` restricts
production Clerk tokens to the deployed origin. The browser bundle was checked
for the production publishable key and absence of the development key.

The production Clerk domain's DNS and certificates are verified. Its webhook
subscribes to `user.deleted`, `session.ended`, `session.removed` and
`session.revoked`. Actual temporary-user deletion deliveries created revocation
records in the application database.

The `chat-maintenance` GitHub environment holds `DIRECT_DATABASE_URL` and the
repository variable `CHAT_MAINTENANCE_ENABLED=true` enables daily cleanup at
03:17 UTC. The initial manually dispatched
[maintenance run](https://github.com/f1shyfang/discord-rep/actions/runs/42457960660)
succeeded.

A two-user browser smoke check against the deployed HTTPS origin passed production
sign-in, profile onboarding, server creation, invitation acceptance, live SSE
message delivery, persistence after reload, rejection of member-only server
deletion, and 390 px mobile overflow checks. The test community was soft-deleted
and both temporary Clerk users were removed. Anonymous event streams return 401;
GET requests to the webhook return 405.

### Development database isolation

Production remains on `main` (`br-weathered-fog-a762cjb8`). Development uses the
schema-only branch `development` (`br-little-field-a7b46iyi`) with its own endpoint
and a development-only password for its `neondb_owner` role. The schema restore
retains this owner, allowing subsequent migrations to alter copied objects.
All 29 application tables started empty;
no production user data was copied. Schema comparison matched production, apart
from equivalent parentheses in one CHECK constraint after schema restoration.
The five Drizzle journal entries were initialized from production only after
verifying their hashes against the committed SQL, so subsequent migrations run
normally without recreating existing tables.

Local `.env.local` database URLs and Postgres aliases, Doppler `dev` and
`dev_personal`, and Vercel Development/Preview database variables all point to the
development endpoint. Vercel variables previously shared with Production were
split into separate scopes. Production Doppler, Cloudflare runtime and GitHub
maintenance retain the production database configuration. Clerk development and
production instances remain separate. The three-user browser journey passed
using a disposable schema on the development branch, and removed its temporary
Clerk users and schema afterward.

Verification confirmed both development connection types, successful development
migration checks, development writes absent from production, and production
rejection of the development credentials. Keep local experiments and automated
browser tests on development; do not reset it from production with user data.
Voice/uploads, load and latency budgets, full accessibility review, and
backup/restore verification remain outside the verified scope.

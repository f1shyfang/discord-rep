# Production operations

## Monitoring

The Worker persists sanitized application error events in Cloudflare logs.
Invocation logs are disabled and query strings are redacted so invitation URLs,
message bodies and credentials are not deliberately recorded. Application errors
include a request ID, route name and error code; webhook and stream failures use
fixed event names. This is operational error logging, not an external alert route.

`Deployment health` checks HTTPS liveness, the public app shell, anonymous stream
rejection and the webhook method boundary every 15 minutes. It does not prove
login or database health. The nightly `Chat browser verification` workflow checks
real Clerk development sessions and persistence on a disposable development schema,
including account lifecycle and automated accessibility checks. Both workflows can
be dispatched manually. Browser traces remain local because this repository is
public. Failed workflow runs are visible in GitHub Actions.

Alert, billing-alert and support/report destinations were explicitly deferred.
Select and test those destinations before calling monitoring fully operational.

## Database privileges

Cloudflare receives the pooled `discord_runtime` connection with read/write
permissions on `public`. It has no superuser, role-creation, database-creation or
public-schema DDL privileges. Development's pooled runtime uses its own
`discord_runtime` password. Direct owner URLs remain separate for migrations and
maintenance; the Worker has no direct owner binding. Legacy Vercel access was
unavailable during this hardening pass, so its older settings were not updated.

Backups use `discord_backup`, scoped to read-only access on `public` and `drizzle`,
plus SELECT on current/future sequences for `pg_dump`. It cannot write application
data. After adding tables or changing their owner, verify the runtime/backup grants
again. Do not put migration or backup decryption credentials in the Worker.

## Backups and recovery

Neon's current point-in-time history is six hours. A historical branch recovery
was tested separately from production. Temporary recovery branches must expire;
the drill branch created on 15 November 2026 expires automatically at 09:07 UTC.

The daily `Encrypted database backup` workflow uses PostgreSQL 18 `pg_dump` and
GnuPG. Application and migration schemas stream directly into public-key
encryption; plaintext dumps are not written to disk. Ciphertext artifacts are
retained for seven days. The repository is public, so ciphertext can be downloaded
by others; confidentiality depends on the private decryption key staying private.
The workflow never receives that private key. Production was exported with the
read-only role and the encrypted result was successfully restored into a separate
database on the expiring recovery branch; known records and all six migrations
were verified.

Doppler project `discord`, config `prd`, stores `BACKUP_GPG_PRIVATE_KEY`,
`BACKUP_GPG_PUBLIC_KEY`, `BACKUP_GPG_RECIPIENT` and `BACKUP_DATABASE_URL`. The GitHub
`database-backups` environment receives only the read-only URL and public key.
Only `main` can use that environment. The encryption key expires after one year;
rotate before 15 November 2027, retaining old private keys until their final backup
artifacts expire. Confirm that the recovery key can be retrieved independently of
GitHub and Neon account access, and restrict access to the production Doppler config.

To recover:

1. Keep the affected app offline or on a maintenance deployment. Record the last
   good Worker version and the database migration journal.
2. Create an isolated recovery branch/database. Never restore over production as
   the first diagnostic step. Obtain a direct owner connection to that isolated
   target and verify its host differs from production.
3. Use a private temporary GnuPG directory (0700), import the private key from
   Doppler through stdin, and pipe `gpg --decrypt` into PostgreSQL 18 `pg_restore`.
   Set libpq connection parameters through environment variables; do not put a
   password-bearing URL in process arguments or logs. Use `--no-owner
--no-privileges --clean --if-exists --exit-on-error` only on the isolated target.
4. Verify migration count, schema constraints, representative records and private
   channel authorization. Restore the reviewed runtime/backup grants separately;
   the dump deliberately omits owner and privilege assignments.
5. Set `RESTORE_DATABASE_URL` to that isolated target and the matching Clerk key.
   Run `node scripts/reconcile-restored-identities.mjs` first as a dry-run, then
   with `--apply`. It checks Clerk's current authority and re-applies anonymization
   and ownership handling for accounts deleted since the backup. Any API error
   other than a confirmed missing account halts reconciliation. Review/replay
   subsequent session revocations, or wait out the maximum configured session-token
   lifetime before reopening traffic. Backups must not resurrect deleted accounts.
6. Run authenticated smoke checks before changing the Worker's pooled connection.
   Keep code compatible with the restored migration journal. After switching,
   verify sign-in, invitation acceptance, message persistence and webhook delivery.
7. Record timings and outcomes without user content or credentials. Remove local
   keys and plaintext-capable restore environments when the exercise is complete.

The account-lifecycle migration is additive, but older pre-lifecycle Worker
versions do not enforce archive restrictions. Do not roll back below commit
`a0d640b` while archives exist. Leave the lifecycle schema/function in place and
roll back to a compatible Worker rather than dropping tables/columns.

## Capacity

Keep load tests on development, using disposable schemas and synthetic accounts.
The explicit bounded load smoke uses ten concurrent request flows and six event
streams through the local vinext/Workers runtime. It is a small integration
baseline (30 unbatched reads, six streams, zero errors, p95 481 ms in the
15 November run), not evidence for the design's 1,000-client target or regional outage
recovery. Larger deployed load/latency, cost and rate-limit behavior still need
measurement before expanding beyond a small beta.

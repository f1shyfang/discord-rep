# Public readiness

Last reviewed: 15 November 2026. The app is deployed; readiness work is tracked
below rather than inferred from a successful build.

| Area                  | Evidence / remaining work                                                                                                                                                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account deletion      | Live real-Clerk-webhook smoke passed: erased profile details, retained anonymous message history, administrator succession and read-only archives. See [policy](ACCOUNT-LIFECYCLE.md).                                                                                |
| Environment isolation | Production and development use separate Neon branches and passwords.                                                                                                                                                                                                  |
| Database privileges   | Separate restricted runtime and read-only backup roles were provisioned and tested; owner URLs remain for migrations and maintenance.                                                                                                                                 |
| Recovery              | Six-hour Neon history confirmed. Historical recovery and encrypted production export/restore verified in an expiring isolated branch/database. Restore procedures include deletion reconciliation against Clerk.                                                      |
| Scheduled checks      | HTTPS health checks, nightly development browser verification and encrypted seven-day backups are configured. Check Actions for actual results.                                                                                                                       |
| Error logging         | Sanitized Worker error events are persisted; invocation URLs/bodies are excluded. Alert and billing-alert destinations are deferred.                                                                                                                                  |
| Accessibility         | Axe WCAG 2/2.1 A/AA checks cover sign-in, account settings and desktop/mobile archives. Missing titles and mismatched labels were corrected. Manual screen-reader and complete keyboard review remain. Automated checks alone do not establish full WCAG conformance. |
| Capacity              | Explicit development vinext smoke exercises ten unbatched request flows and six SSE streams. This is a small baseline; deployed 1,000-client latency, larger-list behavior, cost and regional failure targets remain unverified.                                      |
| Abuse/support         | Existing blocks, moderation and transactional rate limits are tested. Report handling, human response procedures and contact destinations remain deferred; no unattended report form is presented as operational.                                                     |
| User notices          | Account lifecycle notice is available in settings. Publish the final operator/contact details, general privacy/retention notice and community rules before broad public promotion.                                                                                    |

Keep the release to a small text-chat beta until the remaining gates are resolved.
Voice and file uploads/scanning remain deferred. See [operations](OPERATIONS.md)
for monitoring, privileges, encryption keys, recovery and rollback procedures.

Verification runs from 15 November 2026:
[CI](https://github.com/f1shyfang/discord-rep/actions/runs/43695372750),
[browser and accessibility](https://github.com/f1shyfang/discord-rep/actions/runs/43695408659),
[encrypted backup](https://github.com/f1shyfang/discord-rep/actions/runs/43694925064),
[deployment health](https://github.com/f1shyfang/discord-rep/actions/runs/43694642122),
and [maintenance](https://github.com/f1shyfang/discord-rep/actions/runs/43694647979)
all passed. The SQL/unit suite passed 68 tests. Live production smoke checks used
real Clerk deletion deliveries; synthetic accounts were removed and their test
communities were soft-deleted after verification. The 30-read development load
smoke had zero errors, six concurrent streams and p95 latency of 481 ms.

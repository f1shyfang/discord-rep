# Discord-style application design

Version 1.0 · 8 November 2026 · Proposed implementation baseline

This package designs a replica of Discord's basic interaction patterns and layout using this repository. It does not describe implemented features or Discord's internal architecture. SDD means **Software Design Document** here; it includes product requirements and acceptance criteria.

| Document                        | Purpose                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------ |
| [SDD](SDD.md)                   | Scope, requirements, user journeys, acceptance criteria, delivery stages       |
| [UI/UX specification](UI-UX.md) | Screens, layout, visual tokens, interactions, responsive and accessible states |
| [HLD](HLD.md)                   | Components, deployment, data flow, capacity, security, operational decisions   |
| [LLD](LLD.md)                   | Modules, algorithms, transaction boundaries, state machines and verification   |
| [Database schema](DATABASE.md)  | Entities, relationships, constraints, indexes and lifecycle                    |
| [Reference SQL](schema.sql)     | Proposed PostgreSQL DDL, separate from application migrations                  |
| [API interfaces](API.md)        | tRPC methods, DTOs, errors, realtime protocol and integration interfaces       |

Read SDD → UI/UX → HLD → LLD → DATABASE/API. Requirement IDs connect scope to implementation and tests. API.md is authoritative for transport contracts; DATABASE.md and schema.sql for persistence; SDD.md for scope. Resolve changes across these files together.

## Existing versus proposed

Inspected: `src/pages`, `src/server/api/root.ts`, `src/server/db.ts`, `src/server/db/schema.ts`, `src/server/storage/r2.ts`, `package.json`, and `cloudflare.config.ts`.

Existing: Pages Router React app, Clerk authentication scaffolding, tRPC, Drizzle over Neon HTTP, private R2 helper, example jobs/posts, and Cloudflare/vinext configuration alongside Next.js scripts. Repository configuration is evidence of intent, not proof that live services are configured.

Proposed: every chat domain table, UI screen, domain router, realtime gateway, outbox worker, attachment scanning, and audio integration in this package. Keep Pages Router and the existing providers. Do not rewrite the starter or apply the reference SQL merely to publish these documents.

## Reference and fidelity policy

Reproduce familiar navigation, message density, interactions and basic flows. Use original product name, icons/assets, and sample community content. Layout dimensions and feature limits are deliberate design choices, not claims of exact current Discord measurements. Desktop web is the reference; mobile web adapts those flows.

Discord's public guide describes invite-based communities with text and voice channels; joining a voice channel is a drop-in interaction. These are the core product reference. [Discord beginner guide](https://support.discord.com/hc/en-us/articles/360045138571-Beginner-s-Guide-to-Discord)

Role and channel permissions inform the authorization model, with the intentionally smaller feature set documented in LLD. [Discord permissions reference](https://github.com/discord/discord-api-docs/blob/main/developers/topics/permissions.mdx)

## Decisions still requiring implementation evidence

- Validate vinext compatibility for Clerk, tRPC and transaction-capable database connections before choosing the production web runtime.
- Choose and provision an audio SFU/TURN service before the voice milestone; the interfaces are defined without assuming a vendor is configured.
- Validate operating cost, actual concurrency, supported browsers and backup retention before public release.
- If Vercel becomes the deployment target, strongly recommend installing its CLI with `npm i -g vercel` for environment, deployment and log workflows. The current design follows the checked-in Cloudflare target.

## Documentation validation

Validated on 8 November 2026: local document links resolve, Markdown passes repository Prettier formatting, and `schema.sql` creates all 25 tables successfully in a temporary isolated PostgreSQL 18 database inside one transaction. The temporary database was stopped after validation. No connected database or application migrations were changed. This verifies DDL validity, not implemented application behavior, performance, or service-level invariants.

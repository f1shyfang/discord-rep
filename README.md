# lyrainspiredfullstacktemp

A fullstack starter adapted from [Anh Dao's Next.js guidelines](https://github.com/zitianqin/anh-dao-2024-nextjs-guidelines), built upon Nam Dao's original work. Original attribution and the Pages Router, TypeScript, Tailwind, tRPC, Zod, and Jest architecture are retained.

This copy uses **Clerk** for authentication, **Drizzle ORM** for database access, **Neon Postgres** for storage, and **Doppler** for secrets. It uses patched Next.js 15.5, React 18, and the current Clerk Core 3 SDK (`@clerk/nextjs` 7), while retaining the source's Pages Router architecture.

## Quick start

1. Install Node.js 22 (`nvm install && nvm use`) and run `npm ci`.
2. Create a Clerk application in the [Clerk Dashboard](https://dashboard.clerk.com). Enable your preferred sign-in methods there, including Google if needed. Copy the development publishable key and secret key into Doppler as described below. OAuth credentials are configured in Clerk, not in this app.
3. Create a [Neon project](https://console.neon.tech) and a development branch. Copy its pooled connection URL into `DATABASE_URL` and its direct connection URL into `DIRECT_DATABASE_URL`. Both use PostgreSQL with `sslmode=require`.
4. Install the [Doppler CLI](https://docs.doppler.com/docs/cli), log in with `doppler login`, and create a project named `lyrainspiredfullstacktemp` with a `dev` config. If using a different project/config, update `doppler.yaml`.
5. In the Doppler dashboard, add the four variables listed in `.env.example`. That file contains placeholders only. Run `doppler setup` in this directory to select the project/config.
6. Run `npm run db:migrate` to apply the committed Drizzle migration to your development database.
7. Run `npm run dev:secrets` and open [localhost:3000](http://localhost:3000). Sign up, then open `/jobs` to create and list your jobs.

Clerk, Neon, and Doppler resources and real credentials must be configured for a live run. This repository does not provision accounts or contain credentials.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev:secrets` | Start Next.js with Doppler secrets |
| `npm run build:secrets` | Build with Doppler secrets |
| `npm run start:secrets` | Run the production build with Doppler secrets |
| `npm run db:generate` | Generate SQL migrations after editing the schema |
| `npm run db:migrate` | Apply migrations using Doppler's direct database URL |
| `npm run db:push` | Push schema changes directly to a disposable development branch |
| `npm run db:studio` | Inspect the database with Drizzle Studio |
| `npm run typecheck` | Check TypeScript |
| `npm run lint` | Run ESLint |
| `npm test -- --runInBand` | Run Jest tests |

The standard `dev`, `build`, and `start` commands also work when a hosting platform or shell already injects environment variables. You can use a gitignored `.env.local` locally instead, but Doppler is the primary secrets source. Drizzle commands use Doppler; no dotenv files are loaded by `drizzle.config.ts`.

## Architecture and guidelines

- **API layer:** `src/pages/api` and `src/server/api` handle transport, authentication, authorization, and Zod validation. Public tRPC procedures remain public; protected procedures reject requests without a verified Clerk user ID.
- **Service layer:** `src/libs/user/userJobHelper.ts` owns job operations and depends on a small repository interface. Inject repositories to test service behavior independently of the ORM.
- **Data layer:** `DrizzleJobRepository` implements persistence. `src/server/db/schema.ts` defines posts and jobs; `src/server/db.ts` connects Drizzle to Neon over HTTP. Use a WebSocket or PostgreSQL driver if future features require interactive transactions.
- **Authentication:** `src/middleware.ts` establishes Clerk request authentication; `_app.tsx` provides Clerk's client context. Users and sessions live in Clerk. Records store Clerk user IDs; the database has no local user/session tables or foreign keys to Clerk. Add verified webhooks if you later need user profile synchronization or deletion cleanup.
- **Ownership:** Derive user IDs from verified server authentication, never client input. Scope reads and writes to that ID. Public access to the home and jobs pages does not grant access to protected tRPC procedures.
- **Secrets:** Store separate development, staging, and production values in Doppler. `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is intentionally browser-visible and must be available at build time; all other listed variables stay server-side. Never add a `NEXT_PUBLIC_` prefix to secrets or log credentials.
- **Errors:** Propagate database failures through tRPC so clients can display errors; do not hide them behind successful empty results.
- **Testing:** Name tests `*.test.ts`, inject dependencies, and exercise ownership and error paths. Run the checks above before pushing changes.

## Schema changes

Edit `src/server/db/schema.ts`, run `npm run db:generate`, inspect and commit the generated SQL and metadata in `drizzle/`, then run `npm run db:migrate` against an isolated Neon development branch. Use a direct URL for migrations and a pooled URL for runtime queries. Apply reviewed migrations to production in a controlled deployment step; builds do not run migrations automatically.

This is a fresh starter schema. The initial migration creates posts and jobs only. It does not migrate existing user accounts, sessions, or application records from an older installation. If adapting an existing app, plan a separate account and data migration before connecting a populated production database.

## CI and deployment

GitHub Actions runs installation, type checking, linting, Jest, and a production build with explicit non-secret placeholder values. CI verifies compilation without contacting Clerk or Neon; live authentication and persistence need configured services.

For Vercel, import this private repository and configure the [Doppler Vercel integration](https://docs.doppler.com/docs/vercel) to sync the appropriate secrets config to each deployment environment. Keep preview deployments on a separate Neon branch and Clerk development instance. The normal build command is `npm run build`; the platform injects the synced variables. Apply migrations separately before releasing code that depends on them.

For another host, inject a scoped Doppler service token through that platform's secret store and use `doppler run -- npm run start`. Never commit a service token. Keep migrations out of routine builds and untrusted pull-request jobs.

## Dependency maintenance

The source framework was upgraded to Next.js 15.5.29 to remove critical framework advisories, and nonbreaking dependency fixes were applied. The dependency audit still reports low, moderate, and high advisories in the retained toolchain and transitive packages (including Zod, PostCSS, ESLint, Jest, and Drizzle Kit). Run `npm audit` when adopting this starter; resolving the remaining findings requires a separate dependency review. No critical findings remained at the time of this migration.

## References

- [Original guidelines](https://github.com/zitianqin/anh-dao-2024-nextjs-guidelines)
- [Clerk Pages Router authentication](https://clerk.com/docs/reference/nextjs/pages-router/get-auth)
- [Clerk middleware](https://clerk.com/docs/reference/nextjs/clerk-middleware)
- [Drizzle and Neon](https://orm.drizzle.team/docs/connect-neon)
- [Doppler CLI](https://docs.doppler.com/docs/cli)
- [tRPC](https://trpc.io/docs)

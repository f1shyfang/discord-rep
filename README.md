# lyrainspiredfullstacktemp

A fullstack starter adapted from [Anh Dao's Next.js guidelines](https://github.com/zitianqin/anh-dao-2024-nextjs-guidelines), built upon Nam Dao's original work. Original attribution and the Pages Router, TypeScript, Tailwind, tRPC, and Zod architecture are retained; tests now use Vitest.

This copy uses **Clerk** for authentication, **Drizzle ORM** for database access, **Neon Postgres** for relational data, **Cloudflare R2** for private S3-compatible file storage, and **Doppler** for secrets. It uses Next.js 16 LTS, Node.js 26 LTS, stable React 19, TypeScript 7, and the Clerk Core 3 SDK, while retaining the source's Pages Router architecture.

## Versions and compatibility

| Component | Version |
| --- | --- |
| Next.js | 16.4.5 (Active LTS line) |
| Node.js | 26.13.0 LTS |
| React / React DOM | 19.3.1 stable |
| TypeScript compiler | 7.0.2 stable |

`.nvmrc` pins Node 26.13.0 and CI reads that file. The engine range accepts Node 26.13.0 through the rest of Node 26. React and React DOM use the same exact version.

TypeScript 7's native compiler is installed as `@typescript/native` using an npm alias. Its executable is still `tsc`, so `npm run typecheck` and Next.js's default CLI checker use TypeScript 7. ESLint and other tools that need the older JavaScript compiler API resolve `typescript` to Microsoft's `@typescript/typescript6` compatibility package (which provides `tsc6`). This follows [Microsoft's side-by-side setup](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0). Next.js uses its [project-local CLI type checker](https://nextjs.org/docs/app/api-reference/config/typescript#using-typescript-7); type errors are not skipped.

Next.js 16 uses Turbopack for development and production builds and `src/proxy.ts` for Clerk request authentication. ESLint uses flat configuration in `eslint.config.mjs`; builds run lint explicitly because Next.js 16 no longer runs it automatically. Vitest runs tests as ESM and does not depend on `ts-node` or the TypeScript compiler API.

## Quick start

1. Install Node.js 26.13.0 LTS (`nvm install && nvm use`) and run `npm ci`.
2. Create a Clerk application in the [Clerk Dashboard](https://dashboard.clerk.com). Enable your preferred sign-in methods there, including Google if needed. Copy the development publishable key and secret key into Doppler as described below. OAuth credentials are configured in Clerk, not in this app.
3. Create a [Neon project](https://console.neon.tech) and a development branch. Copy its pooled connection URL into `DATABASE_URL` and its direct connection URL into `DIRECT_DATABASE_URL`. Both use PostgreSQL with `sslmode=require`.
4. Install the [Doppler CLI](https://docs.doppler.com/docs/cli), log in with `doppler login`, and create a project named `lyrainspiredfullstacktemp` with a `dev` config. If using a different project/config, update `doppler.yaml`.
5. In the Doppler dashboard, add the Clerk and database variables listed in `.env.example`. Add the optional R2 variables when enabling file storage (see below). That file contains placeholders only. Run `doppler setup` in this directory to select the project/config.
6. Run `npm run db:migrate` to apply the committed Drizzle migration to your development database.
7. Run `npm run dev:secrets` and open [localhost:3000](http://localhost:3000). Sign up, then open `/jobs` to create and list your jobs.

Clerk, Neon, Doppler, and (for file storage) R2 resources and real credentials must be configured for a live run. This repository does not provision accounts or contain credentials.

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
| `npm test` | Run Vitest tests |
| `npm run test:coverage` | Run tests with V8 coverage |

The standard `dev`, `build`, and `start` commands also work when a hosting platform or shell already injects environment variables. You can use a gitignored `.env.local` locally instead, but Doppler is the primary secrets source. Drizzle commands use Doppler; no dotenv files are loaded by `drizzle.config.ts`.

## Architecture and guidelines

- **API layer:** `src/pages/api` and `src/server/api` handle transport, authentication, authorization, and Zod validation. Public tRPC procedures remain public; protected procedures reject requests without a verified Clerk user ID.
- **Service layer:** `src/libs/user/userJobHelper.ts` owns job operations and depends on a small repository interface. Inject repositories to test service behavior independently of the ORM.
- **Data layer:** `DrizzleJobRepository` implements persistence. `src/server/db/schema.ts` defines posts and jobs; `src/server/db.ts` connects Drizzle to Neon over HTTP. Use a WebSocket or PostgreSQL driver if future features require interactive transactions.
- **File storage:** `src/server/storage/r2.ts` wraps the S3 SDK for a private Cloudflare R2 bucket. The protected `storage` tRPC router derives object ownership from the verified Clerk user ID and issues short-lived signed URLs. Storage configuration is loaded lazily, so the base app and CI build work without R2 credentials.
- **Authentication:** `src/proxy.ts` establishes Clerk request authentication; `_app.tsx` provides Clerk's client context. Users and sessions live in Clerk. Records store Clerk user IDs; the database has no local user/session tables or foreign keys to Clerk. Add verified webhooks if you later need user profile synchronization or deletion cleanup.
- **Ownership:** Derive user IDs from verified server authentication, never client input. Scope reads and writes to that ID. Public access to the home and jobs pages does not grant access to protected tRPC procedures.
- **Secrets:** Store separate development, staging, and production values in Doppler. `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is intentionally browser-visible and must be available at build time; all other listed variables stay server-side. Never add a `NEXT_PUBLIC_` prefix to secrets or log credentials.
- **Errors:** Propagate database failures through tRPC so clients can display errors; do not hide them behind successful empty results.
- **Testing:** Name tests `*.test.ts`, inject dependencies, and exercise ownership and error paths. Run the checks above before pushing changes.

## Schema changes

Edit `src/server/db/schema.ts`, run `npm run db:generate`, inspect and commit the generated SQL and metadata in `drizzle/`, then run `npm run db:migrate` against an isolated Neon development branch. Use a direct URL for migrations and a pooled URL for runtime queries. Apply reviewed migrations to production in a controlled deployment step; builds do not run migrations automatically.

This is a fresh starter schema. The initial migration creates posts and jobs only. It does not migrate existing user accounts, sessions, or application records from an older installation. If adapting an existing app, plan a separate account and data migration before connecting a populated production database.

## Cloudflare R2 file storage

1. Create a private bucket in the [Cloudflare R2 dashboard](https://dash.cloudflare.com). Leave public access (`r2.dev` and custom public domains) disabled. Use separate buckets and credentials for development and production.
2. Create an [R2 S3 API token](https://developers.cloudflare.com/r2/api/tokens/) with **Object Read & Write** access scoped to that bucket. Copy its Access Key ID and Secret Access Key into Doppler, not into the repository.
3. Set these server-only Doppler variables: `R2_ACCOUNT_ID` (the 32-character Cloudflare account ID), `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`.
4. Apply `config/r2-cors.example.json` in the bucket's CORS settings for local development. Replace or extend `AllowedOrigins` with your exact deployed app origins for other environments. No wildcard origin is needed. The upload request must send the returned `Content-Type` header.
5. Restart the app after changing secrets. The S3 client uses region `auto` and endpoint `https://<account-id>.r2.cloudflarestorage.com`, following [Cloudflare's S3 SDK example](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/).

All R2 variables are optional for the rest of the app. Calling storage procedures without all four produces `PRECONDITION_FAILED` with a setup message. R2 resources are not provisioned automatically; no live bucket credentials are committed.

The authenticated API exposes:

| Procedure | Input | Result |
| --- | --- | --- |
| `storage.createUploadUrl` | `{ fileName, contentType }` | `{ key, url, headers, expiresIn }` for a direct browser PUT |
| `storage.createDownloadUrl` | `{ key }` | `{ url, expiresIn }` for a private GET download |
| `storage.deleteObject` | `{ key }` | `{ deleted: true }` after deleting an owned object |

For example, inside a React component or custom hook:

```tsx
const upload = api.storage.createUploadUrl.useMutation();
const download = api.storage.createDownloadUrl.useMutation();

async function uploadFile(file: File) {
  const signed = await upload.mutateAsync({
    fileName: file.name,
    contentType: file.type || "application/octet-stream",
  });
  const response = await fetch(signed.url, {
    method: "PUT",
    headers: signed.headers,
    body: file,
  });
  if (!response.ok) throw new Error("File upload failed");
  return signed.key; // Save this key with your application's record after success.
}

async function downloadFile(key: string) {
  const signed = await download.mutateAsync({ key });
  window.location.assign(signed.url);
}
```

Import `api` from `~/utils/api`. The service also supports server-side use via `getR2Storage()` from `~/server/storage`; always pass a verified user ID, never a user ID supplied by a client.

Object keys use `users/<clerk-user-id>/<random-uuid>/<sanitized-filename>`, so repeated filenames do not overwrite one another. Download and delete operations reject foreign user prefixes and path traversal. Downloads are served as attachments with `application/octet-stream`. These procedures do not list bucket contents or create public object URLs.

Signed URLs expire after five minutes and can be reused until they expire. Treat them as temporary bearer credentials and avoid logging them. The upload signature binds the `Content-Type` header, but it does not inspect file contents or enforce a hard size/quota limit. Add application-specific validation and quotas before issuing URLs when your product needs them. This starter does not create a file metadata table; persist returned keys in your own data model as needed.

Tests exercise real offline SigV4 signing, ownership and traversal rejection, configuration errors, and API authentication. Real R2 uploads and downloads require a configured account, bucket, credentials, and CORS policy. See [presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) and [R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/) for provider details.

## CI and deployment

GitHub Actions runs installation, type checking, linting, Vitest, the dependency audit, and a production build with explicit non-secret placeholder values. CI verifies compilation without contacting Clerk, Neon, or R2; live authentication and persistence need configured services.

For Vercel, import this private repository and configure the [Doppler Vercel integration](https://docs.doppler.com/docs/vercel) to sync the appropriate secrets config to each deployment environment. Keep preview deployments on a separate Neon branch and Clerk development instance. The normal build command is `npm run build`; the platform injects the synced variables. Apply migrations separately before releasing code that depends on them.

For another host, inject a scoped Doppler service token through that platform's secret store and use `doppler run -- npm run start`. Never commit a service token. Keep migrations out of routine builds and untrusted pull-request jobs.

## Dependency maintenance

All direct packages use their current stable release lines. Major dependency updates include tRPC 11, TanStack React Query 5, Zod 4, Tailwind CSS 4, ESLint 10, Prettier 3, and Vitest 5. Tailwind 4 uses `@tailwindcss/postcss` and CSS theme configuration in `src/styles/globals.css`; its bundled CSS processing replaces the separate Autoprefixer dependency.

`npm audit` reports **zero vulnerabilities**, including development dependencies, after a clean install of the committed lockfile. Run `npm ci` and `npm audit` to reproduce the result. Audit results describe advisories known at the time of the check; CI runs the audit so new reports are visible.

The test suite moved from Jest to Vitest because the latest Jest release still depends on `deepmerge` 4.3.1, which has no published patched stable release for [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4). The suite retains ownership and error handling coverage and adds an HTTP test for tRPC serialization, anonymous rejection, and Zod request validation. Frontend tests can opt into the installed jsdom environment with `// @vitest-environment jsdom`.

The `overrides` in `package.json` address remaining upstream constraints without suppressing audit results:

- Affected Minimatch 7–11.0.0 dependencies resolve to patched 11.0.5. Older unaffected Minimatch consumers keep their original API.
- Drizzle Kit's legacy `@esbuild-kit/core-utils` loader uses patched esbuild 0.28.2 instead of vulnerable 0.18.20. Migration generation is checked against this override.
- Three ESLint plugins (`import`, `jsx-a11y`, and `react`) still declare peer ranges ending at ESLint 9. Their scoped peer overrides select the project's stable ESLint 10; the complete project lint check verifies this configuration. Remove these peer overrides once upstream declares ESLint 10 support.

TypeScript's compatibility aliases remain as described above: the project uses stable TypeScript 7 for compilation and Microsoft's TypeScript 6 API package for tools that still need it. No preview compiler or test-runner releases are used.

## References

- [Original guidelines](https://github.com/zitianqin/anh-dao-2024-nextjs-guidelines)
- [Clerk Pages Router authentication](https://clerk.com/docs/reference/nextjs/pages-router/get-auth)
- [Clerk middleware](https://clerk.com/docs/reference/nextjs/clerk-middleware)
- [Drizzle and Neon](https://orm.drizzle.team/docs/connect-neon)
- [Doppler CLI](https://docs.doppler.com/docs/cli)
- [tRPC](https://trpc.io/docs)

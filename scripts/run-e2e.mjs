import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { Pool } from "@neondatabase/serverless";

if (
  !process.env.CLERK_SECRET_KEY?.startsWith("sk_test_") ||
  !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_")
) {
  throw new Error("E2E requires Clerk development-instance keys.");
}
if (!process.env.DATABASE_URL)
  throw new Error("E2E requires an existing Neon DATABASE_URL.");
const schemaName = `chat_e2e_${randomUUID().replaceAll("-", "")}`;
const admin = new Pool({
  connectionString:
    process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL,
  max: 1,
});
admin.on("error", () => {});
let scoped;
try {
  await admin.query(`create schema "${schemaName}"`);
  const url = new URL(
    process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL,
  );
  url.searchParams.set("options", `-c search_path=${schemaName}`);
  scoped = new Pool({ connectionString: url.toString(), max: 1 });
  scoped.on("error", () => {});
  for (const file of (await readdir("drizzle"))
    .filter((f) => /^\d+.*\.sql$/.test(f))
    .sort()) {
    const migration = await readFile(`drizzle/${file}`, "utf8");
    await scoped.query(migration.replaceAll('"public".', `"${schemaName}".`));
  }
  await scoped.end();
  scoped = undefined;
  console.log("E2E migrations applied to a disposable Neon schema.");
  const child = spawn(
    "node_modules/.bin/playwright",
    ["test", ...process.argv.slice(2)],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_URL: url.toString(),
        DIRECT_DATABASE_URL: url.toString(),
        CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      },
    },
  );
  process.exitCode = await new Promise((resolve) =>
    child.on("exit", (code) => resolve(code ?? 1)),
  );
} catch (error) {
  console.error(
    "E2E setup failed:",
    error instanceof Error ? error.message : "Database transport error",
  );
  process.exitCode = 1;
} finally {
  await scoped?.end();
  await admin.query(`drop schema if exists "${schemaName}" cascade`);
  await admin.end();
  console.log("Disposable E2E schema removed.");
}

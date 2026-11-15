import { createClerkClient } from "@clerk/backend";
import { Pool } from "@neondatabase/serverless";

// Explicit restore-only configuration avoids accidentally selecting the app's
// normal DATABASE_URL. Run while the restored database is isolated from traffic.
const connectionString = process.env.RESTORE_DATABASE_URL;
const secretKey = process.env.CLERK_SECRET_KEY;
if (!connectionString || !secretKey)
  throw new Error(
    "Set RESTORE_DATABASE_URL and the matching Clerk secret key.",
  );
const apply = process.argv.includes("--apply");
const clerk = createClerkClient({ secretKey });
const pool = new Pool({ connectionString, max: 1 });
pool.on("error", () => {});
let checked = 0,
  missing = 0,
  anonymized = 0;
try {
  const { rows } = await pool.query(
    "select clerk_id from app_users where disabled_at is null order by id",
  );
  for (const row of rows) {
    try {
      await clerk.users.getUser(row.clerk_id);
    } catch (error) {
      // Transport errors, throttling and authorization failures are never proof
      // of deletion. Halt recovery rather than erasing a live identity.
      if (
        !error ||
        typeof error !== "object" ||
        !("status" in error) ||
        error.status !== 404
      )
        throw new Error(
          "Clerk reconciliation could not establish account state.",
        );
      missing++;
      if (apply) {
        await pool.query("select delete_chat_account($1)", [row.clerk_id]);
        anonymized++;
      }
    }
    checked++;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  console.log(
    JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      checked,
      missing,
      anonymized,
    }),
  );
} catch {
  console.error(
    "Restore identity reconciliation failed. Keep the restored app offline.",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}

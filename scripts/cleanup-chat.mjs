import { readFile } from "node:fs/promises";
import { Pool } from "@neondatabase/serverless";
const connectionString =
  process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!connectionString)
  throw new Error(
    "Maintenance requires DIRECT_DATABASE_URL or DATABASE_URL_UNPOOLED.",
  );
const pool = new Pool({ connectionString, max: 1 });
pool.on("error", () => {});
let client;
try {
  const maintenance = await readFile(
    new URL("../src/server/chat/maintenance.sql", import.meta.url),
    "utf8",
  );
  client = await pool.connect();
  await client.query("begin");
  await client.query(maintenance);
  await client.query("commit");
  console.log("Chat maintenance completed.");
} catch {
  if (client) await client.query("rollback").catch(() => {});
  console.error("Chat maintenance failed; transaction rolled back.");
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}

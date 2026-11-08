import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { env } from "~/env";
import * as schema from "~/server/db/schema";

// Request-scoped pools also work on Workers, where sockets must not outlive requests.
export async function withChatDb<T>(
  run: (database: ChatDatabase) => Promise<T>,
): Promise<T> {
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  // Idle transport errors otherwise include the driver configuration (and credentials).
  // In-flight query errors still reject their operation and are handled by tRPC.
  pool.on("error", () => {});
  try {
    return await run(drizzle(pool, { schema }));
  } finally {
    await pool.end();
  }
}
export type ChatDatabase = ReturnType<typeof drizzle<typeof schema>>;
export type ChatTransaction = Parameters<
  Parameters<ChatDatabase["transaction"]>[0]
>[0];
export type ChatStore = ChatDatabase | ChatTransaction;

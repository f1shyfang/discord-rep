import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { env } from "~/env";
import * as schema from "~/server/db/schema";

export const db = drizzle(neon(env.DATABASE_URL), { schema });

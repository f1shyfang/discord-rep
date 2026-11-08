import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url().startsWith("postgresql://"),
    CLERK_SECRET_KEY: z.string().min(1),
    CLERK_WEBHOOK_SIGNING_SECRET: z.string().min(1).optional(),
    R2_ACCOUNT_ID: z
      .string()
      .regex(/^[a-f0-9]{32}$/i)
      .optional(),
    R2_BUCKET_NAME: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/)
      .optional(),
    R2_ACCESS_KEY_ID: z.string().min(1).optional(),
    R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
  },
  client: { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1) },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
    CLERK_WEBHOOK_SIGNING_SECRET: process.env.CLERK_WEBHOOK_SIGNING_SECRET,
    NODE_ENV: process.env.NODE_ENV,
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  },
  skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
  emptyStringAsUndefined: true,
});

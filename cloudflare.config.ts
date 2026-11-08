import { bindings, defineConfig, defineWorker } from "cf/config";

export default defineConfig({
  worker: defineWorker({
    name: "discord",
    entrypoint: "vinext/server/fetch-handler",
    compatibilityDate: "2026-11-08",
    compatibilityFlags: ["nodejs_compat"],
    domains: ["discord.michaelfeng.me"],
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    env: {
      ASSETS: bindings.assets(),
      DATABASE_URL: bindings.secret(),
      DIRECT_DATABASE_URL: bindings.secret(),
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: bindings.secret(),
      CLERK_SECRET_KEY: bindings.secret(),
    },
  }),
});

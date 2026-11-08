import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      include: [
        "src/libs/**/*.ts",
        "src/server/api/**/*.ts",
        "src/server/chat/**/*.ts",
        "src/server/storage/**/*.ts",
      ],
    },
  },
});

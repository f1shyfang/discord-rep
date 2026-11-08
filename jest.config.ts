import { type Config } from "jest";
import nextJest from "next/jest.js";

const createJestConfig = nextJest({ dir: "./" });
const config: Config = {
  coverageProvider: "v8",
  testEnvironment: "jsdom",
  moduleNameMapper: { "^~/(.*)$": "<rootDir>/src/$1" },
};

// SuperJSON v2 and its dependencies ship ESM; transform them for Jest's CJS runtime.
export default async function jestConfig() {
  // Unit tests mock infrastructure and do not need real service credentials.
  process.env.SKIP_ENV_VALIDATION = "1";
  const resolved = await createJestConfig(config)();
  return {
    ...resolved,
    transformIgnorePatterns: [
      "/node_modules/(?!superjson/|copy-anything/|is-what/)",
      "^.+\\.module\\.(css|sass|scss)$",
    ],
  };
}

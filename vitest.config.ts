import path from "node:path";
import { defineConfig } from "vitest/config";

const alias = {
  "@": path.resolve(__dirname, "src"),
  // `server-only` throws outside Next's server bundle; tests are server-side, so stub it.
  "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
};

// `pnpm test` runs --project unit; `pnpm test:db` runs --project db.
export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"] },
      },
      {
        resolve: { alias },
        test: {
          name: "db",
          // The seed test truncates and reloads the shared dev database, so files run one at a time.
          fileParallelism: false,
          include: ["tests/db/**/*.test.ts"],
          globalSetup: ["tests/db/global-setup.ts"],
          setupFiles: ["tests/db/setup-env.ts"],
        },
      },
    ],
  },
});

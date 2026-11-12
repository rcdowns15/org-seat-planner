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
          include: ["tests/db/**/*.test.ts"],
          setupFiles: ["tests/db/setup-env.ts"],
        },
      },
    ],
  },
});

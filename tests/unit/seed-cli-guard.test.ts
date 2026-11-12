import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// Runs the real seed CLI (no database: it must exit before connecting). dotenv never overrides
// variables that are already set, so a developer's .env.local can't change this test's env.
const require = createRequire(import.meta.url);
const tsxCli = require.resolve("tsx/cli");

describe("seed CLI remote guard", () => {
  it("exits 1 naming the host, never the password, for a remote URL without --allow-remote", () => {
    const result = spawnSync(process.execPath, [tsxCli, "scripts/seed/index.ts"], {
      encoding: "utf8",
      timeout: 60_000,
      env: {
        ...process.env,
        DATABASE_URL: "postgres://u:p@localhost:5432/db",
        DATABASE_URL_UNPOOLED: "postgres://u:s3cret-pw@ep-example.neon.tech/db",
      },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("refusing to wipe a non-local database");
    expect(result.stderr).toContain("ep-example.neon.tech");
    expect(result.stdout).not.toContain("target host"); // never reached the connect step
    expect(result.stdout).not.toContain("s3cret-pw");
    expect(result.stderr).not.toContain("s3cret-pw");
  });
});

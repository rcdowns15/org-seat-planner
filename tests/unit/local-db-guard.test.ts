import { describe, expect, it } from "vitest";
import { assertLocalUrls, localChildEnv } from "../db/local-db";

const local = "postgres://u:p@localhost:5432/db";
const remote = "postgres://u:p@ep-example.neon.tech/db";

describe("test:db local-database guard", () => {
  it("accepts local URLs and unset values", () => {
    expect(() => assertLocalUrls({ DATABASE_URL: local })).not.toThrow();
    expect(() =>
      assertLocalUrls({
        DATABASE_URL: local,
        DATABASE_URL_UNPOOLED: "postgres://u:p@127.0.0.1/db",
      }),
    ).not.toThrow();
  });

  it("rejects a remote DATABASE_URL", () => {
    expect(() => assertLocalUrls({ DATABASE_URL: remote })).toThrow(/DATABASE_URL host/);
  });

  it("rejects a remote DATABASE_URL_UNPOOLED even when DATABASE_URL is local", () => {
    expect(() => assertLocalUrls({ DATABASE_URL: local, DATABASE_URL_UNPOOLED: remote })).toThrow(
      /DATABASE_URL_UNPOOLED host/,
    );
  });

  it("pins both URLs in the child process environment", () => {
    const env = localChildEnv(local);
    expect(env.DATABASE_URL).toBe(local);
    expect(env.DATABASE_URL_UNPOOLED).toBe(local);
  });
});

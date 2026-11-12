import { describe, expect, it } from "vitest";
import { decideSeedTarget } from "../../scripts/db/local-host";

const remote = "postgres://neon_user:s3cret-pw@ep-example.neon.tech/db";

describe("seed target guard", () => {
  it("refuses a remote host without --allow-remote", () => {
    expect(decideSeedTarget(remote, false).allowed).toBe(false);
  });

  it("names the host but never the password, user or URL when refusing", () => {
    const d = decideSeedTarget(remote, false);
    if (d.allowed) throw new Error("expected a refusal");
    expect(d.message).toContain("ep-example.neon.tech");
    expect(d.message).not.toContain("s3cret-pw");
    expect(d.message).not.toContain("neon_user");
    expect(d.message).not.toContain(remote);
  });

  it("allows a remote host with --allow-remote", () => {
    expect(decideSeedTarget(remote, true)).toEqual({ allowed: true, host: "ep-example.neon.tech" });
  });

  it("allows localhost and 127.0.0.1 without the flag", () => {
    expect(decideSeedTarget("postgres://u:p@localhost:5432/db", false).allowed).toBe(true);
    expect(decideSeedTarget("postgres://u:p@127.0.0.1:5432/db", false).allowed).toBe(true);
  });

  it("refuses an unparseable URL without echoing it", () => {
    const d = decideSeedTarget("not a url s3cret-pw", true);
    if (d.allowed) throw new Error("expected a refusal");
    expect(d.message).not.toContain("s3cret-pw");
  });

  it("does not treat a lookalike host as local", () => {
    expect(decideSeedTarget("postgres://u:p@localhost.evil.example/db", false).allowed).toBe(false);
  });
});

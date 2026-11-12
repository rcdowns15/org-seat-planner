// Shared, pure guard logic: is a database URL local, and may a destructive script run against it?
// Used by `pnpm db:seed` (refuses remote hosts without --allow-remote) and by the test:db setup.

const LOCAL_HOSTS = ["localhost", "127.0.0.1"];

// The host of a connection string, or null if it can't be parsed. Never returns the string itself.
// pg lets a `?host=` query parameter override the URL hostname, so that parameter wins here too.
export function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("host") ?? parsed.hostname;
  } catch {
    return null;
  }
}

export function isLocalHost(host: string | null): boolean {
  return host !== null && LOCAL_HOSTS.includes(host);
}

export type SeedTargetDecision =
  { allowed: true; host: string } | { allowed: false; message: string };

// Decides whether the seed may wipe and reload the database at `url`. The refusal message names the
// host only: it never contains the URL, user or password (an unparseable URL is reported as such).
export function decideSeedTarget(url: string, allowRemote: boolean): SeedTargetDecision {
  const host = hostOf(url);
  if (host === null) {
    return { allowed: false, message: "the database URL could not be parsed (host unknown)." };
  }
  if (isLocalHost(host) || allowRemote) return { allowed: true, host };
  return {
    allowed: false,
    message: `refusing to wipe a non-local database (host "${host}"). Pass --allow-remote if you mean it.`,
  };
}

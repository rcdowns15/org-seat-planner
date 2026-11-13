import "server-only";

// Demo-only actions (simulate another leader's edit, later simulate Workday refresh and reset) sit
// behind DEMO_MODE=true (D-023). Read at call time, on the server, so a deploy without the
// variable can never run them whatever the client sends.
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "true";
}

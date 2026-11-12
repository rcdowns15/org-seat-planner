import "server-only";
import { cookies } from "next/headers";
import { ACTING_LEADER_COOKIE } from "@/lib/acting-as";
import type { ActionResult } from "@/lib/results";
import { setActingLeaderSchema } from "@/lib/schemas/acting-as";
import { findLeader, parseLeaderId } from "@/server/auth/acting-leader";

// The directive is function-level, not file-level: the boundary test requires `import "server-only"`
// as the first line of every src/server file, and only functions marked "use server" become
// client-callable endpoints (so helpers elsewhere in this folder never do).
// Sets (or clears) the acting-as cookie. This is mock auth for the demo: the cookie only says
// who the demo user is pretending to be, and every mutation re-reads and re-validates it.
export async function setActingLeader(input: unknown): Promise<ActionResult> {
  "use server";
  const parsed = setActingLeaderSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT", message: "Invalid leader selection." };
  }
  const store = await cookies();
  if (parsed.data.leaderId === "") {
    store.delete(ACTING_LEADER_COOKIE);
    return { ok: true };
  }
  const id = parseLeaderId(parsed.data.leaderId);
  const leader = id === null ? null : await findLeader(id);
  if (!leader) return { ok: false, code: "UNKNOWN_LEADER", message: "That leader does not exist." };
  store.set(ACTING_LEADER_COOKIE, String(leader.leaderId), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
  });
  return { ok: true };
}

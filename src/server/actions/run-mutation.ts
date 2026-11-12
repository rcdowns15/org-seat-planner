import "server-only";
import type { z } from "zod";
import type { ActionResult } from "@/lib/results";
import { getActingLeader } from "@/server/auth/acting-leader";
import type { Leader } from "@/server/services/permissions";

// Never add "use server" to this file: it is a plain helper called by server actions, and a
// marked export would become a public endpoint that accepts a caller-supplied schema and handler.
// The shared front half of every mutation server action: (1) parse input with Zod, (2) derive
// the acting leader from the server-side cookie, never from input. Zod objects drop unknown keys,
// so a spoofed `leaderId` field in the input never reaches the handler. Permission checks
// (step 3) and the transaction (step 4) happen in the handler/service.
// The failure codes are typed: the handler's codes plus the two this helper can return.
export async function runMutation<S extends z.ZodType, R extends object, C extends string = string>(
  schema: S,
  rawInput: unknown,
  handler: (input: z.output<S>, leader: Leader) => Promise<ActionResult<R, C>>,
): Promise<ActionResult<R, C | "INVALID_INPUT" | "READ_ONLY">> {
  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT", message: "Invalid input." };
  }
  const leader = await getActingLeader();
  if (!leader) {
    return { ok: false, code: "READ_ONLY", message: "Choose a leader to act as before editing." };
  }
  return handler(parsed.data, leader);
}

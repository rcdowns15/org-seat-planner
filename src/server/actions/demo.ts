import "server-only";
import { simulateEditInputSchema, type SimulateEditResult } from "@/lib/schemas/demo";
import { runMutation } from "@/server/actions/run-mutation";
import { isDemoMode } from "@/server/demo-mode";
import { simulateAnotherLeaderEdit } from "@/server/services/demo-touch";

// "Simulate another leader's edit" (LR-02-05). DEMO_MODE is checked first, on the server (D-023):
// without it the answer is NOT_FOUND, as if the action did not exist, and nothing is read or
// written. Then the usual mutation steps: Zod parse, acting leader from the cookie, permission,
// one transaction (all in the service).
// Deliberately no revalidatePath: the board the leader is looking at must stay stale, so their
// next save hits CONFLICT. "Refresh" in the move dialog is what reloads it.
// "use server" is function-level, as in move.ts.
export async function simulateAnotherLeaderEditAction(input: unknown): Promise<SimulateEditResult> {
  "use server";
  if (!isDemoMode()) return { ok: false, code: "NOT_FOUND", message: "Not found." };
  return runMutation(simulateEditInputSchema, input, (data, leader) =>
    simulateAnotherLeaderEdit(data.seatId, leader),
  );
}

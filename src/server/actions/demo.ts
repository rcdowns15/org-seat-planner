import "server-only";
import { revalidatePath } from "next/cache";
import {
  simulateEditInputSchema,
  type ResetDemoResult,
  type SimulateEditResult,
} from "@/lib/schemas/demo";
import { runMutation } from "@/server/actions/run-mutation";
import { isDemoMode } from "@/server/demo-mode";
import { resetDemoData } from "@/server/services/demo-reset";
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

// "Reset demo data" (LR-04-01). DEMO_MODE first, as above: NOT_FOUND and nothing written. No
// input and no leader: it resets the whole shared demo, so it is not tied to anyone's scope; the
// throttle (one per minute, kept in the database) is its guard. On success every page is
// revalidated so open boards show the restored seed.
// D-039 exception: no leader permission check (see also demo-reset.ts for the seat_changes one).
export async function resetDemoDataAction(): Promise<ResetDemoResult> {
  "use server";
  if (!isDemoMode()) return { ok: false, code: "NOT_FOUND", message: "Not found." };
  const result = await resetDemoData();
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

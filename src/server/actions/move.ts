import "server-only";
import { revalidatePath } from "next/cache";
import { moveInputSchema, type MoveResult } from "@/lib/schemas/move";
import { runMutation } from "@/server/actions/run-mutation";
import { moveWorker } from "@/server/services/moves";

// The move server action (LR-02-03). runMutation parses the input with Zod and takes the acting
// leader from the server-side cookie, never from the input; moveWorker checks permission and
// does the version-checked writes and the audit rows in one transaction.
// "use server" is function-level for the same reason as in acting-as.ts.
export async function moveWorkerAction(input: unknown): Promise<MoveResult> {
  "use server";
  const result = await runMutation(moveInputSchema, input, (data, leader) =>
    moveWorker(data, leader),
  );
  // A saved move changes the board: refresh the server render of every board page.
  if (result.ok) revalidatePath("/board");
  return result;
}

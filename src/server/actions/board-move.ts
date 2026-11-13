import "server-only";
import { revalidatePath } from "next/cache";
import type { MoveResult } from "@/lib/schemas/move";
import { moveWorkerAction } from "@/server/actions/move";

// The action the board's move dialog calls: the LR-02-03 move action, plus a refresh of the board
// pages after a saved move. Kept apart from moveWorkerAction because revalidatePath only works
// inside a Next request, and the database tests call that action directly.
// "use server" is function-level, as in move.ts.
export async function moveWorkerFromBoard(input: unknown): Promise<MoveResult> {
  "use server";
  const result = await moveWorkerAction(input);
  if (result.ok) revalidatePath("/board");
  return result;
}

import type { SeatStatus } from "./seat-status";

// Seat history shapes shared by the server query and the panel. Type-only imports, so nothing
// here pulls the database into the browser bundle.

export type HistoryChangeType =
  "move_out" | "move_in" | "fill" | "vacate" | "reserve" | "release" | "undo" | "demo_touch";

export type SeatHistoryEntry = {
  changeId: number;
  changeType: HistoryChangeType;
  fromStatus: SeatStatus;
  toStatus: SeatStatus;
  fromWorkerName: string | null;
  toWorkerName: string | null;
  actorName: string;
  savedAt: string; // ISO timestamp (when the row was written)
  effectiveDate: string; // YYYY-MM-DD
  note: string | null;
};

const CHANGE_TYPE_LABELS: Record<HistoryChangeType, string> = {
  move_out: "Moved out",
  move_in: "Moved in",
  fill: "Filled",
  vacate: "Vacated",
  reserve: "Reserved for an accepted offer",
  release: "Released",
  undo: "Undo",
  demo_touch: "Demo edit by another leader",
};

export function changeTypeLabel(type: HistoryChangeType): string {
  return CHANGE_TYPE_LABELS[type];
}

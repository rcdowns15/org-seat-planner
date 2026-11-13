import type { WORKER_STATUSES } from "../../db/schema/workday";
import type { SeatStatus } from "./seat-status";
import type { SeatType } from "./seat-card";

// Board shapes shared by the server query and the (future client) components. Type-only imports,
// so nothing here pulls the database into the browser bundle.

export type WorkerStatus = (typeof WORKER_STATUSES)[number];

export type BoardGroupOption = {
  groupId: number;
  name: string;
  divisionId: number;
  divisionName: string;
};

export type BoardSeat = {
  seatId: number;
  seatType: SeatType;
  status: SeatStatus;
  version: number;
  workerId: string | null;
  workerName: string | null; // "First Last"
  jobTitle: string | null;
  workerStatus: WorkerStatus | null; // so a terminated seated worker can be flagged
};

export type BoardSquad = {
  squadId: number;
  name: string;
  seats: BoardSeat[];
  filledCount: number;
  approvedCount: number; // every seat in a squad is an approved seat (see db/schema/app.ts)
};

export type Board = {
  group: BoardGroupOption;
  groups: BoardGroupOption[];
  squads: BoardSquad[];
};

const WORKER_STATUS_LABELS: Record<WorkerStatus, string> = {
  active: "Active",
  leave: "On leave",
  terminated: "Terminated",
};

export function workerStatusLabel(status: WorkerStatus): string {
  return WORKER_STATUS_LABELS[status];
}

// ?group=<id>: a positive integer, or absent. Anything else is not a board.
export function parseGroupParam(value: string | string[] | undefined): number | null | "invalid" {
  if (value === undefined) return null;
  if (typeof value !== "string" || !/^[1-9]\d{0,8}$/.test(value)) return "invalid";
  return Number(value);
}

// The group the board opens on when the URL has no ?group=: a group leader's own group, or the
// first group of a division leader's division (`groups` is already ordered by division, group
// name). Null means no leader or no match, and the caller falls back to the demo group.
export function defaultGroupIdForLeader(
  leader: { scopeType: string; divisionId: number | null; groupId: number | null } | null,
  groups: BoardGroupOption[],
): number | null {
  if (!leader) return null;
  if (leader.scopeType === "group") return leader.groupId;
  if (leader.scopeType === "division") {
    return groups.find((g) => g.divisionId === leader.divisionId)?.groupId ?? null;
  }
  return null;
}

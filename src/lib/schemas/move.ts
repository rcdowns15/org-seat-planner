import { z } from "zod";
import type { ActionResult } from "@/lib/results";

// Input for moving a worker from one seat to another (LR-02-03). Client-safe: the move dialog
// (LR-02-04) uses the same schema and types. There is no leader field on purpose: the acting
// leader always comes from the server-side cookie, and Zod drops unknown keys, so a spoofed
// `leaderId` never reaches the service.
const id = z.number().int().positive().max(2_147_483_647); // a Postgres integer key
const version = z.number().int().min(0).max(2_147_483_647); // app.seats.version is never negative

export const moveInputSchema = z.object({
  // Workday worker ids: 6 digits for employees, `C-` + 5 digits for contingent workers. The
  // pattern is kept loose (letters, digits, hyphen) so a new id format isn't an input error.
  workerId: z.string().regex(/^[A-Za-z0-9-]{1,32}$/),
  fromSeatId: id,
  toSeatId: id,
  // A real calendar date as `YYYY-MM-DD` (2026-02-30 fails). The today-to-+90-days window is a
  // business rule checked in the service (INVALID_EFFECTIVE_DATE), not an input-shape rule.
  effectiveDate: z.iso.date(),
  // The seat versions the leader's board showed when they started the move (optimistic lock).
  fromSeatVersion: version,
  toSeatVersion: version,
});
export type MoveInput = z.infer<typeof moveInputSchema>;

// Every way a move can fail, in the order the service checks them. READ_ONLY means no acting
// leader is selected (from the shared mutation helper).
export const MOVE_FAILURE_CODES = [
  "INVALID_INPUT",
  "READ_ONLY",
  "FORBIDDEN",
  "WORKER_NOT_ACTIVE",
  "NOT_IN_SEAT",
  "SEAT_NOT_AVAILABLE",
  "SEAT_TYPE_MISMATCH",
  "INVALID_EFFECTIVE_DATE",
  "CONFLICT",
] as const;
export type MoveFailureCode = (typeof MOVE_FAILURE_CODES)[number];

// The seats' new versions, so the client can keep editing without a reload.
export type MoveSuccess = {
  moveId: string;
  fromSeat: { seatId: number; version: number };
  toSeat: { seatId: number; version: number };
};
export type MoveResult = ActionResult<MoveSuccess, MoveFailureCode>;

// Effective dates run from today through today + 90 days (D-012).
export const MAX_EFFECTIVE_DAYS_AHEAD = 90;

import { z } from "zod";
import type { ActionResult } from "@/lib/results";

// Input for "simulate another leader's edit" (LR-02-05). Client-safe. Just the seat: the server
// reads the seat's current version and bumps it, so the demo can be clicked more than once. No
// leader field: the acting leader comes from the server-side cookie, and the "other" leader who
// is recorded as the actor is a seeded fixture, never input.
export const simulateEditInputSchema = z.object({
  seatId: z.number().int().positive().max(2_147_483_647), // a Postgres integer key
});
export type SimulateEditInput = z.infer<typeof simulateEditInputSchema>;

// NOT_FOUND: DEMO_MODE is not on (D-023), the same answer as a route that does not exist.
// MISSING_FIXTURE: the seeded "Another leader" is not in the database (not seeded).
export const SIMULATE_EDIT_FAILURE_CODES = [
  "NOT_FOUND",
  "INVALID_INPUT",
  "READ_ONLY",
  "FORBIDDEN",
  "CONFLICT",
  "MISSING_FIXTURE",
] as const;
export type SimulateEditFailureCode = (typeof SIMULATE_EDIT_FAILURE_CODES)[number];

export type SimulateEditSuccess = {
  seatId: number;
  version: number; // the seat's version after the touch
  effectiveDate: string; // the touch row's effective date (YYYY-MM-DD)
  actorName: string; // the seeded "Another leader"
};
export type SimulateEditResult = ActionResult<SimulateEditSuccess, SimulateEditFailureCode>;

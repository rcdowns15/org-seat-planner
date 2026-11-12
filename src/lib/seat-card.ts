import { formatSeatStatus, type SeatStatus } from "./seat-status";

export const SEAT_TYPES = ["employee", "contingent"] as const;
export type SeatType = (typeof SEAT_TYPES)[number];

// The five states a board card can show. "filled" splits by seat type, because the board
// distinguishes employees from contingent workers.
export const CARD_STATES = [
  "filled_employee",
  "filled_contingent",
  "open",
  "backfill",
  "offer_accepted",
] as const;
export type CardState = (typeof CARD_STATES)[number];

export function cardState(status: SeatStatus, seatType: SeatType): CardState {
  if (status === "filled") {
    return seatType === "contingent" ? "filled_contingent" : "filled_employee";
  }
  return status;
}

// Always shown as text next to an icon, never color alone.
export function cardStateLabel(state: CardState): string {
  if (state === "filled_employee") return `${formatSeatStatus("filled")} (employee)`;
  if (state === "filled_contingent") return `${formatSeatStatus("filled")} (contingent)`;
  return formatSeatStatus(state);
}

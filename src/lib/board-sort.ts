import { seatLabel } from "./seat-card";
import type { BoardSeat } from "./board";

// Column order: seats that can receive a move first, then reserved, then filled.
function group(status: BoardSeat["status"]): number {
  if (status === "open" || status === "backfill") return 0;
  if (status === "offer_accepted") return 1;
  return 2;
}

// "Seat 9" before "Seat 72": numeric-aware comparison, not plain string order.
const byLabel = new Intl.Collator("en", { numeric: true });

// Returns a new array; the input is not changed. Inside a group, order is by seat label.
export function sortSeats(seats: BoardSeat[]): BoardSeat[] {
  return [...seats].sort(
    (a, b) =>
      group(a.status) - group(b.status) ||
      byLabel.compare(seatLabel(a.seatId), seatLabel(b.seatId)),
  );
}

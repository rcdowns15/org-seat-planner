export const SEAT_STATUSES = ["filled", "open", "backfill", "offer_accepted"] as const;

export type SeatStatus = (typeof SEAT_STATUSES)[number];

// Seat states are always shown with a text label (and an icon in the UI), never color alone.
const SEAT_STATUS_LABELS: Record<SeatStatus, string> = {
  filled: "Filled",
  open: "Open",
  backfill: "Backfill",
  offer_accepted: "Offer accepted",
};

export function formatSeatStatus(status: SeatStatus): string {
  return SEAT_STATUS_LABELS[status];
}

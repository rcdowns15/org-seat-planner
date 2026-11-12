import {
  CircleDashed,
  HardHat,
  RotateCcw,
  UserCheck,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { cardState, cardStateLabel, type CardState } from "@/lib/seat-card";
import type { BoardSeat } from "@/server/queries/board";

// Type-only import above: the query module itself never reaches the client.
const ICONS: Record<CardState, LucideIcon> = {
  filled_employee: UserRound,
  filled_contingent: HardHat,
  open: CircleDashed,
  backfill: RotateCcw,
  offer_accepted: UserCheck,
};

export function SeatCard({ seat }: { seat: BoardSeat }) {
  const state = cardState(seat.status, seat.seatType);
  const Icon = ICONS[state];
  const filled = seat.status === "filled";
  return (
    <li
      data-testid="seat-card"
      data-state={state}
      data-seat-id={seat.seatId}
      className="bg-card rounded-md border p-2 text-sm"
    >
      <div className="text-muted-foreground flex items-center gap-1 text-xs font-medium">
        <Icon aria-hidden className="size-3.5" />
        <span data-testid="seat-state-label">{cardStateLabel(state)}</span>
      </div>
      {filled ? (
        <div className="mt-1">
          <div data-testid="seat-worker-name" className="font-medium">
            {seat.workerName ?? `Worker ${seat.workerId}`}
          </div>
          <div data-testid="seat-job-title" className="text-muted-foreground text-xs">
            {seat.jobTitle ?? "Title unknown"}
          </div>
          {seat.workerStatus && seat.workerStatus !== "active" ? (
            <div className="mt-1 text-xs font-medium">Workday: {seat.workerStatus}</div>
          ) : null}
        </div>
      ) : (
        <div className="text-muted-foreground mt-1 text-xs">
          {seat.seatType === "contingent" ? "Contingent seat" : "Employee seat"}
        </div>
      )}
    </li>
  );
}

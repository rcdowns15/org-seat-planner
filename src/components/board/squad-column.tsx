"use client";

import type { BoardSquad } from "@/lib/board";
import { SeatCard } from "./seat-card";

type Props = {
  squad: BoardSquad;
  editable: boolean;
  canMoveTo: boolean;
  onMoveTo: (seatId: number) => void;
  selectedSeatId: number | null;
  onSelectSeat: (seatId: number) => void;
};

export function SquadColumn({
  squad,
  editable,
  canMoveTo,
  onMoveTo,
  selectedSeatId,
  onSelectSeat,
}: Props) {
  return (
    <section
      data-testid="squad-column"
      aria-label={`Squad ${squad.name}`}
      className="bg-muted/40 w-64 shrink-0 rounded-lg border p-3"
    >
      <header className="mb-2">
        <h3 className="text-sm font-semibold">{squad.name}</h3>
        <p data-testid="squad-fill" className="text-muted-foreground text-xs">
          {squad.filledCount} / {squad.approvedCount} seats filled
        </p>
      </header>
      <ul className="flex flex-col gap-2">
        {squad.seats.map((seat) => (
          <SeatCard
            key={seat.seatId}
            seat={seat}
            editable={editable}
            canMoveTo={canMoveTo}
            onMoveTo={onMoveTo}
            selected={seat.seatId === selectedSeatId}
            onSelect={onSelectSeat}
          />
        ))}
      </ul>
    </section>
  );
}

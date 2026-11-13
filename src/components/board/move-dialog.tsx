"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { addUtcDays, utcToday } from "@/lib/dates";
import { MAX_EFFECTIVE_DAYS_AHEAD, type MoveResult } from "@/lib/schemas/move";
import { cardState, cardStateLabel } from "@/lib/seat-card";
import type { BoardSeat } from "@/lib/board";

export type SeatRef = { seat: BoardSeat; squadName: string };

type Props = {
  from: SeatRef;
  // Set when the leader dropped the card on a seat; null when they opened "Move to…" and still
  // have to pick a seat from `targets`.
  to: SeatRef | null;
  targets: SeatRef[];
  // The server action, passed down from the page (client code never imports src/server).
  move: (input: unknown) => Promise<MoveResult>;
  onClose: () => void;
  onMoved: () => void;
};

function seatLabel(ref: SeatRef): string {
  const state = cardStateLabel(cardState(ref.seat.status, ref.seat.seatType));
  return `${ref.squadName}, seat ${ref.seat.seatId} (${state})`;
}

export function MoveDialog({ from, to, targets, move, onClose, onMoved }: Props) {
  const [pickedId, setPickedId] = useState<string>("");
  const [date, setDate] = useState(() => utcToday());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const target = to ?? targets.find((t) => String(t.seat.seatId) === pickedId) ?? null;
  const today = utcToday();

  function save() {
    if (!target || !from.seat.workerId) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await move({
          workerId: from.seat.workerId,
          fromSeatId: from.seat.seatId,
          toSeatId: target.seat.seatId,
          effectiveDate: date,
          fromSeatVersion: from.seat.version,
          toSeatVersion: target.seat.version,
        });
        // Whatever the failure code, show the server's own message: a new code needs no UI change.
        if (result.ok) onMoved();
        else setError(result.message);
      } catch {
        setError("Could not reach the server. Try again.");
      }
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent data-testid="move-dialog">
        <DialogHeader>
          <DialogTitle>Move {from.seat.workerName}</DialogTitle>
          <DialogDescription>Review the move, pick an effective date, then save.</DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Who</dt>
          <dd data-testid="move-who">
            {from.seat.workerName} ({from.seat.jobTitle ?? "Title unknown"})
          </dd>
          <dt className="text-muted-foreground">From</dt>
          <dd data-testid="move-from">{seatLabel(from)}</dd>
          <dt className="text-muted-foreground">
            <label htmlFor="move-to-seat">To</label>
          </dt>
          <dd data-testid="move-to">
            {to ? (
              seatLabel(to)
            ) : (
              <select
                id="move-to-seat"
                className="border-input bg-background w-full rounded-md border px-2 py-1"
                value={pickedId}
                onChange={(e) => setPickedId(e.target.value)}
              >
                <option value="">Choose a seat…</option>
                {targets.map((t) => (
                  <option key={t.seat.seatId} value={t.seat.seatId}>
                    {seatLabel(t)}
                  </option>
                ))}
              </select>
            )}
          </dd>
          <dt className="text-muted-foreground">
            <label htmlFor="move-date">Effective date</label>
          </dt>
          <dd>
            <input
              id="move-date"
              type="date"
              className="border-input bg-background rounded-md border px-2 py-1"
              value={date}
              min={today}
              max={addUtcDays(today, MAX_EFFECTIVE_DAYS_AHEAD)}
              onChange={(e) => setDate(e.target.value)}
            />
          </dd>
        </dl>

        {error && (
          <p role="alert" data-testid="move-error" className="text-destructive text-sm font-medium">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending || !target}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

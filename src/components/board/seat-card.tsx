"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  Check,
  CircleDashed,
  HardHat,
  MoveRight,
  RotateCcw,
  UserCheck,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cardState, cardStateLabel, type CardState } from "@/lib/seat-card";
import { workerStatusLabel, type BoardSeat } from "@/lib/board";

const ICONS: Record<CardState, LucideIcon> = {
  filled_employee: UserRound,
  filled_contingent: HardHat,
  open: CircleDashed,
  backfill: RotateCcw,
  offer_accepted: UserCheck,
};

type Props = {
  seat: BoardSeat;
  // The leader can edit this board: filled cards drag, open and backfill cards accept a drop.
  editable: boolean;
  // A leader is selected: filled cards offer "Move to…" (the server still checks permission).
  canMoveTo: boolean;
  onMoveTo: (seatId: number) => void;
  // The board-level selection (?seat=<id>): this card is the selected seat, and how to (de)select.
  selected: boolean;
  onSelect: (seatId: number) => void;
};

export function seatDndId(seatId: number): string {
  return `seat-${seatId}`;
}

export function parseSeatDndId(id: string | number): number {
  return Number(String(id).replace("seat-", ""));
}

export function SeatCard({ seat, editable, canMoveTo, onMoveTo, selected, onSelect }: Props) {
  const state = cardState(seat.status, seat.seatType);
  const Icon = ICONS[state];
  const filled = seat.status === "filled";
  const receives = seat.status === "open" || seat.status === "backfill";

  const drag = useDraggable({ id: seatDndId(seat.seatId), disabled: !(editable && filled) });
  const drop = useDroppable({ id: seatDndId(seat.seatId), disabled: !(editable && receives) });

  // One element is both: a filled card is only a drag source, an open card only a drop target.
  const setNodeRef = (node: HTMLElement | null) => {
    drag.setNodeRef(node);
    drop.setNodeRef(node);
  };
  const dragging = drag.isDragging;
  const style = drag.transform
    ? { transform: `translate3d(${drag.transform.x}px, ${drag.transform.y}px, 0)` }
    : undefined;

  return (
    <li
      ref={setNodeRef}
      style={style}
      // Pointer drag only: the keyboard path is the "Move to…" button, so dnd-kit's own
      // keyboard attributes (role, tabindex) are deliberately not applied to the card.
      {...(editable && filled ? drag.listeners : {})}
      data-testid="seat-card"
      data-state={state}
      data-seat-id={seat.seatId}
      data-draggable={editable && filled ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
      // A click on the card selects it. The drag sensor needs a 6px move, so a plain click never
      // starts a drag. Clicks on the "Move to…" button are that button's own.
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("[data-testid=move-to-button]")) return;
        onSelect(seat.seatId);
      }}
      className={`bg-card relative rounded-md p-2 text-sm ${
        selected ? "border-primary border-2" : "border"
      } ${
        editable && filled ? "cursor-grab touch-none" : ""
      } ${dragging ? "z-20 shadow-lg" : ""} ${drop.isOver ? "ring-primary ring-2" : ""}`}
    >
      <div className="text-muted-foreground flex items-center gap-1 text-xs font-medium">
        <Icon aria-hidden className="size-3.5" />
        <span data-testid="seat-state-label">{cardStateLabel(state)}</span>
        {/* The keyboard path to selection; the whole card is also clickable. The "Selected" text
            and check icon mean selection is never shown by the border color alone. */}
        <button
          type="button"
          aria-pressed={selected}
          aria-label={`Select seat ${seat.seatId}`}
          data-testid="select-seat-button"
          className="ml-auto inline-flex items-center gap-1 rounded border px-1 py-0.5 text-xs"
        >
          {selected ? <Check aria-hidden className="size-3" /> : null}
          {selected ? "Selected" : "Select"}
        </button>
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
            <div className="mt-1 text-xs font-medium">
              Workday: {workerStatusLabel(seat.workerStatus)}
            </div>
          ) : null}
          {canMoveTo ? (
            <Button
              variant="outline"
              size="xs"
              className="mt-2"
              onClick={() => onMoveTo(seat.seatId)}
              aria-label={`Move ${seat.workerName ?? seat.workerId} to…`}
              data-testid="move-to-button"
            >
              <MoveRight aria-hidden />
              Move to…
            </Button>
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

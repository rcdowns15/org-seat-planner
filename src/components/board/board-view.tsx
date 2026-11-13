"use client";

import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useMemo, useState } from "react";
import type { BoardSquad } from "@/lib/board";
import type { MoveResult } from "@/lib/schemas/move";
import { MoveDialog, type SeatRef } from "./move-dialog";
import { parseSeatDndId } from "./seat-card";
import { SquadColumn } from "./squad-column";

type Props = {
  squads: BoardSquad[];
  // The acting leader can edit this board's squads, so drag and drop is on.
  editable: boolean;
  // Some leader is selected, so "Move to…" is offered (the server decides if it is allowed).
  canMoveTo: boolean;
  move: (input: unknown) => Promise<MoveResult>;
};

type DialogState = { fromSeatId: number; toSeatId: number | null };

export function BoardView({ squads, editable, canMoveTo, move }: Props) {
  const [dialog, setDialog] = useState<DialogState | null>(null);

  // A distance threshold means a plain click (e.g. on "Move to…") never starts a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const refs = useMemo(() => {
    const map = new Map<number, SeatRef>();
    for (const squad of squads) {
      for (const seat of squad.seats) map.set(seat.seatId, { seat, squadName: squad.name });
    }
    return map;
  }, [squads]);

  const targets = useMemo(
    () =>
      [...refs.values()].filter((r) => r.seat.status === "open" || r.seat.status === "backfill"),
    [refs],
  );

  function onDragEnd(event: DragEndEvent) {
    if (!event.over) return;
    const fromSeatId = parseSeatDndId(event.active.id);
    const toSeatId = parseSeatDndId(event.over.id);
    if (refs.has(fromSeatId) && refs.has(toSeatId)) setDialog({ fromSeatId, toSeatId });
  }

  const from = dialog ? refs.get(dialog.fromSeatId) : undefined;
  const to = dialog?.toSeatId != null ? (refs.get(dialog.toSeatId) ?? null) : null;

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={onDragEnd}>
      <div data-testid="board" className="mt-6 flex gap-4 overflow-x-auto pb-4">
        {squads.map((squad) => (
          <SquadColumn
            key={squad.squadId}
            squad={squad}
            editable={editable}
            canMoveTo={canMoveTo}
            onMoveTo={(seatId) => setDialog({ fromSeatId: seatId, toSeatId: null })}
          />
        ))}
      </div>
      {dialog && from ? (
        <MoveDialog
          // A fresh dialog (date, error, pick) for every move.
          key={`${dialog.fromSeatId}-${dialog.toSeatId}`}
          from={from}
          to={to}
          targets={targets.filter((t) => t.seat.seatType === from.seat.seatType)}
          move={move}
          onClose={() => setDialog(null)}
          onMoved={() => {
            // The save action revalidates /board, so the board refreshes itself.
            setDialog(null);
          }}
        />
      ) : null}
    </DndContext>
  );
}

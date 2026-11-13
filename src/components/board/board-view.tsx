"use client";

import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import type { BoardSquad } from "@/lib/board";
import type { SimulateEditResult } from "@/lib/schemas/demo";
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
  // The board-level selected seat (?seat=<id> in the URL), or null. Other panels (SQL panel,
  // seat history) read the same URL parameter on the server.
  selectedSeatId: number | null;
  // Set only when DEMO_MODE=true: simulate another leader's edit (LR-02-05).
  simulate?: (input: unknown) => Promise<SimulateEditResult>;
};

// `workerId` is who the dialog is moving, so a refresh can tell whether the selection is still valid.
type DialogState = { fromSeatId: number; toSeatId: number | null; workerId: string };

// Seat id to version, for every seat on the board.
function versionsOf(squads: BoardSquad[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const squad of squads) for (const seat of squad.seats) map.set(seat.seatId, seat.version);
  return map;
}

export function BoardView({ squads, editable, canMoveTo, move, selectedSeatId, simulate }: Props) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  // The board as it was when the dialog opened (or was last refreshed): the seat versions a save
  // sends. The live `squads` prop can be newer, e.g. after another save revalidated the page.
  // `refreshing` stays true from a Refresh click until a new `squads` arrives.
  const [loaded, setLoaded] = useState({ squads, refreshing: false });
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Selecting is a URL change, so the server re-renders the page with the new selection.
  // Selecting the selected seat again clears it.
  function selectSeat(seatId: number) {
    const next = new URLSearchParams(searchParams.toString());
    if (seatId === selectedSeatId) next.delete("seat");
    else next.set("seat", String(seatId));
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  // A distance threshold means a plain click (e.g. on "Move to…") never starts a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Refresh finished (a new board arrived): take its versions, and keep the dialog's selection
  // only where it is still valid. This is React's "adjust state when a prop changes" pattern.
  if (loaded.refreshing && loaded.squads !== squads) {
    setLoaded({ squads, refreshing: false });
    if (dialog) {
      const allSeats = squads.flatMap((q) => q.seats);
      const fromNow = allSeats.find((s) => s.seatId === dialog.fromSeatId);
      const toNow =
        dialog.toSeatId === null ? undefined : allSeats.find((s) => s.seatId === dialog.toSeatId);
      if (!fromNow || fromNow.status !== "filled" || fromNow.workerId !== dialog.workerId) {
        setDialog(null); // the worker is no longer in that seat: nothing left to move
      } else if (toNow && toNow.status !== "open" && toNow.status !== "backfill") {
        setDialog({ ...dialog, toSeatId: null }); // the target is taken: pick again
      }
    }
  }

  function openDialog(next: DialogState) {
    setLoaded({ squads, refreshing: false });
    setDialog(next);
  }

  function refresh() {
    setLoaded((l) => ({ ...l, refreshing: true }));
    router.refresh();
  }

  const loadedVersions = useMemo(() => versionsOf(loaded.squads), [loaded.squads]);

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
    const fromSeat = refs.get(fromSeatId)?.seat;
    if (fromSeat?.workerId && refs.has(toSeatId)) {
      openDialog({ fromSeatId, toSeatId, workerId: fromSeat.workerId });
    }
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
            onMoveTo={(seatId) => {
              const workerId = refs.get(seatId)?.seat.workerId;
              if (workerId) openDialog({ fromSeatId: seatId, toSeatId: null, workerId });
            }}
            selectedSeatId={selectedSeatId}
            onSelectSeat={selectSeat}
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
          loadedVersions={loadedVersions}
          onRefresh={refresh}
          refreshing={loaded.refreshing}
          simulate={simulate}
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

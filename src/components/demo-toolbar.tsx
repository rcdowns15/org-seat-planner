"use client";

import { SimulateEditButton } from "@/components/simulate-edit-button";
import type { SimulateEditResult } from "@/lib/schemas/demo";

type Props = {
  // The board's selected seat (?seat=<id>), or null.
  selectedSeatId: number | null;
  simulate: (input: unknown) => Promise<SimulateEditResult>;
};

// Demo-only controls under the board (rendered only when DEMO_MODE=true). "Pick a seat on screen"
// is the board's Select button; this acts on that seat.
export function DemoToolbar({ selectedSeatId, simulate }: Props) {
  return (
    <section aria-labelledby="demo-toolbar-title" data-testid="demo-toolbar" className="mt-4">
      <h2 id="demo-toolbar-title" className="text-sm font-semibold">
        Demo tools
      </h2>
      {selectedSeatId === null ? (
        <p className="text-muted-foreground text-xs">
          Select a seat on the board to simulate another leader&apos;s edit on it.
        </p>
      ) : (
        <SimulateEditButton seatId={selectedSeatId} simulate={simulate} idSuffix="toolbar" />
      )}
    </section>
  );
}

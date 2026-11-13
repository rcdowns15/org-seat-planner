"use client";

import { UserCog } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { SimulateEditResult } from "@/lib/schemas/demo";

type Props = {
  seatId: number;
  // The server action, passed down from the page (client code never imports src/server).
  simulate: (input: unknown) => Promise<SimulateEditResult>;
  // Test id suffix, so the dialog and the toolbar can each have one.
  idSuffix: string;
};

// "Simulate another leader's edit" on one seat (DEMO_MODE only; the page doesn't render it
// otherwise, and the server refuses it anyway). It does not reload the board: the point is that
// the leader's own copy is now stale.
export function SimulateEditButton({ seatId, simulate, idSuffix }: Props) {
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setMessage(null);
    startTransition(async () => {
      try {
        const r = await simulate({ seatId });
        setMessage(
          r.ok
            ? {
                ok: true,
                text: `${r.actorName} edited seat ${r.seatId} (now version ${r.version}). Your board still shows the old version.`,
              }
            : { ok: false, text: r.message },
        );
      } catch {
        setMessage({ ok: false, text: "Could not reach the server. Try again." });
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={run}
        disabled={pending}
        data-testid={`simulate-edit-${idSuffix}`}
      >
        <UserCog aria-hidden />
        {pending ? "Simulating…" : `Simulate another leader's edit on seat ${seatId}`}
      </Button>
      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          data-testid={`simulate-message-${idSuffix}`}
          className="text-xs"
        >
          {message.text}
        </p>
      )}
    </div>
  );
}

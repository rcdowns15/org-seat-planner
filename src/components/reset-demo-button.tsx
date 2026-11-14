"use client";

import { RotateCcw } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { ResetDemoResult } from "@/lib/schemas/demo";

type Props = {
  // The server action, passed down from the layout (client code never imports src/server).
  reset: () => Promise<ResetDemoResult>;
};

// "Reset demo data" in the site-wide banner (DEMO_MODE only; the layout does not render it
// otherwise, and the server refuses it anyway). Shows the action's result: done, throttled, not
// found or failed.
export function ResetDemoButton({ reset }: Props) {
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setMessage(null);
    startTransition(async () => {
      try {
        const r = await reset();
        setMessage(
          r.ok
            ? { ok: true, text: `Demo data reset to the seed (${r.seats} seats).` }
            : { ok: false, text: r.message },
        );
      } catch {
        setMessage({ ok: false, text: "Could not reach the server. Try again." });
      }
    });
  }

  return (
    <div className="flex items-center gap-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={run}
        disabled={pending}
        data-testid="reset-demo"
      >
        <RotateCcw aria-hidden />
        {pending ? "Resetting…" : "Reset demo data"}
      </Button>
      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          data-testid="reset-demo-message"
          className="text-xs"
        >
          {message.text}
        </p>
      )}
    </div>
  );
}

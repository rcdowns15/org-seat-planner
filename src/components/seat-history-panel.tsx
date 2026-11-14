"use client";

import { ArrowRight, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { changeTypeLabel, type SeatHistoryEntry } from "@/lib/history";
import { seatLabel } from "@/lib/seat-card";
import { formatSeatStatus } from "@/lib/seat-status";

type Props = {
  seatId: number;
  entries: SeatHistoryEntry[];
};

// "Worker (Filled)" or "Open": the seat state before or after a change, as text.
function State({
  status,
  worker,
}: {
  status: SeatHistoryEntry["fromStatus"];
  worker: string | null;
}) {
  return (
    <span>
      {formatSeatStatus(status)}
      {worker ? `, ${worker}` : ""}
    </span>
  );
}

function formatSaved(iso: string): string {
  // UTC, so the text is the same on the server and in every browser.
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

// The side panel for the selected seat (?seat=<id>): its app.seat_changes rows, newest first.
// Closing removes ?seat= from the URL (button or Escape), which is also how the board
// deselects. The rows come from the server (src/server/queries/history.ts).
export function SeatHistoryPanel({ seatId, entries }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function close() {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("seat");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !e.defaultPrevented) close();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // close() reads the current URL on every render; re-subscribe when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  return (
    <aside
      data-testid="seat-history-panel"
      aria-labelledby="seat-history-title"
      className="bg-card mt-6 w-80 shrink-0 self-start rounded-lg border p-3"
    >
      <header className="flex items-center gap-2">
        <h2 id="seat-history-title" className="text-sm font-semibold">
          History of {seatLabel(seatId)}
        </h2>
        <button
          type="button"
          onClick={close}
          data-testid="seat-history-close"
          className="ml-auto inline-flex items-center gap-1 rounded border px-1 py-0.5 text-xs"
        >
          <X aria-hidden className="size-3" />
          Close
        </button>
      </header>
      {entries.length === 0 ? (
        <p data-testid="seat-history-empty" className="text-muted-foreground mt-2 text-sm">
          No changes recorded for this seat.
        </p>
      ) : (
        <ol className="mt-2 flex flex-col gap-2">
          {entries.map((e) => (
            <li
              key={e.changeId}
              data-testid="seat-history-entry"
              data-change-type={e.changeType}
              className="rounded border p-2 text-xs"
            >
              <div data-testid="history-change-type" className="text-sm font-medium">
                {changeTypeLabel(e.changeType)}
              </div>
              <div
                data-testid="history-before-after"
                className="mt-1 flex flex-wrap items-center gap-1"
              >
                <State status={e.fromStatus} worker={e.fromWorkerName} />
                <ArrowRight aria-label="became" className="size-3" />
                <State status={e.toStatus} worker={e.toWorkerName} />
              </div>
              <dl className="text-muted-foreground mt-1">
                <div>
                  <dt className="inline">By: </dt>
                  <dd data-testid="history-actor" className="inline">
                    {e.actorName}
                  </dd>
                </div>
                <div>
                  <dt className="inline">Saved: </dt>
                  <dd data-testid="history-saved" className="inline">
                    <time dateTime={e.savedAt}>{formatSaved(e.savedAt)}</time>
                  </dd>
                </div>
                <div>
                  <dt className="inline">Effective: </dt>
                  <dd data-testid="history-effective" className="inline">
                    {e.effectiveDate}
                  </dd>
                </div>
                {e.note ? (
                  <div>
                    <dt className="inline">Note: </dt>
                    <dd className="inline">{e.note}</dd>
                  </div>
                ) : null}
              </dl>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}

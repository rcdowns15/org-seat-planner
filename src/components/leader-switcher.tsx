"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/results";

type Props = {
  // Server action, passed down from the layout (client components never import src/server).
  setLeader: (input: { leaderId: string }) => Promise<ActionResult>;
  options: { leaderId: number; label: string }[];
  currentLeaderId: number | null;
};

export function LeaderSwitcher({ options, currentLeaderId, setLeader }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onChange(value: string) {
    setError(null);
    startTransition(async () => {
      const result = await setLeader({ leaderId: value });
      if (!result.ok) setError(result.message);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <label htmlFor="acting-as">Acting as</label>
      <select
        id="acting-as"
        className="border-input bg-background rounded-md border px-2 py-1"
        value={currentLeaderId === null ? "" : String(currentLeaderId)}
        disabled={pending}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Read-only (no leader)</option>
        {options.map((o) => (
          <option key={o.leaderId} value={o.leaderId}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}

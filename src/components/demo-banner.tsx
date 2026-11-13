import { Info } from "lucide-react";
import { ResetDemoButton } from "@/components/reset-demo-button";
import type { ResetDemoResult } from "@/lib/schemas/demo";

// Site-wide notice, rendered by the root layout only when DEMO_MODE=true (checked on the server
// there, D-023). Text plus an icon, never color alone.
export function DemoBanner({ reset }: { reset: () => Promise<ResetDemoResult> }) {
  return (
    <div
      role="region"
      aria-label="Demo notice"
      data-testid="demo-banner"
      className="bg-muted flex flex-wrap items-center justify-between gap-2 border-b px-8 py-2 text-sm"
    >
      <p className="flex items-center gap-2">
        <Info aria-hidden className="size-4" />
        Second Republic Bank is fictional; all data is generated.
      </p>
      <ResetDemoButton reset={reset} />
    </div>
  );
}

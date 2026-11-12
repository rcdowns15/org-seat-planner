import type { Metadata } from "next";
import { cache } from "react";
import "./globals.css";
import { LeaderSwitcher } from "@/components/leader-switcher";
import {
  getActingLeader as getActingLeaderUncached,
  listLeaderOptions,
} from "@/server/auth/acting-leader";
import { setActingLeader } from "@/server/actions/acting-as";

// Once per request, even if several server components ask.
const getActingLeader = cache(getActingLeaderUncached);

function logSwallowed(what: string, err: unknown) {
  // Message only: never the whole error object, which can carry connection details.
  console.error(`layout: ${what} failed:`, err instanceof Error ? err.message : "unknown error");
}

export const metadata: Metadata = {
  title: "Org Seat Planner · Second Republic Bank (fictional)",
  description: "Demo write-back app for planning org and seats. All data is mock.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // If the database is down the page still renders, in read-only mode with an empty dropdown.
  const [options, leader] = await Promise.all([
    listLeaderOptions().catch((e) => {
      logSwallowed("listLeaderOptions", e);
      return [];
    }),
    getActingLeader().catch((e) => {
      logSwallowed("getActingLeader", e);
      return null;
    }),
  ]);
  return (
    <html lang="en">
      <body>
        <header className="flex items-center justify-between border-b px-8 py-3">
          <span className="font-medium">Org Seat Planner</span>
          <LeaderSwitcher
            options={options}
            currentLeaderId={leader?.leaderId ?? null}
            setLeader={setActingLeader}
          />
        </header>
        {children}
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";
import { LeaderSwitcher } from "@/components/leader-switcher";
import { getActingLeader, listLeaderOptions } from "@/server/auth/acting-leader";
import { setActingLeader } from "@/server/actions/acting-as";

export const metadata: Metadata = {
  title: "Org Seat Planner · Second Republic Bank (fictional)",
  description: "Demo write-back app for planning org and seats. All data is mock.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // If the database is down the page still renders, in read-only mode with an empty dropdown.
  const [options, leader] = await Promise.all([
    listLeaderOptions().catch(() => []),
    getActingLeader().catch(() => null),
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

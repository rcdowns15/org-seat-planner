import Link from "next/link";
import { SqlPanelBody } from "@/components/sql-panel";
import { parseGroupParam } from "@/lib/board";
import { parseSeatParam } from "@/lib/schemas/sql-panel";
import {
  defaultPanelGroupId,
  getUnderTheHood,
  groupIdOfSeat,
} from "@/server/queries/under-the-hood";

// Reads the database on every request.
export const dynamic = "force-dynamic";

// The same panel as on the board, on its own page: /sql?seat=<id>&group=<id>. Both parameters are
// optional integers; anything else is treated as absent.
export default async function SqlPage({
  searchParams,
}: {
  searchParams: Promise<{ seat?: string | string[]; group?: string | string[] }>;
}) {
  const params = await searchParams;
  const seatId = parseSeatParam(params.seat);
  const parsedGroup = parseGroupParam(params.group);
  const groupId =
    typeof parsedGroup === "number"
      ? parsedGroup
      : ((seatId === null ? null : await groupIdOfSeat(seatId)) ?? (await defaultPanelGroupId()));
  const data = await getUnderTheHood({ seatId, groupId });

  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">Under the hood</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        Read-only preset queries. Pick a seat on the{" "}
        <Link href="/board" className="underline">
          board
        </Link>{" "}
        to fill in the seat and worker tables, or add <code>?seat=&lt;id&gt;</code> to this URL.
      </p>
      <SqlPanelBody data={data} />
    </main>
  );
}

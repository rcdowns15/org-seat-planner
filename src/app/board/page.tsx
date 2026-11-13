import Link from "next/link";
import { notFound } from "next/navigation";
import { BoardView } from "@/components/board/board-view";
import { defaultGroupIdForLeader, parseGroupParam } from "@/lib/board";
import { SqlPanel } from "@/components/sql-panel";
import { parseSeatParam } from "@/lib/schemas/sql-panel";
import { getUnderTheHood } from "@/server/queries/under-the-hood";
import { DemoToolbar } from "@/components/demo-toolbar";
import { simulateAnotherLeaderEditAction } from "@/server/actions/demo";
import { moveWorkerFromBoard } from "@/server/actions/board-move";
import { isDemoMode } from "@/server/demo-mode";
import { getActingLeader } from "@/server/auth/acting-leader";
import { getBoard, listGroups } from "@/server/queries/board";
import { canEditAnyGroup, scopeAllows } from "@/server/services/permissions";

// Reads the database on every request.
export const dynamic = "force-dynamic";

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string | string[]; seat?: string | string[] }>;
}) {
  const params = await searchParams;
  const groupId = parseGroupParam(params.group);
  const selectedSeatId = parseSeatParam(params.seat);
  if (groupId === "invalid") notFound();
  const leader = await getActingLeader();
  // No ?group=: open on the acting leader's scope; with no leader, getBoard uses the demo group.
  const wantedGroupId =
    groupId ?? (leader ? defaultGroupIdForLeader(leader, await listGroups()) : null);
  const board = await getBoard(wantedGroupId);
  if (!board) notFound();
  // Every squad on one board shares a group and a division, so one scope check covers the board.
  const editable =
    leader !== null &&
    scopeAllows(leader, { groupId: board.group.groupId, divisionId: board.group.divisionId });

  // "Move to…" is offered only to a leader who can edit something; the server still checks.
  const canMoveTo = canEditAnyGroup(leader, board.groups);
  const demoMode = isDemoMode();

  const underTheHood = await getUnderTheHood({
    seatId: selectedSeatId,
    groupId: board.group.groupId,
  });

  const divisions = [...new Set(board.groups.map((g) => g.divisionName))];

  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">Org board</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        {board.group.divisionName} / {board.group.name}{" "}
        {leader === null
          ? "(read-only)"
          : editable
            ? `(you can edit this group, acting as ${leader.displayName})`
            : `(outside your scope, acting as ${leader.displayName})`}
      </p>

      <nav aria-label="Choose a group" className="mt-4 flex flex-col gap-1 text-sm">
        {divisions.map((division) => (
          <div key={division} className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{division}:</span>
            {board.groups
              .filter((g) => g.divisionName === division)
              .map((g) => (
                <Link
                  key={g.groupId}
                  href={`/board?group=${g.groupId}`}
                  aria-current={g.groupId === board.group.groupId ? "page" : undefined}
                  className={
                    g.groupId === board.group.groupId
                      ? "font-semibold underline"
                      : "hover:underline"
                  }
                >
                  {g.name}
                </Link>
              ))}
          </div>
        ))}
      </nav>

      <BoardView
        squads={board.squads}
        editable={editable}
        canMoveTo={canMoveTo}
        move={moveWorkerFromBoard}
        selectedSeatId={selectedSeatId}
        simulate={demoMode ? simulateAnotherLeaderEditAction : undefined}
      />
      {demoMode ? (
        <DemoToolbar selectedSeatId={selectedSeatId} simulate={simulateAnotherLeaderEditAction} />
      ) : null}

      <SqlPanel data={underTheHood} />
      <p className="mt-2 text-sm">
        <Link href={selectedSeatId ? `/sql?seat=${selectedSeatId}` : "/sql"} className="underline">
          Open the SQL panel on its own page
        </Link>
      </p>
    </main>
  );
}

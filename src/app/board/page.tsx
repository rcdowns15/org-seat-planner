import Link from "next/link";
import { notFound } from "next/navigation";
import { SquadColumn } from "@/components/board/squad-column";
import { parseGroupParam } from "@/lib/board";
import { getBoard } from "@/server/queries/board";

// Reads the database on every request.
export const dynamic = "force-dynamic";

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string | string[] }>;
}) {
  const groupId = parseGroupParam((await searchParams).group);
  if (groupId === "invalid") notFound();
  const board = await getBoard(groupId);
  if (!board) notFound();

  const divisions = [...new Set(board.groups.map((g) => g.divisionName))];

  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">Org board</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        {board.group.divisionName} / {board.group.name} (read-only)
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

      <div data-testid="board" className="mt-6 flex gap-4 overflow-x-auto pb-4">
        {board.squads.map((squad) => (
          <SquadColumn key={squad.squadId} squad={squad} />
        ))}
      </div>
    </main>
  );
}

import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import type { SeatStatus } from "@/lib/seat-status";
import type { SeatType } from "@/lib/seat-card";

// The group the board opens on when the URL has no ?group= (LR-02-04 changes this to the acting
// leader's scope). Looked up by name, never by row position.
export const DEFAULT_GROUP_NAME = "Digital Channels";

export type BoardGroupOption = { groupId: number; name: string; divisionName: string };

export type BoardSeat = {
  seatId: number;
  seatType: SeatType;
  status: SeatStatus;
  version: number;
  workerId: string | null;
  workerName: string | null; // "First Last"
  jobTitle: string | null;
  workerStatus: string | null; // Workday status, so a terminated seated worker can be flagged
};

export type BoardSquad = {
  squadId: number;
  name: string;
  seats: BoardSeat[];
  filledCount: number;
  approvedCount: number; // every seat in a squad is an approved seat (see db/schema/app.ts)
};

export type Board = {
  group: BoardGroupOption;
  groups: BoardGroupOption[];
  squads: BoardSquad[];
};

type GroupRow = { group_id: number; name: string; division_name: string };
type SeatRow = {
  squad_id: number;
  squad_name: string;
  seat_id: number | null; // null: a squad with no seats yet
  seat_type: SeatType | null;
  status: SeatStatus | null;
  version: number | null;
  worker_id: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  worker_status: string | null;
};

const toOption = (r: GroupRow): BoardGroupOption => ({
  groupId: r.group_id,
  name: r.name,
  divisionName: r.division_name,
});

// Loads one group's board. `groupId` null means the default group. Returns null when the id
// matches no group. All values are bound parameters.
export async function getBoard(groupId: number | null): Promise<Board | null> {
  const db = getDb();

  const groupRows = await db.execute<GroupRow>(sql`
    select g.group_id, g.name, d.name as division_name
    from app.groups g
    join app.divisions d on d.division_id = g.division_id
    order by d.name, g.name`);
  const groups = groupRows.rows.map(toOption);
  const group =
    groupId === null
      ? groups.find((g) => g.name === DEFAULT_GROUP_NAME)
      : groups.find((g) => g.groupId === groupId);
  if (!group) return null;

  const seatRows = await db.execute<SeatRow>(sql`
    select q.squad_id, q.name as squad_name, st.seat_id, st.seat_type, st.status, st.version,
           st.worker_id, w.first_name, w.last_name, w.job_title, w.status as worker_status
    from app.squads q
    left join app.seats st on st.squad_id = q.squad_id
    left join workday.workers w on w.worker_id = st.worker_id
    where q.group_id = ${group.groupId}
    order by q.name, q.squad_id, st.seat_id`);

  const bySquad = new Map<number, BoardSquad>();
  for (const r of seatRows.rows) {
    let squad = bySquad.get(r.squad_id);
    if (!squad) {
      squad = {
        squadId: r.squad_id,
        name: r.squad_name,
        seats: [],
        filledCount: 0,
        approvedCount: 0,
      };
      bySquad.set(r.squad_id, squad);
    }
    if (r.seat_id === null || r.seat_type === null || r.status === null || r.version === null) {
      continue;
    }
    squad.seats.push({
      seatId: r.seat_id,
      seatType: r.seat_type,
      status: r.status,
      version: r.version,
      workerId: r.worker_id,
      workerName: r.first_name === null ? null : `${r.first_name} ${r.last_name}`,
      jobTitle: r.job_title,
      workerStatus: r.worker_status,
    });
    squad.approvedCount += 1;
    if (r.status === "filled") squad.filledCount += 1;
  }
  return { group, groups, squads: [...bySquad.values()] };
}

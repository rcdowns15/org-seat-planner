import "server-only";
import { sql } from "drizzle-orm";
import type { SeatHistoryEntry } from "@/lib/history";
import { seatIdSchema } from "@/lib/schemas/history";
import { getDb } from "@/server/db";

type Row = {
  change_id: number | string;
  change_type: SeatHistoryEntry["changeType"];
  from_status: SeatHistoryEntry["fromStatus"];
  to_status: SeatHistoryEntry["toStatus"];
  from_first: string | null;
  from_last: string | null;
  to_first: string | null;
  to_last: string | null;
  from_worker_id: string | null;
  to_worker_id: string | null;
  actor_name: string;
  saved_at: string;
  effective_date: string;
  note: string | null;
};

export const HISTORY_LIMIT = 100;

function name(first: string | null, last: string | null, workerId: string | null): string | null {
  if (workerId === null) return null;
  return first === null ? `Worker ${workerId}` : `${first} ${last}`;
}

// One seat's audit rows, newest first. "Newest" means last saved: created_at descending, and for
// rows saved in the same instant (the two rows of one move share a transaction timestamp)
// change_id descending, the later insert. Uses the index on app.seat_changes (seat_id); all
// values are bound. Reading history is a read, not a mutation: the seat id is parsed with Zod,
// and an invalid id returns no rows.
export async function getSeatHistory(seatId: unknown): Promise<SeatHistoryEntry[]> {
  const parsed = seatIdSchema.safeParse(seatId);
  if (!parsed.success) return [];
  const result = await getDb().execute<Row>(sql`
    select c.change_id, c.change_type, c.from_status, c.to_status,
           fw.first_name as from_first, fw.last_name as from_last,
           tw.first_name as to_first, tw.last_name as to_last,
           c.from_worker_id, c.to_worker_id,
           l.display_name as actor_name, to_char(c.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as saved_at,
           c.effective_date::text as effective_date, c.note
    from app.seat_changes c
    join app.leaders l on l.leader_id = c.actor_leader_id
    left join workday.workers fw on fw.worker_id = c.from_worker_id
    left join workday.workers tw on tw.worker_id = c.to_worker_id
    where c.seat_id = ${parsed.data}
    order by c.created_at desc, c.change_id desc
    limit ${HISTORY_LIMIT}`);
  return result.rows.map((r) => ({
    changeId: Number(r.change_id),
    changeType: r.change_type,
    fromStatus: r.from_status,
    toStatus: r.to_status,
    fromWorkerName: name(r.from_first, r.from_last, r.from_worker_id),
    toWorkerName: name(r.to_first, r.to_last, r.to_worker_id),
    actorName: r.actor_name,
    savedAt: r.saved_at,
    effectiveDate: r.effective_date,
    note: r.note,
  }));
}

import "server-only";
import type { PoolClient } from "pg";
import { panelParamsSchema, type PanelParams } from "@/lib/schemas/sql-panel";
import { getPool } from "@/server/db";
import { DEFAULT_GROUP_NAME } from "@/server/queries/board";
import { lastSave, type SaveLogEntry } from "@/server/sql-log";

// The "Under the hood" panel (LR-02-08). Preset queries only (D-026): the SQL text below is fixed
// in this file, and the only thing a caller supplies is a typed ID, bound as a parameter. There is
// no function here (and no server action) that takes SQL text from outside.

export const ROW_LIMIT = 200;
export const STATEMENT_TIMEOUT = "2s";

export type QueryResult =
  | { ok: true; columns: string[]; rows: string[][]; truncated: boolean }
  | {
      ok: false;
      code: "READ_ONLY_VIOLATION" | "TIMEOUT" | "QUERY_ERROR" | "NOT_BUILT";
      message: string;
    };

// Shows a cell as text: dates as ISO strings, null as an empty cell.
function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

type Runner = (text: string, values: unknown[]) => Promise<QueryResult>;
type Failure = Extract<QueryResult, { ok: false }>;

// Exported for the unit tests only.
export function toFailure(err: unknown, connected = true): Failure {
  if (!connected) {
    // Driver messages can carry hosts or user names, so keep them out of the UI; log server-side.
    console.error("Under the hood: could not get a database connection:", err);
    return { ok: false, code: "QUERY_ERROR", message: "Database unavailable." };
  }
  const e = err as { code?: string; message?: string };
  if (e.code === "25006") {
    return { ok: false, code: "READ_ONLY_VIOLATION", message: "Writes are not allowed here." };
  }
  // 42P01 undefined_table, 3F000 invalid_schema_name: the table or schema isn't there. For the
  // analytics presets that means dbt hasn't built yet; runPreset turns it into a friendly message.
  if (e.code === "42P01" || e.code === "3F000") {
    return { ok: false, code: "NOT_BUILT", message: "Table or schema not found." };
  }
  if (e.code === "57014") {
    return { ok: false, code: "TIMEOUT", message: `Query stopped after ${STATEMENT_TIMEOUT}.` };
  }
  return { ok: false, code: "QUERY_ERROR", message: e.message ?? "Query failed." };
}

// Opens one connection and one READ ONLY transaction (Postgres itself refuses any write, SQLSTATE
// 25006) with a 2 s statement timeout, hands `work` a runner, and always rolls back. Every query
// run through the runner sees the same snapshot. Each query gets its own savepoint: when one
// fails (timeout, error, refused write) Postgres aborts the transaction, so we roll back to the
// savepoint and the next query still works. Connection failures come back as a failure result
// instead of throwing, so a database hiccup can't take down the page that renders the panel.
// Exported for the tests only; code outside this file must use getUnderTheHood (D-026).
export async function inReadOnlyTransaction<T>(
  work: (run: Runner) => Promise<T>,
): Promise<{ ok: true; value: T } | Failure> {
  let client: PoolClient | null = null;
  try {
    client = await getPool().connect();
    await client.query("begin read only");
    await client.query(`set local statement_timeout = '${STATEMENT_TIMEOUT}'`); // constant, no input
    const conn = client;
    const run: Runner = async (text, values) => {
      await conn.query("savepoint preset");
      try {
        const res = await conn.query({ text, values, rowMode: "array" });
        await conn.query("release savepoint preset");
        const all = res.rows as unknown[][];
        return {
          ok: true,
          columns: res.fields.map((f) => f.name),
          rows: all.slice(0, ROW_LIMIT).map((r) => r.map(cell)),
          truncated: all.length > ROW_LIMIT,
        };
      } catch (err) {
        await conn.query("rollback to savepoint preset");
        await conn.query("release savepoint preset"); // so failed savepoints don't stack up
        return toFailure(err);
      }
    };
    return { ok: true, value: await work(run) };
  } catch (err) {
    return toFailure(err, client !== null);
  } finally {
    if (client) {
      // If rollback itself fails, destroy the connection instead of returning it to the pool.
      try {
        await client.query("rollback");
        client.release();
      } catch {
        client.release(true);
      }
    }
  }
}

// Runs one fixed query with bound values in its own READ ONLY transaction, keeping at most 200
// rows (a 201st row only sets `truncated`). Exported for the tests; code outside this file must
// use getUnderTheHood, and the text passed here must always be a constant (D-026).
export async function runReadOnlyQuery(text: string, values: unknown[]): Promise<QueryResult> {
  const out = await inReadOnlyTransaction((run) => run(text, values));
  return out.ok ? out.value : out;
}

export const PRESET_KEYS = [
  "seat",
  "recent_changes",
  "worker",
  "plan_gaps",
  "last_move_impact",
  "reconciliation_exceptions",
  "workday_changes",
  "squad_headcount_vs_plan",
] as const;
export type PresetKey = (typeof PRESET_KEYS)[number];

type Preset = {
  title: string;
  description: string;
  // Which typed ID the query needs, if any.
  needs: "seatId" | "groupId" | null;
  sql: string;
  emptyMessage: string;
  // Set for presets that read `analytics` (dbt marts): shown instead of an error when the schema
  // or tables don't exist yet.
  notBuiltMessage?: string;
};

const ANALYTICS_NOT_BUILT =
  "The analytics models aren't built yet. Run `pnpm run pipeline` (or `cd analytics && uv run dbt build`) to build them.";

// Every statement is a constant. `$1` is the only thing bound, and only a typed ID.
const PRESETS: Record<PresetKey, Preset> = {
  seat: {
    title: "Selected seat",
    description: "The seat's row, including the version the optimistic lock checks.",
    needs: "seatId",
    sql: `select seat_id, squad_id, seat_type, status, worker_id, version, updated_at,
       updated_by_leader_id
from app.seats
where seat_id = $1`,
    emptyMessage: "Select a seat on the board to see its row.",
  },
  recent_changes: {
    title: "Latest 10 seat changes",
    description: "The append-only audit table, newest first.",
    needs: null,
    sql: `select change_id, move_id, seat_id, change_type, worker_id, from_status, to_status,
       actor_leader_id, effective_date::text as effective_date, created_at
from app.seat_changes
order by change_id desc
limit 10`,
    emptyMessage: "No seat changes yet.",
  },
  worker: {
    title: "Selected worker (Workday record)",
    description: "The worker sitting in the selected seat, with their manager.",
    needs: "seatId",
    sql: `select w.worker_id, w.first_name, w.last_name, w.status, w.worker_type, w.job_title,
       w.manager_worker_id, m.first_name || ' ' || m.last_name as manager_name
from app.seats s
join workday.workers w on w.worker_id = s.worker_id
left join workday.workers m on m.worker_id = w.manager_worker_id
where s.seat_id = $1`,
    emptyMessage: "Select a filled seat to see its worker's Workday record.",
  },
  plan_gaps: {
    title: "Open and backfill seats vs. the plan",
    description:
      "Per squad in the board's group: seats still to fill, and committed seats against this quarter's approved plan.",
    needs: "groupId",
    sql: `select q.squad_id, q.name as squad_name,
       count(*) filter (where s.status = 'open') as open_seats,
       count(*) filter (where s.status = 'backfill') as backfill_seats,
       pl.approved_seats as approved_plan,
       count(*) filter (where s.status in ('filled', 'offer_accepted')) - pl.approved_seats
         as variance
from app.squads q
left join app.seats s on s.squad_id = q.squad_id
left join app.headcount_plan pl
  on pl.squad_id = q.squad_id
 and pl.quarter_start = date_trunc('quarter', now() at time zone 'utc')::date
where q.group_id = $1
group by q.squad_id, q.name, pl.approved_seats
order by q.name, q.squad_id
limit 201`,
    emptyMessage: "No squads in this group.",
  },
  last_move_impact: {
    title: "Impact of last move",
    description:
      "The squads the most recent move touched. After = live app.seats. Before = the same seats with that move's two seat_changes rows reversed (from_status restored). Variance = committed seats (filled + offer accepted) minus the plan.",
    needs: null,
    sql: `with last_move as (
  select move_id from app.seat_changes
  where move_id is not null and change_type in ('move_out', 'move_in')
  order by change_id desc
  limit 1
),
moved as (
  select c.seat_id, c.from_status
  from app.seat_changes c
  join last_move m on m.move_id = c.move_id
  where c.change_type in ('move_out', 'move_in')
),
touched as (
  select distinct s.squad_id from moved mv join app.seats s on s.seat_id = mv.seat_id
),
states as (
  select s.squad_id, s.seat_type, s.status as after_status,
         coalesce(mv.from_status, s.status) as before_status
  from app.seats s
  join touched t on t.squad_id = s.squad_id
  left join moved mv on mv.seat_id = s.seat_id
),
phases as (
  select squad_id, 'before' as phase, seat_type, before_status as status from states
  union all
  select squad_id, 'after' as phase, seat_type, after_status as status from states
)
select q.squad_id, q.name as squad_name, p.phase,
       count(*) filter (where p.status = 'filled' and p.seat_type = 'employee')
         as filled_employee,
       count(*) filter (where p.status = 'filled' and p.seat_type = 'contingent')
         as filled_contingent,
       count(*) filter (where p.status = 'open') as open_seats,
       count(*) filter (where p.status = 'backfill') as backfill_seats,
       count(*) filter (where p.status = 'offer_accepted') as offer_accepted_seats,
       pl.approved_seats as approved_plan,
       count(*) filter (where p.status in ('filled', 'offer_accepted')) - pl.approved_seats
         as variance
from phases p
join app.squads q on q.squad_id = p.squad_id
left join app.headcount_plan pl
  on pl.squad_id = p.squad_id
 and pl.quarter_start = date_trunc('quarter', now() at time zone 'utc')::date
group by q.squad_id, q.name, p.phase, pl.approved_seats
order by q.name, q.squad_id, p.phase desc
limit 201`,
    emptyMessage: "No move yet. Move a worker and this table shows its effect on both squads.",
  },
  reconciliation_exceptions: {
    title: "Reconciliation exceptions (latest Workday report vs. the plan)",
    description:
      "The dbt mart analytics.rpt_reconciliation_exceptions: where the latest Workday report and the seat plan disagree, errors first.",
    needs: null,
    sql: `select exception_type, severity, subject_type, subject_id, seat_id, squad_id, group_id,
       report_date::text as report_date, detail
from analytics.rpt_reconciliation_exceptions
order by case severity when 'error' then 1 when 'warning' then 2 else 3 end,
         exception_type, subject_id
limit 201`,
    emptyMessage: "No reconciliation exceptions: the latest report and the plan agree.",
    notBuiltMessage: ANALYTICS_NOT_BUILT,
  },
  workday_changes: {
    title: "Latest Workday changes",
    description:
      "The dbt mart analytics.rpt_workday_changes: what changed for each worker between the latest Workday report and the one before it.",
    needs: null,
    sql: `select worker_id, change_type, report_date::text as report_date,
       previous_report_date::text as previous_report_date,
       previous_worker_status, worker_status, previous_manager_id, manager_id
from analytics.rpt_workday_changes
where report_date = (select max(report_date) from analytics.rpt_workday_changes)
order by change_type, worker_id
limit 201`,
    emptyMessage: "No Workday changes yet: load a second report to compare against the first.",
    notBuiltMessage: ANALYTICS_NOT_BUILT,
  },
  squad_headcount_vs_plan: {
    title: "Squad headcount vs. plan (latest Workday report)",
    description:
      "The dbt mart analytics.rpt_squad_headcount: seats as of the latest report date against that quarter's approved plan, most over plan first.",
    needs: null,
    sql: `select h.squad_id, q.name as squad_name, h.report_date::text as report_date,
       h.filled_employee_seats, h.filled_contingent_seats, h.offer_accepted_seats,
       h.open_seats, h.backfill_seats, h.approved_seats, h.variance, h.fill_rate
from analytics.rpt_squad_headcount h
join app.squads q on q.squad_id = h.squad_id
where h.is_latest_report
order by h.variance desc, h.squad_id
limit 201`,
    emptyMessage: "No squad headcount rows yet.",
    notBuiltMessage: ANALYTICS_NOT_BUILT,
  },
};

export type PanelSection = {
  key: PresetKey;
  title: string;
  description: string;
  sql: string;
  params: number[]; // the bound values, for display
  // Set when the preset has nothing to show (no selection, or no rows).
  empty: string | null;
  result: QueryResult | null;
};

// Runs one preset with already-validated IDs. Exported for the unit tests (with a stubbed runner).
export async function runPreset(
  key: PresetKey,
  ids: PanelParams,
  run: Runner,
): Promise<PanelSection> {
  const preset = PRESETS[key];
  const base = { key, title: preset.title, description: preset.description, sql: preset.sql };
  const bound = preset.needs === null ? null : ids[preset.needs];
  if (preset.needs !== null && bound === null) {
    return { ...base, params: [], empty: preset.emptyMessage, result: null };
  }
  const params = bound === null ? [] : [bound];
  const result = await run(preset.sql, params);
  // An analytics preset whose schema or table is missing: say what to do, not "relation does not
  // exist".
  if (!result.ok && result.code === "NOT_BUILT" && preset.notBuiltMessage) {
    return { ...base, params, empty: preset.notBuiltMessage, result: null };
  }
  const empty = result.ok && result.rows.length === 0 ? preset.emptyMessage : null;
  return { ...base, params, empty, result };
}

function failedSection(key: PresetKey, result: Failure): PanelSection {
  const p = PRESETS[key];
  return {
    key,
    title: p.title,
    description: p.description,
    sql: p.sql,
    params: [],
    empty: null,
    result,
  };
}

export type UnderTheHood = {
  sections: PanelSection[];
  lastSave: SaveLogEntry | null;
};

// Everything the panel shows. The IDs are checked against the Zod schema here, so a bad value
// can't reach a query.
export async function getUnderTheHood(rawParams: unknown): Promise<UnderTheHood> {
  const ids = panelParamsSchema.parse(rawParams);
  // One connection, one snapshot, presets run one after another (a single client can't run
  // queries in parallel anyway). Latency: worst case is about 8 x 2s (every preset hitting the
  // statement timeout) plus the connect timeout. Accepted as the price of one consistent snapshot.
  const out = await inReadOnlyTransaction(async (run) => {
    const done: PanelSection[] = [];
    for (const key of PRESET_KEYS) done.push(await runPreset(key, ids, run));
    return done;
  });
  const sections = out.ok ? out.value : PRESET_KEYS.map((key) => failedSection(key, out)); // could not connect
  return { sections, lastSave: lastSave() };
}

// The group the plan table covers on /sql when nothing picks one: the demo group, by name.
export async function defaultPanelGroupId(): Promise<number | null> {
  const res = await runReadOnlyQuery("select group_id from app.groups where name = $1", [
    DEFAULT_GROUP_NAME,
  ]);
  return res.ok && res.rows.length > 0 ? Number(res.rows[0][0]) : null;
}

// The group a seat belongs to, so /sql?seat=N can show that group's plan table.
export async function groupIdOfSeat(seatId: number): Promise<number | null> {
  const res = await runReadOnlyQuery(
    `select q.group_id from app.seats s join app.squads q on q.squad_id = s.squad_id
     where s.seat_id = $1`,
    [seatId],
  );
  return res.ok && res.rows.length > 0 ? Number(res.rows[0][0]) : null;
}

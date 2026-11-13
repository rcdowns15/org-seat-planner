import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { Client } from "pg";
import { requireLocalDatabaseUrl } from "../db/local-db";
import { ACTING_LEADER_COOKIE } from "../../src/lib/acting-as";

// Named demo fixtures (scripts/seed/README.md).
const DIVISION_LEADER = "100002"; // Savion Kshlerin, division Retail Banking Technology
const OUT_OF_SCOPE_OPEN_SEAT = 206; // open employee seat in Accounts and Cards

// The panel's "last move" and "last save" are global, so playwright.config.ts runs one worker.
// Each test makes its own move, picking its seats by query at run time (as move.spec.ts does), so
// reruns on the same database keep working.
async function withDb<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: requireLocalDatabaseUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

type Pick = {
  groupId: number;
  from: { seatId: number; squadId: number };
  to: { seatId: number; squadId: number; version: number };
};

// In a non-demo group of the division leader's division: an active employee in a filled seat of
// one squad, and an open or backfill employee seat in another squad.
async function pickMove(): Promise<Pick> {
  return withDb(async (c) => {
    const groups = await c.query<{ group_id: number }>(
      `select g.group_id from app.groups g
       join app.leaders l on l.division_id = g.division_id
       where l.worker_id = $1 and g.name not in ('Digital Channels', 'Accounts and Cards')
       order by g.name`,
      [DIVISION_LEADER],
    );
    for (const g of groups.rows) {
      const seats = await c.query<{
        seat_id: number;
        squad_id: number;
        status: string;
        version: number;
        worker_status: string | null;
      }>(
        `select s.seat_id, s.squad_id, s.status, s.version, w.status as worker_status
         from app.seats s
         join app.squads q on q.squad_id = s.squad_id
         left join workday.workers w on w.worker_id = s.worker_id
         where q.group_id = $1 and s.seat_type = 'employee' and s.seat_id <> $2
         order by q.name, q.squad_id, s.seat_id`,
        [g.group_id, OUT_OF_SCOPE_OPEN_SEAT],
      );
      for (const src of seats.rows) {
        if (src.status !== "filled" || src.worker_status !== "active") continue;
        const dest = seats.rows.find(
          (s) => s.squad_id !== src.squad_id && (s.status === "open" || s.status === "backfill"),
        );
        if (dest) {
          return {
            groupId: g.group_id,
            from: { seatId: src.seat_id, squadId: src.squad_id },
            to: { seatId: dest.seat_id, squadId: dest.squad_id, version: dest.version },
          };
        }
      }
    }
    throw new Error("no non-demo group with a movable worker");
  });
}

type Counts = {
  filled_employee: number;
  filled_contingent: number;
  open_seats: number;
  backfill_seats: number;
  offer_accepted_seats: number;
  approved_plan: number;
};

// Independent count of one squad from the database, plus the current quarter's plan.
async function squadCounts(squadId: number): Promise<Counts> {
  return withDb(async (c) => {
    const r = await c.query<Counts>(
      `select
         count(*) filter (where s.status = 'filled' and s.seat_type = 'employee')::int as filled_employee,
         count(*) filter (where s.status = 'filled' and s.seat_type = 'contingent')::int as filled_contingent,
         count(*) filter (where s.status = 'open')::int as open_seats,
         count(*) filter (where s.status = 'backfill')::int as backfill_seats,
         count(*) filter (where s.status = 'offer_accepted')::int as offer_accepted_seats,
         (select approved_seats from app.headcount_plan
           where squad_id = $1
             and quarter_start = date_trunc('quarter', now() at time zone 'utc')::date) as approved_plan
       from app.seats s where s.squad_id = $1`,
      [squadId],
    );
    return r.rows[0];
  });
}

async function actAsDivisionLeader(context: BrowserContext, baseURL: string) {
  const r = await withDb((c) =>
    c.query<{ leader_id: number }>("select leader_id from app.leaders where worker_id = $1", [
      DIVISION_LEADER,
    ]),
  );
  await context.addCookies([
    { name: ACTING_LEADER_COOKIE, value: String(r.rows[0].leader_id), url: baseURL },
  ]);
}

const card = (page: Page, seatId: number) => page.locator(`[data-seat-id="${seatId}"]`);

// Selects the seat target, makes the move from the board with "Move to…", and opens the panel.
async function selectAndMove(page: Page, pick: Pick) {
  await page.goto(`/board?group=${pick.groupId}`);
  await card(page, pick.to.seatId).getByTestId("select-seat-button").click();
  await expect(page).toHaveURL(new RegExp(`seat=${pick.to.seatId}`));
  await expect(card(page, pick.to.seatId)).toHaveAttribute("data-selected", "true");

  await card(page, pick.from.seatId).getByTestId("move-to-button").click();
  const dialog = page.getByTestId("move-dialog");
  await dialog.getByLabel("To", { exact: true }).selectOption(String(pick.to.seatId));
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(card(page, pick.to.seatId)).toHaveAttribute("data-state", "filled_employee");

  await page.getByTestId("sql-panel").locator("summary").click();
}

// A table's rows as column -> text objects.
async function tableRows(page: Page, testId: string): Promise<Record<string, string>[]> {
  const table = page.getByTestId(`${testId}-table`);
  await expect(table).toBeVisible();
  return table.evaluate((t) => {
    const cols = [...t.querySelectorAll("thead th")].map((th) => th.textContent ?? "");
    return [...t.querySelectorAll("tbody tr")].map((tr) =>
      Object.fromEntries(
        [...tr.querySelectorAll("td")].map((td, i) => [cols[i], td.textContent ?? ""]),
      ),
    );
  });
}

test.describe("Under the hood panel", () => {
  test.use({ viewport: { width: 3200, height: 4000 } });

  test("after a move: the seat row shows the incremented version; latest change is the move", async ({
    page,
    context,
    baseURL,
  }) => {
    const pick = await pickMove();
    await actAsDivisionLeader(context, baseURL!);
    await selectAndMove(page, pick);

    const seatRows = await tableRows(page, "sql-seat");
    expect(seatRows).toHaveLength(1);
    expect(seatRows[0].seat_id).toBe(String(pick.to.seatId));
    expect(seatRows[0].version).toBe(String(pick.to.version + 1));
    expect(seatRows[0].status).toBe("filled");

    const changes = await tableRows(page, "sql-recent_changes");
    expect(changes[0].change_type).toBe("move_in");
    expect(changes[0].seat_id).toBe(String(pick.to.seatId));
    expect(changes[1].change_type).toBe("move_out");
    expect(changes[1].seat_id).toBe(String(pick.from.seatId));
    expect(changes[0].move_id).toBe(changes[1].move_id);

    // The worker table shows the mover's Workday record.
    const worker = await tableRows(page, "sql-worker");
    expect(worker[0].status).toBe("active");
  });

  test("Impact of last move: source filled -1 / backfill +1, target filled +1 / open or backfill -1, variance recomputed", async ({
    page,
    context,
    baseURL,
  }) => {
    const pick = await pickMove();
    const beforeA = await squadCounts(pick.from.squadId);
    const beforeB = await squadCounts(pick.to.squadId);
    const targetWasOpen = await withDb(async (c) => {
      const r = await c.query<{ status: string }>(
        "select status from app.seats where seat_id = $1",
        [pick.to.seatId],
      );
      return r.rows[0].status === "open";
    });

    await actAsDivisionLeader(context, baseURL!);
    await selectAndMove(page, pick);

    const impact = await tableRows(page, "sql-last_move_impact");
    expect(impact).toHaveLength(4);
    const row = (squadId: number, phase: string) =>
      impact.find((r) => r.squad_id === String(squadId) && r.phase === phase)!;
    const num = (r: Record<string, string>, k: string) => Number(r[k]);
    const committed = (r: Record<string, string>) =>
      num(r, "filled_employee") + num(r, "filled_contingent") + num(r, "offer_accepted_seats");

    const aBefore = row(pick.from.squadId, "before");
    const aAfter = row(pick.from.squadId, "after");
    expect(num(aBefore, "filled_employee")).toBe(beforeA.filled_employee);
    expect(num(aAfter, "filled_employee")).toBe(beforeA.filled_employee - 1);
    expect(num(aAfter, "backfill_seats")).toBe(beforeA.backfill_seats + 1);

    const bBefore = row(pick.to.squadId, "before");
    const bAfter = row(pick.to.squadId, "after");
    expect(num(bBefore, "filled_employee")).toBe(beforeB.filled_employee);
    expect(num(bAfter, "filled_employee")).toBe(beforeB.filled_employee + 1);
    expect(num(bAfter, targetWasOpen ? "open_seats" : "backfill_seats")).toBe(
      (targetWasOpen ? beforeB.open_seats : beforeB.backfill_seats) - 1,
    );

    // Variance = committed seats - plan, recomputed for each phase.
    for (const [r, plan] of [
      [aBefore, beforeA.approved_plan],
      [aAfter, beforeA.approved_plan],
      [bBefore, beforeB.approved_plan],
      [bAfter, beforeB.approved_plan],
    ] as const) {
      expect(num(r, "approved_plan")).toBe(plan);
      expect(num(r, "variance")).toBe(committed(r) - plan);
    }
    expect(num(aAfter, "variance")).toBe(num(aBefore, "variance") - 1);
    expect(num(bAfter, "variance")).toBe(num(bBefore, "variance") + 1);
  });

  test("Last save: one UPDATE with version, two audit INSERTs, bound values shown", async ({
    page,
    context,
    baseURL,
  }) => {
    const pick = await pickMove();
    await actAsDivisionLeader(context, baseURL!);
    await selectAndMove(page, pick);

    const statements = await page
      .getByTestId("sql-last-save")
      .getByTestId("sql-last-save-statement")
      .locator("pre")
      .allTextContents();
    // A move updates two seats, each guarded by the optimistic-lock version check.
    const updates = statements.filter((s) => /^update "app"\."seats"/i.test(s));
    expect(updates).toHaveLength(2);
    for (const u of updates) expect(u).toMatch(/where .*"version" = \$\d+/is);
    const inserts = statements.filter((s) => /^insert into "app"\."seat_changes"/i.test(s));
    expect(inserts).toHaveLength(2);
    // The bound values must include this test's target seat id, so an earlier save can't pass.
    const saved = page.getByTestId("sql-last-save");
    await expect(saved).toContainText("Values:");
    const text = (await saved.textContent()) ?? "";
    const values = text.slice(text.indexOf("Values:"));
    expect(values).toMatch(new RegExp(`(^|[^0-9])${pick.to.seatId}([^0-9]|$)`));
  });

  test("the panel has no free-text input, and /sql shows the same presets", async ({
    page,
    context,
    baseURL,
  }) => {
    await actAsDivisionLeader(context, baseURL!);
    await page.goto("/board");
    await page.getByTestId("sql-panel").locator("summary").click();
    await expect(page.getByTestId("sql-panel").locator("input, textarea, select")).toHaveCount(0);

    await page.goto("/sql");
    await expect(page.getByRole("heading", { name: "Under the hood" })).toBeVisible();
    await expect(page.locator("main input, main textarea")).toHaveCount(0);
    for (const key of [
      "seat",
      "recent_changes",
      "worker",
      "plan_gaps",
      "last_move_impact",
      "reconciliation_exceptions",
      "workday_changes",
      "squad_headcount_vs_plan",
    ]) {
      await expect(page.getByTestId(`sql-${key}`)).toBeVisible();
    }
  });

  // Needs the seed, the 11-15 report ingested and `dbt build` run (pnpm run pipeline): the preset
  // reads the analytics mart. The rows are the named fixtures in scripts/seed/README.md.
  test("reconciliation preset shows the seeded exceptions", async ({ page }) => {
    await page.goto("/sql");
    const rows = await tableRows(page, "sql-reconciliation_exceptions");
    const find = (type: string, subject: string) =>
      rows.find((r) => r.exception_type === type && r.subject_id === subject);

    // terminated-seated-worker: terminated in Workday, still holds seat 39.
    expect(find("terminated_seated", "100052")).toMatchObject({ severity: "error", seat_id: "39" });
    // Active on 11-01, missing from the 11-15 report with no termination, still in seat 955.
    expect(find("seated_missing_from_report", "100878")).toMatchObject({
      severity: "error",
      seat_id: "955",
    });
    // worker-on-leave keeps seat 28: informational.
    expect(find("on_leave_seated", "100042")).toMatchObject({ severity: "info", seat_id: "28" });
    // A hiring gap is about a group, not a worker.
    expect(rows.some((r) => r.exception_type === "hiring_gap" && r.subject_type === "group")).toBe(
      true,
    );
    // Errors sort before warnings and info.
    const firstInfo = rows.findIndex((r) => r.severity === "info");
    const lastError = rows.map((r) => r.severity).lastIndexOf("error");
    expect(lastError).toBeLessThan(firstInfo);
    // The panel shows the SQL it ran.
    await expect(page.getByTestId("sql-reconciliation_exceptions").locator("pre")).toContainText(
      "analytics.rpt_reconciliation_exceptions",
    );
  });

  test("selecting a seat works from the keyboard and is shown with text, not color alone", async ({
    page,
  }) => {
    const pick = await pickMove();
    await page.goto(`/board?group=${pick.groupId}`);
    const button = card(page, pick.to.seatId).getByTestId("select-seat-button");
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`seat=${pick.to.seatId}`));
    await expect(button).toHaveText("Selected");
    await expect(button).toHaveAttribute("aria-pressed", "true");
    // Selecting it again clears the selection.
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(page).not.toHaveURL(/seat=/);
    await expect(button).toHaveText("Select");
  });
});

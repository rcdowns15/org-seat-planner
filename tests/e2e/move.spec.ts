import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { Client } from "pg";
import { requireLocalDatabaseUrl } from "../db/local-db";
import { ACTING_LEADER_COOKIE } from "../../src/lib/acting-as";
import { utcToday } from "../../src/lib/dates";

// Named demo fixtures (scripts/seed/README.md).
const DIVISION_LEADER = "100002"; // Savion Kshlerin, division Retail Banking Technology
const GROUP_LEADER = "100006"; // Anissa Predovic, group Digital Channels
const OUT_OF_SCOPE_OPEN_SEAT = 206; // open employee seat in Accounts and Cards

// The tests are independent without a reseed: each works in its own group, and picks its seats by
// query at run time (a worker who already moved just leaves a backfill seat behind), so a rerun
// against the same database still finds a worker and an open seat.
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
  from: { seatId: number; workerId: string; workerName: string };
  to: { seatId: number };
};

// In one group: an active employee in a filled seat of one squad, and an open or backfill
// employee seat in a different squad. Squads are taken in board order (name, then id).
async function pickMove(client: Client, groupId: number): Promise<Pick | null> {
  const seats = await client.query<{
    squad_id: number;
    seat_id: number;
    status: string;
    worker_id: string | null;
    first_name: string | null;
    last_name: string | null;
    worker_status: string | null;
  }>(
    `select q.squad_id, s.seat_id, s.status, s.worker_id, w.first_name, w.last_name,
            w.status as worker_status
     from app.seats s
     join app.squads q on q.squad_id = s.squad_id
     left join workday.workers w on w.worker_id = s.worker_id
     where q.group_id = $1 and s.seat_type = 'employee' and s.seat_id <> $2
     order by q.name, q.squad_id, s.seat_id`,
    [groupId, OUT_OF_SCOPE_OPEN_SEAT],
  );
  for (const src of seats.rows) {
    if (src.status !== "filled" || src.worker_status !== "active" || !src.worker_id) continue;
    const dest = seats.rows.find(
      (s) => s.squad_id !== src.squad_id && (s.status === "open" || s.status === "backfill"),
    );
    if (dest) {
      return {
        groupId,
        from: {
          seatId: src.seat_id,
          workerId: src.worker_id,
          workerName: `${src.first_name} ${src.last_name}`,
        },
        to: { seatId: dest.seat_id },
      };
    }
  }
  return null;
}

// The mutating tests work in the first non-demo group of the division leader's division that has
// a movable worker: never the demo group or the out-of-scope group, which board.spec.ts and the
// FORBIDDEN test read counts from, and no other spec file touches it. The tests in this file run
// one after another in one worker, and each picks its seats by query at run time, so reruns on the
// same database keep working.
async function pickInOwnGroup(): Promise<Pick> {
  const picks = await withDb(async (c) => {
    const groups = await c.query<{ group_id: number }>(
      `select g.group_id from app.groups g
       join app.leaders l on l.division_id = g.division_id
       where l.worker_id = $1 and g.name not in ('Digital Channels', 'Accounts and Cards')
       order by g.name`,
      [DIVISION_LEADER],
    );
    const found: Pick[] = [];
    for (const g of groups.rows) {
      const p = await pickMove(c, g.group_id);
      if (p) found.push(p);
    }
    return found;
  });
  expect(picks.length, "a non-demo group with a movable worker").toBeGreaterThan(0);
  return picks[0];
}

async function actAs(context: BrowserContext, baseURL: string, workerId: string) {
  const r = await withDb((c) =>
    c.query<{ leader_id: number }>("select leader_id from app.leaders where worker_id = $1", [
      workerId,
    ]),
  );
  await context.addCookies([
    { name: ACTING_LEADER_COOKIE, value: String(r.rows[0].leader_id), url: baseURL },
  ]);
}

async function changeCount(seatIds: number[]): Promise<number> {
  return withDb(async (c) => {
    const r = await c.query<{ n: string }>(
      "select count(*) n from app.seat_changes where seat_id = any($1::int[])",
      [seatIds],
    );
    return Number(r.rows[0].n);
  });
}

const card = (page: Page, seatId: number) => page.locator(`[data-seat-id="${seatId}"]`);

// A real pointer drag, which is what dnd-kit's PointerSensor listens to: press, move in steps
// past the activation distance, release over the target.
async function pointerDrag(page: Page, sourceSeatId: number, targetSeatId: number) {
  await card(page, sourceSeatId).scrollIntoViewIfNeeded();
  const s = (await card(page, sourceSeatId).boundingBox())!;
  const t = (await card(page, targetSeatId).boundingBox())!;
  await page.mouse.move(s.x + s.width / 2, s.y + 10);
  await page.mouse.down();
  await page.mouse.move(s.x + s.width / 2 + 12, s.y + 20, { steps: 4 });
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 12 });
  await page.mouse.up();
}

test.describe("drag-and-drop move", () => {
  // Big enough to show a whole group (squads side by side, all seats) with no scrolling mid-drag.
  test.use({ viewport: { width: 3200, height: 4000 } });

  test("division leader drags a worker to an open seat in another squad and saves", async ({
    page,
    context,
    baseURL,
  }) => {
    const pick = await pickInOwnGroup();
    const seatIds = [pick.from.seatId, pick.to.seatId];
    const before = await changeCount(seatIds);

    await actAs(context, baseURL!, DIVISION_LEADER);
    await page.goto(`/board?group=${pick.groupId}`);
    await expect(card(page, pick.from.seatId)).toHaveAttribute("data-draggable", "true");

    await pointerDrag(page, pick.from.seatId, pick.to.seatId);

    const dialog = page.getByTestId("move-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("move-who")).toContainText(pick.from.workerName);
    await expect(dialog.getByTestId("move-from")).toContainText(`seat ${pick.from.seatId}`);
    await expect(dialog.getByTestId("move-to")).toContainText(`seat ${pick.to.seatId}`);
    await expect(dialog.getByLabel("Effective date")).toHaveValue(utcToday());

    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();

    // The board refreshed: the worker is in the target seat; the source seat is now backfill.
    await expect(card(page, pick.to.seatId)).toHaveAttribute("data-state", "filled_employee");
    await expect(card(page, pick.to.seatId).getByTestId("seat-worker-name")).toHaveText(
      pick.from.workerName,
    );
    await expect(card(page, pick.from.seatId)).toHaveAttribute("data-state", "backfill");
    expect(await changeCount(seatIds)).toBe(before + 2);
  });

  test("Cancel closes the dialog and changes nothing", async ({ page, context, baseURL }) => {
    const pick = await pickInOwnGroup();
    const seatIds = [pick.from.seatId, pick.to.seatId];
    const before = await changeCount(seatIds);
    await actAs(context, baseURL!, DIVISION_LEADER);
    await page.goto(`/board?group=${pick.groupId}`);
    await pointerDrag(page, pick.from.seatId, pick.to.seatId);
    await page.getByTestId("move-dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("move-dialog")).toBeHidden();
    expect(await changeCount(seatIds)).toBe(before);
  });
});

test("Move to… completes a move with the keyboard only", async ({ page, context, baseURL }) => {
  const pick = await pickInOwnGroup();
  const seatIds = [pick.from.seatId, pick.to.seatId];
  const before = await changeCount(seatIds);

  await actAs(context, baseURL!, DIVISION_LEADER);
  await page.goto(`/board?group=${pick.groupId}`);

  // Keyboard from here: focus the button, open with Enter, choose a seat with the arrow keys,
  // Tab to Save and press Enter.
  await card(page, pick.from.seatId).getByTestId("move-to-button").focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByTestId("move-dialog");
  await expect(dialog).toBeVisible();

  const select = dialog.getByLabel("To", { exact: true });
  await expect(select).toBeFocused();
  const values = await select
    .locator("option")
    .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  const presses = values.indexOf(String(pick.to.seatId));
  expect(presses).toBeGreaterThan(0);
  for (let i = 0; i < presses; i++) await page.keyboard.press("ArrowDown");
  await expect(select).toHaveValue(String(pick.to.seatId));

  // Tab to Save. The date input has several tab stops (month, day, year), so press Tab until
  // Save has focus instead of counting stops.
  const save = dialog.getByRole("button", { name: "Save" });
  for (let i = 0; i < 10 && !(await save.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press("Tab");
  }
  await expect(save).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(dialog).toBeHidden();
  await expect(card(page, pick.to.seatId)).toHaveAttribute("data-state", "filled_employee");
  await expect(card(page, pick.to.seatId).getByTestId("seat-worker-name")).toHaveText(
    pick.from.workerName,
  );
  expect(await changeCount(seatIds)).toBe(before + 2);
});

test("group leader moving into a squad outside their group sees the FORBIDDEN message", async ({
  page,
  context,
  baseURL,
}) => {
  // The board shows one group, so a group leader can only reach another group's seats by looking
  // at that group's board. Cards there have no drag (it is outside their scope), but "Move to…"
  // is offered to any selected leader and the server is the one that says no.
  const setup = await withDb(async (c) => {
    const g = await c.query<{ group_id: number }>(
      `select q.group_id from app.seats s join app.squads q on q.squad_id = s.squad_id
       where s.seat_id = $1`,
      [OUT_OF_SCOPE_OPEN_SEAT],
    );
    const groupId = g.rows[0].group_id;
    const w = await c.query<{ seat_id: number; worker_id: string }>(
      `select s.seat_id, s.worker_id from app.seats s
       join app.squads q on q.squad_id = s.squad_id
       join workday.workers w on w.worker_id = s.worker_id
       where q.group_id = $1 and s.seat_type = 'employee' and s.status = 'filled'
         and w.status = 'active' order by s.seat_id limit 1`,
      [groupId],
    );
    return { groupId, source: w.rows[0] };
  });
  const seatIds = [setup.source.seat_id, OUT_OF_SCOPE_OPEN_SEAT];
  const before = await changeCount(seatIds);

  await actAs(context, baseURL!, GROUP_LEADER);
  await page.goto(`/board?group=${setup.groupId}`);
  // No drag on a board the leader can't edit.
  await expect(card(page, setup.source.seat_id)).not.toHaveAttribute("data-draggable", "true");

  await card(page, setup.source.seat_id).getByTestId("move-to-button").click();
  const dialog = page.getByTestId("move-dialog");
  await dialog.getByLabel("To", { exact: true }).selectOption(String(OUT_OF_SCOPE_OPEN_SEAT));
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(dialog.getByTestId("move-error")).toHaveText(
    "You do not have permission to edit both squads.",
  );
  // Board unchanged: dialog still open, seats as before, nothing written.
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(card(page, OUT_OF_SCOPE_OPEN_SEAT)).toHaveAttribute("data-state", "open");
  await expect(card(page, setup.source.seat_id)).toHaveAttribute("data-state", "filled_employee");
  expect(await changeCount(seatIds)).toBe(before);
});

test.describe("default group follows the acting leader", () => {
  async function shownGroup(page: Page): Promise<string> {
    await page.goto("/board");
    const text = (await page.locator("main > p").first().textContent())!;
    return text.split(" / ")[1].split(" (")[0];
  }

  test("a group leader opens on their own group", async ({ page, context, baseURL }) => {
    await actAs(context, baseURL!, GROUP_LEADER);
    expect(await shownGroup(page)).toBe("Digital Channels");
  });

  test("a division leader opens on the first group of their division", async ({
    page,
    context,
    baseURL,
  }) => {
    const first = await withDb((c) =>
      c.query<{ name: string }>(
        `select g.name from app.groups g join app.leaders l on l.division_id = g.division_id
         where l.worker_id = $1 order by g.name limit 1`,
        [DIVISION_LEADER],
      ),
    );
    await actAs(context, baseURL!, DIVISION_LEADER);
    expect(await shownGroup(page)).toBe(first.rows[0].name);
  });

  test("with no leader selected the board opens on the demo group", async ({ page }) => {
    expect(await shownGroup(page)).toBe("Digital Channels");
  });
});

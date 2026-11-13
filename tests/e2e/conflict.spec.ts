import { expect, test, type BrowserContext } from "@playwright/test";
import { Client } from "pg";
import { requireLocalDatabaseUrl } from "../db/local-db";
import { ACTING_LEADER_COOKIE } from "../../src/lib/acting-as";

// Needs DEMO_MODE=true in the dev server's environment (.env.local; see .env.example).

// Named demo fixtures (scripts/seed/README.md).
const DIVISION_LEADER = "100002"; // Savion Kshlerin, division Retail Banking Technology
const OUT_OF_SCOPE_OPEN_SEAT = 206; // open employee seat in Accounts and Cards

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
  from: { seatId: number; workerName: string };
  to: { seatId: number };
};

// In a non-demo group of the division leader's division: an active employee in a filled seat of
// one squad, and an open or backfill employee seat in another squad (picked at run time, so
// reruns on the same database keep working; the other specs use the same approach).
async function pickInOwnGroup(): Promise<Pick> {
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
        squad_id: number;
        seat_id: number;
        status: string;
        first_name: string | null;
        last_name: string | null;
        worker_status: string | null;
      }>(
        `select q.squad_id, s.seat_id, s.status, w.first_name, w.last_name,
                w.status as worker_status
         from app.seats s join app.squads q on q.squad_id = s.squad_id
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
            from: { seatId: src.seat_id, workerName: `${src.first_name} ${src.last_name}` },
            to: { seatId: dest.seat_id },
          };
        }
      }
    }
    throw new Error("no movable worker in a non-demo group");
  });
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

async function seatState(seatId: number) {
  return withDb(async (c) => {
    const seat = await c.query<{ version: number }>(
      "select version from app.seats where seat_id = $1",
      [seatId],
    );
    const touches = await c.query<{ n: string }>(
      "select count(*) n from app.seat_changes where seat_id = $1 and change_type = 'demo_touch'",
      [seatId],
    );
    return { version: seat.rows[0].version, touches: Number(touches.rows[0].n) };
  });
}

test("simulate another leader's edit on the target seat: Save conflicts, Refresh then Save succeeds", async ({
  page,
  context,
  baseURL,
}) => {
  const pick = await pickInOwnGroup();
  const before = await seatState(pick.to.seatId);

  await actAs(context, baseURL!, DIVISION_LEADER);
  await page.goto(`/board?group=${pick.groupId}`);
  await page.locator(`[data-seat-id="${pick.from.seatId}"]`).getByTestId("move-to-button").click();
  const dialog = page.getByTestId("move-dialog");
  const select = dialog.getByLabel("To", { exact: true });
  await select.selectOption(String(pick.to.seatId));

  // Another leader edits the target seat; the board on screen is now stale.
  await dialog.getByTestId("simulate-edit-dialog").click();
  await expect(dialog.getByTestId("simulate-message-dialog")).toContainText("edited seat");
  expect(await seatState(pick.to.seatId)).toEqual({
    version: before.version + 1,
    touches: before.touches + 1,
  });

  // Save now loses the optimistic lock.
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByTestId("move-error")).toHaveText(
    "This seat changed since you loaded it.",
  );

  // Refresh reloads the board and keeps the dialog's selection (the target is still open).
  await dialog.getByTestId("move-refresh").click();
  await expect(dialog.getByTestId("move-error")).toBeHidden();
  const save = dialog.getByRole("button", { name: "Save" });
  await expect(save).toBeEnabled();
  await expect(select).toHaveValue(String(pick.to.seatId));

  await save.click();
  await expect(dialog).toBeHidden();
  const target = page.locator(`[data-seat-id="${pick.to.seatId}"]`);
  await expect(target).toHaveAttribute("data-state", "filled_employee");
  await expect(target.getByTestId("seat-worker-name")).toHaveText(pick.from.workerName);
});

test("the demo toolbar simulates an edit on the selected seat", async ({
  page,
  context,
  baseURL,
}) => {
  const pick = await pickInOwnGroup();
  const before = await seatState(pick.to.seatId);
  await actAs(context, baseURL!, DIVISION_LEADER);
  await page.goto(`/board?group=${pick.groupId}`);

  const toolbar = page.getByTestId("demo-toolbar");
  await expect(toolbar).toContainText("Select a seat");
  await page
    .locator(`[data-seat-id="${pick.to.seatId}"]`)
    .getByTestId("select-seat-button")
    .click();
  await toolbar.getByTestId("simulate-edit-toolbar").click();
  await expect(toolbar.getByTestId("simulate-message-toolbar")).toContainText("edited seat");
  expect((await seatState(pick.to.seatId)).version).toBe(before.version + 1);
});

test("with no leader selected there is no Move to…, and simulate answers READ_ONLY", async ({
  page,
}) => {
  const pick = await pickInOwnGroup();
  await page.goto(`/board?group=${pick.groupId}`);
  await expect(page.getByTestId("board")).toBeVisible();
  await expect(page.getByTestId("move-to-button")).toHaveCount(0);
  // The toolbar is there (DEMO_MODE) but acting needs a leader: the server answers READ_ONLY.
  await page
    .locator(`[data-seat-id="${pick.to.seatId}"]`)
    .getByTestId("select-seat-button")
    .click();
  await page.getByTestId("simulate-edit-toolbar").click();
  await expect(page.getByTestId("simulate-message-toolbar")).toHaveText(
    "Choose a leader to act as before editing.",
  );
});

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { Client } from "pg";
import { requireLocalDatabaseUrl } from "../db/local-db";
import { ACTING_LEADER_COOKIE } from "../../src/lib/acting-as";
import { utcToday } from "../../src/lib/dates";

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

// Picked by query at run time (so reruns on the same database keep working): in a non-demo group
// of the division leader's division, an active employee in a filled seat and an open or backfill
// employee seat in a different squad.
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
        squad_id: number;
        seat_id: number;
        status: string;
        first_name: string | null;
        last_name: string | null;
        worker_status: string | null;
      }>(
        `select q.squad_id, s.seat_id, s.status, w.first_name, w.last_name, w.status as worker_status
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
            from: { seatId: src.seat_id, workerName: `${src.first_name} ${src.last_name}` },
            to: { seatId: dest.seat_id },
          };
        }
      }
    }
    throw new Error("no group with a movable worker");
  });
}

async function actAs(context: BrowserContext, baseURL: string, workerId: string): Promise<string> {
  const r = await withDb((c) =>
    c.query<{ leader_id: number; display_name: string }>(
      "select leader_id, display_name from app.leaders where worker_id = $1",
      [workerId],
    ),
  );
  await context.addCookies([
    { name: ACTING_LEADER_COOKIE, value: String(r.rows[0].leader_id), url: baseURL },
  ]);
  return r.rows[0].display_name;
}

const card = (page: Page, seatId: number) => page.locator(`[data-seat-id="${seatId}"]`);

test.describe("seat history panel", () => {
  test.use({ viewport: { width: 3200, height: 4000 } });

  test("after a move, both seats' history panels show it; Escape and Close dismiss the panel", async ({
    page,
    context,
    baseURL,
  }) => {
    const pick = await pickMove();
    const leaderName = await actAs(context, baseURL!, DIVISION_LEADER);
    await page.goto(`/board?group=${pick.groupId}`);
    await expect(page.getByTestId("seat-history-panel")).toBeHidden();

    // Move with the keyboard path, so this test doesn't depend on drag.
    await card(page, pick.from.seatId).getByTestId("move-to-button").click();
    const dialog = page.getByTestId("move-dialog");
    await dialog.getByLabel("To", { exact: true }).selectOption(String(pick.to.seatId));
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(card(page, pick.to.seatId)).toHaveAttribute("data-state", "filled_employee");

    const panel = page.getByTestId("seat-history-panel");

    // Source seat: the newest row is the move out. Before: the worker; after: backfill.
    await card(page, pick.from.seatId).getByTestId("select-seat-button").click();
    await expect(page).toHaveURL(new RegExp(`seat=${pick.from.seatId}`));
    await expect(panel).toContainText(`History of Seat ${pick.from.seatId}`);
    const out = panel.getByTestId("seat-history-entry").first();
    await expect(out.getByTestId("history-change-type")).toHaveText("Moved out");
    await expect(out.getByTestId("history-before-after")).toContainText(pick.from.workerName);
    await expect(out.getByTestId("history-before-after")).toContainText("Backfill");
    await expect(out.getByTestId("history-actor")).toHaveText(leaderName);
    await expect(out.getByTestId("history-effective")).toHaveText(utcToday());
    await expect(out.getByTestId("history-saved")).toContainText(utcToday());

    // Target seat: the newest row is the move in, with the same actor and date.
    await card(page, pick.to.seatId).getByTestId("select-seat-button").click();
    await expect(page).toHaveURL(new RegExp(`seat=${pick.to.seatId}`));
    await expect(panel).toContainText(`History of Seat ${pick.to.seatId}`);
    const into = panel.getByTestId("seat-history-entry").first();
    await expect(into.getByTestId("history-change-type")).toHaveText("Moved in");
    await expect(into.getByTestId("history-before-after")).toContainText(pick.from.workerName);
    await expect(into.getByTestId("history-actor")).toHaveText(leaderName);
    await expect(into.getByTestId("history-effective")).toHaveText(utcToday());

    // Escape closes the panel and clears the selection.
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(page).not.toHaveURL(/seat=/);

    // The Close button does the same.
    await card(page, pick.to.seatId).getByTestId("select-seat-button").click();
    await expect(panel).toBeVisible();
    await panel.getByTestId("seat-history-close").click();
    await expect(panel).toBeHidden();
    await expect(page).not.toHaveURL(/seat=/);
  });

  test("a seat with no changes says so", async ({ page }) => {
    const seatId = await withDb(async (c) => {
      const r = await c.query<{ seat_id: number }>(
        `select s.seat_id from app.seats s
         join app.squads q on q.squad_id = s.squad_id
         join app.groups g on g.group_id = q.group_id
         where g.name = 'Digital Channels'
           and not exists (select 1 from app.seat_changes c where c.seat_id = s.seat_id)
         order by s.seat_id limit 1`,
      );
      return r.rows[0].seat_id;
    });
    await page.goto(`/board?seat=${seatId}`);
    await expect(page.getByTestId("seat-history-empty")).toBeVisible();
  });

  test("dropping a dragged card does not select or deselect the source seat", async ({
    page,
    context,
    baseURL,
  }) => {
    const pick = await pickMove();
    await actAs(context, baseURL!, DIVISION_LEADER);
    await page.goto(`/board?group=${pick.groupId}`);
    const source = card(page, pick.from.seatId);
    await expect(source).toHaveAttribute("data-draggable", "true");
    await source.scrollIntoViewIfNeeded();

    // A real pointer drag onto the target seat. While dragging, the source card follows the
    // pointer, so the browser sends the click that follows the drop to the source card.
    const s = (await source.boundingBox())!;
    const t = (await card(page, pick.to.seatId).boundingBox())!;
    await page.mouse.move(s.x + s.width / 2, s.y + s.height - 4);
    await page.mouse.down();
    await page.mouse.move(s.x + s.width / 2 + 12, s.y + s.height + 6, { steps: 4 });
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 12 });
    await page.mouse.up();
    // dnd-kit usually swallows the click that follows a drop, and Playwright's mouse doesn't
    // always produce one, so send the click a browser may send, right after the drop.
    await source.dispatchEvent("click");

    const dialog = page.getByTestId("move-dialog");
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(500); // a wrongly-fired select would have changed the URL by now
    await expect(page).not.toHaveURL(/seat=/);
    await expect(source).not.toHaveAttribute("data-selected", "true");
    await dialog.getByRole("button", { name: "Cancel" }).click();

    // Same when the seat is already selected: the drop must not deselect it.
    await page.waitForTimeout(400);
    await source.getByTestId("select-seat-button").click();
    await expect(page).toHaveURL(new RegExp(`seat=${pick.from.seatId}`));
    const s2 = (await source.boundingBox())!;
    const t2 = (await card(page, pick.to.seatId).boundingBox())!;
    await page.mouse.move(s2.x + s2.width / 2, s2.y + s2.height - 4);
    await page.mouse.down();
    await page.mouse.move(s2.x + s2.width / 2 + 12, s2.y + s2.height + 6, { steps: 4 });
    await page.mouse.move(t2.x + t2.width / 2, t2.y + t2.height / 2, { steps: 12 });
    await page.mouse.up();
    await source.dispatchEvent("click");
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(new RegExp(`seat=${pick.from.seatId}`));
    await expect(source).toHaveAttribute("data-selected", "true");
    await dialog.getByRole("button", { name: "Cancel" }).click();
  });

  test("the Select button's accessible name starts with its visible text and describes the seat", async ({
    page,
  }) => {
    await page.goto("/board");
    const open = card(page, OUT_OF_SCOPE_OPEN_SEAT);
    // Seat 206 is in Accounts and Cards; open that group's board.
    const groupId = await withDb(async (c) => {
      const r = await c.query<{ group_id: number }>(
        `select q.group_id from app.seats s join app.squads q on q.squad_id = s.squad_id
         where s.seat_id = $1`,
        [OUT_OF_SCOPE_OPEN_SEAT],
      );
      return r.rows[0].group_id;
    });
    await page.goto(`/board?group=${groupId}`);
    const button = open.getByTestId("select-seat-button");
    await expect(button).toHaveText(/^Select/);
    await expect(button).toHaveAccessibleName("Select Seat 206, Open");
    await expect(page.getByRole("button", { name: "Select Seat 206, Open" })).toHaveCount(1);
    await button.click();
    await expect(button).toHaveAccessibleName("Selected Seat 206, Open");
  });
});

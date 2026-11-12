import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { requireLocalDatabaseUrl } from "../db/local-db";
import { CARD_STATES, cardStateLabel, type CardState } from "../../src/lib/seat-card";

// Ground truth, straight from SQL: the demo group is the group of fixture demo-group-leader.
async function sqlCounts() {
  const client = new Client({ connectionString: requireLocalDatabaseUrl() });
  await client.connect();
  try {
    const group = await client.query<{ group_id: number; name: string }>(
      `select g.group_id, g.name from app.leaders l join app.groups g on g.group_id = l.group_id
       where l.worker_id = $1`,
      ["100006"],
    );
    const groupId = group.rows[0].group_id;
    const squads = await client.query<{ n: string }>(
      "select count(*) n from app.squads where group_id = $1",
      [groupId],
    );
    const states = await client.query<{ state: CardState; n: string }>(
      `select case when s.status = 'filled' then 'filled_' || s.seat_type else s.status end as state,
              count(*) n
       from app.seats s join app.squads q on q.squad_id = s.squad_id
       where q.group_id = $1 group by 1`,
      [groupId],
    );
    const perState = Object.fromEntries(CARD_STATES.map((s) => [s, 0])) as Record<
      CardState,
      number
    >;
    for (const r of states.rows) perState[r.state] = Number(r.n);
    return { groupName: group.rows[0].name, squads: Number(squads.rows[0].n), perState };
  } finally {
    await client.end();
  }
}

test("default board shows the demo group: squad count and per-state card counts match SQL", async ({
  page,
}) => {
  const expected = await sqlCounts();
  expect(expected.groupName).toBe("Digital Channels");
  await page.goto("/board");

  await expect(page.getByTestId("squad-column")).toHaveCount(expected.squads);
  for (const state of CARD_STATES) {
    expect(expected.perState[state], `demo group has ${state} seats`).toBeGreaterThan(0);
    await expect(page.locator(`[data-testid="seat-card"][data-state="${state}"]`)).toHaveCount(
      expected.perState[state],
    );
  }
});

test("every one of the five states renders its own text label", async ({ page }) => {
  await page.goto("/board");
  for (const state of CARD_STATES) {
    const card = page.locator(`[data-testid="seat-card"][data-state="${state}"]`).first();
    await expect(card.getByTestId("seat-state-label")).toHaveText(cardStateLabel(state));
  }
});

test("filled cards show name and title; squad header shows filled / approved", async ({ page }) => {
  await page.goto("/board");
  const filled = page.locator('[data-testid="seat-card"][data-state="filled_employee"]').first();
  await expect(filled.getByTestId("seat-worker-name")).not.toBeEmpty();
  await expect(filled.getByTestId("seat-job-title")).not.toBeEmpty();
  await expect(page.getByTestId("squad-fill").first()).toHaveText(/^\d+ \/ \d+ seats filled$/);
});

test("?group= selects another group; an unknown group is a 404", async ({ page }) => {
  await page.goto("/board");
  const other = page.getByRole("navigation", { name: "Choose a group" }).getByRole("link").first();
  const name = (await other.textContent())!;
  await other.click();
  await expect(page).toHaveURL(/\/board\?group=\d+/);
  await expect(page.getByText(`/ ${name} (read-only)`)).toBeVisible();

  const res = await page.goto("/board?group=999999");
  expect(res?.status()).toBe(404);
});

test("a malformed group id is a 404", async ({ page }) => {
  for (const bad of ["abc", "0"]) {
    const res = await page.goto(`/board?group=${bad}`);
    expect(res?.status()).toBe(404);
  }
});

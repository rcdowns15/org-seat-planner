import { expect, test } from "@playwright/test";

test("home page shows the app heading", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Org Seat Planner · Second Republic Bank (fictional)",
  );
});

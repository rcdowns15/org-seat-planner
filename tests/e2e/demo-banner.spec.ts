import { expect, test } from "@playwright/test";

// The dev server started by playwright.config.ts loads .env.local, where DEMO_MODE=true.
// Every route in src/app (home, board, sql) shows the banner, because it lives in the root layout.
for (const path of ["/", "/board", "/sql"]) {
  test(`the fictional-data banner and reset button are visible on ${path}`, async ({ page }) => {
    await page.goto(path);
    const banner = page.getByTestId("demo-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Second Republic Bank is fictional; all data is generated.");
    await expect(banner.getByRole("button", { name: "Reset demo data" })).toBeVisible();
  });
}

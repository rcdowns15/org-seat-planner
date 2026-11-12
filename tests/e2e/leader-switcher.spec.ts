import { expect, test } from "@playwright/test";

test("the acting-as selection persists across reloads and clears on Read-only", async ({
  page,
}) => {
  await page.goto("/");
  const select = page.getByLabel("Acting as");
  await expect(select).toHaveValue("");

  // The demo group leader (scripts/seed/README.md: demo-group-leader).
  const groupLeader = select.locator("option", { hasText: "Anissa Predovic" });
  const value = await groupLeader.getAttribute("value");
  await select.selectOption(value!);
  await expect(select).toHaveValue(value!);

  await page.reload();
  await expect(page.getByLabel("Acting as")).toHaveValue(value!);

  await page.getByLabel("Acting as").selectOption({ label: "Read-only (no leader)" });
  await expect(page.getByLabel("Acting as")).toHaveValue("");
  await page.reload();
  await expect(page.getByLabel("Acting as")).toHaveValue("");
});

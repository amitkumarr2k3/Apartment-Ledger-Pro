import { navSections } from "../src/lib/finance-mock";
import { expect, mockApi, signIn, test } from "./fixtures";

// Every page in the navigation must load and render without crashing, so new pages are covered automatically.
const residentPages = navSections.filter((s) => s.tone === "resident").flatMap((s) => s.items);
const adminPages = navSections.filter((s) => s.tone === "admin").flatMap((s) => s.items);

test.describe("resident pages load", () => {
  for (const item of residentPages) {
    test(`${item.label} (${item.to})`, async ({ page }) => {
      await mockApi(page);
      await signIn(page, "resident");
      await page.goto(item.to);
      await expect(page).toHaveURL(new RegExp(`${item.to}(\\?|$)`));
      await expect(page.locator("main")).not.toContainText("Loading dashboards...");
      await expect(page.locator("main")).not.toContainText(/Something went wrong|Application error/i);
    });
  }
});

test.describe("admin pages load", () => {
  for (const item of adminPages) {
    test(`${item.label} (${item.to})`, async ({ page }) => {
      await mockApi(page);
      await signIn(page, "superadmin");
      await page.goto(item.to);
      await expect(page).toHaveURL(new RegExp(`${item.to}(\\?|$)`));
      await expect(page.locator("main")).not.toContainText(/Something went wrong|Application error/i);
    });
  }
});

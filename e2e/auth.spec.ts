import { expect, mockApi, signIn, test } from "./fixtures";

test.describe("authentication and access", () => {
  test.describe("signed out", () => {
    // Known: the server renders the page, then the client-only guard redirects to /login; React recovers (#418/#422/#520).
    test.use({ allowedPageErrors: [/Minified React error #(418|422|520)\b/] });

    test("anonymous visitors are sent to login", async ({ page }) => {
      await mockApi(page);
      await page.goto("/resident/overview");
      await expect(page).toHaveURL(/\/login/);
      await expect(page.getByRole("button", { name: "Send OTP" })).toBeVisible();
    });
  });

  test("residents cannot open admin screens", async ({ page }) => {
    await mockApi(page);
    await signIn(page, "resident");
    await page.goto("/admin/settings");
    await expect(page).toHaveURL(/\/resident\/overview/);
  });

  test("plain admins cannot open admin controls", async ({ page }) => {
    await mockApi(page);
    await signIn(page, "admin");
    await page.goto("/admin/settings");
    await expect(page).toHaveURL(/\/resident\/overview/);
  });

  test("residents only see resident navigation", async ({ page }) => {
    await mockApi(page);
    await signIn(page, "resident");
    await page.goto("/resident/overview");
    const sidebar = page.locator("aside");
    await expect(sidebar.getByRole("link", { name: /Overview/ })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: /Action Needed/ })).toHaveCount(0);
    await expect(sidebar.getByRole("link", { name: /Dashboard Controls/ })).toHaveCount(0);
  });
});

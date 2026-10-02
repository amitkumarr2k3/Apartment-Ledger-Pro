import { allResidentDashboards, expect, mockApi, signIn, test, withSetting, type DashboardSetting } from "./fixtures";

// Dashboard Controls restrict residents only; admins and superadmins always see every resident dashboard and widget.
const everythingHidden: DashboardSetting[] = allResidentDashboards(false).map((row) => ({
  ...row,
  hidden_widgets: [
    "overview.summaryHeadline", "overview.summaryNet",
    "cashflow.summaryCards", "cashflow.performanceVsTarget", "cashflow.monthlyTrendChart",
    "income.sourcesBreakdown", "income.expenseRatio",
  ],
}));

const residentLinks = ["Overview", "Head Drill-down", "Cashflow Health", "Income Visibility", "Opening & Closing", "Forecasting"];

for (const role of ["admin", "superadmin"] as const) {
  test.describe(`${role} is not affected by Dashboard Controls`, () => {
    test("sees every resident dashboard in navigation", async ({ page }) => {
      await mockApi(page, everythingHidden);
      await signIn(page, role);
      await page.goto("/resident/overview");

      const residentSection = page.locator("aside nav > div").filter({ hasText: /^.*Resident/ }).first();
      for (const label of residentLinks) {
        await expect(residentSection.getByRole("link", { name: new RegExp(`^\\W*${label}$`) })).toBeVisible();
      }
    });

    test("can open a dashboard that is disabled for residents", async ({ page }) => {
      await mockApi(page, everythingHidden);
      await signIn(page, role);
      await page.goto("/resident/cashflow");
      await expect(page).toHaveURL(/\/resident\/cashflow/);
      await expect(page.getByText("Surplus months")).toBeVisible();
      await expect(page.getByText(/Monthly trend/)).toBeVisible();
    });

    test("sees widgets that are hidden for residents", async ({ page }) => {
      await mockApi(page, everythingHidden);
      await signIn(page, role);
      await page.goto("/resident/income");
      await expect(page.getByText("Income sources", { exact: true })).toBeVisible();
      await expect(page.getByText("Same calculation as overview")).toBeVisible();
    });

    test("Overview shows all tabs and summary blocks", async ({ page }) => {
      await mockApi(page, everythingHidden);
      await signIn(page, role);
      await page.goto("/resident/overview");
      await expect(page.getByText(/At a glance/)).toBeVisible();
      for (const tab of [/Summary/, /Collections/, /Reserves/, /Audited Report/]) {
        await expect(page.getByRole("tab", { name: tab })).toBeVisible();
      }
    });
  });

  test.describe(`${role} moves between resident and admin views`, () => {
    test("persona switch goes to admin and back", async ({ page }) => {
      await mockApi(page, everythingHidden);
      await signIn(page, role);
      await page.goto("/resident/overview");

      const sidebar = page.locator("aside");
      await sidebar.getByRole("radio", { name: /Admin/ }).click();
      await expect(page).toHaveURL(/\/admin\//);

      await sidebar.getByRole("radio", { name: /Resident/ }).click();
      await expect(page).toHaveURL(/\/resident\//);

      await sidebar.getByRole("radio", { name: /Admin/ }).click();
      await expect(page).toHaveURL(/\/admin\//);
    });

    test("admin dashboard links work from a resident page", async ({ page }) => {
      await mockApi(page, everythingHidden);
      await signIn(page, role);
      await page.goto("/resident/forecasting");

      await page.locator("aside").getByRole("link", { name: /Vendor Insights/ }).click();
      await expect(page).toHaveURL(/\/admin\/vendors/);

      await page.locator("aside").getByRole("link", { name: /Forecasting/ }).click();
      await expect(page).toHaveURL(/\/resident\/forecasting/);
    });

    test("Dashboard home lands on the admin area", async ({ page }) => {
      await mockApi(page);
      await signIn(page, role);
      await page.goto("/resident/overview");
      await page.getByRole("link", { name: "Dashboard home" }).click();
      await expect(page).toHaveURL(/\/admin\/actions/);
    });
  });
}

test.describe("admin controls are superadmin-only", () => {
  const controls = ["/admin/settings", "/admin/transactions", "/admin/residents", "/admin/audit", "/admin/imports", "/admin/etl"];

  for (const role of ["resident", "admin"] as const) {
    test(`${role} sees no Admin Controls navigation`, async ({ page }) => {
      await mockApi(page);
      await signIn(page, role);
      await page.goto("/resident/overview");
      await expect(page.locator("aside").getByText("Admin · Controls")).toHaveCount(0);
      await expect(page.locator("aside").getByRole("link", { name: /Dashboard Controls/ })).toHaveCount(0);
    });

    for (const path of controls) {
      test(`${role} is redirected away from ${path}`, async ({ page }) => {
        await mockApi(page);
        await signIn(page, role);
        await page.goto(path);
        await expect(page).not.toHaveURL(new RegExp(`${path}(\\?|$)`));
      });
    }
  }

  test("superadmin sees and opens Admin Controls", async ({ page }) => {
    await mockApi(page);
    await signIn(page, "superadmin");
    await page.goto("/admin/actions");
    await page.locator("aside").getByRole("link", { name: /Dashboard Controls/ }).click();
    await expect(page).toHaveURL(/\/admin\/settings/);
  });

  test("residents never see admin dashboards or the persona switch", async ({ page }) => {
    await mockApi(page);
    await signIn(page, "resident");
    await page.goto("/resident/overview");
    await expect(page.locator("aside").getByRole("link", { name: /Action Needed/ })).toHaveCount(0);
    await expect(page.locator("aside").getByRole("radio", { name: /Admin/ })).toHaveCount(0);
  });

  test("residents are still restricted when admins are not", async ({ page }) => {
    await mockApi(page, withSetting(allResidentDashboards(), "resident.cashflow", { enabled: false }));
    await signIn(page, "resident");
    await page.goto("/resident/cashflow");
    await expect(page).toHaveURL(/\/resident\/overview/);
  });
});

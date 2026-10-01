import { allResidentDashboards, expect, mockApi, signIn, test, withSetting } from "./fixtures";

test.describe("dashboard controls: whole dashboards", () => {
  test("disabled dashboards disappear from resident navigation", async ({ page }) => {
    let settings = withSetting(allResidentDashboards(), "resident.cashflow", { enabled: false });
    settings = withSetting(settings, "resident.forecasting", { enabled: false });
    await mockApi(page, settings);
    await signIn(page, "resident");
    await page.goto("/resident/overview");

    const sidebar = page.locator("aside");
    await expect(sidebar.getByRole("link", { name: /Income Visibility/ })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: /Cashflow Health/ })).toHaveCount(0);
    await expect(sidebar.getByRole("link", { name: /Forecasting/ })).toHaveCount(0);
  });

  test("opening a disabled dashboard by URL redirects to an enabled one", async ({ page }) => {
    await mockApi(page, withSetting(allResidentDashboards(), "resident.balance", { enabled: false }));
    await signIn(page, "resident");
    await page.goto("/resident/balance");
    await expect(page).toHaveURL(/\/resident\/overview/);
  });

  test("a disabled first dashboard redirects to the next enabled dashboard", async ({ page }) => {
    await mockApi(page, withSetting(allResidentDashboards(), "resident.overview", { enabled: false }));
    await signIn(page, "resident");
    await page.goto("/resident/overview");
    await expect(page).toHaveURL(/\/resident\/drilldown/);
  });

  test("with every dashboard disabled, residents see a clear message instead of empty pages", async ({ page }) => {
    await mockApi(page, allResidentDashboards(false));
    await signIn(page, "resident");
    await page.goto("/resident/forecasting");
    await expect(page.locator("main")).toContainText("No resident dashboards are available.");
  });

  test("admin preview follows the same resident visibility", async ({ page }) => {
    await mockApi(page, withSetting(allResidentDashboards(), "resident.income", { enabled: false }));
    await signIn(page, "superadmin");
    await page.goto("/resident/income");
    await expect(page).toHaveURL(/\/resident\/overview/);
  });
});

test.describe("dashboard controls: individual widgets", () => {
  test("Cashflow Health hides only the switched-off widgets", async ({ page }) => {
    await mockApi(page, withSetting(allResidentDashboards(), "resident.cashflow", { hidden_widgets: ["cashflow.summaryCards"] }));
    await signIn(page, "resident");
    await page.goto("/resident/cashflow");

    await expect(page.getByText("Collection performance vs target")).toBeVisible();
    await expect(page.getByText(/Monthly trend/)).toBeVisible();
    await expect(page.getByText("Surplus months")).toHaveCount(0);
    await expect(page.getByText("Deficit months")).toHaveCount(0);
  });

  test("Income Visibility hides only the switched-off widgets", async ({ page }) => {
    await mockApi(page, withSetting(allResidentDashboards(), "resident.income", {
      hidden_widgets: ["income.sourcesBreakdown", "income.recoveryRateTrend"],
    }));
    await signIn(page, "resident");
    await page.goto("/resident/income");

    await expect(page.getByText("Same calculation as overview")).toBeVisible();
    await expect(page.getByText("Collected vs Outstanding Receivables")).toBeVisible();
    await expect(page.getByText("Income sources", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Recovery rate trend")).toHaveCount(0);
  });

  test("Overview summary blocks follow their switches", async ({ page }) => {
    await mockApi(page, withSetting(allResidentDashboards(), "resident.overview", {
      hidden_widgets: ["overview.summaryHeadline", "overview.summaryCollection"],
    }));
    await signIn(page, "resident");
    await page.goto("/resident/overview");

    await expect(page.getByText("Net Position")).toBeVisible();
    await expect(page.getByText(/At a glance/)).toHaveCount(0);
    await expect(page.getByText("Collection Progress")).toHaveCount(0);
  });

  test("Overview hides tabs whose widgets are all switched off", async ({ page }) => {
    await mockApi(page, withSetting(allResidentDashboards(), "resident.overview", {
      hidden_widgets: ["overview.auditedReport", "overview.financialStrength"],
    }));
    await signIn(page, "resident");
    await page.goto("/resident/overview");

    await expect(page.getByRole("tab", { name: /Summary/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Audited Report/ })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: /Reserves/ })).toHaveCount(0);
  });
});

test.describe("dashboard controls: admin screen", () => {
  function dashboardSwitch(page: import("@playwright/test").Page, key: string) {
    return page.getByText(key, { exact: true })
      .locator("xpath=ancestor::div[.//button[@role='switch']][1]")
      .getByRole("switch")
      .first();
  }

  test("saving a disabled dashboard sends it to the API", async ({ page }) => {
    const api = await mockApi(page, allResidentDashboards());
    await signIn(page, "superadmin");
    await page.goto("/admin/settings");

    await dashboardSwitch(page, "resident.cashflow").click();
    await page.getByRole("button", { name: /Save changes/ }).click();

    await expect.poll(() => api.patches.length).toBe(1);
    const saved = api.patches[0].find((row) => row.dashboard_key === "resident.cashflow");
    expect(saved?.enabled).toBe(false);
    expect(api.patches[0]).toHaveLength(6);
  });

  test("disabling a dashboard shows its widget switches as off and locked", async ({ page }) => {
    await mockApi(page, withSetting(allResidentDashboards(), "resident.forecasting", { enabled: false }));
    await signIn(page, "superadmin");
    await page.goto("/admin/settings");

    const widgetSwitch = page.getByText("forecasting.kpiTiles", { exact: true })
      .locator("xpath=ancestor::li[1]")
      .getByRole("switch");
    await expect(widgetSwitch).toHaveAttribute("aria-checked", "false");
    await expect(widgetSwitch).toBeDisabled();
  });

  test("hiding a widget saves its id", async ({ page }) => {
    const api = await mockApi(page, allResidentDashboards());
    await signIn(page, "superadmin");
    await page.goto("/admin/settings");

    await page.getByText("income.recoveryRateTrend", { exact: true }).locator("xpath=ancestor::li[1]").getByRole("switch").click();
    await page.getByRole("button", { name: /Save changes/ }).click();

    await expect.poll(() => api.patches.length).toBe(1);
    const saved = api.patches[0].find((row) => row.dashboard_key === "resident.income");
    expect(saved?.hidden_widgets).toEqual(["income.recoveryRateTrend"]);
  });
});

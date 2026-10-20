import { test, expect, mockApi, signIn, fixtures, type Role } from "./fixtures";

const originalName = "One Time Operational Procurement";
const renamed = "Ad Hoc Operations Purchases";
const uploadedProcurementRows = [
  { month: "2026-04-01", category: originalName, vendor: "Individual", vendor_kind: "internal", line_item: originalName, amount: "7403800" },
  { month: "2026-07-01", category: originalName, vendor: "Individual", vendor_kind: "internal", line_item: originalName, amount: "13986400" },
  { month: "2026-08-01", category: originalName, vendor: "Individual", vendor_kind: "internal", line_item: originalName, amount: "15597000" },
];
const pettyCashFixture = {
  month: "2026-08-01", category: "Petty Cash", vendor: "Petty Cash", vendor_kind: "internal",
  line_item: "Petty Cash - Consumables", amount: "740200",
};

test("uploaded procurement rows stay visible as their own category and show info at line-item level", async ({ page }) => {
  await signIn(page, "admin");
  await mockApi(page);
  await page.route("**/api/admin/settings/expense-info", (route) => route.fulfill({
    json: { procurementNames: [originalName] },
  }));
  await page.route("**/api/expenses/tree", (route) => route.fulfill({
    json: [...fixtures.expenseTree, pettyCashFixture, ...uploadedProcurementRows],
  }));

  await page.goto("/admin/drilldown?head=expense");
  const category = page.getByRole("button", { name: new RegExp(`${originalName} 1 vendor`) });
  await expect(category).toBeVisible();
  await expect(category).toContainText("₹3,69,872");
  await expect(page.getByRole("button", { name: /Petty Cash/ })).toBeVisible();

  await category.click();
  await page.getByRole("button", { name: /Individual/ }).click();
  const lineInfo = page.getByRole("button", { name: `About ${originalName}`, exact: true }).last();
  await expect(lineInfo).toBeVisible();
  await lineInfo.click();
  await expect(page.getByRole("dialog")).toContainText("Unexpected, non-recurring purchases");
  await expect(page).toHaveURL(/category=One\+Time\+Operational\+Procurement/);
});

test("mapped procurement name shows info when it is a vendor", async ({ page }) => {
  await signIn(page, "admin");
  await mockApi(page);
  await page.route("**/api/admin/settings/expense-info", (route) => route.fulfill({
    json: { procurementNames: [originalName] },
  }));
  await page.route("**/api/expenses/tree", (route) => route.fulfill({
    json: [
      { month: "2026-08-01", category: "Petty Cash", vendor: originalName, vendor_kind: "internal", line_item: "One-off purchase", amount: "740200" },
    ],
  }));

  await page.goto("/admin/drilldown?head=expense");
  await page.getByRole("button", { name: /Petty Cash 1 vendor/ }).click();
  const vendorInfo = page.getByRole("button", { name: `About ${originalName}`, exact: true }).last();
  await expect(vendorInfo).toBeVisible();
  await vendorInfo.click();
  await expect(page.getByRole("dialog")).toContainText("Unexpected, non-recurring purchases");
});

for (const role of ["resident", "admin", "superadmin"] as Role[]) {
  for (const name of [originalName, renamed]) {
    test(`${role} sees procurement explanation for ${name}`, async ({ page }) => {
      await signIn(page, role);
      await mockApi(page);
      await page.route("**/api/admin/settings/expense-info", (route) => route.fulfill({
        json: { procurementNames: [originalName, renamed] },
      }));
      await page.route("**/api/expenses/tree", (route) => route.fulfill({
        json: fixtures.expenseTree.map((row) => ({ ...row, category: name })),
      }));
      const persona = role === "resident" ? "resident" : "admin";
      await page.goto(`/${persona}/drilldown?head=expense`);
      const info = page.getByRole("button", { name: `About ${name}`, exact: true });
      await expect(info).toBeVisible();
      await info.click();
      await expect(page).toHaveURL(/head=expense$/);
      await expect(page.getByText("Unexpected, non-recurring purchases", { exact: false })).toBeVisible();
      await expect(page.getByText("Contact the Treasurer", { exact: false })).toBeVisible();
      const faq = page.getByRole("link", { name: "Read the user manual FAQ" });
      await expect(faq).toHaveAttribute("href", `/dashboard-user-guide-${persona}.html#one-time-operational-procurement`);
      const [manual] = await Promise.all([page.waitForEvent("popup"), faq.click()]);
      const answer = manual.locator("#one-time-operational-procurement");
      await expect(answer).toBeVisible();
      await expect(answer.locator("summary")).toContainText("What is One Time Operational Procurement");
      await expect(answer).toContainText("Treasurer");
      await expect(answer).toContainText("gardening pipes");
      await expect(answer).toContainText("recurring expense head");
    });
  }
}

test("unmapped category does not receive procurement explanation", async ({ page }) => {
  await signIn(page, "resident");
  await mockApi(page);
  await page.route("**/api/admin/settings/expense-info", (route) => route.fulfill({
    json: { procurementNames: [renamed] },
  }));
  await page.goto("/resident/drilldown?head=expense");
  await expect(page.getByText("Utilities", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^About / })).toHaveCount(0);
});

test("account switch refetches mapping instead of retaining the prior community cache", async ({ page }) => {
  await signIn(page, "resident");
  await mockApi(page);
  let names = [originalName];
  let reads = 0;
  await page.route("**/api/admin/settings/expense-info", (route) => {
    reads += 1;
    return route.fulfill({ json: { procurementNames: names } });
  });
  await page.route("**/api/expenses/tree", (route) => route.fulfill({
    json: fixtures.expenseTree.map((row) => ({ ...row, category: originalName })),
  }));
  await page.goto("/resident/drilldown?head=expense");
  const info = page.getByRole("button", { name: `About ${originalName}`, exact: true });
  await expect(info).toBeVisible();
  await expect.poll(() => reads).toBeGreaterThan(0);
  const previousReads = reads;
  names = [renamed];
  await page.evaluate(() => {
    localStorage.setItem("apf.session", JSON.stringify({
      email: "another-community@example.com", name: "Another resident", role: "resident", issuedAt: Date.now(),
    }));
    window.dispatchEvent(new StorageEvent("storage", { key: "apf.session" }));
  });
  await expect.poll(() => reads).toBeGreaterThan(previousReads);
  await expect(info).toHaveCount(0);
});

test("superadmin saves a renamed category and sees its icon after navigation", async ({ page }) => {
  await signIn(page, "superadmin");
  await mockApi(page);
  let procurementNames = [originalName];
  await page.route("**/api/admin/settings/expense-info", async (route) => {
    if (route.request().method() === "PATCH") {
      procurementNames = route.request().postDataJSON().procurementNames;
    }
    await route.fulfill({ json: { procurementNames } });
  });
  await page.route("**/api/expenses/tree", (route) => route.fulfill({
    json: fixtures.expenseTree.map((row) => ({ ...row, category: renamed })),
  }));
  await page.goto("/admin/settings");
  await page.getByLabel("Uploaded category", { exact: true }).selectOption(renamed);
  await page.getByRole("button", { name: "Add category", exact: true }).click();
  await page.getByRole("button", { name: "Save procurement names", exact: true }).click();
  await expect(page.getByText("Procurement category names saved.", { exact: true })).toBeVisible();
  expect(procurementNames).toEqual([originalName, renamed]);
  await page.goto("/admin/drilldown?head=expense");
  await expect(page.getByRole("button", { name: `About ${renamed}`, exact: true })).toBeVisible();
});

test("failed mapping save keeps the draft and reports the failure", async ({ page }) => {
  await signIn(page, "superadmin");
  await mockApi(page);
  await page.route("**/api/admin/settings/expense-info", (route) => route.fulfill(
    route.request().method() === "PATCH"
      ? { status: 500, json: { error: "Save failed" } }
      : { json: { procurementNames: [originalName] } },
  ));
  await page.goto("/admin/settings");
  const input = page.getByLabel("Category names (one per line)", { exact: true });
  await input.fill(renamed);
  await page.getByRole("button", { name: "Save procurement names", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Names could not be saved" })).toBeVisible();
  await expect(input).toHaveValue(renamed);
});

for (const width of [390, 1440]) {
  test(`procurement popup fits a ${width}px viewport`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page, "resident");
    await mockApi(page);
    await page.route("**/api/expenses/tree", (route) => route.fulfill({
      json: fixtures.expenseTree.map((row) => ({ ...row, category: originalName })),
    }));
    await page.goto("/resident/drilldown?head=expense");
    const info = page.getByRole("button", { name: `About ${originalName}`, exact: true });
    await info.focus();
    await info.press("Enter");
    const popup = page.getByRole("dialog");
    await expect(popup).toBeVisible();
    const bounds = await popup.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`procurement-${width}.png`), fullPage: true });
    await page.keyboard.press("Escape");
    await expect(popup).not.toBeVisible();
    await expect(info).toBeFocused();
  });
}
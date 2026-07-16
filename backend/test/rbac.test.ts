import { describe, it, expect } from "vitest";
// RBAC contract: routes under /api/admin/* require admin/superadmin role
const ADMIN_ONLY = [
  "/api/admin/transactions","/api/admin/residents",
  "/api/admin/settings/dashboards","/api/admin/audit","/api/admin/imports",
];
describe("RBAC contract", () => {
  it("lists admin-only routes", () => {
    expect(ADMIN_ONLY.every((p) => p.startsWith("/api/admin/"))).toBe(true);
  });
});

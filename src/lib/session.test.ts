import { describe, expect, it } from "vitest";
import { navSections } from "./finance-mock";
import { applySessionFromAuthResponse, canAccess, isAdminOrAbove } from "./session";

describe("canAccess", () => {
  it("blocks signed-out users", () => {
    expect(canAccess("/resident/overview", null)).toBe(false);
  });

  it("lets every role view resident dashboards", () => {
    for (const role of ["resident", "admin", "superadmin"] as const) {
      expect(canAccess("/resident/overview", role)).toBe(true);
      expect(canAccess("/resident/forecasting", role)).toBe(true);
    }
  });

  it("keeps residents out of admin dashboards", () => {
    expect(canAccess("/admin/actions", "resident")).toBe(false);
    expect(canAccess("/admin/actions", "admin")).toBe(true);
    expect(canAccess("/admin/actions", "superadmin")).toBe(true);
  });

  it("reserves admin controls for superadmin", () => {
    for (const path of ["/admin/settings", "/admin/transactions", "/admin/residents", "/admin/audit"]) {
      expect(canAccess(path, "resident")).toBe(false);
      expect(canAccess(path, "admin")).toBe(false);
      expect(canAccess(path, "superadmin")).toBe(true);
    }
  });

  it("reserves every Admin Controls navigation page for superadmin", () => {
    const controls = navSections.filter((s) => s.group === "controls").flatMap((s) => s.items);
    expect(controls.length).toBeGreaterThan(0);
    for (const { to } of controls) {
      expect(canAccess(to, "resident"), to).toBe(false);
      expect(canAccess(to, "admin"), to).toBe(false);
      expect(canAccess(to, "superadmin"), to).toBe(true);
    }
  });

  it("lets admins and superadmins open every admin dashboard, but not residents", () => {
    const dashboards = navSections.filter((s) => s.tone === "admin" && s.group === "dashboards").flatMap((s) => s.items);
    for (const { to } of dashboards) {
      expect(canAccess(to, "resident"), to).toBe(false);
      expect(canAccess(to, "admin"), to).toBe(true);
      expect(canAccess(to, "superadmin"), to).toBe(true);
    }
  });
});

describe("applySessionFromAuthResponse", () => {
  it("maps the highest backend role", () => {
    expect(applySessionFromAuthResponse({ email: "A@X.com", roles: ["admin", "superadmin"] }).role).toBe("superadmin");
    expect(applySessionFromAuthResponse({ email: "a@x.com", roles: ["admin"] }).role).toBe("admin");
    expect(applySessionFromAuthResponse({ email: "a@x.com", roles: [] }).role).toBe("resident");
  });

  it("parses Postgres array-literal roles", () => {
    const session = applySessionFromAuthResponse({ email: "A@X.com", roles: "{superadmin,admin}" as unknown as string[] });
    expect(session.role).toBe("superadmin");
    expect(session.email).toBe("a@x.com");
  });

  it("keeps the flat code from either response shape", () => {
    expect(applySessionFromAuthResponse({ email: "a@x.com", flatCode: "C-G11" }).flatCode).toBe("C-G11");
    expect(applySessionFromAuthResponse({ email: "a@x.com", flat_code: "B-101" }).flatCode).toBe("B-101");
  });
});

describe("isAdminOrAbove", () => {
  it("treats superadmin as admin", () => {
    expect(isAdminOrAbove("superadmin")).toBe(true);
    expect(isAdminOrAbove("admin")).toBe(true);
    expect(isAdminOrAbove("resident")).toBe(false);
    expect(isAdminOrAbove(null)).toBe(false);
  });
});

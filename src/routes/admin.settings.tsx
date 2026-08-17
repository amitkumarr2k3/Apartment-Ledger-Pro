import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PortalShell } from "@/components/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useDashboardSettings, saveDashboardSettings, type DashboardSettingRow } from "@/lib/hooks";
import { Eye, EyeOff, Save, ExternalLink, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/settings")({
  component: Page,
  head: () => ({ meta: [{ title: "Admin \u00B7 Dashboard Controls" }] }),
});

// FIX (2026-08-15): this whole page used to run on seedDashboardControls
// (hardcoded mock data), and "Save changes" never called any API -- toggles
// only mutated local state and vanished on refresh. It's now wired to the
// real GET/PATCH /api/admin/settings/dashboards endpoints.
//
// The widget IDs below are REAL -- they correspond to actual cards in the
// resident pages (verified by reading resident.overview.tsx,
// resident.cashflow.tsx, and resident.income.tsx in full), not the
// fictional "kpi.collections" / "chart.trend" style IDs the old mock data
// used, which matched nothing any resident page actually renders.
//
// resident.drilldown and resident.balance are marked pendingWidgetDetail:
// their whole-dashboard on/off toggle is real and functional, but
// individual widget-level toggles aren't defined yet -- doing so blind
// risked guessing at those two pages' structure incorrectly. Confirm their
// exact card structure before adding granular toggles for them.
type WidgetDef = { id: string; label: string };
type DashboardDef = {
  key: string;
  label: string;
  widgets: WidgetDef[];
  pendingWidgetDetail?: boolean;
  notApplicable?: string;
};

const DASHBOARD_DEFS: DashboardDef[] = [
  {
    key: "resident.overview",
    label: "Resident \u00B7 Overview",
    widgets: [
      { id: "overview.auditedReport", label: "Audited Report (superadmin uploads; residents/admin view only)" },
      { id: "overview.collectionHealth", label: "Collection Health (Expected Collection, Collected Maintenance, Outstanding Dues, Other Income)" },
      { id: "overview.financialPosition", label: "Society Financial Position (Total Income/Expense, Net Surplus, Recovery Rate)" },
      { id: "overview.financialStrength", label: "Long-Term Financial Strength (Corpus, Contingency Cash, Bank Balance, Expense/Income Ratio)" },
      { id: "overview.top5Expenses", label: "Top 5 expense categories" },
      { id: "overview.top5Income", label: "Top 5 income sources (excluding maintenance)" },
      { id: "overview.top5Vendors", label: "Top 5 vendors by expense" },
    ],
  },
  {
    key: "resident.cashflow",
    label: "Resident \u00B7 Cashflow Health",
    widgets: [
      { id: "cashflow.summaryCards", label: "Expense/Income, Surplus months, Deficit months summary" },
      { id: "cashflow.performanceVsTarget", label: "Collection performance vs target + Best/worst month" },
      { id: "cashflow.monthlyTrendChart", label: "Monthly trend chart (actual vs expected collection, expense, outstanding)" },
    ],
  },
  {
    key: "resident.income",
    label: "Resident \u00B7 Income Visibility",
    widgets: [
      { id: "income.sourcesBreakdown", label: "Income sources (maintenance + other income breakdown)" },
      { id: "income.expenseRatio", label: "Expense / Income ratio card" },
      { id: "income.maintenanceVsOutstanding", label: "Maintenance collection vs outstanding chart" },
    ],
  },
  {
    key: "resident.drilldown",
    label: "Resident \u00B7 Head Drill-down",
    widgets: [],
    notApplicable: "This page is one continuous drill-down flow (Heads -> Categories -> Vendors -> Line items) -- each screen replaces the last based on what's selected, so individual sections can't be hidden without breaking navigation. Use the whole-dashboard toggle above to show/hide this entire page.",
  },
  {
    key: "resident.balance",
    label: "Resident \u00B7 Opening & Closing",
    widgets: [
      { id: "balance.strip", label: "Balance strip (Opening/Income/Expense/Net/Closing + months covered + contingency composition)" },
      { id: "balance.continuity", label: "Month-by-month continuity table" },
      { id: "balance.contingencyChart", label: "Monthly contingency fund collection chart" },
    ],
  },
];

function Page() {
  // FIX (2026-08-15): this page crashed with a React hydration mismatch
  // (error #418) -- likely because it renders differently depending on
  // whether real settings data has arrived yet, which can disagree between
  // the server-rendered HTML and the client's first paint. Delaying real
  // content until after mount guarantees both passes agree, matching the
  // same fix applied to useWidgetVisibility for the resident-facing pages.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const { data: remoteSettings = [], isLoading, refetch } = useDashboardSettings();
  const [rows, setRows] = useState<DashboardSettingRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Merge fetched settings with the real widget defs -- any dashboard with
  // no saved row yet defaults to fully enabled (nothing hidden), matching
  // the backend's own "no row = default visible" convention.
  useEffect(() => {
    setRows(
      DASHBOARD_DEFS.map((d) => {
        const existing = remoteSettings.find((r) => r.dashboard_key === d.key);
        return {
          dashboard_key: d.key,
          enabled: existing?.enabled ?? true,
          hidden_widgets: existing?.hidden_widgets ?? [],
        };
      }),
    );
    setDirty(false);
  }, [remoteSettings]);

  function toggleDash(key: string) {
    setRows((rs) => rs.map((r) => (r.dashboard_key === key ? { ...r, enabled: !r.enabled } : r)));
    setDirty(true);
  }
  function toggleWidget(key: string, widgetId: string) {
    setRows((rs) =>
      rs.map((r) => {
        if (r.dashboard_key !== key) return r;
        const hidden = r.hidden_widgets.includes(widgetId)
          ? r.hidden_widgets.filter((w) => w !== widgetId)
          : [...r.hidden_widgets, widgetId];
        return { ...r, hidden_widgets: hidden };
      }),
    );
    setDirty(true);
  }
  async function saveAll() {
    setSaving(true);
    const ok = await saveDashboardSettings(rows);
    setSaving(false);
    if (ok) {
      toast.success("Dashboard visibility saved for all residents");
      setDirty(false);
      refetch();
    } else {
      toast.error("Save failed \u2014 changes were not persisted to the server. Try again.");
    }
  }

  const enabledCount = rows.filter((r) => r.enabled).length;

  // Render nothing (matches what SSR sends down) until mounted client-side --
  // avoids the hydration mismatch that was crashing this page.
  if (!mounted) {
    return (
      <PortalShell title="Dashboard Controls" reqIds="AC-30 \u00B7 AC-31 \u00B7 AC-32" persona="admin">
        <p className="text-sm text-muted-foreground py-8 text-center">Loading\u2026</p>
      </PortalShell>
    );
  }

  return (
    <PortalShell title="Dashboard Controls" reqIds="AC-30 \u00B7 AC-31 \u00B7 AC-32" persona="admin">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base">What residents see</CardTitle>
            <CardDescription>Toggle whole dashboards or hide individual widgets. Changes apply the next time a resident loads the app.</CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline">{isLoading ? "\u2026" : `${enabledCount} of ${rows.length} dashboards enabled`}</Badge>
            <Button size="sm" disabled={!dirty || saving} onClick={saveAll}>
              <Save className="h-4 w-4 mr-1" /> {saving ? "Saving\u2026" : "Save changes"}
            </Button>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2 mt-4">
        {DASHBOARD_DEFS.map((def) => {
          const row = rows.find((r) => r.dashboard_key === def.key);
          if (!row) return null;
          return (
            <Card key={def.key} className={row.enabled ? "" : "opacity-60 border-dashed"}>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      {row.enabled ? <Eye className="h-4 w-4 text-emerald-500" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                      {def.label}
                    </CardTitle>
                    <CardDescription className="font-mono text-xs mt-1">{def.key}</CardDescription>
                  </div>
                  <Switch checked={row.enabled} onCheckedChange={() => toggleDash(def.key)} />
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {def.notApplicable ? (
                  <div className="flex items-start gap-2 rounded-md border border-slate-500/30 bg-slate-500/5 px-3 py-2.5 text-xs text-slate-700 dark:text-slate-400">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <p>{def.notApplicable}</p>
                  </div>
                ) : def.pendingWidgetDetail ? (
                  <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <p>
                      Whole-dashboard on/off (above) is fully functional. Individual widget toggles for this
                      page aren\u2019t defined yet \u2014 confirm its exact card structure before adding granular controls.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Widgets</div>
                    <ul className="divide-y divide-border rounded-md border">
                      {def.widgets.map((w) => {
                        const shown = !row.hidden_widgets.includes(w.id);
                        return (
                          <li key={w.id} className="flex items-center justify-between px-3 py-2 text-sm gap-3">
                            <div>
                              <div className="font-medium">{w.label}</div>
                              <div className="text-[11px] font-mono text-muted-foreground">{w.id}</div>
                            </div>
                            <Switch checked={shown} onCheckedChange={() => toggleWidget(def.key, w.id)} disabled={!row.enabled} />
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
                <div className="pt-2">
                  <Link to={def.key.startsWith("resident.") ? `/${def.key.replace(".", "/")}` : "/"} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    Preview as resident <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </PortalShell>
  );
}

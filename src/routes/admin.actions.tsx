import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PortalShell, usePeriod } from "@/components/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, XAxis, YAxis, Legend } from "recharts";
import { SmartTooltipContent, getTooltipTrigger } from "@/components/smart-tooltip";
import { inr, pct, categoryMonthly, total, vendorMonthly, months12, type Category } from "@/lib/finance-mock";
import { AlertTriangle, ArrowRight, TrendingUp } from "lucide-react";
import { NoDbData } from "@/components/mock-gate";
import { useExpenseTree, useIncomeTree, useMonthlyTotals } from "@/lib/hooks";
import { filterReportableIncomeCategories, sumMaintenanceChargeMonthly } from "@/lib/income-utils";

export const Route = createFileRoute("/admin/actions")({
  component: Page,
  head: () => ({ meta: [{ title: "Admin · Action Needed" }] }),
});

function derive(
  tree: Category[],
  sliceMonthly: <T>(arr: T[]) => T[],
  priorSliceMonthly: <T>(arr: T[]) => T[],
) {
  const momChanges = tree.map((c) => {
    const m = categoryMonthly(c);
    const cur = total(sliceMonthly(m));
    const prevPeriod = total(priorSliceMonthly(m));
    const periodChange = prevPeriod ? ((cur - prevPeriod) / Math.abs(prevPeriod)) * 100 : 0;
    return { category: c.name, current: cur, periodChange };
  });
  const anomalies = tree
    .map((c) => {
      const m = categoryMonthly(c);
      const currentSlice = sliceMonthly(m);
      const cur = currentSlice[currentSlice.length - 1] ?? 0;
      const prev3 = [...priorSliceMonthly(m), ...currentSlice.slice(0, -1)].slice(-3);
      const avg = prev3.length ? prev3.reduce((s, n) => s + n, 0) / prev3.length : 0;
      const ratio = cur / (avg || 1);
      return { category: c.name, cur, avg, ratio };
    })
    .filter((a) => a.ratio >= 1.5);
  return { momChanges, anomalies };
}

function Page() {
  return (
    <PortalShell title="Action needed" reqIds="AD-40 · AD-41 · AD-42 · AD-43" persona="admin">
      <Inner />
    </PortalShell>
  );
}

function Inner() {
  const { data: expenseTree = [], isLoading } = useExpenseTree();
  const { data: incomeTree = [] } = useIncomeTree();
  const { data: apiMonthly = [] } = useMonthlyTotals();
  const { sliceMonthly, priorSliceMonthly, labels, view } = usePeriod();
  const { momChanges, anomalies } = useMemo(
    () => derive(expenseTree, sliceMonthly, priorSliceMonthly),
    [expenseTree, sliceMonthly, priorSliceMonthly],
  );
  const [selectedProjection, setSelectedProjection] = useState<string | null>(null);

  if (!isLoading && expenseTree.length === 0) {
    return (
      <NoDbData note="Alerts, projections and budget variance appear once transactions exist for the selected period." />
    );
  }

  // FIX (2026-08-15): this card's own description always said "anomalies,
  // rising costs, income drops" -- but the code only ever looked at
  // expenseTree, so income drops (and collection gaps, and vendor spend
  // spikes) never actually fed into "Top 5 items needing attention." That
  // made this page a subset of Cost Alerts & Trends rather than a genuine
  // cross-cutting triage hub. It now pulls flagged items from every admin
  // dashboard's own detection logic (mirrored here, not reinvented) and
  // ranks them together by Amount.
  const risingItems = momChanges.filter((c) => c.periodChange > 15).map((c) => ({
    kind: "Rising cost", label: c.category, detail: `${pct(c.periodChange)} vs prior period`, to: "/admin/alerts", amount: c.current,
  }));
  const anomalyItems = anomalies.map((a) => ({
    kind: "Anomaly", label: a.category, detail: `Current ${inr(a.cur)} · ${a.ratio.toFixed(1)}× 3-mo avg`, to: "/admin/alerts", amount: a.cur,
  }));

  // Income drops / irregular sources -- mirrors Income Optimisation's own
  // row-level flagging exactly (same active-months + trailing-3-month logic).
  const reportableIncomeTree = filterReportableIncomeCategories(incomeTree);
  const incomeRows = reportableIncomeTree.flatMap((c) =>
    c.vendors.flatMap((v) =>
      v.items.map((it) => {
        const monthly = sliceMonthly(it.monthly);
        const t = total(monthly);
        const active = monthly.filter((n) => n > 0).length;
        const recent = monthly.slice(-Math.min(3, monthly.length));
        const expectedMonths = Math.max(labels.length, 12);
        return {
          category: c.name, source: it.name, total: t, active,
          irregular: active < expectedMonths && active > 0,
          dropped: recent.length > 0 && recent.every((n) => n === 0) && active > 0,
        };
      }),
    ),
  );
  const incomeDropItems = incomeRows.filter((r) => r.dropped || r.irregular).map((r) => ({
    kind: r.dropped ? "Income drop" : "Income irregular",
    label: r.source, detail: `${r.category} · ${r.active}/${labels.length} months active`, to: "/admin/income", amount: r.total,
  }));

  // Collection gaps -- mirrors Collections' sharp-drop detection, using the
  // same corrected "Collected Maintenance" figure (not the raw, unfiltered
  // backend collection total).
  const maintenanceMonthly = sumMaintenanceChargeMonthly(incomeTree, months12.length);
  const maintenanceByMonth = new Map(months12.map((m, i) => [m, maintenanceMonthly[i]]));
  const adjustedCollections = apiMonthly.map((m) => ({
    ...m, collection: maintenanceByMonth.get(m.month) ?? m.collection,
  }));
  const collectionData = sliceMonthly(adjustedCollections).map((m, i, arr) => {
    const prev = arr[i - 1]?.collection;
    const change = prev ? ((m.collection - prev) / prev) * 100 : 0;
    return { ...m, change };
  });
  const collectionGapItems = collectionData.filter((d) => d.change < -10).map((d) => ({
    kind: "Collection gap", label: `${d.month} collection`, detail: `${pct(d.change, 1)} vs prior month`, to: "/admin/collections", amount: d.collection,
  }));

  // Vendor spend spikes -- mirrors Vendor Insights' own >20%-change flag.
  const vendorRanking = expenseTree.flatMap((c) => c.vendors.map((v) => {
    const full = vendorMonthly(v);
    const selected = sliceMonthly(full);
    const previous = priorSliceMonthly(full);
    const selectedTotal = total(selected);
    const previousTotal = total(previous);
    return {
      vendor: v.name, category: c.name, total: selectedTotal,
      changePct: previousTotal ? ((selectedTotal - previousTotal) / Math.abs(previousTotal)) * 100 : 0,
    };
  })).filter((v) => v.total > 0);
  const vendorSpikeItems = vendorRanking.filter((v) => v.changePct > 20).map((v) => ({
    kind: "Vendor spike", label: v.vendor, detail: `${v.category} · ${pct(v.changePct, 1)} vs prior period`, to: "/admin/vendors", amount: v.total,
  }));

  const actions = [...anomalyItems, ...risingItems, ...incomeDropItems, ...collectionGapItems, ...vendorSpikeItems]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  // FIX (2026-08-15): "Seasonal patterns" used to be 3 HARDCODED entries
  // (Utilities Apr-May, Maintenance Jun, Petty Cash Dec) shown regardless of
  // actual data -- not computed from real transactions at all. True
  // seasonality (a pattern that repeats at the same calendar month across
  // YEARS) can't be proven with only ~12 months of data, so rather than
  // fake that confidence, this now shows a real, honest signal instead:
  // categories currently spending notably more than their own average over
  // the selected period. Once 2+ years of data exist, this can be upgraded
  // to genuine year-over-year seasonality detection.
  const aboveAverageSpend = expenseTree
    .map((c) => {
      const monthly = sliceMonthly(categoryMonthly(c)).filter((n) => n > 0);
      if (monthly.length < 3) return null;
      const current = monthly[monthly.length - 1] ?? 0;
      const priorMonths = monthly.slice(0, -1);
      const avg = priorMonths.length ? priorMonths.reduce((s, n) => s + n, 0) / priorMonths.length : 0;
      if (avg <= 0 || current <= 0) return null;
      const ratio = current / avg;
      return { category: c.name, current, avg, ratio };
    })
    .filter((s) => s !== null && s.ratio >= 1.25)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 5);

  const projectionCandidates = [
    ...anomalies
      .sort((a, b) => b.ratio - a.ratio)
      .map((a) => ({
        category: a.category,
        reason: `Anomaly: ${a.ratio.toFixed(1)}x above prior 3-month average`,
        score: a.ratio,
      })),
    ...momChanges
      .filter((c) => c.periodChange > 15)
      .sort((a, b) => b.periodChange - a.periodChange)
      .map((c) => ({
        category: c.category,
        reason: `Rising cost: ${pct(c.periodChange, 1)} vs prior period`,
        score: c.periodChange,
      })),
  ].filter((candidate, index, arr) => arr.findIndex((x) => x.category === candidate.category) === index);

  const activeProjectionName = selectedProjection ?? projectionCandidates[0]?.category ?? null;
  const activeProjectionMeta = projectionCandidates.find((c) => c.category === activeProjectionName) ?? null;
  const risingCat = expenseTree.find((c) => c.name === activeProjectionName) ?? null;
  const monthlyFull = risingCat ? categoryMonthly(risingCat) : new Array(labels.length).fill(0);
  const monthly = sliceMonthly(monthlyFull);
  const last6 = monthly.slice(-6);
  const slope = last6.length >= 2 ? (last6[last6.length - 1] - last6[0]) / (last6.length - 1) : 0;
  const lastVal = monthly[monthly.length - 1] ?? 0;
  const projA = Math.max(0, Math.round(lastVal + slope));
  const projB = Math.max(0, Math.round(projA + slope));
  const trendData = [
    ...labels.map((m, i) => ({ month: m, actual: monthly[i], projected: null as number | null })),
    { month: "+1 mo", actual: null, projected: projA },
    { month: "+2 mo", actual: null, projected: projB },
  ];


  return (
    <>
      <Card className="border-rose-500/30">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-500" /> Top 5 items needing attention · AD-41
          </CardTitle>
          {/* FIX (2026-08-15): description now genuinely matches what the
              code computes -- previously said "income drops" but the code
              never looked at income at all. This page is the cross-cutting
              triage hub across every admin dashboard; Cost Alerts & Trends
              is the expense-specific deep-dive behind the anomaly/rising-
              cost subset of these signals. */}
          <CardDescription>Highest-priority flagged items across every dashboard — expense anomalies, rising costs, income drops, collection gaps, and vendor spend spikes</CardDescription>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          {actions.length === 0 && <p className="text-sm text-muted-foreground py-3">Nothing flagged. All categories look healthy.</p>}
          {actions.map((a, i) => (
            <Link
              key={i}
              to={a.to}
              // FIX (2026-08-15): this was the ONE link in the app missing
              // search-param preservation -- every other cross-dashboard
              // link (nav tabs, "Drill" links on Vendor Insights/Cost
              // Alerts) spreads {...prev} so period/view survive
              // navigation. This one was a bare path string, so clicking
              // any "Top 5 items needing attention" row silently reset the
              // period filter to the default on arrival -- and since the
              // tab bar itself correctly preserves "whatever the current
              // period is," that reset value then propagated to every
              // subsequent page you visited afterward, making it look like
              // your original selection had vanished entirely.
              search={(((prev: any) => ({ ...prev })) as any)}
              className="flex items-center justify-between py-3 group hover:bg-accent/40 -mx-4 px-4 rounded"
            >
              <div className="flex items-center gap-4">
                <span className="text-xs font-mono w-6 text-muted-foreground">#{i + 1}</span>
                <div>
                  <div className="font-medium flex items-center gap-2">
                    {a.label}
                    <Badge variant="outline" className="text-[10px]">{a.kind}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">{a.detail}</div>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
            </Link>
          ))}
        </CardContent>
      </Card>

      {risingCat && activeProjectionMeta && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base">Projection · {risingCat.name} · AD-40</CardTitle>
              <CardDescription>{activeProjectionMeta.reason}</CardDescription>
            </div>
            {projectionCandidates.length > 1 && (
              <Select value={activeProjectionName ?? undefined} onValueChange={setSelectedProjection}>
                <SelectTrigger className="w-[250px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {projectionCandidates.map((candidate) => (
                    <SelectItem key={candidate.category} value={candidate.category}>{candidate.category}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </CardHeader>
          <CardContent>
            {view === "chart" ? (
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="month" fontSize={11} />
                  <YAxis tickFormatter={(v) => `₹${(v/1000).toFixed(0)}k`} fontSize={11} />
                  <Tooltip trigger={getTooltipTrigger()} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} content={<SmartTooltipContent labelPrefix="Month" valueFormatter={(v) => inr(v)} />} />
                  <Legend />
                  <Bar dataKey="actual" name="Actual" fill="var(--color-chart-1)" radius={[4,4,0,0]} />
                  <Line type="monotone" dataKey="projected" name="Projected" stroke="var(--color-chart-4)" strokeWidth={2} strokeDasharray="6 4" />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="rounded-md border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left p-2">Month</th>
                      <th className="text-right p-2">Actual</th>
                      <th className="text-right p-2">Projected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trendData.map((r) => (
                      <tr key={r.month} className="border-t border-border">
                        <td className="p-2">{r.month}</td>
                        <td className="p-2 text-right font-mono">{r.actual == null ? "-" : inr(r.actual)}</td>
                        <td className="p-2 text-right font-mono">{r.projected == null ? "-" : inr(r.projected)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Projection is shown only for flagged categories and is based on the recent linear trend of the selected period.
            </p>
          </CardContent>
        </Card>
      )}

      {!risingCat && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Projection · AD-40</CardTitle>
            <CardDescription>No flagged category available for projection in the selected period</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              This chart now appears only when a category is flagged as an anomaly or rising cost, so it will not fall back to an unrelated category like the first item in the list.
            </p>
          </CardContent>
        </Card>
      )}

      {/* FIX (2026-08-15): "Budget vs actual" hidden for now -- every row
          always showed "N/A" because getUploadedBudgetForCategory() is a
          stub with no real budget data behind it. Showing a permanently-
          broken-looking card undermines trust in a "control" dashboard more
          than not showing it at all. Re-enable once a real budget-upload
          feature exists (see admin.settings / a future Dashboard Controls
          addition), rather than leaving a half-built feature visible. */}
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-cyan-500" /> Above-average spend this month · AD-42
            </CardTitle>
            <CardDescription>
              Categories currently spending noticeably more than their own period average — worth watching, not necessarily alarming
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {aboveAverageSpend.length === 0 && (
              <p className="text-sm text-muted-foreground">No category is running notably above its own average this period.</p>
            )}
            {aboveAverageSpend.map((s) => (
              <div key={s.category} className="p-3 rounded-md border border-cyan-500/30 bg-cyan-500/5 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{s.category}</span>
                  <Badge variant="outline" className="text-[10px]">{s.ratio.toFixed(1)}× avg</Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  This month {inr(s.current)} · period average {inr(Math.round(s.avg))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

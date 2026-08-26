import { createFileRoute } from "@tanstack/react-router";
import { PortalShell, usePeriod } from "@/components/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { SmartTooltipContent, getTooltipTrigger } from "@/components/smart-tooltip";
import { inr, categoryMonthly, total, sumMonthly } from "@/lib/finance-mock";
import { useIncomeTree, useMonthlyTotals } from "@/lib/hooks";
import { filterReportableIncomeCategories, isMaintenanceOutstandingCategory } from "@/lib/income-utils";

export const Route = createFileRoute("/resident/income")({
  component: Page,
  head: () => ({ meta: [{ title: "Resident · Income Visibility" }] }),
});

const COLORS = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)", "var(--color-chart-5)"];

function Page() {
  return (
    <PortalShell title="Income visibility" reqIds="RD-30 · RD-31 · RD-32" persona="resident">
      <Inner />
    </PortalShell>
  );
}

function Inner() {
  const { data: incomeTree = [] } = useIncomeTree();
  const { data: monthlyTotals = [] } = useMonthlyTotals();
  const { sliceMonthly, labels, view } = usePeriod();
  const reportableIncomeTree = filterReportableIncomeCategories(incomeTree);
  const outstandingIncomeTree = incomeTree.filter((c) => isMaintenanceOutstandingCategory(c.name));
  const rows = reportableIncomeTree
    .map((c) => ({ name: c.name, value: total(sliceMonthly(categoryMonthly(c))) }))
    .sort((a, b) => b.value - a.value);
  const totalIncome = rows.reduce((s, r) => s + r.value, 0);
  // Use sliceMonthly on the full objects to preserve month-label alignment,
  // then sum the expense field — avoids the index-mismatch when backend data
  // does not cover the same months as months12.
  const totalExpense = sliceMonthly(monthlyTotals).reduce((s, m) => s + m.expense, 0);
  const spentRatio = totalIncome ? (totalExpense / totalIncome) * 100 : 0;
  const maintenanceRow = rows.find((r) => r.name.toLowerCase().includes("maintenance"));
  const maintenanceValue = maintenanceRow?.value ?? 0;
  const maintenancePct = totalIncome ? (maintenanceValue / totalIncome) * 100 : 0;
  const otherIncomeRows = rows
    .filter((r) => !r.name.toLowerCase().includes("maintenance"))
    .map((r) => ({
      ...r,
      pct: totalIncome ? +((r.value / totalIncome) * 100).toFixed(1) : 0,
    }));
  const otherIncomeTotal = otherIncomeRows.reduce((sum, r) => sum + r.value, 0);

  const monthlyIncome = sliceMonthly(
    sumMonthly(reportableIncomeTree.flatMap((c) => c.vendors.flatMap((v) => v.items.map((i) => i.monthly)))),
  );
  const maintenanceMonthly = sliceMonthly(
    sumMonthly(
      reportableIncomeTree
        .filter((c) => c.name.toLowerCase().includes("maintenance"))
        .flatMap((c) => c.vendors.flatMap((v) => v.items.map((i) => i.monthly))),
    ),
  );
  // RD-32 is the ONE designated place "Current Month Unpaid Maintenance" is
  // allowed to appear. Filter at the line-item level (not just the category
  // level) so "Previous Arrears Brought Forward" -- which now recurs every
  // month and would otherwise massively distort this figure -- is excluded.
  const isCurrentMonthUnpaid = (s: string) => (s || "").trim().toLowerCase() === "current month unpaid maintenance";
  const outstandingMonthly = sliceMonthly(
    sumMonthly(
      outstandingIncomeTree
        .flatMap((c) => c.vendors.flatMap((v) => v.items
          .filter((i) => isCurrentMonthUnpaid(i.name))
          .map((i) => i.monthly))),
    ),
  );
  // Expected Collection target line -- same per-sqft rate x fixed area
  // formula used by Overview\u2019s / Cashflow Health\u2019s Expected Collection.
  // EXPECTED COLLECTION -- now supplied DIRECTLY via CSV (head=reference,
  // category="Expected Collection Reference") instead of rate x fixed area.
  const isExpectedCollectionReference = (name: string) => /expected collection reference/i.test(name || "");
  const expectedCollectionCategory = incomeTree.find((c) => isExpectedCollectionReference(c.name));
  const expectedCollectionByMonth = expectedCollectionCategory ? sliceMonthly(categoryMonthly(expectedCollectionCategory)) : [];
  // ---- OLD calculation (rate x fixed area) -- kept for easy rollback ----
  // const isMaintenanceRateReference = (name: string) => /maintenance rate reference/i.test(name || "");
  // const TOTAL_SQFT = 701591;
  // const rateCategory = incomeTree.find((c) => isMaintenanceRateReference(c.name));
  // const rateMonthly = rateCategory ? sliceMonthly(categoryMonthly(rateCategory)) : [];
  const monthlyMaintenanceData = labels.map((m, i) => {
    const collected = maintenanceMonthly[i] ?? 0;
    const outstanding = Math.max(0, outstandingMonthly[i] ?? 0);
    const totalMaintenance = collected + outstanding;
    const expectedCollection = expectedCollectionByMonth[i] ?? 0;
    // const expectedCollection = ((rateMonthly[i] ?? 0) / 100) * TOTAL_SQFT; // OLD
    return {
      month: m,
      collected,
      outstanding,
      totalMaintenance,
      expectedCollection,
      recoveryPct: totalMaintenance > 0 ? +((collected / totalMaintenance) * 100).toFixed(1) : 0,
    };
  });
  const totalMaintenanceCollected = monthlyMaintenanceData.reduce((s, r) => s + r.collected, 0);
  const totalOutstanding = monthlyMaintenanceData.reduce((s, r) => s + r.outstanding, 0);
  const maintenanceRecoveryRate = totalMaintenanceCollected + totalOutstanding > 0
    ? ((totalMaintenanceCollected / (totalMaintenanceCollected + totalOutstanding)) * 100)
    : 0;
  const arrearsMonths = monthlyMaintenanceData.filter((r) => r.outstanding > 0).length;

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-3 items-start">
        {/* RD-30 */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Income sources · RD-30</CardTitle>
            <CardDescription>Maintenance separated out, remaining income sorted by contribution</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Link
              to="/resident/drilldown"
              search={(((prev: any) => ({ ...prev, head: "income", category: "Maintenance Collections", vendor: undefined, line: undefined })) as any)}
              className="flex items-center justify-between p-3 rounded-md bg-cyan-500/5 border border-cyan-500/20 hover:bg-cyan-500/10 transition-colors"
            >
              <div>
                <div className="text-sm font-medium">Maintenance Collections</div>
                <div className="text-xs text-muted-foreground">Flat dues · {maintenancePct.toFixed(1)}% of total income</div>
              </div>
              <span className="font-mono text-sm">{inr(maintenanceValue)}</span>
            </Link>

            {otherIncomeRows.length > 0 && (
              <>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-medium uppercase tracking-wider">Other income</span>
                  <span className="font-mono">{inr(otherIncomeTotal)}</span>
                </div>
                <ResponsiveContainer width="100%" height={Math.max(180, otherIncomeRows.length * 38)}>
                  <BarChart data={otherIncomeRows} layout="vertical" margin={{ left: 8, right: 44, top: 4, bottom: 4 }}>
                    <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.3} />
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" width={110} fontSize={11} />
                   {/* <Tooltip trigger={getTooltipTrigger()} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} content={<SmartTooltipContent labelPrefix="Income" valueFormatter={(v) => inr(v)} />} />*/}
                    <Tooltip trigger={getTooltipTrigger()} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} content={<SmartTooltipContent labelPrefix="Income" valueFormatter={(v) => inr(Number(v))} />} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                      {otherIncomeRows.map((r, i) => <Cell key={r.name} fill={COLORS[i % COLORS.length]} />)}
                      <LabelList dataKey="pct" position="right" formatter={(v: number) => `${v}%`} style={{ fontSize: 11 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </>
            )}
          </CardContent>
        </Card>

        {/* RD-31 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Expense / Income · RD-31</CardTitle>
            <CardDescription>Same calculation as overview</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="text-3xl font-mono">{spentRatio.toFixed(1)}%</div>
              <div className="text-xs text-muted-foreground">of total income has been spent</div>
            </div>
            <div className="text-sm space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Total income</span><span className="font-mono">{inr(totalIncome)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Total expense</span><span className="font-mono">{inr(totalExpense)}</span></div>
              <div className="flex justify-between border-t border-border pt-1 mt-1"><span>{totalIncome >= totalExpense ? "Surplus" : "Deficit"}</span><span className="font-mono">{inr(Math.abs(totalIncome - totalExpense))}</span></div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* RD-32 -- split into two focused, side-by-side charts instead of one
          dense 4-legend/dual-axis chart. "Collected vs Unpaid" stays a pure
          rupee comparison; "Recovery Rate Trend" is its own %-only chart,
          which also structurally prevents the currency/percentage tooltip
          mixing bug from ever resurfacing here -- there's no rupee series
          left in the same chart for a shared formatter to get confused by. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Maintenance collection vs outstanding · RD-32</CardTitle>
          <CardDescription>Shows recovery, arrears, and the unpaid maintenance gap for the selected period</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-md border border-border p-3">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Collected maintenance</div>
              <div className="text-xl font-mono">{inr(totalMaintenanceCollected)}</div>
            </div>
            <div className="rounded-md border border-border p-3">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Outstanding receivables</div>
              <div className="text-xl font-mono">{inr(totalOutstanding)}</div>
            </div>
            <div className="rounded-md border border-border p-3">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Recovery rate</div>
              <div className="text-xl font-mono">{maintenanceRecoveryRate.toFixed(1)}%</div>
            </div>
            <div className="rounded-md border border-border p-3">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Months with dues</div>
              <div className="text-xl font-mono">{arrearsMonths}</div>
            </div>
          </div>

          {view === "chart" ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Left: pure rupee comparison -- collected vs unpaid vs target, one axis, 3 legends */}
              <div>
                <div className="text-sm font-medium mb-1">Collected vs Outstanding Receivables</div>
                <div className="text-xs text-muted-foreground mb-2">Are we hitting the per-sqft target, and how big is the unpaid gap?</div>
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={monthlyMaintenanceData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="month" fontSize={11} />
                    <YAxis tickFormatter={(v) => "\u20B9" + (v / 1000).toFixed(0) + "k"} fontSize={11} />
                    <Tooltip trigger={getTooltipTrigger()} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} content={<SmartTooltipContent labelPrefix="Month" valueFormatter={(v) => inr(v)} />} />
                    <Legend />
                    <Bar dataKey="collected" name="Collected Maintenance" fill="var(--color-chart-2)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="outstanding" name="Outstanding Receivables" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} />
                    <Line type="monotone" dataKey="expectedCollection" name="Expected Collection" stroke="var(--color-chart-4, #a855f7)" strokeWidth={2} strokeDasharray="4 2" dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Right: recovery % ALONE on its own 0-100% axis -- no currency
                  series sharing this chart, so there's nothing for a tooltip
                  formatter to mix up. A reference line at 90% gives an
                  at-a-glance "healthy" benchmark instead of just a bare line. */}
              <div>
                <div className="text-sm font-medium mb-1">Recovery rate trend</div>
                <div className="text-xs text-muted-foreground mb-2">Month-by-month collection efficiency, vs. the 90% healthy benchmark</div>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={monthlyMaintenanceData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="month" fontSize={11} />
                    <YAxis tickFormatter={(v) => `${v}%`} fontSize={11} domain={[0, 100]} />
                    <Tooltip trigger={getTooltipTrigger()} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} content={<SmartTooltipContent labelPrefix="Month" valueFormatter={(v) => `${v}%`} />} />
                    <ReferenceLine y={90} stroke="var(--color-chart-3)" strokeDasharray="3 3" label={{ value: "Healthy (90%)", position: "insideTopRight", fontSize: 10, fill: "var(--color-chart-3)" }} />
                    <Line type="monotone" dataKey="recoveryPct" name="Recovery Rate" stroke="var(--color-chart-2)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-md border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left p-2">Month</th>
                      <th className="text-right p-2">Collected Maintenance</th>
                      <th className="text-right p-2">Expected Collection</th>
                      <th className="text-right p-2">Outstanding Receivables</th>
                      <th className="text-right p-2">Recovery Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyMaintenanceData.map((m) => (
                      <tr key={m.month} className="border-t border-border">
                        <td className="p-2">{m.month}</td>
                        <td className="p-2 text-right font-mono">{inr(m.collected)}</td>
                        <td className="p-2 text-right font-mono">{inr(m.expectedCollection)}</td>
                        <td className="p-2 text-right font-mono">{inr(m.outstanding)}</td>
                        <td className="p-2 text-right font-mono">{m.recoveryPct.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-md border border-border p-3 bg-muted/20">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">Insight</div>
                  <div className="mt-1 text-sm">
                    Recovery is calculated from uploaded maintenance collections versus unpaid maintenance amounts, so periods with low recovery are easy to spot.
                  </div>
                </div>
                <div className="rounded-md border border-border p-3 bg-muted/20">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">Focus</div>
                  <div className="mt-1 text-sm">
                    A rising red bar with a falling recovery line indicates collection slippage and helps identify the months needing follow-up.
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

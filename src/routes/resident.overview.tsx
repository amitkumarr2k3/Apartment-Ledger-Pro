import { createFileRoute, Link } from "@tanstack/react-router";

import { PortalShell, usePeriod } from "@/components/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend, Cell,
} from "recharts";
import { SmartTooltipContent, getTooltipTrigger } from "@/components/smart-tooltip";
import {
  inr, pct, expenseTree, categoryMonthly, total, vendorMonthly, sumMonthly,
} from "@/lib/finance-mock";
import { useMonthlyTotals, useExpenseTree, useIncomeTree } from "@/lib/hooks";
import { filterReportableIncomeCategories } from "@/lib/income-utils";
import { Wallet, ArrowRight, TrendingUp, TrendingDown } from "lucide-react";

export const Route = createFileRoute("/resident/overview")({
  component: Page,
  head: () => ({ meta: [{ title: "Resident · Overview" }] }),
});

function Page() {
  return (
    <PortalShell title="Overview" reqIds="RD-01 · RD-02 · RD-03 · RD-04 · RD-05" persona="resident">
      <Inner />
    </PortalShell>
  );
}

function Inner() {
  const { sliceMonthly, priorSliceMonthly, view, labels } = usePeriod();
  const { data: monthlyTotals = [] } = useMonthlyTotals();
  const { data: expenseTree = [] } = useExpenseTree();
  const { data: incomeTree = [] } = useIncomeTree();
  const reportableIncomeTree = filterReportableIncomeCategories(incomeTree);
  const period = sliceMonthly(monthlyTotals);
  const prior = priorSliceMonthly(monthlyTotals);
  const periodCollection = sliceMonthly(
    sumMonthly(reportableIncomeTree.flatMap((c) => c.vendors.flatMap((v) => v.items.map((i) => i.monthly)))),
  );
  const priorCollectionSeries = priorSliceMonthly(
    sumMonthly(reportableIncomeTree.flatMap((c) => c.vendors.flatMap((v) => v.items.map((i) => i.monthly)))),
  );

  const totalCollection = periodCollection.reduce((s, v) => s + v, 0);
  const totalExpense = period.reduce((s, m) => s + m.expense, 0);
  const net = totalCollection - totalExpense;
  // Show how much of collected income has been spent (expense ÷ income)
  const ratio = totalCollection === 0 ? 0 : (totalExpense / totalCollection) * 100;

  const priorCollection = priorCollectionSeries.reduce((s, v) => s + v, 0);
  const priorExpense = prior.reduce((s, m) => s + m.expense, 0);
  const priorNet = priorCollection - priorExpense;
  const priorRatio = priorCollection === 0 ? 0 : (priorExpense / priorCollection) * 100;

  const delta = (cur: number, prev: number) =>
    prev === 0 ? null : ((cur - prev) / Math.abs(prev)) * 100;

  const top5 = expenseTree
    .map((c) => ({ name: c.name, total: total(sliceMonthly(categoryMonthly(c))) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
  const top5Total = top5.reduce((s, c) => s + c.total, 0);
  const top5Vendors = expenseTree
    .flatMap((c) => c.vendors.map((v) => ({
      name: v.name,
      category: c.name,
      total: total(sliceMonthly(vendorMonthly(v))),
    })))
    .filter((v) => v.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
  const top5VendorTotal = top5Vendors.reduce((s, v) => s + v.total, 0);
  const maintenanceIncomeByMonth = sliceMonthly(
    incomeTree
      .filter((c) => c.name.toLowerCase().includes("maintenance") && !/outstanding|arrears|default/.test(c.name.toLowerCase()))
      .reduce<number[]>((acc, c) => {
        const monthly = categoryMonthly(c);
        return acc.length === 0 ? monthly : acc.map((v, i) => v + (monthly[i] ?? 0));
      }, []),
  );
  const outstandingIncomeByMonth = sliceMonthly(
    incomeTree
      .filter((c) => /outstanding|arrears|default/.test(c.name.toLowerCase()))
      .reduce<number[]>((acc, c) => {
        const monthly = categoryMonthly(c);
        return acc.length === 0 ? monthly : acc.map((v, i) => v + (monthly[i] ?? 0));
      }, []),
  );
  const isLiabilityCategory = (name: string) => /outstanding|arrears|default/.test(name.toLowerCase());
  const nonMaintenanceCategories = incomeTree
    .filter((c) => !c.name.toLowerCase().includes("maintenance") && !isLiabilityCategory(c.name))
    .map((c) => ({ name: c.name, total: total(sliceMonthly(categoryMonthly(c))) }))
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);
  const communityIncome = nonMaintenanceCategories.reduce((s, c) => s + c.total, 0);
  const top5Income = nonMaintenanceCategories.slice(0, 5);
  const top5IncomeTotal = top5Income.reduce((s, c) => s + c.total, 0);

  const periodMonthlyTotals = new Map(period.map((m) => [m.month, m]));
  let runningOutstanding = 0;
  const monthlyWithOutstanding = labels.map((month, i) => {
    const monthlyTotal = periodMonthlyTotals.get(month);
    const collected = maintenanceIncomeByMonth[i] ?? 0;
    const outstanding = Math.max(0, outstandingIncomeByMonth[i] ?? 0);
    runningOutstanding += outstanding;
    return {
      month,
      collection: periodCollection[i] ?? 0,
      expense: monthlyTotal?.expense ?? 0,
      net: monthlyTotal?.net ?? 0,
      outstanding,
      cumulative_outstanding: runningOutstanding,
      maintenance_collected: collected,
    };
  });
  const totalOutstanding = monthlyWithOutstanding.reduce((s, m) => s + m.outstanding, 0);
  const monthsInArrears = monthlyWithOutstanding.filter((m) => m.outstanding > 0).length;
  const defaultMonths = [...monthlyWithOutstanding]
    .filter((m) => m.outstanding > 0)
    .sort((a, b) => a.month.localeCompare(b.month));

  const periodLabel = period.length > 1
    ? `${period[0].month} to ${period[period.length - 1].month}`
    : (period[0]?.month ?? "selected period");

  const priorLabel = prior.length === 0 ? "no prior window" : `vs prior ${prior.length}m`;
  const topCardsClass = "h-full min-h-[380px]";
  const chartHeight = 240;

  return (
    <>
      {/* RD-01 summary cards with vs-prior deltas */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <SummaryCard label="Total collection" value={inr(totalCollection)} tone="cyan"
          delta={delta(totalCollection, priorCollection)} deltaLabel={priorLabel} higherIsBetter />
        <SummaryCard label="Total expense" value={inr(totalExpense)} tone="rose"
          delta={delta(totalExpense, priorExpense)} deltaLabel={priorLabel} higherIsBetter={false} />
        <SummaryCard label={net >= 0 ? "Net surplus" : "Net deficit"} value={inr(net)} tone={net >= 0 ? "emerald" : "amber"}
          delta={delta(net, priorNet)} deltaLabel={priorLabel} higherIsBetter />
        <SummaryCard label="Total outstanding / default" value={inr(totalOutstanding)} tone="amber"
          delta={null} deltaLabel="uploaded outstanding and default line items" higherIsBetter={false} />
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase tracking-wider">Expense / Income · RD-04</CardDescription>
            <CardTitle className="text-2xl">{ratio.toFixed(0)}%</CardTitle>
          </CardHeader>
          <CardContent>
            <Progress value={Math.min(ratio, 150)} className="h-2" />
            <div className="flex items-center justify-between mt-2 text-xs">
              <span className="text-muted-foreground">
                {ratio <= 100 ? "Expense below collection" : "Expense exceeds collection"}
              </span>
              {prior.length > 0 && (
                <span className="text-muted-foreground">
                  prior {priorRatio.toFixed(0)}%
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* RD-02 top 5 — drill-through */}
        <Card className={topCardsClass}>
          <CardHeader>
            <CardTitle className="text-base">Top 5 expense categories</CardTitle>
            <CardDescription>RD-02 · Click any expense category to drill down</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden">
            {view === "chart" ? (
              <ResponsiveContainer width="100%" height={chartHeight}>
                <BarChart data={top5} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.3} />
                  <XAxis type="number" tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} fontSize={11} />
                  <YAxis type="category" dataKey="name" width={110} fontSize={12} />
                  <Tooltip trigger={getTooltipTrigger()} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} content={<SmartTooltipContent labelPrefix="Category" valueFormatter={(v) => inr(v)} />} />
                  <Bar dataKey="total" radius={[0, 4, 4, 0]} className="cursor-pointer">
                    {top5.map((c) => (
                      <Cell key={c.name} fill="var(--color-chart-1)"
                        onClick={() => {
                          window.location.href = `/resident/drilldown?head=expense&category=${encodeURIComponent(c.name)}`;
                        }} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ul className="divide-y divide-border max-h-[240px] overflow-y-auto">
                {top5.map((c) => (
                  <li key={c.name}>
                    <Link
                      to="/resident/drilldown"
                      search={(((prev: any) => ({ ...prev, head: "expense", category: c.name, vendor: undefined, line: undefined })) as any)}
                      className="flex items-center justify-between py-3 -mx-4 px-4 hover:bg-accent/40 rounded transition-colors"
                    >
                      <div>
                        <div className="font-medium">{c.name}</div>
                        <div className="text-xs text-muted-foreground">{((c.total / (top5Total || 1)) * 100).toFixed(1)}% of top 5</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-mono">{inr(c.total)}</span>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* RD-05 community income */}
        <Card className={topCardsClass}>
          <CardHeader>
            <CardTitle className="text-base">Top 5 income sources(Excluding Maintainence)</CardTitle>
            <CardDescription>RD-05 · Click any income category to drill down</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 flex-1 overflow-hidden">
            {top5Income.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                {`No community income recorded for ${periodLabel}.`}
              </div>
            ) : view === "chart" ? (
              <ResponsiveContainer width="100%" height={chartHeight}>
                <BarChart data={top5Income} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.3} />
                  <XAxis type="number" tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} fontSize={11} />
                  <YAxis type="category" dataKey="name" width={110} fontSize={12} />
                  <Tooltip trigger={getTooltipTrigger()} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} content={<SmartTooltipContent labelPrefix="Income" valueFormatter={(v) => inr(v)} />} />
                  <Bar dataKey="total" radius={[0, 4, 4, 0]} className="cursor-pointer">
                    {top5Income.map((income) => (
                      <Cell key={income.name} fill="var(--color-chart-2)"
                        onClick={() => {
                          window.location.href = `/resident/drilldown?head=income&category=${encodeURIComponent(income.name)}`;
                        }} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ul className="divide-y divide-border max-h-[240px] overflow-y-auto">
                {top5Income.map((income) => (
                  <li key={income.name}>
                    <Link
                      to="/resident/drilldown"
                      search={(((prev: any) => ({ ...prev, head: "income", category: income.name, vendor: undefined, line: undefined })) as any)}
                      className="flex items-center justify-between py-3 -mx-4 px-4 hover:bg-accent/40 rounded transition-colors"
                    >
                      <div>
                        <div className="font-medium">{income.name}</div>
                        <div className="text-xs text-muted-foreground">{((income.total / (top5IncomeTotal || 1)) * 100).toFixed(1)}% of top 5</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-mono">{inr(income.total)}</span>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className={topCardsClass}>
          <CardHeader>
            <CardTitle className="text-base">Top 5 vendors by expense</CardTitle>
            <CardDescription>Actual vendor spend click any vendor to drill down</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden">
            {top5Vendors.length === 0 ? (
              <p className="text-sm text-muted-foreground">No vendor-tagged expense data is available for this period.</p>
            ) : view === "chart" ? (
              <ResponsiveContainer width="100%" height={chartHeight}>
                <BarChart data={top5Vendors} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.3} />
                  <XAxis type="number" tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} fontSize={11} />
                  <YAxis type="category" dataKey="name" width={110} fontSize={12} />
                  <Tooltip trigger={getTooltipTrigger()} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} content={<SmartTooltipContent labelPrefix="Vendor" valueFormatter={(v) => inr(v)} />} />
                  <Bar dataKey="total" radius={[0, 4, 4, 0]} className="cursor-pointer">
                    {top5Vendors.map((v) => (
                      <Cell key={`${v.category}-${v.name}`} fill="var(--color-chart-3)"
                        onClick={() => {
                          window.location.href = `/resident/drilldown?head=expense&category=${encodeURIComponent(v.category)}&vendor=${encodeURIComponent(v.name)}`;
                        }} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ul className="divide-y divide-border max-h-[240px] overflow-y-auto">
                {top5Vendors.map((v) => (
                  <li key={`${v.category}-${v.name}`}>
                    <Link
                      to="/resident/drilldown"
                      search={(((prev: any) => ({ ...prev, head: "expense", category: v.category, vendor: v.name, line: undefined })) as any)}
                      className="flex items-center justify-between py-3 -mx-4 px-4 hover:bg-accent/40 rounded transition-colors"
                    >
                      <div>
                        <div className="font-medium">{v.name}</div>
                        <div className="text-xs text-muted-foreground">{v.category} · {((v.total / (top5VendorTotal || 1)) * 100).toFixed(1)}% of top 5 vendors</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-mono">{inr(v.total)}</span>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* RD-03 trend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monthly trend · collection vs expense</CardTitle>
          <CardDescription>RD-03 · Includes cumulative outstanding signal</CardDescription>
        </CardHeader>
        <CardContent>
          {view === "chart" ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={monthlyWithOutstanding} margin={{ left: 8, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="month" fontSize={11} />
                <YAxis tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} fontSize={11} />
                <Tooltip trigger={getTooltipTrigger()} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} content={<SmartTooltipContent labelPrefix="Month" valueFormatter={(v) => inr(v)} />} />
                <Legend />
                <Line type="monotone" dataKey="collection" stroke="var(--color-chart-2)" strokeWidth={2} name="Collection" />
                <Line type="monotone" dataKey="expense" stroke="var(--color-chart-1)" strokeWidth={2} name="Expense" />
                <Line type="monotone" dataKey="cumulative_outstanding" stroke="var(--color-chart-3)" strokeWidth={2} name="Cumulative outstanding" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="space-y-3">
              <div className="rounded-md border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left p-2">Month</th>
                      <th className="text-right p-2">Collection</th>
                      <th className="text-right p-2">Expense</th>
                      <th className="text-right p-2">Outstanding</th>
                      <th className="text-right p-2">Cumulative</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyWithOutstanding.map((m) => (
                      <tr key={m.month} className="border-t border-border">
                        <td className="p-2">{m.month}</td>
                        <td className="p-2 text-right font-mono">{inr(m.collection)}</td>
                        <td className="p-2 text-right font-mono">{inr(m.expense)}</td>
                        <td className="p-2 text-right font-mono">{inr(m.outstanding)}</td>
                        <td className="p-2 text-right font-mono">{inr(m.cumulative_outstanding)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}


function SummaryCard({
  label, value, tone, delta, deltaLabel, higherIsBetter,
}: {
  label: string;
  value: string;
  tone: "cyan" | "rose" | "emerald" | "amber";
  delta: number | null;
  deltaLabel: string;
  higherIsBetter: boolean;
}) {
  const bar = {
    cyan: "bg-cyan-500",
    rose: "bg-rose-500",
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
  }[tone];
  const good = delta === null ? null : higherIsBetter ? delta >= 0 : delta <= 0;
  const deltaTone = good === null
    ? "text-muted-foreground"
    : good
      ? "text-emerald-600 bg-emerald-500/10"
      : "text-rose-600 bg-rose-500/10";
  return (
    <Card className="relative overflow-hidden">
      <div className={`absolute inset-y-0 left-0 w-1 ${bar}`} />
      <CardHeader className="pb-2">
        <CardDescription className="text-xs uppercase tracking-wider">{label}</CardDescription>
        <CardTitle className="text-2xl font-mono">{value}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {delta === null ? (
          <span className="text-[11px] text-muted-foreground">{deltaLabel}</span>
        ) : (
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-mono ${deltaTone}`}>
            {delta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {pct(delta, 1)}
            <span className="opacity-70 ml-1">{deltaLabel}</span>
          </span>
        )}
      </CardContent>
    </Card>
  );
}

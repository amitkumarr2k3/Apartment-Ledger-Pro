import { createFileRoute, Link } from "@tanstack/react-router";

import { PortalShell, usePeriod } from "@/components/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend, Cell,
} from "recharts";
import { SmartTooltipContent, getTooltipTrigger } from "@/components/smart-tooltip";
import {
  inr, pct, expenseTree, categoryMonthly, total,
} from "@/lib/finance-mock";
import { useMonthlyTotals, useIncomeCategoryTotals, useExpenseTree } from "@/lib/hooks";
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
  const { sliceMonthly, priorSliceMonthly, view } = usePeriod();
  const { data: monthlyTotals = [] } = useMonthlyTotals();
  const { data: incomeCategoryTotals = [] } = useIncomeCategoryTotals();
  const { data: expenseTree = [] } = useExpenseTree();
  const period = sliceMonthly(monthlyTotals);
  const prior = priorSliceMonthly(monthlyTotals);

  const totalCollection = period.reduce((s, m) => s + m.collection, 0);
  const totalExpense = period.reduce((s, m) => s + m.expense, 0);
  const net = totalCollection - totalExpense;
  // Show how much of collected income has been spent (expense ÷ income)
  const ratio = totalCollection === 0 ? 0 : (totalExpense / totalCollection) * 100;

  const priorCollection = prior.reduce((s, m) => s + m.collection, 0);
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
  const communityIncome = incomeCategoryTotals.find((c) => c.name === "Other Income")?.total ?? 0;

  const priorLabel = prior.length === 0 ? "no prior window" : `vs prior ${prior.length}m`;

  return (
    <>
      {/* RD-01 summary cards with vs-prior deltas */}
      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard label="Total collection" value={inr(totalCollection)} tone="cyan"
          delta={delta(totalCollection, priorCollection)} deltaLabel={priorLabel} higherIsBetter />
        <SummaryCard label="Total expense" value={inr(totalExpense)} tone="rose"
          delta={delta(totalExpense, priorExpense)} deltaLabel={priorLabel} higherIsBetter={false} />
        <SummaryCard label={net >= 0 ? "Net surplus" : "Net deficit"} value={inr(net)} tone={net >= 0 ? "emerald" : "amber"}
          delta={delta(net, priorNet)} deltaLabel={priorLabel} higherIsBetter />
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase tracking-wider">Expense / Income · RD-04</CardDescription>
            <CardTitle className="text-2xl">{ratio.toFixed(0)}%</CardTitle>
          </CardHeader>
          <CardContent>
            <Progress value={Math.min(ratio, 150)} className="h-2" />
            <div className="flex items-center justify-between mt-2 text-xs">
              <span className="text-muted-foreground">
                {ratio <= 100 ? "Within budget" : "Over-spent"}
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
        {/* RD-02 top 5 — now drill-through */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Top 5 expense categories</CardTitle>
            <CardDescription>RD-02 · Click any category to drill down</CardDescription>
          </CardHeader>
          <CardContent>
            {view === "chart" ? (
              <ResponsiveContainer width="100%" height={260}>
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
              <ul className="divide-y divide-border">
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
            <div className="mt-3 text-xs text-muted-foreground">
              Tip: press <kbd className="rounded border border-border bg-muted px-1 font-mono">⌘K</kbd> to jump to any category or vendor.
            </div>
          </CardContent>
        </Card>

        {/* RD-05 community income */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Wallet className="h-4 w-4" /> Community income
            </CardTitle>
            <CardDescription>RD-05 · Non-maintenance income</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-3xl font-semibold">{inr(communityIncome)}</div>
              <div className="text-xs text-muted-foreground">from hall rental, signage, events</div>
            </div>
            <div className="space-y-2 text-sm">
              {incomeCategoryTotals.map((i) => (
                <Link
                  key={i.name}
                  to="/resident/drilldown"
                  search={(((prev: any) => ({ ...prev, head: "income", category: i.name, vendor: undefined, line: undefined })) as any)}
                  className="flex justify-between hover:bg-accent/40 rounded px-2 -mx-2 py-1 transition-colors"
                >
                  <span className="text-muted-foreground">{i.name}</span>
                  <span className="font-mono">{inr(i.total)}</span>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* RD-03 trend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monthly trend · collection vs expense</CardTitle>
          <CardDescription>RD-03 · Selected period</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={period} margin={{ left: 8, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="month" fontSize={11} />
              <YAxis tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} fontSize={11} />
              <Tooltip trigger={getTooltipTrigger()} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} content={<SmartTooltipContent labelPrefix="Month" valueFormatter={(v) => inr(v)} />} />
              <Legend />
              <Line type="monotone" dataKey="collection" stroke="var(--color-chart-2)" strokeWidth={2} name="Collection" />
              <Line type="monotone" dataKey="expense" stroke="var(--color-chart-1)" strokeWidth={2} name="Expense" />
            </LineChart>
          </ResponsiveContainer>
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

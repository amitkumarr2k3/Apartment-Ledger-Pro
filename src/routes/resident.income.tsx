import { createFileRoute } from "@tanstack/react-router";
import { PortalShell, usePeriod } from "@/components/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { SmartTooltipContent, getTooltipTrigger } from "@/components/smart-tooltip";
import { inr, categoryMonthly, total, sumMonthly } from "@/lib/finance-mock";
import { useIncomeTree, useMonthlyTotals } from "@/lib/hooks";

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
  const { sliceMonthly, labels } = usePeriod();
  const rows = incomeTree
    .map((c) => ({ name: c.name, value: total(sliceMonthly(categoryMonthly(c))) }))
    .sort((a, b) => b.value - a.value);
  const totalIncome = rows.reduce((s, r) => s + r.value, 0);
  const totalExpense = total(sliceMonthly(monthlyTotals.map((m) => m.expense)));
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

  const monthlyIncomeFull = sumMonthly(incomeTree.flatMap((c) => c.vendors.flatMap((v) => v.items.map((i) => i.monthly))));
  const monthlyIncome = sliceMonthly(monthlyIncomeFull);

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-3">
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
                    <Tooltip trigger={getTooltipTrigger()} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} content={<SmartTooltipContent labelPrefix="Income" valueFormatter={(v) => inr(v)} />} />
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
              <div className="flex justify-between border-t border-border pt-1 mt-1"><span>{spentRatio <= 100 ? "Income left" : "Over-spent"}</span><span className="font-mono">{inr(Math.abs(totalIncome - totalExpense))}</span></div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* RD-32 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Income trend · RD-32</CardTitle>
          <CardDescription>Monthly total income across selected range</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={labels.map((m, i) => ({ month: m, value: monthlyIncome[i] }))}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="month" fontSize={11} />
              <YAxis tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} fontSize={11} />
              <Tooltip trigger={getTooltipTrigger()} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} content={<SmartTooltipContent labelPrefix="Month" valueFormatter={(v) => inr(v)} />} />
              <Legend />
              <Bar dataKey="value" name="Total income" fill="var(--color-chart-2)" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </>
  );
}

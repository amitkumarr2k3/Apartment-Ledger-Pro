import { createFileRoute } from "@tanstack/react-router";
import { PortalShell } from "@/components/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, XAxis, YAxis, Legend } from "recharts";
import { SmartTooltipContent, getTooltipTrigger } from "@/components/smart-tooltip";
import { inr, categoryMonthly, total, months12, sumMonthly } from "@/lib/finance-mock";
import { useIncomeTree } from "@/lib/hooks";

export const Route = createFileRoute("/resident/income")({
  component: Page,
  head: () => ({ meta: [{ title: "Resident · Income Visibility" }] }),
});

const COLORS = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)", "var(--color-chart-5)"];

function Page() {
  const { data: incomeTree = [] } = useIncomeTree();
  const rows = incomeTree.map((c) => ({ name: c.name, value: total(categoryMonthly(c)) }));
  const totalIncome = rows.reduce((s, r) => s + r.value, 0);
  const totalExpense = 3_200_000; // illustrative
  const coverage = totalExpense ? (totalIncome / totalExpense) * 100 : 0;

  const monthlyIncome = sumMonthly(incomeTree.flatMap((c) => c.vendors.flatMap((v) => v.items.map((i) => i.monthly))));

  return (
    <PortalShell title="Income visibility" reqIds="RD-30 · RD-31 · RD-32" persona="resident">
      <div className="grid gap-4 lg:grid-cols-3">
        {/* RD-30 */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Income sources · RD-30</CardTitle>
            <CardDescription>Category, amount, and % of total income</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-center">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={rows} dataKey="value" nameKey="name" outerRadius={80} innerRadius={45}>
                    {rows.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip trigger={getTooltipTrigger()} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} content={<SmartTooltipContent labelPrefix="Month" valueFormatter={(v) => inr(v)} />} />
                </PieChart>
              </ResponsiveContainer>
              <ul className="space-y-3">
                {rows.map((r, i) => (
                  <li key={r.name}>
                    <div className="flex justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                        {r.name}
                      </span>
                      <span className="font-mono">{inr(r.value)}</span>
                    </div>
                    <div className="text-xs text-muted-foreground text-right">{((r.value / totalIncome) * 100).toFixed(1)}%</div>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>

        {/* RD-31 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Income coverage · RD-31</CardTitle>
            <CardDescription>Does income offset expense?</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="text-3xl font-mono">{coverage.toFixed(1)}%</div>
              <div className="text-xs text-muted-foreground">of total expense covered by income</div>
            </div>
            <div className="text-sm space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Total income</span><span className="font-mono">{inr(totalIncome)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Total expense</span><span className="font-mono">{inr(totalExpense)}</span></div>
              <div className="flex justify-between border-t border-border pt-1 mt-1"><span>Net offset</span><span className="font-mono">{inr(totalIncome - totalExpense)}</span></div>
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
            <BarChart data={months12.map((m, i) => ({ month: m, value: monthlyIncome[i] }))}>
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
    </PortalShell>
  );
}

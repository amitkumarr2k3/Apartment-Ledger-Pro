import { createFileRoute } from "@tanstack/react-router";
import { PortalShell, usePeriod } from "@/components/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, XAxis, YAxis, Legend } from "recharts";
import { SmartTooltipContent, getTooltipTrigger } from "@/components/smart-tooltip";
import { inr } from "@/lib/finance-mock";
import { useMonthlyTotals } from "@/lib/hooks";
import { Info, TrendingDown, TrendingUp } from "lucide-react";

export const Route = createFileRoute("/resident/cashflow")({
  component: Page,
  head: () => ({ meta: [{ title: "Resident · Cashflow Health" }] }),
});

function Page() {
  return (
    <PortalShell title="Community cashflow health" reqIds="RD-20 · RD-21 · RD-22 · RD-23" persona="resident">
      <Inner />
    </PortalShell>
  );
}

function Inner() {
  const { sliceMonthly, view } = usePeriod();
  const { data: monthlyTotals = [] } = useMonthlyTotals();
  const period = sliceMonthly(monthlyTotals);

  const totalCol = period.reduce((s, m) => s + m.collection, 0);
  const totalExp = period.reduce((s, m) => s + m.expense, 0);
  // % of collected income that has been spent
  const ratio = totalCol === 0 ? 0 : (totalExp / totalCol) * 100;
  const surplus = period.filter((m) => m.net >= 0).length;
  const deficit = period.length - surplus;

  return (
    <>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>RD-23 · Aggregate community-level view only. No individual flat-wise tracking.</AlertDescription>
      </Alert>

      <div className="grid gap-4 md:grid-cols-3">
        {/* RD-20 */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase tracking-wider">Expense / Income · RD-20</CardDescription>
            <CardTitle className="text-4xl font-mono">{ratio.toFixed(0)}%</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded ${ratio <= 100 ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"}`}>
              {ratio <= 100 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {ratio <= 100 ? "Expense below collection" : "Expense exceeds collection"}
            </div>
          </CardContent>
        </Card>
        {/* RD-22 */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase tracking-wider">Surplus months · RD-22</CardDescription>
            <CardTitle className="text-4xl font-mono text-emerald-600">{surplus}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">out of {period.length} months in selected range</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase tracking-wider">Deficit months · RD-22</CardDescription>
            <CardTitle className="text-4xl font-mono text-rose-600">{deficit}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">months where expense exceeded collection</p>
          </CardContent>
        </Card>
      </div>

      {/* RD-21 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Collection vs Expense · month-wise</CardTitle>
          <CardDescription>RD-21 · Community-level totals</CardDescription>
        </CardHeader>
        <CardContent>
          {view === "chart" ? (
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={period}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="month" fontSize={11} />
                <YAxis tickFormatter={(v) => `₹${(v/1000).toFixed(0)}k`} fontSize={11} />
                <Tooltip trigger={getTooltipTrigger()} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} content={<SmartTooltipContent labelPrefix="Month" valueFormatter={(v) => inr(v)} />} />
                <Legend />
                <Bar dataKey="collection" fill="var(--color-chart-2)" name="Collection" radius={[4,4,0,0]} />
                <Bar dataKey="expense" fill="var(--color-chart-1)" name="Expense" radius={[4,4,0,0]} />
                <Line type="monotone" dataKey="net" stroke="var(--color-chart-4)" strokeWidth={2} name="Net" />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left p-2">Month</th>
                    <th className="text-right p-2">Collection</th>
                    <th className="text-right p-2">Expense</th>
                    <th className="text-right p-2">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {period.map((m) => (
                    <tr key={m.month} className="border-t border-border">
                      <td className="p-2">{m.month}</td>
                      <td className="p-2 text-right font-mono">{inr(m.collection)}</td>
                      <td className="p-2 text-right font-mono">{inr(m.expense)}</td>
                      <td className="p-2 text-right font-mono">{inr(m.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>

  );
}

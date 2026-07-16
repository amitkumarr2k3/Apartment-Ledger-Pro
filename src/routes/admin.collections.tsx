import { createFileRoute } from "@tanstack/react-router";
import { PortalShell, usePeriod } from "@/components/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tooltip, Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, XAxis, YAxis, Legend, Area, AreaChart } from "recharts";
import { SmartTooltipContent, getTooltipTrigger } from "@/components/smart-tooltip";
import { inr, pct, monthlyTotals as monthlyTotalsMock } from "@/lib/finance-mock";
import { AlertTriangle } from "lucide-react";
import { useMonthlyTotals } from "@/lib/hooks";
import { useShowMockData, NoDbData } from "@/components/mock-gate";

export const Route = createFileRoute("/admin/collections")({
  component: Page,
  head: () => ({ meta: [{ title: "Admin · Collection Performance" }] }),
});

function Page() {
  return (
    <PortalShell title="Collection performance (aggregate)" reqIds="AD-20 → AD-24" persona="admin">
      <Inner />
    </PortalShell>
  );
}

function Inner() {
  const { sliceMonthly } = usePeriod();
  const showMock = useShowMockData();
  const { data: apiMonthly } = useMonthlyTotals();
  const source = showMock ? monthlyTotalsMock : (apiMonthly ?? []);
  if (!showMock && source.length === 0) {
    return <NoDbData note="Collection charts appear once monthly income transactions are recorded." />;
  }
  const data = sliceMonthly(source).map((m, i, arr) => {
    const prev = arr[i - 1]?.collection;
    const change = prev ? ((m.collection - prev) / prev) * 100 : 0;
    return { ...m, change, expected: 400000 };
  });

  const sharpDrops = data.filter((d) => d.change < -10);

  let cum = 0;
  const cumulative = data.map((d) => {
    cum += d.net;
    return { month: d.month, cumulative: cum };
  });

  const quarters: { q: string; collection: number; expense: number }[] = [];
  data.forEach((d, i) => {
    const qi = Math.floor(i / 3);
    if (!quarters[qi]) quarters[qi] = { q: `Q${qi + 1}`, collection: 0, expense: 0 };
    quarters[qi].collection += d.collection;
    quarters[qi].expense += d.expense;
  });

  return (
    <>
      {sharpDrops.length > 0 && (
        <Alert className="border-amber-500/40 bg-amber-500/5">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertTitle>Collection volatility · AD-21</AlertTitle>
          <AlertDescription>
            Sharp drop{sharpDrops.length > 1 ? "s" : ""} detected in:{" "}
            {sharpDrops.map((d) => `${d.month} (${pct(d.change)})`).join(", ")}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monthly collection vs expense vs expected</CardTitle>
          <CardDescription>AD-20, AD-24 · Aggregate</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={data}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="month" fontSize={11} />
              <YAxis tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} fontSize={11} />
              <Tooltip trigger={getTooltipTrigger()} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} content={<SmartTooltipContent labelPrefix="Period" valueFormatter={(v) => inr(v)} />} />
              <Legend />
              <Bar dataKey="collection" name="Collection" fill="var(--color-chart-2)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="expense" name="Expense" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="expected" name="Expected collection" stroke="var(--color-chart-4)" strokeWidth={2} strokeDasharray="6 4" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cumulative net movement · AD-23</CardTitle>
            <CardDescription>Running collections − expenses over the period</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={cumulative}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="month" fontSize={11} />
                <YAxis tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} fontSize={11} />
                <Tooltip trigger={getTooltipTrigger()} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} content={<SmartTooltipContent labelPrefix="Period" valueFormatter={(v) => inr(v)} />} />
                <Area type="monotone" dataKey="cumulative" stroke="var(--color-chart-3)" fill="var(--color-chart-3)" fillOpacity={0.2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quarterly pattern · AD-22</CardTitle>
            <CardDescription>Identify seasonal pressure periods</CardDescription>
          </CardHeader>
          <CardContent>
            {quarters.length === 0 ? (
              <p className="text-sm text-muted-foreground">Not enough months in this range for a quarterly view.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={quarters}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="q" fontSize={11} />
                  <YAxis tickFormatter={(v) => `₹${(v / 100000).toFixed(1)}L`} fontSize={11} />
                  <Tooltip trigger={getTooltipTrigger()} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} content={<SmartTooltipContent labelPrefix="Period" valueFormatter={(v) => inr(v)} />} />
                  <Legend />
                  <Bar dataKey="collection" fill="var(--color-chart-2)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="expense" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { PortalShell, usePeriod } from "@/components/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, XAxis, YAxis, Legend } from "recharts";
import { SmartTooltipContent, getTooltipTrigger } from "@/components/smart-tooltip";
import { inr, pct, categoryMonthly, total, type Category } from "@/lib/finance-mock";
import { TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";
import { NoDbData } from "@/components/mock-gate";
import { useExpenseTree } from "@/lib/hooks";

export const Route = createFileRoute("/admin/alerts")({
  component: Page,
  head: () => ({ meta: [{ title: "Admin · Cost Alerts & Trends" }] }),
});

function deriveAnalytics(
  tree: Category[],
  sliceMonthly: <T>(arr: T[]) => T[],
  priorSliceMonthly: <T>(arr: T[]) => T[],
) {
  const momChanges = tree.map((c) => {
    const m = categoryMonthly(c);
    const cur = total(sliceMonthly(m));
    const prev = total(priorSliceMonthly(m));
    const change = prev ? ((cur - prev) / Math.abs(prev)) * 100 : 0;
    const periodChange = change;
    return { category: c.name, current: cur, previous: prev, change, periodChange };
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
    .filter((a) => a.ratio >= 1.5)
    .sort((a, b) => b.ratio - a.ratio);
  return { momChanges, anomalies };
}

function Page() {
  return (
    <PortalShell title="Cost trend & anomaly alerts" reqIds="AD-01 · AD-02 · AD-03 · AD-04 · AD-05" persona="admin">
      <Inner />
    </PortalShell>
  );
}

function Inner() {
  const { data: expenseTree = [], isLoading } = useExpenseTree();
  const { sliceMonthly, priorSliceMonthly, labels } = usePeriod();
  const [selected, setSelected] = useState<string | null>(null);
  const { momChanges, anomalies } = useMemo(
    () => deriveAnalytics(expenseTree, sliceMonthly, priorSliceMonthly),
    [expenseTree, sliceMonthly, priorSliceMonthly],
  );

  const activeName = selected ?? expenseTree[0]?.name ?? null;
  const cat = expenseTree.find((c) => c.name === activeName);

  if (!isLoading && expenseTree.length === 0) {
    return (
      <NoDbData note="Cost alerts and MoM changes require at least two months of expense data." />
    );
  }

  const monthly = cat ? sliceMonthly(categoryMonthly(cat)) : new Array(labels.length).fill(0);
  const sma = monthly.map((_, i) => {
    const slice = monthly.slice(Math.max(0, i - 2), i + 1);
    return slice.reduce((s, n) => s + n, 0) / slice.length;
  });
  const chartData = labels.map((m, i) => ({ month: m, value: monthly[i], sma: Math.round(sma[i]) }));
  const rising = momChanges.filter((c) => c.periodChange > 15).sort((a, b) => b.periodChange - a.periodChange);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-500" /> Cost alerts · AD-01
          </CardTitle>
          <CardDescription>Categories with spend increase &gt; 15% vs prior period</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {rising.length === 0 && <p className="text-sm text-muted-foreground">No categories exceed the 15% threshold this period.</p>}
          {rising.map((r) => (
            <Link
              key={r.category}
              to="/resident/drilldown"
              search={(((prev: any) => ({ ...prev, head: "expense", category: r.category, vendor: undefined, line: undefined })) as any)}
              className="flex items-center justify-between p-3 rounded-md border border-rose-500/30 bg-rose-500/5 hover:bg-rose-500/10 transition-colors"
            >
              <div className="flex items-center gap-3">
                <TrendingUp className="h-4 w-4 text-rose-500" />
                <div>
                  <div className="font-medium">{r.category}</div>
                  <div className="text-xs text-muted-foreground">Current {inr(r.current)} · prev avg {inr(Math.round((r.current) / (1 + r.periodChange / 100)))}</div>
                </div>
              </div>
              <Badge className="bg-rose-500/10 text-rose-600 border-rose-500/30" variant="outline">{pct(r.periodChange, 1)}</Badge>
            </Link>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sudden spike anomalies · AD-02</CardTitle>
          <CardDescription>Month spend &gt; 2× average of previous 3 months</CardDescription>
        </CardHeader>
        <CardContent>
          {anomalies.length === 0 ? (
            <p className="text-sm text-muted-foreground">No anomalies detected in the selected range.</p>
          ) : (
            <ul className="space-y-2">
              {anomalies.map((a) => (
                <li key={a.category}>
                  <Link
                    to="/resident/drilldown"
                    search={(((prev: any) => ({ ...prev, head: "expense", category: a.category, vendor: undefined, line: undefined })) as any)}
                    className="flex items-center justify-between p-3 rounded-md border border-amber-500/30 bg-amber-500/5 text-sm hover:bg-amber-500/10 transition-colors"
                  >
                    <span className="font-medium">{a.category}</span>
                    <span className="text-muted-foreground">
                      {inr(a.cur)} vs 3-mo avg {inr(a.avg)} · <span className="text-amber-600 font-semibold">{a.ratio.toFixed(1)}×</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {cat && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Category trend · AD-03</CardTitle>
              <CardDescription>Selected-period spend with 3-month moving average</CardDescription>
            </div>
            <Select value={activeName ?? undefined} onValueChange={setSelected}>
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {expenseTree.map((c) => <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="month" fontSize={11} />
                <YAxis tickFormatter={(v) => `₹${(v/1000).toFixed(0)}k`} fontSize={11} />
                <Tooltip trigger={getTooltipTrigger()} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} content={<SmartTooltipContent labelPrefix="Month" valueFormatter={(v) => inr(v)} />} />
                <Legend />
                <Bar dataKey="value" name="Monthly spend" fill="var(--color-chart-1)" radius={[4,4,0,0]} />
                <Line type="monotone" dataKey="sma" name="3-mo moving avg" stroke="var(--color-chart-4)" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Month-over-month change · AD-04</CardTitle>
          <CardDescription>Colour-coded: green (down), amber (±15%), red (up &gt;15%)</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Previous period</TableHead>
                <TableHead className="text-right">Current period</TableHead>
                <TableHead className="text-right">MoM change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {momChanges.map((r) => {
                const tone =
                  r.change > 15 ? "text-rose-600 bg-rose-500/10" :
                  r.change < 0 ? "text-emerald-600 bg-emerald-500/10" :
                  "text-amber-600 bg-amber-500/10";
                return (
                  <TableRow key={r.category}>
                    <TableCell className="font-medium">{r.category}</TableCell>
                    <TableCell className="text-right font-mono">{inr(r.previous)}</TableCell>
                    <TableCell className="text-right font-mono">{inr(r.current)}</TableCell>
                    <TableCell className="text-right">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-xs ${tone}`}>
                        {r.change >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                        {pct(r.change, 1)}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

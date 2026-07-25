import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { PortalShell, usePeriod } from "@/components/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, XAxis, YAxis, Legend } from "recharts";
import { SmartTooltipContent, getTooltipTrigger } from "@/components/smart-tooltip";
import { inr, pct, categoryMonthly, total, type Category } from "@/lib/finance-mock";
import { AlertTriangle, ArrowRight, Snowflake } from "lucide-react";
import { NoDbData } from "@/components/mock-gate";
import { useExpenseTree } from "@/lib/hooks";

export const Route = createFileRoute("/admin/actions")({
  component: Page,
  head: () => ({ meta: [{ title: "Admin · Action Needed" }] }),
});

const budgets: Record<string, number> = {
  Utilities: 480000, Maintenance: 800000, Security: 700000, Housekeeping: 400000, "Petty Cash": 60000,
};

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
  const { sliceMonthly, priorSliceMonthly, labels } = usePeriod();
  const { momChanges, anomalies } = useMemo(
    () => derive(expenseTree, sliceMonthly, priorSliceMonthly),
    [expenseTree, sliceMonthly, priorSliceMonthly],
  );

  if (!isLoading && expenseTree.length === 0) {
    return (
      <NoDbData note="Alerts, projections and budget variance appear once transactions exist for the selected period." />
    );
  }

  const risingItems = momChanges.filter((c) => c.periodChange > 15).map((c) => ({
    kind: "Rising cost", label: c.category, detail: `${pct(c.periodChange)} vs prior period`, to: "/admin/alerts",
  }));
  const anomalyItems = anomalies.map((a) => ({
    kind: "Anomaly", label: a.category, detail: `Current ${inr(a.cur)} · ${a.ratio.toFixed(1)}× 3-mo avg`, to: "/admin/alerts",
  }));
  const actions = [...anomalyItems, ...risingItems].slice(0, 5);

  const risingCat = expenseTree.find((c) => c.name === risingItems[0]?.label) ?? expenseTree[0];
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

  const budgetRows = expenseTree.map((c) => {
    const spent = total(sliceMonthly(categoryMonthly(c)));
    const budget = Math.round(((budgets[c.name] ?? (spent || 1)) / 12) * Math.max(1, labels.length));
    const variance = ((spent - budget) / budget) * 100;
    return { category: c.name, budget, spent, variance };
  });

  return (
    <>
      <Card className="border-rose-500/30">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-500" /> Top 5 items needing attention · AD-41
          </CardTitle>
          <CardDescription>Highest-priority flagged items — anomalies, rising costs, income drops</CardDescription>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          {actions.length === 0 && <p className="text-sm text-muted-foreground py-3">Nothing flagged. All categories look healthy.</p>}
          {actions.map((a, i) => (
            <Link key={i} to={a.to} className="flex items-center justify-between py-3 group hover:bg-accent/40 -mx-4 px-4 rounded">
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

      {risingCat && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Projection · {risingCat.name} · AD-40</CardTitle>
            <CardDescription>Linear extrapolation for the next 2 months (dashed)</CardDescription>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Budget vs actual · AD-43</CardTitle>
            <CardDescription>Categories over budget flagged red</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Budget</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  <TableHead className="text-right w-[100px]">Variance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {budgetRows.map((r) => (
                  <TableRow key={r.category}>
                    <TableCell className="font-medium">{r.category}</TableCell>
                    <TableCell className="text-right font-mono">{inr(r.budget)}</TableCell>
                    <TableCell className="text-right font-mono">{inr(r.spent)}</TableCell>
                    <TableCell className="text-right">
                      <span className={`font-mono text-xs px-2 py-0.5 rounded ${
                        r.variance > 0 ? "bg-rose-500/10 text-rose-600" : "bg-emerald-500/10 text-emerald-600"
                      }`}>{pct(r.variance)}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Snowflake className="h-4 w-4 text-cyan-500" /> Seasonal patterns · AD-42
            </CardTitle>
            <CardDescription>Categories with consistent seasonal spikes — expected, not alerts</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { cat: "Utilities", month: "Apr–May", note: "Summer backup load typically 30% higher" },
              { cat: "Maintenance", month: "Jun", note: "Pre-monsoon painting & waterproofing" },
              { cat: "Petty Cash", month: "Dec", note: "Community event contributions" },
            ].map((s) => (
              <div key={s.cat} className="p-3 rounded-md border border-cyan-500/30 bg-cyan-500/5 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{s.cat}</span>
                  <Badge variant="outline" className="text-[10px]">{s.month}</Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-1">{s.note}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

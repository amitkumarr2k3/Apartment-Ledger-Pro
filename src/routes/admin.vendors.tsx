import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { PortalShell, usePeriod } from "@/components/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { SmartTooltipContent, getTooltipTrigger } from "@/components/smart-tooltip";
import { inr, pct, total, vendorMonthly } from "@/lib/finance-mock";
import { TrendingUp, ChevronRight, ExternalLink } from "lucide-react";
import { NoDbData } from "@/components/mock-gate";
import { useExpenseTree } from "@/lib/hooks";

export const Route = createFileRoute("/admin/vendors")({
  component: Page,
  head: () => ({ meta: [{ title: "Admin · Vendor Analysis" }] }),
});

function Page() {
  return (
    <PortalShell title="Vendor & service provider analysis" reqIds="AD-10 → AD-14" persona="admin">
      <Inner />
    </PortalShell>
  );
}

function Inner() {
  const { data: expenseTree = [], isLoading } = useExpenseTree();
  const { sliceMonthly, priorSliceMonthly, labels, view } = usePeriod();
  const [openVendor, setOpenVendor] = useState<string | null>(null);

  const vendorRanking = useMemo(() => expenseTree
    .flatMap((c) => c.vendors.map((v) => {
      const full = vendorMonthly(v);
      const selected = sliceMonthly(full);
      const previous = priorSliceMonthly(full);
      const selectedTotal = total(selected);
      const previousTotal = total(previous);
      return {
        vendor: v.name,
        category: c.name,
        kind: v.kind,
        total: selectedTotal,
        monthsActive: selected.filter((x) => x > 0).length,
        changePct: previousTotal ? ((selectedTotal - previousTotal) / Math.abs(previousTotal)) * 100 : 0,
      };
    }))
    .filter((v) => v.total > 0)
    .sort((a, b) => b.total - a.total), [expenseTree, sliceMonthly, priorSliceMonthly]);

  const activeVendor = openVendor ?? vendorRanking[0]?.vendor ?? null;
  const vendorObj = useMemo(
    () => expenseTree.flatMap((c) => c.vendors).find((v) => v.name === activeVendor),
    [expenseTree, activeVendor],
  );
  const vendorTrend = useMemo(() => {
    if (!vendorObj) return new Array(labels.length).fill(0);
    return vendorMonthly(vendorObj);
  }, [vendorObj, labels.length]);
  const slicedTrend = sliceMonthly(vendorTrend);
  const trendData = labels.map((m, i) => ({ month: m, value: slicedTrend[i] ?? 0 }));

  if (!isLoading && vendorRanking.length === 0) {
    return (
      <NoDbData note="Vendor analytics will appear once expense transactions with vendors are imported." />
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vendor ranking · AD-10, AD-13, AD-14</CardTitle>
          <CardDescription>Sorted by total spend · flagged rows exceed +20% period change</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Total spend</TableHead>
                <TableHead className="text-right">Period change</TableHead>
                <TableHead className="text-right">Frequency</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {vendorRanking.map((v) => {
                const flagged = v.changePct > 20;
                return (
                  <TableRow key={v.vendor} className={activeVendor === v.vendor ? "bg-accent/40" : ""}>
                    <TableCell className="font-medium">{v.vendor}</TableCell>
                    <TableCell className="text-muted-foreground">{v.category}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{v.kind}</Badge></TableCell>
                    <TableCell className="text-right font-mono">{inr(v.total)}</TableCell>
                    <TableCell className="text-right">
                      <span className={`inline-flex items-center gap-1 font-mono text-xs px-2 py-0.5 rounded ${
                        flagged ? "bg-rose-500/10 text-rose-600" : v.changePct < 0 ? "bg-emerald-500/10 text-emerald-600" : "text-muted-foreground"
                      }`}>
                        {flagged && <TrendingUp className="h-3 w-3" />}
                        {pct(v.changePct)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">{v.monthsActive} / {labels.length} months</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-3">
                        <button onClick={() => setOpenVendor(v.vendor)} className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                          Preview <ChevronRight className="h-3 w-3" />
                        </button>
                        <Link
                          to="/resident/drilldown"
                          search={(((prev: any) => ({ ...prev, head: "expense", category: v.category, vendor: v.vendor, line: undefined })) as any)}
                          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                          title="Open in drill-down"
                        >
                          Drill <ExternalLink className="h-3 w-3" />
                        </Link>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {vendorObj && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">{vendorObj.name} · monthly trend</CardTitle>
              <CardDescription>AD-11 · Steady rise pattern shows here</CardDescription>
            </CardHeader>
            <CardContent>
              {view === "chart" ? (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="month" fontSize={11} />
                    <YAxis tickFormatter={(v) => `₹${(v/1000).toFixed(0)}k`} fontSize={11} />
                    <Tooltip trigger={getTooltipTrigger()} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} content={<SmartTooltipContent labelPrefix="Vendor" valueFormatter={(v) => inr(v)} />} />
                    <Bar dataKey="value" fill="var(--color-chart-3)" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="rounded-md border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="text-left p-2">Month</th>
                        <th className="text-right p-2">Spend</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trendData.map((r) => (
                        <tr key={r.month} className="border-t border-border">
                          <td className="p-2">{r.month}</td>
                          <td className="p-2 text-right font-mono">{inr(r.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Line items · AD-12</CardTitle>
              <CardDescription>Vendor breakdown</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {vendorObj.items.map((it) => {
                  const t = total(sliceMonthly(it.monthly));
                  return (
                    <li key={it.name} className="flex justify-between border-b border-border pb-2 last:border-none">
                      <span>{it.name}</span>
                      <span className="font-mono">{inr(t)}</span>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}

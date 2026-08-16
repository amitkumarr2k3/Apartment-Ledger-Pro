import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { PortalShell, usePeriod } from "@/components/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { SmartTooltipContent, getTooltipTrigger } from "@/components/smart-tooltip";
import { inr, pct, total, vendorMonthly } from "@/lib/finance-mock";
import { TrendingUp, ChevronRight, ExternalLink, PieChart } from "lucide-react";
import { NoDbData } from "@/components/mock-gate";
import { useExpenseTree, useIncomeTree } from "@/lib/hooks";
import { filterReportableIncomeCategories } from "@/lib/income-utils";

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
  const { data: expenseTree = [], isLoading: expenseLoading } = useExpenseTree();
  const { data: incomeTree = [], isLoading: incomeLoading } = useIncomeTree();
  const { sliceMonthly, priorSliceMonthly, labels, view } = usePeriod();
  // FIX (2026-08-15): income-side vendors (e.g. commercial tenants like a
  // creche or laundry service under "Commercial Income") were invisible on
  // this page because it only ever queried the expense tree. Rather than
  // merge both directions into one table (confusing -- "spend" and
  // "collected" aren't the same thing) or stack two separate tables (breaks
  // the single Preview panel below, which only makes sense for one active
  // vendor at a time), this uses a sub-tab: only one direction's table (and
  // its own Preview/drill-down) is visible at once.
  const [vendorHead, setVendorHead] = useState<"expense" | "income">("expense");
  const [openVendor, setOpenVendor] = useState<string | null>(null);
  useEffect(() => { setOpenVendor(null); }, [vendorHead]);

  // FIX (2026-08-15): the Income vendors tab was showing raw incomeTree
  // categories, including Rate Reference rows (Maintenance/Contingency Rate
  // Reference -- these are per-sqft calculation aids, never real money),
  // Tax Collected (Liability) (GST held on behalf of the government, not
  // society income), and Maintenance Outstanding (unpaid dues, not
  // collected income). filterReportableIncomeCategories is the same shared
  // exclusion used by Income Optimisation and Collections -- applying it
  // here too so this tab agrees with the rest of the app on what counts as
  // real, collected income.
  const tree = vendorHead === "expense" ? expenseTree : filterReportableIncomeCategories(incomeTree);
  const isLoading = vendorHead === "expense" ? expenseLoading : incomeLoading;

  // FIX (2026-08-15): the same vendor NAME can appear under multiple
  // categories (e.g. "Petty Cash" under both "Petty Cash" and "Office
  // Supplies" categories -- very common on the income side). Using the bare
  // vendor name as an identity key (React key, active-selection state, and
  // the vendorObj lookup) meant: (a) React could visually mix up which row
  // showed which data across re-renders -- the apparent "broken sort" you
  // saw was actually React key collision corruption, not a bad sort -- and
  // (b) clicking Preview on the SECOND "Petty Cash" row would silently pull
  // up the FIRST one's chart/line items, since .find() just grabs whichever
  // matches first. A compound category+vendor key fixes both.
  const vendorRanking = useMemo(() => tree
    .flatMap((c) => c.vendors.map((v) => {
      const full = vendorMonthly(v);
      const selected = sliceMonthly(full);
      const previous = priorSliceMonthly(full);
      const selectedTotal = total(selected);
      const previousTotal = total(previous);
      return {
        key: `${c.name}::${v.name}`,
        vendor: v.name,
        category: c.name,
        kind: v.kind,
        total: selectedTotal,
        monthsActive: selected.filter((x) => x > 0).length,
        changePct: previousTotal ? ((selectedTotal - previousTotal) / Math.abs(previousTotal)) * 100 : 0,
      };
    }))
    .filter((v) => v.total > 0)
    .sort((a, b) => b.total - a.total), [tree, sliceMonthly, priorSliceMonthly]);

  const activeVendor = openVendor ?? vendorRanking[0]?.key ?? null;
  const vendorObj = useMemo(
    () => tree.flatMap((c) => c.vendors.map((v) => ({ v, key: `${c.name}::${v.name}` }))).find((x) => x.key === activeVendor)?.v,
    [tree, activeVendor],
  );
  const vendorTrend = useMemo(() => {
    if (!vendorObj) return new Array(labels.length).fill(0);
    return vendorMonthly(vendorObj);
  }, [vendorObj, labels.length]);
  const slicedTrend = sliceMonthly(vendorTrend);
  const trendData = labels.map((m, i) => ({ month: m, value: slicedTrend[i] ?? 0 }));

  // New: concentration-risk signal -- "Vendor patterns" is an explicitly
  // named persona focus area, and a sortable list alone doesn't answer the
  // control-oriented question "are we over-reliant on a few vendors?"
  const totalRanked = vendorRanking.reduce((s, v) => s + v.total, 0);
  const top3Total = vendorRanking.slice(0, 3).reduce((s, v) => s + v.total, 0);
  const top3SharePct = totalRanked > 0 ? (top3Total / totalRanked) * 100 : 0;

  const amountLabel = vendorHead === "expense" ? "Total spend" : "Total collected";
  const rankingNote = vendorHead === "expense"
    ? "Sorted by total spend \u00b7 flagged rows exceed +20% period change"
    : "Sorted by total collected \u00b7 flagged rows exceed +20% period change";
  const emptyNote = vendorHead === "expense"
    ? "Vendor analytics will appear once expense transactions with vendors are imported."
    : "No income-side vendors found for the selected period (e.g. commercial tenants under Commercial Income).";

  return (
    <>
      {/* Sub-tab: Expense vendors (who we pay) vs Income vendors (who pays
          us -- e.g. commercial tenants). Only one table + its Preview panel
          is visible at a time, so there's never ambiguity about which
          vendor set a drill-down/preview belongs to. */}
      <Tabs value={vendorHead} onValueChange={(v) => setVendorHead(v as "expense" | "income")}>
        <TabsList>
          <TabsTrigger value="expense">Expense vendors</TabsTrigger>
          <TabsTrigger value="income">Income vendors</TabsTrigger>
        </TabsList>
      </Tabs>

      {!isLoading && vendorRanking.length === 0 ? (
        <NoDbData note={emptyNote} />
      ) : (
      <>
      {/* New: concentration-risk callout -- a sortable list alone doesn't
          answer the control-oriented question "are we over-reliant on a
          few vendors?" This surfaces it at a glance, above the table. */}
      {vendorRanking.length >= 3 && (
        <div className="flex items-center gap-2 rounded-md border border-violet-500/30 bg-violet-500/5 px-3 py-2.5 text-sm text-violet-800 dark:text-violet-300">
          <PieChart className="h-4 w-4 shrink-0 text-violet-600" />
          <p>
            Top 3 vendors ({vendorRanking.slice(0, 3).map((v) => v.vendor).join(", ")}) make up{" "}
            <span className="font-semibold">{top3SharePct.toFixed(0)}%</span> of {vendorHead === "expense" ? "total spend" : "total collected"} this period.
          </p>
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {vendorHead === "expense" ? "Vendor ranking · AD-10, AD-13, AD-14" : "Income vendor ranking"}
          </CardTitle>
          <CardDescription>{rankingNote}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">{amountLabel}</TableHead>
                <TableHead className="text-right">Period change</TableHead>
                <TableHead className="text-right">Frequency</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {vendorRanking.map((v) => {
                const flagged = v.changePct > 20;
                return (
                  <TableRow key={v.key} className={activeVendor === v.key ? "bg-accent/40" : ""}>
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
                        <button onClick={() => setOpenVendor(v.key)} className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                          Preview <ChevronRight className="h-3 w-3" />
                        </button>
                        <Link
                          to="/resident/drilldown"
                          search={(((prev: any) => ({ ...prev, head: vendorHead, category: v.category, vendor: v.vendor, line: undefined })) as any)}
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
                {/* FIX (2026-08-15): sort by Amount, descending -- previously
                    unsorted (natural line-item order from the tree). */}
                {[...vendorObj.items]
                  .map((it) => ({ it, t: total(sliceMonthly(it.monthly)) }))
                  .sort((a, b) => b.t - a.t)
                  .map(({ it, t }) => (
                    <li key={it.name} className="flex justify-between border-b border-border pb-2 last:border-none">
                      <span>{it.name}</span>
                      <span className="font-mono">{inr(t)}</span>
                    </li>
                  ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}
      </>
      )}
    </>
  );
}

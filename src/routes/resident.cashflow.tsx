import { createFileRoute } from "@tanstack/react-router";
import { PortalShell, usePeriod } from "@/components/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SmartTooltipContent, getTooltipTrigger } from "@/components/smart-tooltip";
import { inr, categoryMonthly } from "@/lib/finance-mock";
import { useMonthlyTotals, useIncomeTree } from "@/lib/hooks";
import { Info, TrendingDown, TrendingUp, Award, AlertOctagon } from "lucide-react";

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

const TOTAL_SQFT = 701591;

function Inner() {
  const { sliceMonthly, view, labels = [] } = usePeriod();
  const { data: monthlyTotals = [] } = useMonthlyTotals();
  const { data: incomeTree = [] } = useIncomeTree();
  const safeIncomeTree = incomeTree || [];
  const period = sliceMonthly(monthlyTotals);

  // ---- Same business rules as Overview -- kept in sync so every dashboard
  // agrees on what counts as real income, on purpose. ----
  const isTax = (s: string) => /tax|gst|cgst|sgst/i.test(s || "");
  const isMaintenanceLoose = (s: string) => /maintenance/i.test(s || "") && !/outstanding|arrears|default/i.test(s || "");
  const isLiability = (s: string) => /outstanding|arrears|default/i.test(s || "");
  const isMaintenanceChargeExact = (s: string) => (s || "").trim().toLowerCase() === "maintenance charge";
  const isMaintenanceRateReference = (s: string) => /maintenance rate reference/i.test(s || "");
  const isContingencyRateReference = (s: string) => /contingency rate reference/i.test(s || "");
  const isAnyRateReference = (s: string) => isMaintenanceRateReference(s) || isContingencyRateReference(s);

  // Actual Collection = ONLY the "Maintenance Charge" line item (mirrors
  // Overview\u2019s Collected Maintenance card exactly).
  const maintenanceChargeRawMonthly = safeIncomeTree.reduce<number[]>((acc, c) => {
    const catHit = isMaintenanceChargeExact(c.name);
    (c.vendors || []).forEach((v) => {
      const vHit = isMaintenanceChargeExact(v.name);
      (v.items || []).forEach((i) => {
        if (catHit || vHit || isMaintenanceChargeExact(i.name)) {
          const monthly = i.monthly || [];
          acc = acc.length === 0 ? [...monthly] : acc.map((val, idx) => val + (monthly[idx] ?? 0));
        }
      });
    });
    return acc;
  }, []);
  const actualCollectionByMonth = sliceMonthly(maintenanceChargeRawMonthly);

  // Other reportable income: excludes maintenance, outstanding/arrears, tax,
  // and the internal rate-reference categories -- NOT the raw
  // mv_monthly_totals collection figure, which still silently includes
  // Tax/GST and Maintenance Outstanding at the database level.
  const otherIncomeByMonth = sliceMonthly(
    safeIncomeTree
      .filter((c) => !(isMaintenanceLoose(c.name) || isLiability(c.name) || isTax(c.name) || isAnyRateReference(c.name)))
      .reduce<number[]>((acc, c) => {
        const monthly = categoryMonthly(c);
        return acc.length === 0 ? monthly : acc.map((v, i) => v + (monthly[i] ?? 0));
      }, []),
  );

  // "Previous Arrears Brought Forward" is uploaded every month, dated for
  // the FOLLOWING month (e.g. the entry dated 1-Aug is the closing/cumulative
  // outstanding as of the end of July) -- it already IS the running total,
  // no addition needed, just a one-month shift. "Current Month Unpaid
  // Maintenance" is restricted to Income Visibility's RD-32 chart ONLY and
  // must not be read here at all.
  const isPreviousArrearsBF = (s: string) => (s || "").trim().toLowerCase() === "previous arrears brought forward";
  const liabilityLineItemRawMonthly = (matchLineItem: (name: string) => boolean): number[] => {
    let result: number[] = [];
    safeIncomeTree.filter((c) => isLiability(c.name)).forEach((c) => {
      (c.vendors || []).forEach((v) => {
        (v.items || []).forEach((i) => {
          if (matchLineItem(i.name)) {
            const monthly = i.monthly || [];
            result = result.length === 0 ? [...monthly] : result.map((val, idx) => val + (monthly[idx] ?? 0));
          }
        });
      });
    });
    return result;
  };
  const bfRawMonthly = liabilityLineItemRawMonthly(isPreviousArrearsBF);

  // Cumulative outstanding for month i = the BF entry dated the FOLLOWING
  // calendar month (index i + 1 in the same array) -- taken at face value,
  // no addition. Built across the FULL unsliced history first, then sliced
  // to the selected period, so the shift lines up correctly regardless of
  // which window is currently visible.
  const cumulativeOutstandingFullByMonth = bfRawMonthly.map((_, idx) => bfRawMonthly[idx + 1] ?? 0);
  const cumulativeOutstandingByMonth = sliceMonthly(cumulativeOutstandingFullByMonth);

  // Expected Collection = per-sqft rate x fixed area (same Rate Reference
  // data source as Overview\u2019s Expected Collection card).
  const rateCategory = safeIncomeTree.find((c) => isMaintenanceRateReference(c.name));
  const rateMonthly = rateCategory ? sliceMonthly(categoryMonthly(rateCategory)) : [];

  const periodMonthlyTotals = new Map(period.map((m) => [m.month, m]));
  const monthlyTrend = (labels || []).map((month, i) => {
    const monthlyTotal = periodMonthlyTotals.get(month);
    const actualCollection = actualCollectionByMonth[i] ?? 0;
    const otherIncome = otherIncomeByMonth[i] ?? 0;
    const totalIncomeThisMonth = actualCollection + otherIncome;
    const expectedCollectionThisMonth = ((rateMonthly[i] ?? 0) / 100) * TOTAL_SQFT;
    return {
      month,
      actual_collection: actualCollection,
      expected_collection: expectedCollectionThisMonth,
      other_income: otherIncome,
      total_income: totalIncomeThisMonth,
      expense: monthlyTotal?.expense ?? 0,
      cumulative_outstanding: cumulativeOutstandingByMonth[i] ?? 0,
      net: totalIncomeThisMonth - (monthlyTotal?.expense ?? 0),
    };
  });

  // ---- Clean, consistent totals (replaces the old raw mv_monthly_totals
  // "collection" figure, which used to silently include Tax/GST and
  // Maintenance Outstanding). ----
  const totalIncomeClean = monthlyTrend.reduce((s, m) => s + m.total_income, 0);
  const totalExpenseClean = monthlyTrend.reduce((s, m) => s + m.expense, 0);
  const totalExpectedClean = monthlyTrend.reduce((s, m) => s + m.expected_collection, 0);
  const totalActualClean = monthlyTrend.reduce((s, m) => s + m.actual_collection, 0);

  // % of collected income that has been spent
  const ratio = totalIncomeClean === 0 ? 0 : (totalExpenseClean / totalIncomeClean) * 100;
  const surplus = monthlyTrend.filter((m) => m.net >= 0).length;
  const deficit = monthlyTrend.length - surplus;

  // NEW INSIGHT: Expected vs Actual maintenance collection variance
  const collectionVariancePct = totalExpectedClean === 0
    ? 0
    : ((totalActualClean - totalExpectedClean) / totalExpectedClean) * 100;

  // NEW INSIGHT: best / worst month by net (total income - expense)
  const bestMonth = monthlyTrend.length ? monthlyTrend.reduce((a, b) => (b.net > a.net ? b : a)) : null;
  const worstMonth = monthlyTrend.length ? monthlyTrend.reduce((a, b) => (b.net < a.net ? b : a)) : null;

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
            <p className="text-xs text-muted-foreground">out of {monthlyTrend.length} months in selected range</p>
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

      {/* NEW INSIGHTS: Expected-vs-Actual variance + best/worst month callouts */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase tracking-wider">Collection performance vs target</CardDescription>
            <CardTitle className={`text-3xl font-mono ${collectionVariancePct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
              {collectionVariancePct >= 0 ? "+" : ""}{collectionVariancePct.toFixed(1)}%
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Actual maintenance collected ({inr(totalActualClean)}) vs the expected target ({inr(totalExpectedClean)}) based on the per-sqft rate.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase tracking-wider">Best &amp; worst month (net)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {bestMonth && (
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1 text-emerald-600"><Award className="h-4 w-4" /> {bestMonth.month}</span>
                <span className="font-mono">{inr(bestMonth.net)}</span>
              </div>
            )}
            {worstMonth && (
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1 text-rose-600"><AlertOctagon className="h-4 w-4" /> {worstMonth.month}</span>
                <span className="font-mono">{inr(worstMonth.net)}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* RD-21 -- moved from Overview: strictly richer than the old bar chart
          it replaces (adds Expected Collection target + cumulative outstanding
          risk signal, and fixes the Tax/GST contamination that previously
          existed in the raw "collection" figure this page used to show). */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monthly trend · actual vs expected collection, expense &amp; outstanding</CardTitle>
          <CardDescription>RD-21 · Moved from Overview · Includes cumulative outstanding signal</CardDescription>
        </CardHeader>
        <CardContent>
          {view === "chart" ? (
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={monthlyTrend} margin={{ left: 8, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="month" fontSize={11} />
                <YAxis tickFormatter={(v) => `\u20B9${(v / 1000).toFixed(0)}k`} fontSize={11} />
                <Tooltip trigger={getTooltipTrigger()} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} content={<SmartTooltipContent labelPrefix="Month" valueFormatter={(v) => inr(v)} />} />
                <Legend />
                <Line type="monotone" dataKey="actual_collection" stroke="var(--color-chart-2)" strokeWidth={2} name="Actual Collection" />
                <Line type="monotone" dataKey="expected_collection" stroke="var(--color-chart-4, #a855f7)" strokeWidth={2} strokeDasharray="4 2" name="Expected Collection" />
                <Line type="monotone" dataKey="expense" stroke="var(--color-chart-1)" strokeWidth={2} name="Expense" />
                <Line type="monotone" dataKey="cumulative_outstanding" stroke="var(--color-chart-3)" strokeWidth={2} name="Cumulative outstanding" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left p-2">Month</th>
                    <th className="text-right p-2">Actual Collection</th>
                    <th className="text-right p-2">Expected Collection</th>
                    <th className="text-right p-2">Expense</th>
                    <th className="text-right p-2">Cumulative Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyTrend.map((m) => (
                    <tr key={m.month} className="border-t border-border">
                      <td className="p-2">{m.month}</td>
                      <td className="p-2 text-right font-mono">{inr(m.actual_collection)}</td>
                      <td className="p-2 text-right font-mono">{inr(m.expected_collection)}</td>
                      <td className="p-2 text-right font-mono">{inr(m.expense)}</td>
                      <td className="p-2 text-right font-mono">{inr(m.cumulative_outstanding)}</td>
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

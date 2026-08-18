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
  const isExpectedCollectionReference = (s: string) => /expected collection reference/i.test(s || "");
  const isAnyRateReference = (s: string) =>
    isMaintenanceRateReference(s) || isContingencyRateReference(s) || isExpectedCollectionReference(s);

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
  // ============================================================
  // EXPECTED COLLECTION -- now supplied DIRECTLY via CSV (head=reference,
  // category="Expected Collection Reference") instead of being computed
  // here from rate x fixed area. Old calculation kept below, commented out.
  // ============================================================
  const expectedCollectionCategory = safeIncomeTree.find((c) => isExpectedCollectionReference(c.name));
  const expectedCollectionByMonth = expectedCollectionCategory ? sliceMonthly(categoryMonthly(expectedCollectionCategory)) : [];

  // ---- OLD calculation (rate x fixed area) -- kept for easy rollback ----
  // const rateCategory = safeIncomeTree.find((c) => isMaintenanceRateReference(c.name));
  // const rateMonthly = rateCategory ? sliceMonthly(categoryMonthly(rateCategory)) : [];

  // Per-sqft rate -- shown as a 5th line on the trend chart below (its own
  // right-hand axis, since a Rs 4/sqft rate is invisible on a scale that
  // runs into the lakhs). Display only -- NOT used to compute Expected
  // Collection, which now comes directly from the CSV.
  const rateCategoryForDisplay = safeIncomeTree.find((c) => isMaintenanceRateReference(c.name));
  const rateMonthlyForDisplay = rateCategoryForDisplay ? sliceMonthly(categoryMonthly(rateCategoryForDisplay)) : [];

  const periodMonthlyTotals = new Map(period.map((m) => [m.month, m]));
  const monthlyTrend = (labels || []).map((month, i) => {
    const monthlyTotal = periodMonthlyTotals.get(month);
    const actualCollection = actualCollectionByMonth[i] ?? 0;
    const otherIncome = otherIncomeByMonth[i] ?? 0;
    const totalIncomeThisMonth = actualCollection + otherIncome;
    const expectedCollectionThisMonth = expectedCollectionByMonth[i] ?? 0;
    // const expectedCollectionThisMonth = ((rateMonthly[i] ?? 0) / 100) * TOTAL_SQFT; // OLD
    return {
      month,
      actual_collection: actualCollection,
      expected_collection: expectedCollectionThisMonth,
      other_income: otherIncome,
      total_income: totalIncomeThisMonth,
      expense: monthlyTotal?.expense ?? 0,
      cumulative_outstanding: cumulativeOutstandingByMonth[i] ?? 0,
      per_sqft_rate: (rateMonthlyForDisplay[i] ?? 0) / 100,
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

      {/* NEW INSIGHTS: Expected-vs-Actual variance + best/worst month callouts +
          current per-sqft rate (as a compact stat, not a whole extra chart --
          a rate that barely moves month to month doesn't need its own axis). */}
      <div className="grid gap-4 md:grid-cols-3">
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
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase tracking-wider">Maintenance rate trend · selected range</CardDescription>
            <CardTitle className="text-3xl font-mono">
              {"\u20B9"}{(rateMonthlyForDisplay[rateMonthlyForDisplay.length - 1] ?? 0) / 100}/sqft
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              // Trim leading months with no rate on file yet (stored as 0)
              // instead of plotting a false "rate was Rs 0" flat prefix --
              // that both looks like a sharp/artificial rise AND produces a
              // misleading "up from Rs 0" insight below. Start the trend at
              // the FIRST month a rate actually exists for.
              const firstAvailableIdx = rateMonthlyForDisplay.findIndex((v) => (v ?? 0) > 0);
              const trimmedLabels = firstAvailableIdx >= 0 ? labels.slice(firstAvailableIdx) : [];
              const trimmedRates = firstAvailableIdx >= 0 ? rateMonthlyForDisplay.slice(firstAvailableIdx) : [];
              const rateTrendData = trimmedLabels.map((m, i) => ({ month: m, rate: (trimmedRates[i] ?? 0) / 100 }));
              const first = (trimmedRates[0] ?? 0) / 100;
              const last = (trimmedRates[trimmedRates.length - 1] ?? 0) / 100;
              const delta = last - first;
              return (
                <>
                  <p className="text-xs text-muted-foreground mb-1">
                    {rateTrendData.length === 0
                      ? "No rate has been uploaded yet for this range"
                      : rateTrendData.length < 2 || delta === 0
                        ? "Unchanged across the selected range"
                        : `${delta > 0 ? "Up" : "Down"} from \u20B9${first}/sqft at the start of this range (${trimmedLabels[0]})`}
                  </p>
                  {rateTrendData.length > 0 && (
                    // Sparkline -- the trend itself, without the overhead of a
                    // full chart (no gridlines/legend). The X axis is real but
                    // hidden -- needed so the tooltip resolves actual month
                    // labels (e.g. "Apr '26") instead of falling back to a
                    // raw row index when no axis/dataKey is present at all.
                    <ResponsiveContainer width="100%" height={48}>
                      <LineChart data={rateTrendData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                        <XAxis dataKey="month" hide />
                        <Tooltip trigger={getTooltipTrigger()} content={<SmartTooltipContent labelPrefix="Month" valueFormatter={(v) => `\u20B9${v}/sqft`} />} />
                        <Line type="monotone" dataKey="rate" stroke="var(--color-chart-5, #9333ea)" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </>
              );
            })()}
          </CardContent>
        </Card>
      </div>

      {/* RD-21 -- redesigned to eliminate cross-page duplication. The previous
          version re-plotted "Actual/Expected Collection" here too, which is
          MAINTENANCE-ONLY data that Income Visibility already owns entirely.
          This chart now shows what Cashflow Health should uniquely own: the
          full cash-flow picture using TOTAL income (maintenance + every
          other income source, not just maintenance) against Total Expense,
          plus the cumulative Outstanding Dues trend -- none of which
          duplicates Income Visibility's maintenance-collection detail.
          Per Sqft Rate moved to a compact stat card above (a rate that
          barely moves month to month doesn't need its own chart+axis). */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monthly trend · total income, expense &amp; outstanding dues</CardTitle>
          <CardDescription>RD-21 · Total income here includes ALL income sources, not maintenance alone -- see Income Visibility for the maintenance-specific breakdown</CardDescription>
        </CardHeader>
        <CardContent>
          {view === "chart" ? (
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={monthlyTrend} margin={{ left: 8, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="month" fontSize={11} />
                <YAxis tickFormatter={(v) => `\u20B9${(v / 1000).toFixed(0)}k`} fontSize={11} />
                <Tooltip trigger={getTooltipTrigger()} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} content={<SmartTooltipContent labelPrefix="Month" valueFormatter={(v) => inr(v)} />} />
                <Legend />
                <Line type="monotone" dataKey="total_income" stroke="var(--color-chart-2)" strokeWidth={2} name="Total Income" />
                <Line type="monotone" dataKey="expense" stroke="var(--color-chart-1)" strokeWidth={2} name="Total Expense" />
                <Line type="monotone" dataKey="cumulative_outstanding" stroke="var(--color-chart-3)" strokeWidth={2} name="Outstanding Dues (cumulative)" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left p-2">Month</th>
                    <th className="text-right p-2">Total Income</th>
                    <th className="text-right p-2">Total Expense</th>
                    <th className="text-right p-2">Outstanding Dues (cumulative)</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyTrend.map((m) => (
                    <tr key={m.month} className="border-t border-border">
                      <td className="p-2">{m.month}</td>
                      <td className="p-2 text-right font-mono">{inr(m.total_income)}</td>
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

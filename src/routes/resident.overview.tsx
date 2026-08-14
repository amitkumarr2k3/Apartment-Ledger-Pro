import { createFileRoute, Link } from "@tanstack/react-router";

import { PortalShell, usePeriod } from "@/components/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell,
} from "recharts";
import { SmartTooltipContent, getTooltipTrigger } from "@/components/smart-tooltip";
import {
  inr, pct, categoryMonthly, total, vendorMonthly, sumMonthly,
} from "@/lib/finance-mock";
import { useMonthlyTotals, useExpenseTree, useIncomeTree } from "@/lib/hooks";
import { Wallet, ArrowRight, TrendingUp, TrendingDown, Home, Banknote, ShieldCheck, CheckCircle2, AlertTriangle, ShoppingCart, PiggyBank, Landmark, Vault, HandCoins, CreditCard, Scale, Gauge, Target } from "lucide-react";

export const Route = createFileRoute("/resident/overview")({
  component: Page,
  head: () => ({ meta: [{ title: "Resident · Overview" }] }),
});

function Page() {
  return (
    <PortalShell title="Overview" reqIds="RD-01 · RD-02 · RD-03 · RD-04 · RD-05" persona="resident">
      <Inner />
    </PortalShell>
  );
}

function Inner() {
  const { sliceMonthly, view } = usePeriod();
  const { data: monthlyTotals = [] } = useMonthlyTotals();
  const { data: expenseTree = [] } = useExpenseTree();
  const { data: incomeTree = [] } = useIncomeTree();
  
  const safeIncomeTree = incomeTree || [];
  const safeExpenseTree = expenseTree || [];
  const safeMonthlyTotals = monthlyTotals || [];

  const period = sliceMonthly(safeMonthlyTotals);
  
  const totalExpense = period.reduce((s, m) => s + (m.expense || 0), 0);

  // Helper to check for tax/gst keywords
  const isTax = (s: string) => /tax|gst|cgst|sgst/i.test(s || "");
  const isMaintenance = (s: string) => /maintenance/i.test(s || "") && !/outstanding|arrears|default/i.test(s || "");
  const isLiability = (s: string) => /outstanding|arrears|default/i.test(s || "");
  // Strict, exact-name match -- "Collected Maintenance" must ONLY ever be the
  // "Maintenance Charge" line item. It must never pick up Association Fund,
  // AV Room, Late Payment Fine, Lift Advertisement, Move In/Out Charges,
  // CGST/SGST, or any other ledger that happens to share the word
  // "maintenance" or gets swept in by a broader income filter.
  const isMaintenanceChargeExact = (s: string) => (s || "").trim().toLowerCase() === "maintenance charge";

  const TOTAL_SQFT = 701591;
  // Specific matchers (must not collide with each other -- both category
  // names happen to contain the substring "rate reference").
  const isMaintenanceRateReference = (name: string) => /maintenance rate reference/i.test(name || "");
  const isContingencyRateReference = (name: string) => /contingency rate reference/i.test(name || "");
  const isAnyRateReference = (name: string) => isMaintenanceRateReference(name) || isContingencyRateReference(name);
  // pull the rate category out of the tree, sliced to the selected period
  const rateCategory = safeIncomeTree.find((c) => isMaintenanceRateReference(c.name));
  const rateMonthly = rateCategory ? sliceMonthly(categoryMonthly(rateCategory)) : [];
  // each stored value is (rate * 100); divide back, then multiply by fixed area, summed per selected period
  const expectedCollection = rateMonthly.reduce((sum, storedVal) => sum + (storedVal / 100) * TOTAL_SQFT, 0);

  /**
   * CONTINGENCY FUND
   * The contingency portion is a slice of the same per-sqft maintenance
   * charge (e.g. Rs 0.25 of the Rs 4/sqft), defined month-by-month purely
   * via CSV upload (head=reference, category="Contingency Rate Reference") --
   * no code change needed to update the portion for a new month.
   */
  const contingencyCategory = safeIncomeTree.find((c) => isContingencyRateReference(c.name));
  // Full, UNSLICED 12-month series -- the headline "Contingency Cash" figure
  // intentionally ignores whatever period filter is selected on the
  // dashboard and always reflects the latest maintenance-collection cycle
  // month for which a rate has been defined.
  const contingencyFullMonthly = contingencyCategory ? categoryMonthly(contingencyCategory) : [];
  // Cumulative across EVERY month recorded so far, deliberately NOT sliced by
  // the dashboard's period filter -- this is the running contingency reserve
  // built up since inception, not a single month's contribution.
  const contingencyCash = contingencyFullMonthly.reduce(
    (sum, storedVal) => sum + ((storedVal || 0) / 100) * TOTAL_SQFT,
    0,
  );

  /**
   * COLLECTED MAINTENANCE
   * Deep-scans category -> vendor -> line_item for an EXACT match on
   * "Maintenance Charge" only. Deliberately does NOT reuse the loose
   * "reportable income" total, which used to include every other income
   * line (Association Fund, Late Payment Fine, CGST/SGST, etc.) and
   * therefore over-counted this card.
   */
  const collectedMaintenance = safeIncomeTree.reduce((acc, c) => {
    const catHit = isMaintenanceChargeExact(c.name);
    const catSum = (c.vendors || []).reduce((vAcc, v) => {
      const vHit = isMaintenanceChargeExact(v.name);
      const venSum = (v.items || []).reduce((iAcc, i) => {
        if (catHit || vHit || isMaintenanceChargeExact(i.name)) {
          return iAcc + total(sliceMonthly(i.monthly || []));
        }
        return iAcc;
      }, 0);
      return vAcc + venSum;
    }, 0);
    return acc + catSum;
  }, 0);
  
  /**
   * GST LIABILITY CALCULATION
   * Sum of all items in the income tree that match tax keywords.
   */
  const gstLiability = safeIncomeTree.reduce((acc, c) => {
    const cTax = isTax(c.name);
    const catSum = (c.vendors || []).reduce((vAcc, v) => {
      const vTax = isTax(v.name);
      const venSum = (v.items || []).reduce((iAcc, i) => {
        if (cTax || vTax || isTax(i.name)) {
          return iAcc + total(sliceMonthly(i.monthly || []));
        }
        return iAcc;
      }, 0);
      return vAcc + venSum;
    }, 0);
    return acc + catSum;
  }, 0);

  /**
   * OTHER INCOME (COMMUNITY INCOME)
   * Sum of all income that is NOT maintenance, NOT liability/arrears, and NOT tax.
   */
  const communityIncome = safeIncomeTree.reduce((acc, c) => {
    if (isAnyRateReference(c.name) || isMaintenance(c.name) || isLiability(c.name) || isTax(c.name)) return acc;
    
    const catSum = (c.vendors || []).reduce((vAcc, v) => {
      if (isTax(v.name)) return vAcc;
      const venSum = (v.items || []).reduce((iAcc, i) => {
        if (isTax(i.name)) return iAcc;
        return iAcc + total(sliceMonthly(i.monthly || []));
      }, 0);
      return vAcc + venSum;
    }, 0);
    return acc + catSum;
  }, 0);

  // Top 5 income sources (excluding maintenance, outstanding/liability, tax,
  // and the internal rate-reference category) -- mirrors communityIncome's
  // exclusion rules exactly so the two numbers always agree with each other.
  const top5Income = safeIncomeTree
    .filter((c) => !(isAnyRateReference(c.name) || isMaintenance(c.name) || isLiability(c.name) || isTax(c.name)))
    .map((c) => ({ name: c.name, total: total(sliceMonthly(categoryMonthly(c))) }))
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
  const top5IncomeTotal = top5Income.reduce((s, c) => s + c.total, 0);

  // Top 5 Expenses for the chart/list
  const top5 = safeExpenseTree
    .map((c) => ({ name: c.name, total: total(sliceMonthly(categoryMonthly(c))) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
  const top5Total = top5.reduce((s, c) => s + c.total, 0);
  
  const top5Vendors = safeExpenseTree
    .flatMap((c) => (c.vendors || []).map((v) => ({
      name: v.name,
      category: c.name,
      total: total(sliceMonthly(vendorMonthly(v))),
    })))
    .filter((v) => v.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
  const top5VendorTotal = top5Vendors.reduce((s, v) => s + v.total, 0);

  
  const periodLabel = period.length > 1
    ? `${period[0].month} to ${period[period.length - 1].month}`
    : (period[0]?.month ?? "selected period");

  const topCardsClass = "h-full min-h-[380px]";
  const chartHeight = 240;
  
  // Date logic for "current month - 1"
  const previousMonthDate = new Date();
  previousMonthDate.setMonth(previousMonthDate.getMonth() - 1);
  const prevMonthLabel = previousMonthDate.toLocaleString("en-US", { month: "short", year: "2-digit" }).replace(" ", "-");

  // Mock values for the ones not in logic
  const outstandingDuesMock = 300000;
  const recoveryRate = 90;
  const corpusValue = "₹1,85,60,000";
  // BANK BALANCE = cumulative (Collection - Expense) across EVERY month ever
  // recorded, deliberately NOT sliced by the dashboard's period filter --
  // this represents the actual liquid cash on hand today, not a period flow.
  // Reference-only rows (rate cards) and "Maintenance Outstanding" (money
  // never actually collected/deposited) are excluded from the collection side.
  const allTimeCollection = safeIncomeTree
    .filter((c) => !isAnyRateReference(c.name) && !isLiability(c.name))
    .reduce((sum, c) => sum + total(categoryMonthly(c)), 0);
  const allTimeExpense = safeExpenseTree.reduce((sum, c) => sum + total(categoryMonthly(c)), 0);
  const bankBalance = allTimeCollection - allTimeExpense;
  // Contingency Cash is a RING-FENCED PORTION of Bank Balance, not additional
  // money on top of it. These two values drive the composition bar on the
  // Bank Balance card so that relationship is visually unmistakable.
  const unrestrictedCash = Math.max(0, bankBalance - contingencyCash);
  const contingencyShareOfBank = bankBalance > 0 ? Math.min(100, (contingencyCash / bankBalance) * 100) : 0;
  
  // Final Financial Metrics
  const totalIncome = collectedMaintenance + communityIncome;
  const netSurplus = totalIncome - totalExpense;
  const expenseIncomeRatio = totalIncome === 0 ? 0 : (totalExpense / totalIncome) * 100;
  const ratioStatus =
    expenseIncomeRatio > 100
      ? { text: "Over Budget", color: "text-red-600" }
      : expenseIncomeRatio > 85
        ? { text: "Caution", color: "text-amber-600" }
        : { text: "Healthy", color: "text-gray-600" };


  return (
    <div className="space-y-6">
      {/* Section 1: Collection Health */}
      <DashboardSection 
        title={`Collection Health (${periodLabel})`} 
        icon={<Home className="h-5 w-5 text-blue-600" />} 
        headerColor="bg-blue-50 border-blue-200"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard 
            label="EXPECTED COLLECTION" 
            value={inr(expectedCollection)} 
            subText={`TARGET COLLECTION FOR ${periodLabel}`} 
            icon={<Target className="h-5 w-5 text-blue-500" />}
          />
          <MetricCard 
            label="COLLECTED MAINTENANCE" 
            value={inr(collectedMaintenance)} 
            subText={`MAINTENANCE RECEIVED FOR ${periodLabel}`} 
            icon={<CheckCircle2 className="h-5 w-5 text-green-500" />}
          />
          <MetricCard 
            label="OUTSTANDING DUES" 
            value={inr(outstandingDuesMock)} 
            subText="PENDING DUES ACROSS ALL FLATS" 
            icon={<AlertTriangle className="h-5 w-5 text-red-500" />}
            valueClassName="text-red-700"
          />
          <MetricCard 
            label="RECOVERY RATE" 
            value={`${recoveryRate}%`} 
            icon={<Gauge className="h-5 w-5 text-blue-500" />}
            subText={
              <div className="flex justify-between w-full mt-1">
                <span className="text-green-600 font-medium">165 FLATS</span>
                <span className="text-red-600 font-medium">35 FLAT DEFAULTERS</span>
              </div>
            }
            footer={
              <div className="w-full mt-2">
                <div className="flex items-center gap-1 text-green-600 text-xs font-medium mb-1">
                  <div className="h-2 w-2 rounded-full bg-green-500" /> Healthy
                </div>
                <Progress value={recoveryRate} className="h-1.5 bg-gray-100" />
              </div>
            }
          />
        </div>
      </DashboardSection>

      {/* Section 2: Society Financial Position */}
      <DashboardSection 
        title="Society Financial Position" 
        icon={<Banknote className="h-5 w-5 text-green-600" />} 
        headerColor="bg-green-50 border-green-200"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <MetricCard 
            label="OTHER INCOME" 
            value={inr(communityIncome)} 
            subText="RENT, PARKING, EVENTS, ETC." 
            icon={<Wallet className="h-5 w-5 text-teal-500" />}
          />
			<MetricCard 
			  label="TOTAL INCOME" 
			  value={inr(totalIncome)} 
			  subText="MAINTENANCE + OTHER INCOME · CLICK TO VIEW DETAILS" 
			  icon={<TrendingUp className="h-5 w-5 text-green-500" />}
			  to="/resident/drilldown"
			  search={(((prev: any) => ({ ...prev, head: "income", category: undefined, vendor: undefined, line: undefined })) as any)}
			/>
			<MetricCard 
			  label="TOTAL EXPENSE" 
			  value={inr(totalExpense)} 
			  subText={`OPERATING SPEND FOR ${periodLabel} · CLICK TO VIEW DETAILS`} 
			  icon={<ShoppingCart className="h-5 w-5 text-gray-400" />}
			  className="bg-gray-50/50"
			  to="/resident/drilldown"
			  search={(((prev: any) => ({ ...prev, head: "expense", category: undefined, vendor: undefined, line: undefined })) as any)}
			/>
          <MetricCard 
            label={netSurplus >= 0 ? "NET OPERATING SURPLUS" : "NET OPERATING DEFICIT"} 
            value={inr(netSurplus)} 
            subText={netSurplus >= 0 ? "SAVINGS RETAINED" : "SHORTFALL TO COVER"} 
            icon={<PiggyBank className={`h-5 w-5 ${netSurplus >= 0 ? "text-green-600" : "text-red-500"}`} />}
            footer={
              <div className={`flex items-center gap-1 text-xs font-medium mt-2 ${netSurplus >= 0 ? "text-green-600" : "text-red-600"}`}>
                <div className={`h-2 w-2 rounded-full ${netSurplus >= 0 ? "bg-green-500" : "bg-red-500"}`} /> {netSurplus >= 0 ? "Positive" : "Negative"}
              </div>
            }
          />
        </div>
      </DashboardSection>

      {/* Section 3: Long-Term Financial Strength */}
      <DashboardSection 
        title="Long-Term Financial Strength" 
        icon={<ShieldCheck className="h-5 w-5 text-orange-600" />} 
        headerColor="bg-orange-50 border-orange-200"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard 
            label="CORPUS WITH INTEREST (ACCUMULATED)" 
            value={corpusValue} 
            subText={`INCLUDES FIXED SINKING FUND TILL ${prevMonthLabel.toUpperCase()}`} 
            icon={<Vault className="h-5 w-5 text-orange-500" />}
          />
          <MetricCard 
            label="CONTINGENCY CASH" 
            value={inr(contingencyCash)} 
            subText="CUMULATIVE RESERVE · CLICK FOR MONTHLY TREND" 
            icon={<HandCoins className="h-5 w-5 text-pink-500" />}
            to="/resident/balance"
            hash="contingency-fund-chart"
            footer={
              <div className="mt-2 text-[9px] font-semibold text-pink-600 bg-pink-50 rounded px-2 py-1 leading-tight">
                ⊆ Included within Bank Balance -- not additional funds
              </div>
            }
          />
          <MetricCard 
            label="BANK BALANCE" 
            value={inr(bankBalance)} 
            subText="CUMULATIVE COLLECTION − EXPENSE · NOT FILTER-DEPENDENT" 
            icon={<CreditCard className="h-5 w-5 text-yellow-500" />}
            footer={
              <div className="w-full mt-2">
                <div className="h-1.5 w-full rounded-full overflow-hidden flex bg-gray-100">
                  <div
                    className="h-full bg-pink-400"
                    style={{ width: `${contingencyShareOfBank}%` }}
                    title={`Contingency reserve (ring-fenced): ${inr(contingencyCash)}`}
                  />
                  <div
                    className="h-full bg-yellow-400"
                    style={{ width: `${100 - contingencyShareOfBank}%` }}
                    title={`Unrestricted / freely usable: ${inr(unrestrictedCash)}`}
                  />
                </div>
                <div className="flex items-center justify-between w-full mt-1 text-[9px] text-gray-500 leading-tight">
                  <span>● <span className="text-pink-500 font-medium">Contingency</span> {inr(contingencyCash)}</span>
                  <span><span className="text-yellow-600 font-medium">Unrestricted</span> {inr(unrestrictedCash)} ●</span>
                </div>
              </div>
            }
          />
          <MetricCard 
            label="EXPENSE / INCOME RATIO" 
            value={`${expenseIncomeRatio.toFixed(1)}%`} 
            subText="BUDGET EFFICIENCY INDICATOR" 
            icon={<Scale className="h-5 w-5 text-indigo-400" />}
            footer={
              <div className="w-full mt-2">
                <div className={`text-center text-xs font-medium mb-1 ${ratioStatus.color}`}>{ratioStatus.text}</div>
                <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-purple-500 via-blue-500 to-cyan-400" 
                    style={{ width: `${Math.min(expenseIncomeRatio, 100)}%` }} 
                  />
                </div>
              </div>
            }
          />
        </div>
      </DashboardSection>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* RD-02 top 5 — drill-through */}
        <Card className={topCardsClass}>
          <CardHeader>
            <CardTitle className="text-base">Top 5 expense categories</CardTitle>
            <CardDescription>RD-02 · Click any expense category to drill down</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden">
            {top5.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                {`No expense recorded for ${periodLabel}.`}
              </div>
            ) : view === "chart" ? (
              <ResponsiveContainer width="100%" height={chartHeight}>
                <BarChart data={top5} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.3} />
                  <XAxis type="number" tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} fontSize={11} />
                  <YAxis type="category" dataKey="name" width={110} fontSize={12} />
                  <Tooltip trigger={getTooltipTrigger()} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} content={<SmartTooltipContent labelPrefix="Category" valueFormatter={(v) => inr(v)} />} />
                  <Bar dataKey="total" radius={[0, 4, 4, 0]} className="cursor-pointer">
                    {top5.map((c) => (
                      <Cell key={c.name} fill="var(--color-chart-1)"
                        onClick={() => {
                          window.location.href = `/resident/drilldown?head=expense&category=${encodeURIComponent(c.name)}`;
                        }} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ul className="divide-y divide-border max-h-[240px] overflow-y-auto">
                {top5.map((c) => (
                  <li key={c.name}>
                    <Link
                      to="/resident/drilldown"
                      search={(((prev: any) => ({ ...prev, head: "expense", category: c.name, vendor: undefined, line: undefined })) as any)}
                      className="flex items-center justify-between py-3 -mx-4 px-4 hover:bg-accent/40 rounded transition-colors"
                    >
                      <div>
                        <div className="font-medium">{c.name}</div>
                        <div className="text-xs text-muted-foreground">{((c.total / (top5Total || 1)) * 100).toFixed(1)}% of top 5</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-mono">{inr(c.total)}</span>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* RD-05 community income */}
        <Card className={topCardsClass}>
          <CardHeader>
            <CardTitle className="text-base">Top 5 income sources (excluding maintenance)</CardTitle>
            <CardDescription>RD-05 · Click any income category to drill down</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 flex-1 overflow-hidden">
            {top5Income.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                {`No community income recorded for ${periodLabel}.`}
              </div>
            ) : view === "chart" ? (
              <ResponsiveContainer width="100%" height={chartHeight}>
                <BarChart data={top5Income} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.3} />
                  <XAxis type="number" tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} fontSize={11} />
                  <YAxis type="category" dataKey="name" width={110} fontSize={12} />
                  <Tooltip trigger={getTooltipTrigger()} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} content={<SmartTooltipContent labelPrefix="Income" valueFormatter={(v) => inr(v)} />} />
                  <Bar dataKey="total" radius={[0, 4, 4, 0]} className="cursor-pointer">
                    {top5Income.map((income) => (
                      <Cell key={income.name} fill="var(--color-chart-2)"
                        onClick={() => {
                          window.location.href = `/resident/drilldown?head=income&category=${encodeURIComponent(income.name)}`;
                        }} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ul className="divide-y divide-border max-h-[240px] overflow-y-auto">
                {top5Income.map((income) => (
                  <li key={income.name}>
                    <Link
                      to="/resident/drilldown"
                      search={(((prev: any) => ({ ...prev, head: "income", category: income.name, vendor: undefined, line: undefined })) as any)}
                      className="flex items-center justify-between py-3 -mx-4 px-4 hover:bg-accent/40 rounded transition-colors"
                    >
                      <div>
                        <div className="font-medium">{income.name}</div>
                        <div className="text-xs text-muted-foreground">{((income.total / (top5IncomeTotal || 1)) * 100).toFixed(1)}% of top 5</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-mono">{inr(income.total)}</span>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className={topCardsClass}>
          <CardHeader>
            <CardTitle className="text-base">Top 5 vendors by expense</CardTitle>
            <CardDescription>Actual vendor spend click any vendor to drill down</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden">
            {top5Vendors.length === 0 ? (
              <p className="text-sm text-muted-foreground">No vendor-tagged expense data is available for this period.</p>
            ) : view === "chart" ? (
              <ResponsiveContainer width="100%" height={chartHeight}>
                <BarChart data={top5Vendors} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.3} />
                  <XAxis type="number" tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} fontSize={11} />
                  <YAxis type="category" dataKey="name" width={110} fontSize={12} />
                  <Tooltip trigger={getTooltipTrigger()} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} content={<SmartTooltipContent labelPrefix="Vendor" valueFormatter={(v) => inr(v)} />} />
                  <Bar dataKey="total" radius={[0, 4, 4, 0]} className="cursor-pointer">
                    {top5Vendors.map((v) => (
                      <Cell key={`${v.category}-${v.name}`} fill="var(--color-chart-3)"
                        onClick={() => {
                          window.location.href = `/resident/drilldown?head=expense&category=${encodeURIComponent(v.category)}&vendor=${encodeURIComponent(v.name)}`;
                        }} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ul className="divide-y divide-border max-h-[240px] overflow-y-auto">
                {top5Vendors.map((v) => (
                  <li key={`${v.category}-${v.name}`}>
                    <Link
                      to="/resident/drilldown"
                      search={(((prev: any) => ({ ...prev, head: "expense", category: v.category, vendor: v.name, line: undefined })) as any)}
                      className="flex items-center justify-between py-3 -mx-4 px-4 hover:bg-accent/40 rounded transition-colors"
                    >
                      <div>
                        <div className="font-medium">{v.name}</div>
                        <div className="text-xs text-muted-foreground">{v.category} · {((v.total / (top5VendorTotal || 1)) * 100).toFixed(1)}% of top 5 vendors</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-mono">{inr(v.total)}</span>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DashboardSection({ title, icon, headerColor, children }: { 
  title: string; 
  icon: React.ReactNode; 
  headerColor: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl border ${headerColor.split(' ')[1]} overflow-hidden shadow-sm`}>
      <div className={`px-4 py-2 flex items-center gap-2 font-semibold text-gray-800 ${headerColor.split(' ')[0]}`}>
        {icon}
        {title}
      </div>
      <div className="p-4 bg-white">
        {children}
      </div>
    </div>
  );
}

function MetricCard({ label, value, subText, icon, footer, className, valueClassName, to, search, hash }: {
  label: string;
  value: string;
  subText: React.ReactNode;
  icon?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  valueClassName?: string;
  // When provided, the whole card becomes a clickable drill-down link
  // (used by Total Income / Total Expense -> Head Drill-down, and
  // Contingency Cash -> Opening & Closing's contingency chart).
  to?: string;
  search?: any;
  hash?: string;
}) {
  const card = (
    <Card
      className={`border-none shadow-none text-center flex flex-col items-center justify-center p-2 ${className || ""} ${
        to ? "cursor-pointer hover:bg-accent/50 hover:shadow-sm transition-colors rounded-lg" : ""
      }`}
    >
      <CardHeader className="p-0 space-y-1 w-full">
        <div className="flex items-center justify-center gap-2 w-full relative">
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{label}</div>
          {icon && <div className="absolute right-0 top-0">{icon}</div>}
        </div>
        <CardTitle className={`text-2xl font-bold ${valueClassName || "text-gray-900"}`}>{value}</CardTitle>
      </CardHeader>
      <CardContent className="p-0 flex flex-col items-center w-full">
        <div className="text-[10px] text-gray-500 font-medium uppercase">{subText}</div>
        {footer}
      </CardContent>
    </Card>
  );

  if (to) {
    return (
      <Link to={to} search={search} hash={hash} className="block">
        {card}
      </Link>
    );
  }
  return card;
}

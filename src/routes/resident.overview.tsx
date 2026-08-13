import { createFileRoute, Link } from "@tanstack/react-router";

import { PortalShell, usePeriod } from "@/components/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend, Cell,
} from "recharts";
import { SmartTooltipContent, getTooltipTrigger } from "@/components/smart-tooltip";
import {
  inr, pct, categoryMonthly, total, vendorMonthly, sumMonthly,
} from "@/lib/finance-mock";
import { useMonthlyTotals, useExpenseTree, useIncomeTree } from "@/lib/hooks";
import { filterReportableIncomeCategories } from "@/lib/income-utils";
import { Wallet, ArrowRight, TrendingUp, TrendingDown, Home, Banknote, ShieldCheck, CheckCircle2, AlertCircle, ShoppingCart, Coins, Key, Landmark } from "lucide-react";

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
  const { sliceMonthly, priorSliceMonthly, view, labels = [] } = usePeriod();
  const { data: monthlyTotals = [] } = useMonthlyTotals();
  const { data: expenseTree = [] } = useExpenseTree();
  const { data: incomeTree = [] } = useIncomeTree();
  
  const safeIncomeTree = incomeTree || [];
  const safeExpenseTree = expenseTree || [];
  const safeMonthlyTotals = monthlyTotals || [];

  const reportableIncomeTree = filterReportableIncomeCategories(safeIncomeTree);
  const period = sliceMonthly(safeMonthlyTotals);
  const prior = priorSliceMonthly(safeMonthlyTotals);
  
  // Standard collection calculation
  const periodCollectionSeries = sliceMonthly(
    sumMonthly((reportableIncomeTree || []).flatMap((c) => (c.vendors || []).flatMap((v) => (v.items || []).map((i) => i.monthly || [])))),
  );
  const totalCollection = periodCollectionSeries.reduce((s, v) => s + (v || 0), 0);
  const totalExpense = period.reduce((s, m) => s + (m.expense || 0), 0);

  // Helper to check for tax/gst keywords
  const isTax = (s: string) => /tax|gst|cgst|sgst/i.test(s || "");
  const isMaintenance = (s: string) => /maintenance/i.test(s || "") && !/outstanding|arrears|default/i.test(s || "");
  const isLiability = (s: string) => /outstanding|arrears|default/i.test(s || "");

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
    if (isMaintenance(c.name) || isLiability(c.name) || isTax(c.name)) return acc;
    
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

  // Maintenance Trend Logic
  const maintenanceIncomeByMonth = sliceMonthly(
    safeIncomeTree
      .filter((c) => isMaintenance(c.name))
      .reduce<number[]>((acc, c) => {
        const monthly = categoryMonthly(c);
        return acc.length === 0 ? monthly : acc.map((v, i) => v + (monthly[i] ?? 0));
      }, []),
  );
  const outstandingIncomeByMonth = sliceMonthly(
    safeIncomeTree
      .filter((c) => isLiability(c.name))
      .reduce<number[]>((acc, c) => {
        const monthly = categoryMonthly(c);
        return acc.length === 0 ? monthly : acc.map((v, i) => v + (monthly[i] ?? 0));
      }, []),
  );
  
  // Monthly Trend Data
  const periodMonthlyTotals = new Map(period.map((m) => [m.month, m]));
  let runningOutstanding = 0;
  const monthlyWithOutstanding = (labels || []).map((month, i) => {
    const monthlyTotal = periodMonthlyTotals.get(month);
    const collected = maintenanceIncomeByMonth[i] ?? 0;
    const outstanding = Math.max(0, outstandingIncomeByMonth[i] ?? 0);
    runningOutstanding += outstanding;
    return {
      month,
      collection: periodCollectionSeries[i] ?? 0,
      expense: monthlyTotal?.expense ?? 0,
      net: monthlyTotal?.net ?? 0,
      outstanding,
      cumulative_outstanding: runningOutstanding,
      maintenance_collected: collected,
    };
  });
  
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
  const expectedCollection = 3000000;
  const outstandingDuesMock = 300000;
  const recoveryRate = 90;
  const corpusValue = "₹1,85,60,000";
  const bankBalance = 4250000;
  
  // Final Financial Metrics
  const totalIncome = totalCollection + communityIncome;
  const netSurplus = totalIncome - totalExpense;
  const expenseIncomeRatio = totalIncome === 0 ? 0 : (totalExpense / totalIncome) * 100;

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
            subText={`TARGET FOR ${periodLabel}`} 
          />
          <MetricCard 
            label="COLLECTED MAINTENANCE" 
            value={inr(totalCollection)} 
            subText="RECEIVED TILL DATE" 
            icon={<CheckCircle2 className="h-5 w-5 text-green-500" />}
          />
          <MetricCard 
            label="OUTSTANDING DUES" 
            value={inr(outstandingDuesMock)} 
            subText="TOTAL ARREARS" 
            icon={<AlertCircle className="h-5 w-5 text-red-500" />}
            valueClassName="text-red-700"
          />
          <MetricCard 
            label="RECOVERY RATE" 
            value={`${recoveryRate}%`} 
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
          />
          <MetricCard 
            label="TOTAL INCOME" 
            value={inr(totalIncome)} 
            subText="MAINTENANCE + OTHER" 
            icon={<TrendingUp className="h-5 w-5 text-green-500" />}
          />
          <MetricCard 
            label="TOTAL EXPENSE" 
            value={inr(totalExpense)} 
            subText="MONTHLY OPERATING SPEND" 
            icon={<ShoppingCart className="h-5 w-5 text-gray-400" />}
            className="bg-gray-50/50"
          />
          <MetricCard 
            label="NET OPERATING SURPLUS" 
            value={inr(netSurplus)} 
            subText="SAVINGS RETAINED" 
            icon={<Coins className="h-5 w-5 text-green-600" />}
            footer={
              <div className="flex items-center gap-1 text-green-600 text-xs font-medium mt-2">
                <div className="h-2 w-2 rounded-full bg-green-500" /> Positive
              </div>
            }
          />
          <MetricCard 
            label="GST LIABILITY" 
            value={inr(gstLiability)} 
            subText="CGST + SGST COLLECTED" 
            icon={<Landmark className="h-5 w-5 text-slate-400" />}
            className="bg-slate-50/50"
          />
        </div>
      </DashboardSection>

      {/* Section 3: Long-Term Financial Strength */}
      <DashboardSection 
        title="Long-Term Financial Strength" 
        icon={<ShieldCheck className="h-5 w-5 text-orange-600" />} 
        headerColor="bg-orange-50 border-orange-200"
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <MetricCard 
            label="CORPUS WITH INTEREST (ACCUMULATED)" 
            value={corpusValue} 
            subText={`INCLUDES FIXED SINKING FUND TILL ${prevMonthLabel.toUpperCase()}`} 
          />
          <MetricCard 
            label="BANK BALANCE" 
            value={inr(bankBalance)} 
            subText="CURRENT LIQUID OPERABLE CASH" 
            icon={<Key className="h-5 w-5 text-yellow-500" />}
          />
          <MetricCard 
            label="EXPENSE / INCOME RATIO" 
            value={`${expenseIncomeRatio.toFixed(1)}%`} 
            subText="BUDGET EFFICIENCY INDICATOR" 
            footer={
              <div className="w-full mt-2">
                <div className="text-center text-xs font-medium text-gray-600 mb-1">Healthy</div>
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
            {view === "chart" ? (
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
            <CardTitle className="text-base">Top 5 income sources(Excluding Maintainence)</CardTitle>
            <CardDescription>RD-05 · Click any income category to drill down</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 flex-1 overflow-hidden">
            {top5.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                {`No community income recorded for ${periodLabel}.`}
              </div>
            ) : view === "chart" ? (
              <ResponsiveContainer width="100%" height={chartHeight}>
                <BarChart data={top5} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.3} />
                  <XAxis type="number" tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} fontSize={11} />
                  <YAxis type="category" dataKey="name" width={110} fontSize={12} />
                  <Tooltip trigger={getTooltipTrigger()} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} content={<SmartTooltipContent labelPrefix="Income" valueFormatter={(v) => inr(v)} />} />
                  <Bar dataKey="total" radius={[0, 4, 4, 0]} className="cursor-pointer">
                    {top5.map((income) => (
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
                {top5.map((income) => (
                  <li key={income.name}>
                    <Link
                      to="/resident/drilldown"
                      search={(((prev: any) => ({ ...prev, head: "income", category: income.name, vendor: undefined, line: undefined })) as any)}
                      className="flex items-center justify-between py-3 -mx-4 px-4 hover:bg-accent/40 rounded transition-colors"
                    >
                      <div>
                        <div className="font-medium">{income.name}</div>
                        <div className="text-xs text-muted-foreground">{((income.total / (communityIncome || 1)) * 100).toFixed(1)}% of top 5</div>
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

      {/* RD-03 trend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monthly trend · collection vs expense</CardTitle>
          <CardDescription>RD-03 · Includes cumulative outstanding signal</CardDescription>
        </CardHeader>
        <CardContent>
          {view === "chart" ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={monthlyWithOutstanding} margin={{ left: 8, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="month" fontSize={11} />
                <YAxis tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} fontSize={11} />
                <Tooltip trigger={getTooltipTrigger()} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} content={<SmartTooltipContent labelPrefix="Month" valueFormatter={(v) => inr(v)} />} />
                <Legend />
                <Line type="monotone" dataKey="collection" stroke="var(--color-chart-2)" strokeWidth={2} name="Collection" />
                <Line type="monotone" dataKey="expense" stroke="var(--color-chart-1)" strokeWidth={2} name="Expense" />
                <Line type="monotone" dataKey="cumulative_outstanding" stroke="var(--color-chart-3)" strokeWidth={2} name="Cumulative outstanding" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="space-y-3">
              <div className="rounded-md border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left p-2">Month</th>
                      <th className="text-right p-2">Collection</th>
                      <th className="text-right p-2">Expense</th>
                      <th className="text-right p-2">Outstanding</th>
                      <th className="text-right p-2">Cumulative</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyWithOutstanding.map((m) => (
                      <tr key={m.month} className="border-t border-border">
                        <td className="p-2">{m.month}</td>
                        <td className="p-2 text-right font-mono">{inr(m.collection)}</td>
                        <td className="p-2 text-right font-mono">{inr(m.expense)}</td>
                        <td className="p-2 text-right font-mono">{inr(m.outstanding)}</td>
                        <td className="p-2 text-right font-mono">{inr(m.cumulative_outstanding)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
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

function MetricCard({ label, value, subText, icon, footer, className, valueClassName }: {
  label: string;
  value: string;
  subText: React.ReactNode;
  icon?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <Card className={`border-none shadow-none text-center flex flex-col items-center justify-center p-2 ${className}`}>
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
}

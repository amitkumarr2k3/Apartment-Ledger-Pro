import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PortalShell, usePeriod } from "@/components/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell, LabelList,
} from "recharts";
import { SmartTooltipContent, getTooltipTrigger } from "@/components/smart-tooltip";
import {
  inr, pct, categoryMonthly, total, vendorMonthly, sumMonthly,
} from "@/lib/finance-mock";
import { useMonthlyTotals, useExpenseTree, useIncomeTree, useWidgetVisibility, useAuditedReports, uploadAuditedReport, fetchAuditedReportFileUrl } from "@/lib/hooks";
import { getSession } from "@/lib/session";
import { Wallet, ArrowRight, TrendingUp, TrendingDown, Home, Banknote, ShieldCheck, CheckCircle2, AlertTriangle, ShoppingCart, PiggyBank, Vault, HandCoins, CreditCard, Scale, Gauge, Target, FileCheck2, Eye, UploadCloud, ExternalLink } from "lucide-react";
import { toast } from "sonner";

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
  // FIX (2026-08-15): real widget-level visibility, replacing the old
  // Dashboard Controls page that had no effect on what residents actually
  // see. Each real card below now checks its real widget id.
  const { isWidgetVisible } = useWidgetVisibility("resident.overview");
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
  const isExpectedCollectionReference = (name: string) => /expected collection reference/i.test(name || "");
  const isOpeningBalanceReference = (name: string) => /opening balance reference/i.test(name || "");
  const isCorpusFundReference = (name: string) => /corpus fund reference/i.test(name || "");
  const isAnyRateReference = (name: string) =>
    isMaintenanceRateReference(name) || isContingencyRateReference(name) || isExpectedCollectionReference(name) || isOpeningBalanceReference(name) || isCorpusFundReference(name);

  // ============================================================
  // EXPECTED COLLECTION -- now supplied DIRECTLY via CSV (head=reference,
  // category="Expected Collection Reference") instead of being computed
  // here from rate x fixed area. The old rate x area calculation is kept
  // below, commented out, so it's trivial to switch back if ever needed.
  // ============================================================
  const expectedCollectionCategory = safeIncomeTree.find((c) => isExpectedCollectionReference(c.name));
  const expectedCollectionMonthly = expectedCollectionCategory ? sliceMonthly(categoryMonthly(expectedCollectionCategory)) : [];
  const expectedCollection = total(expectedCollectionMonthly);

  // ---- OLD calculation (rate x fixed area) -- kept for easy rollback ----
  // const rateCategory = safeIncomeTree.find((c) => isMaintenanceRateReference(c.name));
  // const rateMonthly = rateCategory ? sliceMonthly(categoryMonthly(rateCategory)) : [];
  // // each stored value is (rate * 100); divide back, then multiply by fixed area, summed per selected period
  // const expectedCollection = rateMonthly.reduce((sum, storedVal) => sum + (storedVal / 100) * TOTAL_SQFT, 0);

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

  // Renders "xx.x% of total" directly on top-5 bar charts (instead of only
  // in the tooltip). `total` is the sum of the 5 bars shown in that chart,
  // matching the % already used in the list view for consistency.
  const renderPercentLabel = (grandTotal: number) => (props: any) => {
    const { x, y, width, height, value } = props;
    const pct = grandTotal > 0 ? (value / grandTotal) * 100 : 0;
    return (
      <text
        x={x + width + 6}
        y={y + height / 2}
        dy={4}
        fontSize={11}
        fontWeight={600}
        fill="var(--color-muted-foreground, #6b7280)"
        textAnchor="start"
      >
        {`${pct.toFixed(1)}%`}
      </text>
    );
  };
  
  // Date logic for "current month - 1"
  const previousMonthDate = new Date();
  previousMonthDate.setMonth(previousMonthDate.getMonth() - 1);
  const prevMonthLabel = previousMonthDate.toLocaleString("en-US", { month: "short", year: "2-digit" }).replace(" ", "-");

  /**
   * OUTSTANDING DUES (period-filtered)
   * Sum of all "Maintenance Outstanding"-style categories for the selected
   * period. Feeds Recovery Rate below so the two figures can never disagree.
   */
  // "Previous Arrears Brought Forward" is uploaded every month, dated for
  // the FOLLOWING month (e.g. the entry dated 1-Aug is the closing/cumulative
  // outstanding as of the end of July) -- it already IS the running total,
  // no addition needed. "Current Month Unpaid Maintenance" is restricted to
  // Income Visibility's RD-32 chart ONLY and must not be read here at all.
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
  // "Current Month Unpaid Maintenance" -- used ONLY for the Total Expected
  // Income card below (sum across the selected period, alongside Total
  // Received Income and Opening Balance). This is a distinct, additive use
  // from RD-32's Income Visibility chart and does not change that chart's
  // behavior at all.
  const isCurrentMonthUnpaidMaintenance = (s: string) => (s || "").trim().toLowerCase() === "current month unpaid maintenance";
  const currentMonthUnpaidRawMonthly = liabilityLineItemRawMonthly(isCurrentMonthUnpaidMaintenance);

  /**
   * OUTSTANDING DUES CARD -- CUMULATIVE (ALL-TIME).
   * The latest available "Previous Arrears Brought Forward" entry, taken at
   * face value -- it already represents the full cumulative default as of
   * the end of the most recently closed month. No addition, no other line
   * item involved. Deliberately NOT filtered by the dashboard's period
   * selector, same "all-time" treatment as Bank Balance / Contingency Cash /
   * Corpus.
   */
  let cumulativeOutstandingDue = 0;
  for (let idx = bfRawMonthly.length - 1; idx >= 0; idx--) {
    if (bfRawMonthly[idx]) {
      cumulativeOutstandingDue = bfRawMonthly[idx];
      break;
    }
  }

  /**
   * RECOVERY RATE
   * Redefined: % of the EXPECTED (per-sqft target) collection that was
   * actually collected for the selected period. Neither "Current Month
   * Unpaid Maintenance" nor "Previous Arrears Brought Forward" are used
   * here -- both are restricted to their own designated places only
   * (RD-32 for the former; the Outstanding Dues card / Cashflow Health's
   * cumulative outstanding line for the latter) and must not leak into any
   * other calculation.
   */
  const recoveryRate = expectedCollection > 0
    ? (collectedMaintenance / expectedCollection) * 100
    : 0;
  const recoveryStatus =
    recoveryRate >= 90
      ? { text: "Healthy", color: "text-green-600", dot: "bg-green-500" }
      : recoveryRate >= 75
        ? { text: "Watch", color: "text-amber-600", dot: "bg-amber-500" }
        : { text: "At Risk", color: "text-red-600", dot: "bg-red-500" };
  /**
   * CORPUS WITH INTEREST (ACCUMULATED)
   * Supplied via CSV (head=reference, category="Corpus Fund Reference") as a
   * running balance snapshot per month. Always takes the LATEST dated entry
   * at face value -- never summed, never period-filtered -- so re-uploading
   * a newer month's figure immediately becomes the displayed corpus value.
   * Same "latest entry wins" convention already used for the Outstanding
   * Receivables / Previous Arrears Brought Forward figure below.
   */
  const corpusFundCategory = safeIncomeTree.find((c) => isCorpusFundReference(c.name));
  const corpusFundFullMonthly = corpusFundCategory ? categoryMonthly(corpusFundCategory) : [];
  let corpusFundValue = 0;
  for (let idx = corpusFundFullMonthly.length - 1; idx >= 0; idx--) {
    if (corpusFundFullMonthly[idx]) {
      corpusFundValue = corpusFundFullMonthly[idx];
      break;
    }
  }
  const corpusValue = inr(corpusFundValue);
  // BANK BALANCE = cumulative (Collection - Expense) across EVERY month ever
  // recorded, deliberately NOT sliced by the dashboard's period filter --
  // this represents the actual liquid cash on hand today, not a period flow.
  // Reference-only rows (rate cards) and "Maintenance Outstanding" (money
  // never actually collected/deposited) are excluded from the collection side.
  const allTimeCollection = safeIncomeTree
    .filter((c) => !isAnyRateReference(c.name) && !isLiability(c.name) && !isTax(c.name))
    .reduce((sum, c) => sum + total(categoryMonthly(c)), 0);
  const allTimeExpense = safeExpenseTree.reduce((sum, c) => sum + total(categoryMonthly(c)), 0);
  // TRUE OPENING BALANCE -- supplied via CSV (head=reference, category=
  // "Opening Balance Reference") instead of assuming the account started at
  // Rs 0 before the earliest tracked transaction. Falls back to 0 (today's
  // behavior) if this hasn't been uploaded yet.
  const openingBalanceCategory = safeIncomeTree.find((c) => isOpeningBalanceReference(c.name));
  const openingBalanceFullMonthly = openingBalanceCategory ? categoryMonthly(openingBalanceCategory) : [];
  let trueOpeningAnchor = 0;
  for (let idx = 0; idx < openingBalanceFullMonthly.length; idx++) {
    if (openingBalanceFullMonthly[idx]) { trueOpeningAnchor = openingBalanceFullMonthly[idx]; break; }
  }
  const bankBalance = trueOpeningAnchor + allTimeCollection - allTimeExpense;
  // Contingency Cash is a RING-FENCED PORTION of Bank Balance, not additional
  // money on top of it. These two values drive the composition bar on the
  // Bank Balance card so that relationship is visually unmistakable.
  const unrestrictedCash = Math.max(0, bankBalance - contingencyCash);
  const contingencyShareOfBank = bankBalance > 0 ? Math.min(100, (contingencyCash / bankBalance) * 100) : 0;
  
  // Final Financial Metrics
  const totalIncome = collectedMaintenance + communityIncome;
  // TOTAL EXPECTED INCOME = Total Received Income (this period) + ALL
  // "Current Month Unpaid Maintenance" ever recorded, across every month --
  // deliberately NOT sliced by the dashboard's period filter, same
  // "all-time" treatment as Bank Balance / Contingency Cash / Corpus /
  // Outstanding Receivables -- + the historical Opening Balance anchor.
  // This is a projection of total funds expected to be available,
  // deliberately shown as its own card BEFORE Total Received Income so the
  // "expected" and "actually received" figures are never confused.
  const currentMonthUnpaidAllTime = total(currentMonthUnpaidRawMonthly);
  const totalExpectedIncome = totalIncome + currentMonthUnpaidAllTime + trueOpeningAnchor;
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
      {/* Audited Report -- prominent placeholder at the very top, above
          every other card, so it's the first thing a resident sees. */}
      {isWidgetVisible("overview.auditedReport") && <AuditedReportCard />}

      {/* Section 1: Collection Health */}
      {isWidgetVisible("overview.collectionHealth") && (
      <DashboardSection 
        title={`Collection Health (${periodLabel})`} 
        icon={<Home className="h-5 w-5 text-blue-600" />} 
        headerColor="bg-blue-50 border-blue-200"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard 
            label="EXPECTED MAINTENANCE COLLECTION" 
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
            label="OUTSTANDING RECEIVABLES" 
            value={inr(cumulativeOutstandingDue)} 
            subText="CUMULATIVE DEFAULT · NOT FILTER-DEPENDENT" 
            icon={<AlertTriangle className="h-5 w-5 text-red-500" />}
            valueClassName="text-red-700"
            fixed
          />
          <MetricCard 
            label="OTHER INCOME" 
            value={inr(communityIncome)} 
            subText="RENT, PARKING, EVENTS, ETC." 
            icon={<Wallet className="h-5 w-5 text-teal-500" />}
          />
        </div>
      </DashboardSection>
      )}

      {/* Section 2: Society Financial Position */}
      {isWidgetVisible("overview.financialPosition") && (
      <DashboardSection 
        title="Society Financial Position" 
        icon={<Banknote className="h-5 w-5 text-green-600" />} 
        headerColor="bg-green-50 border-green-200"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
			<MetricCard 
			  label="TOTAL EXPECTED INCOME" 
			  value={inr(totalExpectedIncome)} 
			  subText={`RECEIVED (${periodLabel}) + UNPAID DUES (ALL-TIME) + OPENING BALANCE`} 
			  icon={<Target className="h-5 w-5 text-emerald-500" />}
			  className="ring-1 ring-slate-200 rounded-lg"
			/>
			<MetricCard 
			  label="TOTAL RECEIVED INCOME" 
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
          <MetricCard 
            label="RECOVERY RATE" 
            value={`${recoveryRate.toFixed(1)}%`} 
            icon={<Gauge className="h-5 w-5 text-blue-500" />}
            subText={`MAINTENANCE COLLECTED VS EXPECTED TARGET FOR ${periodLabel}`}
            footer={
              <div className="w-full mt-2">
                <div className={`flex items-center gap-1 text-xs font-medium mb-1 ${recoveryStatus.color}`}>
                  <div className={`h-2 w-2 rounded-full ${recoveryStatus.dot}`} /> {recoveryStatus.text}
                </div>
                <Progress value={Math.min(recoveryRate, 100)} className="h-1.5 bg-gray-100" />
              </div>
            }
          />
        </div>
      </DashboardSection>
      )}

      {/* Section 3: Long-Term Financial Strength */}
      {isWidgetVisible("overview.financialStrength") && (
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
            fixed
          />
          <MetricCard 
            label="CONTINGENCY CASH" 
            value={inr(contingencyCash)} 
            subText="CUMULATIVE RESERVE · CLICK FOR MONTHLY TREND" 
            icon={<HandCoins className="h-5 w-5 text-pink-500" />}
            to="/resident/balance"
            hash="contingency-fund-chart"
            fixed
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
            fixed
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
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* RD-05 community income */}
        {isWidgetVisible("overview.top5Income") && (
        <Card className={topCardsClass}>
          <CardHeader>
            <CardTitle className="text-base">Top 5 income sources (excluding maintenance paid from residents)</CardTitle>
            <CardDescription>RD-05 · Click any income category to drill down</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 flex-1 overflow-hidden">
            {top5Income.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                {`No community income recorded for ${periodLabel}.`}
              </div>
            ) : view === "chart" ? (
              <ResponsiveContainer width="100%" height={chartHeight}>
                <BarChart data={top5Income} layout="vertical" margin={{ left: 20, right: 44 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.3} />
                  <XAxis type="number" domain={[0, (max: number) => max * 1.12]} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} fontSize={11} />
                  <YAxis type="category" dataKey="name" width={110} fontSize={12} />
                  <Tooltip trigger={getTooltipTrigger()} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} content={<SmartTooltipContent labelPrefix="Income" valueFormatter={(v) => inr(v)} />} />
                  <Bar dataKey="total" radius={[0, 4, 4, 0]} className="cursor-pointer">
                    {top5Income.map((income) => (
                      <Cell key={income.name} fill="var(--color-chart-2)"
                        onClick={() => {
                          window.location.href = `/resident/drilldown?head=income&category=${encodeURIComponent(income.name)}`;
                        }} />
                    ))}
                    <LabelList dataKey="total" content={renderPercentLabel(top5IncomeTotal)} />
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
        )}

        {/* RD-02 top 5 — drill-through */}
        {isWidgetVisible("overview.top5Expenses") && (
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
                <BarChart data={top5} layout="vertical" margin={{ left: 20, right: 44 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.3} />
                  <XAxis type="number" domain={[0, (max: number) => max * 1.12]} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} fontSize={11} />
                  <YAxis type="category" dataKey="name" width={110} fontSize={12} />
                  <Tooltip trigger={getTooltipTrigger()} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} content={<SmartTooltipContent labelPrefix="Category" valueFormatter={(v) => inr(v)} />} />
                  <Bar dataKey="total" radius={[0, 4, 4, 0]} className="cursor-pointer">
                    {top5.map((c) => (
                      <Cell key={c.name} fill="var(--color-chart-1)"
                        onClick={() => {
                          window.location.href = `/resident/drilldown?head=expense&category=${encodeURIComponent(c.name)}`;
                        }} />
                    ))}
                    <LabelList dataKey="total" content={renderPercentLabel(top5Total)} />
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
        )}

        {isWidgetVisible("overview.top5Vendors") && (
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
                <BarChart data={top5Vendors} layout="vertical" margin={{ left: 20, right: 44 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.3} />
                  <XAxis type="number" domain={[0, (max: number) => max * 1.12]} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} fontSize={11} />
                  <YAxis type="category" dataKey="name" width={110} fontSize={12} />
                  <Tooltip trigger={getTooltipTrigger()} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} content={<SmartTooltipContent labelPrefix="Vendor" valueFormatter={(v) => inr(v)} />} />
                  <Bar dataKey="total" radius={[0, 4, 4, 0]} className="cursor-pointer">
                    {top5Vendors.map((v) => (
                      <Cell key={`${v.category}-${v.name}`} fill="var(--color-chart-3)"
                        onClick={() => {
                          window.location.href = `/resident/drilldown?head=expense&category=${encodeURIComponent(v.category)}&vendor=${encodeURIComponent(v.name)}`;
                        }} />
                    ))}
                    <LabelList dataKey="total" content={renderPercentLabel(top5VendorTotal)} />
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
        )}
      </div>
    </div>
  );
}

// FIY label convention matches what's shown elsewhere in the app ("FY 2026-27").
// Independent of the dashboard's main period selector on purpose -- that
// selector has non-FY modes (Last 12 months, a specific month, etc.) that
// don't map cleanly to a single fiscal year, so this widget gets its own
// small, self-contained FY picker instead of trying to reuse that state.
function fiscalYearLabel(offsetYears: number): string {
  const now = new Date();
  const fyStartYear = (now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1) - offsetYears;
  const fyEndYear = (fyStartYear + 1) % 100;
  return `FY ${fyStartYear}-${String(fyEndYear).padStart(2, "0")}`;
}

function AuditedReportCard() {
  const { data: reports = [] } = useAuditedReports();
  const qc = useQueryClient();
  const session = getSession();
  const isSuperAdmin = session?.role === "superadmin";

  const recentFYs = [fiscalYearLabel(0), fiscalYearLabel(1)];
  const availableFYs = Array.from(new Set([...recentFYs, ...reports.map((r) => r.fiscal_year)])).sort().reverse();

  const [selectedFY, setSelectedFY] = useState(fiscalYearLabel(1)); // default to FY 2025-26 per feedback
  const [viewOpen, setViewOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFY, setUploadFY] = useState(fiscalYearLabel(0));
  const [uploading, setUploading] = useState(false);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);

  const report = reports.find((r) => r.fiscal_year === selectedFY);
  // Most mobile browsers don't reliably render a PDF INLINE inside an
  // <iframe> the way desktop browsers do (especially for a blob: URL
  // sitting inside a modal) -- they show an unresponsive placeholder
  // instead. Detect mobile and use a guaranteed-to-work "open in new tab"
  // button there instead of the iframe.
  const isMobile = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  // Load the PDF as an authenticated blob: URL whenever the viewer is open --
  // an <iframe src="/api/reports/:id/file"> alone would send no auth header
  // at all and always come back 401. Revoke the previous blob URL on cleanup
  // so we don't leak memory across report switches / dialog closes.
  useEffect(() => {
    if (!viewOpen || !report) {
      setFileUrl(null);
      return;
    }
    let cancelled = false;
    setFileLoading(true);
    setFileUrl(null);
    fetchAuditedReportFileUrl(report.id).then((url) => {
      if (cancelled) {
        if (url) URL.revokeObjectURL(url);
        return;
      }
      setFileUrl(url);
      setFileLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [viewOpen, report?.id]);

  useEffect(() => {
    return () => {
      if (fileUrl) URL.revokeObjectURL(fileUrl);
    };
  }, [fileUrl]);

  async function handleUpload(file: File) {
    if (file.type !== "application/pdf") {
      toast.error("Only PDF files are supported.");
      return;
    }
    setUploading(true);
    const ok = await uploadAuditedReport(uploadFY, file);
    setUploading(false);
    if (ok) {
      toast.success(`Audited report uploaded for ${uploadFY}`);
      setUploadOpen(false);
      qc.invalidateQueries({ queryKey: ["audited-reports"] });
    } else {
      toast.error("Upload failed \u2014 please try again.");
    }
  }

  return (
    <Card className="border-indigo-500/30 bg-indigo-500/5">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileCheck2 className="h-5 w-5 text-indigo-600" />
          <div>
            <CardTitle className="text-base">Audited Report</CardTitle>
            <CardDescription>Statutory audited financial report for the society</CardDescription>
          </div>
        </div>
        <Select value={selectedFY} onValueChange={setSelectedFY}>
          <SelectTrigger className="w-[140px] h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            {availableFYs.map((fy) => <SelectItem key={fy} value={fy}>{fy}</SelectItem>)}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="flex items-center justify-between flex-wrap gap-3">
        {report ? (
          <>
            <div className="text-sm text-muted-foreground">
              {report.file_name} · uploaded {String(report.uploaded_at).slice(0, 10)}
            </div>
            <Button size="sm" onClick={() => setViewOpen(true)}>
              <Eye className="h-4 w-4 mr-1" /> View Report
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No audited report uploaded yet for {selectedFY}.</p>
        )}
        {isSuperAdmin && (
          <Button size="sm" variant="outline" onClick={() => { setUploadFY(selectedFY); setUploadOpen(true); }}>
            <UploadCloud className="h-4 w-4 mr-1" /> {report ? "Replace" : "Upload"}
          </Button>
        )}
      </CardContent>

      {/* View: inline PDF embed, never a download prompt */}
      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="max-w-4xl h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Audited Report · {selectedFY}</DialogTitle>
          </DialogHeader>
          {report && (
            fileLoading ? (
              <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Loading report…</div>
            ) : fileUrl ? (
              isMobile ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
                  <FileCheck2 className="h-10 w-10 text-indigo-400" />
                  <p className="text-sm text-muted-foreground">
                    Inline PDF preview isn't reliably supported on mobile browsers.
                    Tap below to open the report.
                  </p>
                  <Button onClick={() => window.open(fileUrl, "_blank", "noopener,noreferrer")}>
                    <ExternalLink className="h-4 w-4 mr-1" /> Open Report
                  </Button>
                </div>
              ) : (
                <iframe src={fileUrl} title="Audited Report" className="flex-1 w-full rounded border" />
              )
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-rose-600">Failed to load report. Please try again.</div>
            )
          )}
        </DialogContent>
      </Dialog>

      {/* Upload: superadmin only */}
      {isSuperAdmin && (
        <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Upload audited report</DialogTitle>
              <DialogDescription>PDF only. Uploading again for the same FY replaces the existing file.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Fiscal year</Label>
                <Select value={uploadFY} onValueChange={setUploadFY}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {availableFYs.map((fy) => <SelectItem key={fy} value={fy}>{fy}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">PDF file</Label>
                <Input
                  type="file"
                  accept="application/pdf"
                  disabled={uploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUpload(f);
                  }}
                />
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Card>
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

function MetricCard({ label, value, subText, icon, footer, className, valueClassName, to, search, hash, fixed }: {
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
  // When true, visually marks this card as an ALL-TIME figure that does
  // NOT respond to the dashboard's period filter (e.g. Bank Balance,
  // Contingency Cash, Corpus) so it's obviously different at a glance from
  // cards that do change with the selected duration.
  fixed?: boolean;
}) {
  const card = (
    <Card
      className={`relative text-center flex flex-col items-center justify-center p-2 ${className || ""} ${
        fixed ? "border border-dashed border-slate-300 bg-slate-50/60" : "border-none shadow-none"
      } ${
        to ? "cursor-pointer hover:bg-accent/50 hover:shadow-md transition-colors rounded-lg ring-1 ring-blue-100" : ""
      }`}
    >
      {fixed && (
        <div className="absolute top-1.5 left-1.5 text-[8px] font-bold uppercase tracking-wide text-slate-600 bg-slate-200 rounded px-1.5 py-0.5">
          All-time
        </div>
      )}
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
      {to && (
        <div className="absolute bottom-1.5 right-1.5 h-5 w-5 rounded-full bg-blue-100 flex items-center justify-center">
          <ArrowRight className="h-3 w-3 text-blue-600" />
        </div>
      )}
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

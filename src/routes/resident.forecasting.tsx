import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PortalShell } from "@/components/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend,
  PieChart, Pie, Cell,
} from "recharts";
import { SmartTooltipContent, getTooltipTrigger } from "@/components/smart-tooltip";
import { inr, categoryMonthly, months12, type Category } from "@/lib/finance-mock";
import { useBalanceStrip, useMonthlyTotals, useIncomeTree, useExpenseTree, useWidgetVisibility } from "@/lib/hooks";
import { Info, Settings2, ChevronDown, ChevronUp, RotateCcw } from "lucide-react";

// ---------------------------------------------------------------------------
// v4: restores the Configuration panel, the 3-tile KPI row, and the full
// Global Assumptions card (all reverted from v3's over-trim -- those removals
// were not requested). Keeps v3's two genuine fixes: real Unicode characters
// embedded directly (no escape-notation typos reaching the rendered page),
// and Contingency displayed as its raw fraction (0.05, 0.1, 0.15 ... 1)
// instead of a converted percentage. Everything else from the "mobile-first"
// pass (dynamic top-N categories by size, Maintenance/Liability rows
// excluded from the dynamic category loop to avoid double-counting,
// Levers -> Table -> Chart ordering, table collapsed by default, chart+mix
// combined into one tabbed card) is unchanged.
// ---------------------------------------------------------------------------

const TOTAL_SQFT = 701591; // same community constant as resident.balance.tsx
const TOP_INCOME_COUNT = 5;
const TOP_EXPENSE_COUNT = 6;

const MONTH_ABBRS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtMonthLabel(d: Date): string {
  return MONTH_ABBRS[d.getMonth()] + " '" + String(d.getFullYear()).slice(-2);
}
function fiscalStartYearFor(d: Date): number {
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
}
function fyLabelFor(startYear: number): string {
  return "FY " + startYear + "-" + String(startYear + 1).slice(-2);
}
// Inverse of fmtMonthLabel -- turns a "MMM 'YY" label (the same format
// monthlyTotals/actualByMonth already use) back into a real Date, so we can
// compare months chronologically across FY boundaries instead of only by
// exact label match. Needed to bridge a gap of several forecast months when
// jumping two or more FYs ahead of the last real data (see fyOpeningBalance).
function parseMonthLabel(label: string): Date | null {
  const parts = (label || "").trim().split(" '");
  if (parts.length !== 2) return null;
  const monIdx = MONTH_ABBRS.indexOf(parts[0]);
  const yy = parseInt(parts[1], 10);
  if (monIdx === -1 || Number.isNaN(yy)) return null;
  return new Date(2000 + yy, monIdx, 1);
}

const CHART_COLORS = ["#0082c9", "#06b6d4", "#f59e0b", "#22c55e", "#a855f7", "#ef4444", "#ec4899", "#6366f1", "#14b8a6", "#f97316"];

export const Route = createFileRoute("/resident/forecasting")({
  component: Page,
  head: () => ({ meta: [{ title: "Resident · Forecasting" }] }),
});

function Page() {
  return (
    <PortalShell title="Forecasting" reqIds="RD-50 → RD-54" persona="resident" showPeriodSelector={false}>
      <Inner />
    </PortalShell>
  );
}

type CategoryLever = { name: string; baseline: number; monthsUsed: number; pct: number };
type MonthRow = { month: string; status: "actual" | "forecast" | "noData"; income: number; expense: number; net: number; closing: number };

// Regex-based "special row" exclusion -- same pattern resident.balance.tsx
// already uses (isOpeningBalanceReference / isContingencyRateReference).
// "Maintenance Collection"/"Maintenance Outstanding" are excluded from the
// dynamic category loop because they're ALREADY handled by the dedicated
// Maintenance Rate x Collection% levers in Global Assumptions -- including
// them again here would double-count maintenance income.
const isReferenceRow = (name: string) => /reference/i.test(name || "");
const isMaintenanceRow = (name: string) => /maintenance\s*(collection|outstanding|dues)/i.test(name || "");
const isLiabilityRow = (name: string) => /liability/i.test(name || "");
// Same "Contingency Rate Reference" row resident.balance.tsx already reads --
// this stores a PER-SQFT RATE per month (encoded x100, like Maintenance
// Rate), not a rupee amount, and the rate is genuinely 0 in some months
// (contingency isn't collected every month) -- it must NOT be treated as a
// normal income category, and it must NOT be modelled as "a % of surplus".
const isContingencyRateReference = (name: string) => /contingency\s*rate\s*reference/i.test(name || "");

function Inner() {
  const { isWidgetVisible } = useWidgetVisibility("resident.forecasting");
  const { data: monthlyTotals = [] } = useMonthlyTotals();
  const { data: balanceStrip = { opening: 0, income: 0, expense: 0, net: 0, closing: 0 } } = useBalanceStrip();
  const { data: incomeTree = [] } = useIncomeTree();
  const { data: expenseTree = [] } = useExpenseTree();

  // -- Configuration: methodology, restored per feedback --
  const [configOpen, setConfigOpen] = useState(false);
  const [refWindow, setRefWindow] = useState(12);
  const [combineMode, setCombineMode] = useState<"compound" | "additive">("compound");
  const [inflationScope, setInflationScope] = useState<"expense" | "both">("expense");

  // -- Global assumptions: full set, restored per feedback --
  const [maintenanceRate, setMaintenanceRate] = useState(4);
  const [collectionPct, setCollectionPct] = useState(90);
  const [interestPct, setInterestPct] = useState(0);
  const [inflationPct, setInflationPct] = useState(6);
  const [unknownExpense, setUnknownExpense] = useState(0);
  const [incomeCategoryPct, setIncomeCategoryPct] = useState<Record<string, number>>({});
  const [expenseCategoryPct, setExpenseCategoryPct] = useState<Record<string, number>>({});
  const [tableOpen, setTableOpen] = useState(false);
  const [showAllIncome, setShowAllIncome] = useState(false);
  const [showAllExpense, setShowAllExpense] = useState(false);

  const defaultFyStart = useMemo(() => {
    const now = new Date();
    return fiscalStartYearFor(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  }, []);
  const [fyStart, setFyStart] = useState(defaultFyStart);
  const fyOptions = [defaultFyStart - 1, defaultFyStart, defaultFyStart + 1];
  const yearsForward = Math.max(0, fyStart - defaultFyStart);

  const fyMonths = useMemo(
    () => Array.from({ length: 12 }, (_, i) => {
      const d = new Date(fyStart + (i >= 9 ? 1 : 0), (i + 3) % 12, 1);
      return { date: d, label: fmtMonthLabel(d) };
    }),
    [fyStart],
  );

  const actualByMonth = useMemo(() => {
    const map = new Map((monthlyTotals as any[]).map((m) => [m.month, m]));
    return fyMonths.map((fm) => map.get(fm.label));
  }, [fyMonths, monthlyTotals]);

  const lastCompletedIdx = useMemo(() => {
    let idx = -1;
    actualByMonth.forEach((a, i) => { if (a) idx = i; });
    return idx;
  }, [actualByMonth]);

  // How many of this FY's 12 months are real recorded data vs. forecast --
  // reused across the header, KPI tiles, the month table badge, the
  // Contingency Fund card, and the closing disclaimer so every card agrees
  // on the same two numbers.
  // FIX: lastCompletedIdx is the LAST index with actual data, not a count --
  // treating "0..lastCompletedIdx" as all-actual is wrong whenever real data
  // starts partway through the FY (e.g. record-keeping in this app only
  // began in October, so Apr-Sep have no data even though Mar of THIS fy
  // has already happened and is actual). actualMonthsCount now counts real
  // actual months directly; forecastMonthsCount only counts months strictly
  // after the last actual month (i.e. genuinely still ahead of us); anything
  // left over is noDataMonthsCount -- months that already happened but have
  // no record, which must never be forecast (see monthRows below).
  const actualMonthsCount = actualByMonth.filter(Boolean).length;
  const forecastMonthsCount = Math.max(0, 12 - lastCompletedIdx - 1);
  const noDataMonthsCount = Math.max(0, 12 - actualMonthsCount - forecastMonthsCount);

  // Returns both the average AND how many actual months fed into it --
  // months with no recorded activity for that specific category are
  // excluded from BOTH the sum and the denominator (point raised: a
  // category billed in only 8 of 12 months must average over 8, not 12).
  function computeBaseline(monthly: number[], window: number): { value: number; monthsUsed: number } {
    const nonZero = monthly.filter((v) => v > 0);
    const sample = nonZero.slice(-window);
    if (sample.length === 0) return { value: 0, monthsUsed: 0 };
    return { value: sample.reduce((s, v) => s + v, 0) / sample.length, monthsUsed: sample.length };
  }

  const expenseLevers: CategoryLever[] = useMemo(() => {
    return (expenseTree as Category[])
      .map((cat) => {
        const { value, monthsUsed } = computeBaseline(categoryMonthly(cat), refWindow);
        return { name: cat.name, baseline: value, monthsUsed, pct: expenseCategoryPct[cat.name] ?? 0 };
      })
      .filter((l) => l.baseline > 0)
      .sort((a, b) => b.baseline - a.baseline);
  }, [expenseTree, refWindow, expenseCategoryPct]);

  const incomeLevers: CategoryLever[] = useMemo(() => {
    return (incomeTree as Category[])
      .filter((cat) => !isReferenceRow(cat.name) && !isMaintenanceRow(cat.name) && !isLiabilityRow(cat.name))
      .map((cat) => {
        const { value, monthsUsed } = computeBaseline(categoryMonthly(cat), refWindow);
        return { name: cat.name, baseline: value, monthsUsed, pct: incomeCategoryPct[cat.name] ?? 0 };
      })
      .filter((l) => l.baseline > 0)
      .sort((a, b) => b.baseline - a.baseline);
  }, [incomeTree, refWindow, incomeCategoryPct]);

  const visibleIncomeLevers = showAllIncome ? incomeLevers : incomeLevers.slice(0, TOP_INCOME_COUNT);
  const visibleExpenseLevers = showAllExpense ? expenseLevers : expenseLevers.slice(0, TOP_EXPENSE_COUNT);

  // FIX: previously only checked the alphabetically-first category (could be
  // thin/sparse even when others weren't) -- now takes the max across all.
  const historyMonthsAvailable = useMemo(() => {
    const counts = (expenseTree as Category[]).map((cat) => categoryMonthly(cat).filter((v) => v > 0).length);
    return counts.length ? Math.max(...counts) : 0;
  }, [expenseTree]);

  // Contingency: pull the REAL per-sqft rate history from the same
  // "Contingency Rate Reference" row resident.balance.tsx already reads.
  // This is NOT a normal income category (excluded from incomeLevers above
  // via isContingencyRateReference) and it is NOT derived from Net Surplus --
  // it's its own independent monthly rate, aligned to months12 the same way
  // every other category tree is.
  const contingencyRateByMonth = useMemo(() => {
    const cat = (incomeTree as Category[]).find((c) => isContingencyRateReference(c.name));
    const map = new Map<string, number>();
    if (!cat) return map;
    const monthly = categoryMonthly(cat); // raw encoded rate (x100), aligned to months12
    months12.forEach((label: string, i: number) => map.set(label, (monthly[i] ?? 0) / 100));
    return map;
  }, [incomeTree]);

  // Default the forecast-months rate to the most recently recorded ACTUAL
  // rate that wasn't zero (rather than a plain average), since the real
  // pattern is "collected in some months, not others" -- averaging in the
  // zero months would understate the rate actually being charged when it
  // IS collected.
  const defaultContingencyRate = useMemo(() => {
    for (let i = lastCompletedIdx; i >= 0; i--) {
      const rate = contingencyRateByMonth.get(fyMonths[i]?.label) ?? 0;
      if (rate > 0) return rate;
    }
    return 0;
  }, [contingencyRateByMonth, fyMonths, lastCompletedIdx]);

  const [contingencyRate, setContingencyRate] = useState<number | null>(null);
  const effectiveContingencyRate = contingencyRate ?? defaultContingencyRate;

  // NOTE: the Contingency Fund total used to be summarized in its own card
  // on this page. It's been removed here because the same figure (ring-
  // fenced portion of Closing Balance) is already shown on the Opening &
  // Closing Balance page -- this page only needs the Contingency Rate LEVER
  // below so residents can still see/adjust the assumption feeding forecast
  // months; it no longer computes or displays the aggregate total itself.

  function combinedFactor(pct: number): number {
    const inflation = inflationPct / 100;
    const cat = pct / 100;
    return combineMode === "additive" ? 1 + inflation + cat : (1 + inflation) * (1 + cat);
  }
  const forwardInflationMultiplier = Math.pow(1 + inflationPct / 100, yearsForward);

  // TRUE OPENING BALANCE -- one-time anchor, mirrors resident.balance.tsx's
  // identical fix. If an "Opening Balance Reference" row has been uploaded
  // (the confirmed real starting balance for this ledger), its first
  // non-zero value is used as the anchor instead of the derived all-time
  // balanceStrip figure. This matters most for the very first tracked FY --
  // e.g. real record-keeping began in October, so the confirmed October
  // anchor IS the starting point for that whole FY; there is no reliable
  // pre-October number to compute instead, so we don't try to invent one.
  const isOpeningBalanceReference = (name: string) => /opening balance reference/i.test(name || "");
  const openingBalanceCategory = (incomeTree as Category[]).find((c) => isOpeningBalanceReference(c.name));
  const openingBalanceFullMonthly = openingBalanceCategory ? categoryMonthly(openingBalanceCategory) : [];
  let trueOpeningAnchor: number | null = null;
  for (let idx = 0; idx < openingBalanceFullMonthly.length; idx++) {
    if (openingBalanceFullMonthly[idx]) { trueOpeningAnchor = openingBalanceFullMonthly[idx]; break; }
  }
  const hasTrueAnchor = trueOpeningAnchor !== null;

  // Standalone forecast-month formula, deliberately kept separate from the
  // monthRows loop below (small duplication, on purpose) so that fixing
  // multi-year chaining here can never change what's already shown/verified
  // correct for the currently selected FY's own forecast months. Excludes
  // the one-time "Unknown Expense" input and expense-mix tracking, since
  // those are specific to the single FY currently on screen, not to
  // bridging an earlier, already-passed FY in the background.
  function computeForecastMonth(openingForInterest: number, yearsForwardHere: number) {
    const fMultiplier = Math.pow(1 + inflationPct / 100, yearsForwardHere);
    const billed = maintenanceRate * TOTAL_SQFT;
    let income = billed * (collectionPct / 100) + openingForInterest * (interestPct / 100);
    incomeLevers.forEach((lv) => {
      const factor = inflationScope === "both" ? combinedFactor(lv.pct) : 1 + lv.pct / 100;
      income += lv.baseline * factor * fMultiplier;
    });
    let expense = 0;
    expenseLevers.forEach((lv) => {
      expense += lv.baseline * combinedFactor(lv.pct) * fMultiplier;
    });
    return { income, expense };
  }

  // True opening balance for the SELECTED FY. Three cases:
  //  (a) This FY starts before any real data exists at all (the very first
  //      tracked FY) -- use the confirmed True Opening Balance directly;
  //      there is nothing reliable to sum before it.
  //  (b) This FY starts within/before the real-data range we already have
  //      (the common case) -- sum real actual net for every month strictly
  //      before this FY's start, same as before.
  //  (c) This FY starts AFTER the last month we have real data for (e.g.
  //      viewing two or more FYs ahead) -- bridge the gap between the last
  //      real month and this FY's start using the SAME forecast formula as
  //      the rest of this page, so a later FY's opening always equals the
  //      (possibly still-forecast) closing balance of the FY right before
  //      it, instead of silently resetting to the anchor. This is what was
  //      missing: FY N+1's opening correctly picked up FY N's real closing,
  //      but FY N+2's opening skipped straight back to the anchor because
  //      the bridge only ever looked at REAL monthlyTotals rows, and FY N's
  //      own tail end (still forecast) never appears there.
  const fyOpeningBalance = useMemo(() => {
    const anchor = hasTrueAnchor ? (trueOpeningAnchor as number) : (balanceStrip.opening || 0);
    const fyStartDate = fyMonths[0]?.date;
    if (!fyStartDate) return anchor;

    const parsedActuals = (monthlyTotals as any[])
      .map((m) => ({ m, d: parseMonthLabel(m.month) }))
      .filter((x): x is { m: any; d: Date } => x.d !== null)
      .sort((a, b) => a.d.getTime() - b.d.getTime());

    if (parsedActuals.length === 0) return anchor;

    const earliestDate = parsedActuals[0].d;
    const latestDate = parsedActuals[parsedActuals.length - 1].d;

    if (fyStartDate.getTime() <= earliestDate.getTime()) return anchor; // case (a)

    const realNet = parsedActuals
      .filter((x) => x.d.getTime() < fyStartDate.getTime())
      .reduce((s, x) => s + (x.m.collection ?? 0) - (x.m.expense ?? 0), 0);

    let bridgeNet = 0;
    let running = anchor + realNet;
    let cursor = new Date(latestDate.getFullYear(), latestDate.getMonth() + 1, 1);
    while (cursor.getTime() < fyStartDate.getTime()) {
      const yearsForwardHere = fiscalStartYearFor(cursor) - defaultFyStart;
      const { income, expense } = computeForecastMonth(running, yearsForwardHere);
      const net = income - expense;
      bridgeNet += net;
      running += net;
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }

    return anchor + realNet + bridgeNet; // case (b) when bridgeNet ends up 0, case (c) otherwise
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    monthlyTotals, fyMonths, balanceStrip.opening, hasTrueAnchor, trueOpeningAnchor, defaultFyStart,
    maintenanceRate, collectionPct, interestPct, inflationPct, incomeLevers, expenseLevers, combineMode, inflationScope,
  ]);

  // TODAY'S REAL POSITION -- deliberately independent of the FY dropdown
  // above. "Opening" and "Closing" on this page are scoped to whichever FY
  // is selected (which could be a future or closed year); this always shows
  // the actual, real, all-time position as of the most recent month there
  // is real data for, so residents/admins have a fixed reference point no
  // matter which FY they're browsing.
  const todaySnapshot = useMemo(() => {
    const anchor = hasTrueAnchor ? (trueOpeningAnchor as number) : (balanceStrip.opening || 0);
    const parsedActuals = (monthlyTotals as any[])
      .map((m) => ({ m, d: parseMonthLabel(m.month) }))
      .filter((x): x is { m: any; d: Date } => x.d !== null)
      .sort((a, b) => a.d.getTime() - b.d.getTime());
    if (parsedActuals.length === 0) {
      return { netOperatingSurplus: 0, bankBalance: anchor, asOfLabel: null as string | null };
    }
    const realNet = parsedActuals.reduce((s, x) => s + (x.m.collection ?? 0) - (x.m.expense ?? 0), 0);
    const lastActual = parsedActuals[parsedActuals.length - 1];
    return {
      netOperatingSurplus: realNet,
      bankBalance: anchor + realNet,
      asOfLabel: lastActual.m.month as string,
    };
  }, [monthlyTotals, hasTrueAnchor, trueOpeningAnchor, balanceStrip.opening]);

  const { rows: monthRows, mixByCategory } = useMemo(() => {
    let opening = fyOpeningBalance;
    const out: MonthRow[] = [];
    const mix: Record<string, number> = {};

    fyMonths.forEach((fm, i) => {
      const actual: any = actualByMonth[i];
      let income: number, expense: number;
      let status: MonthRow["status"];
      if (actual) {
        status = "actual";
        income = actual.collection ?? 0;
        expense = actual.expense ?? 0;
      } else if (i > lastCompletedIdx) {
        // Genuinely still ahead of us (comes after the last month we have
        // real data for) -- this is the only case a forecast belongs.
        status = "forecast";
        const billed = maintenanceRate * TOTAL_SQFT;
        income = billed * (collectionPct / 100) + opening * (interestPct / 100);
        incomeLevers.forEach((lv) => {
          const factor = inflationScope === "both" ? combinedFactor(lv.pct) : 1 + lv.pct / 100;
          income += lv.baseline * factor * forwardInflationMultiplier;
        });
        expense = 0;
        expenseLevers.forEach((lv) => {
          const amt = lv.baseline * combinedFactor(lv.pct) * forwardInflationMultiplier;
          expense += amt;
          mix[lv.name] = (mix[lv.name] ?? 0) + amt;
        });
        if (i === lastCompletedIdx + 1) expense += unknownExpense;
      } else {
        // No actual record AND already in the past relative to the data we
        // have (e.g. before real record-keeping began) -- this has already
        // happened, so forecasting it would be inventing history, not
        // predicting the future. Show it as genuinely empty instead.
        status = "noData";
        income = 0;
        expense = 0;
      }
      const net = income - expense;
      const closing = opening + net;
      out.push({ month: fm.label, status, income, expense, net, closing });
      opening = closing;
    });
    return { rows: out, mixByCategory: mix };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    fyMonths, actualByMonth, fyOpeningBalance, maintenanceRate, collectionPct, interestPct,
    incomeLevers, expenseLevers, inflationScope, forwardInflationMultiplier, unknownExpense,
    lastCompletedIdx, combineMode, inflationPct,
  ]);

  const fyIncome = monthRows.reduce((s, r) => s + r.income, 0);
  const fyExpense = monthRows.reduce((s, r) => s + r.expense, 0);
  const fyNet = fyIncome - fyExpense;
  const closing = monthRows[11]?.closing ?? 0;
  const worst = monthRows.length ? Math.min(...monthRows.map((r) => r.closing)) : 0;
  const risk: "high" | "moderate" | "low" =
    worst < 0 ? "high" : worst < (fyOpeningBalance || 1) * 0.3 ? "moderate" : "low";

  const mixData = Object.entries(mixByCategory).map(([name, value], i) => ({
    name, value, color: CHART_COLORS[i % CHART_COLORS.length],
  }));

  function resetAll() {
    setMaintenanceRate(4); setCollectionPct(90); setInterestPct(0); setInflationPct(6);
    setContingencyRate(null); setUnknownExpense(0); setIncomeCategoryPct({}); setExpenseCategoryPct({});
    setRefWindow(12); setCombineMode("compound"); setInflationScope("expense");
    setShowAllIncome(false); setShowAllExpense(false);
  }

  // UX: a single at-a-glance count of every lever currently sitting away
  // from its standard value -- shown next to Reset so it's obvious BEFORE
  // reading any number below whether you're looking at the standard
  // projection or a scenario you've been experimenting with.
  const changedLeverCount = useMemo(() => {
    let n = 0;
    if (maintenanceRate !== 4) n++;
    if (collectionPct !== 90) n++;
    if (interestPct !== 0) n++;
    if (inflationPct !== 6) n++;
    if (contingencyRate !== null) n++;
    if (unknownExpense !== 0) n++;
    n += Object.values(incomeCategoryPct).filter((v) => v !== 0).length;
    n += Object.values(expenseCategoryPct).filter((v) => v !== 0).length;
    return n;
  }, [maintenanceRate, collectionPct, interestPct, inflationPct, contingencyRate, unknownExpense, incomeCategoryPct, expenseCategoryPct]);

  const riskLabel = risk === "high" ? "HIGH RISK" : risk === "moderate" ? "MODERATE RISK" : "LOW RISK";
  const riskClass =
    risk === "high" ? "border-rose-500/40 text-rose-600" :
    risk === "moderate" ? "border-amber-500/40 text-amber-600" :
    "border-emerald-500/40 text-emerald-600";

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Financial Forecast</h2>
          <p className="text-xs text-muted-foreground">Every lever is yours to explore -- local to your browser, never saved or shared. This view always covers all 12 months of {fyLabelFor(fyStart)}.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={String(fyStart)} onValueChange={(v) => setFyStart(Number(v))}>
            <SelectTrigger className="w-[170px] h-9 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {fyOptions.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {fyLabelFor(y)}{y === defaultFyStart ? " (Current)" : y < defaultFyStart ? " (Closed)" : " (Forecast)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {changedLeverCount > 0 && (
            <Badge
              variant="outline"
              className="h-9 px-2.5 text-[11px] border-amber-400/60 text-amber-700 bg-amber-50 flex items-center gap-1.5"
              title="Levers currently different from their standard value -- see the amber &quot;Changed&quot; tags below"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              {changedLeverCount} lever{changedLeverCount === 1 ? "" : "s"} changed
            </Badge>
          )}
          <Button variant="outline" size="sm" className="h-9" onClick={() => setConfigOpen((v) => !v)}>
            <Settings2 className="h-3.5 w-3.5 mr-1" /> Config
          </Button>
          <Button variant="ghost" size="sm" className="h-9" onClick={resetAll}>
            <RotateCcw className="h-3.5 w-3.5 mr-1" /> Reset
          </Button>
        </div>
      </div>

      {/* KPI 3-tile row -- restored */}
      {isWidgetVisible("forecasting.kpiTiles") && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="rounded-lg border p-3">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground truncate">Opening · {fyLabelFor(fyStart)}</div>
            <div className="text-sm sm:text-lg font-black truncate">{inr(fyOpeningBalance)}</div>
            <div className="text-[8px] text-muted-foreground mt-0.5 leading-tight">Carried forward from before this FY began</div>
          </div>
          <div className="rounded-lg p-3 bg-gradient-to-br from-[#0082c9] to-[#005f91] text-white">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-blue-100 truncate">Closing · {fyLabelFor(fyStart)}</div>
            <div className="text-sm sm:text-lg font-black truncate">{inr(closing)}</div>
            <div className="text-[8px] text-blue-100 mt-0.5 leading-tight">Opening + full-year Net Surplus</div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground truncate">Net Surplus</div>
            <div className={"text-sm sm:text-lg font-black truncate " + (fyNet < 0 ? "text-rose-600" : "")}>{inr(fyNet)}</div>
            <div className="text-[8px] text-muted-foreground mt-0.5 leading-tight">Total income minus total expense, all 12 months</div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground truncate">Risk</div>
            <Badge variant="outline" className={"mt-0.5 text-[10px] " + riskClass}>{riskLabel}</Badge>
            <div className="text-[8px] text-muted-foreground mt-1 leading-tight">Based on the lowest projected month-end balance this year</div>
          </div>
        </div>
      )}

      {/* As of Today -- real, all-time position, independent of the FY
          dropdown above (per feedback: shown alongside the FY-scoped
          Opening/Closing tiles, not merged into them). */}
      {isWidgetVisible("forecasting.kpiTiles") && todaySnapshot.asOfLabel && (
        <div className="rounded-lg border p-3 bg-muted/20">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              As of Today -- real position, not filtered by the FY selector above
            </div>
            <Badge variant="outline" className="text-[9px] border-dashed">All-Time · as of {todaySnapshot.asOfLabel}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Net Operating Surplus</div>
              <div className={"text-lg font-black truncate " + (todaySnapshot.netOperatingSurplus < 0 ? "text-rose-600" : "")}>{inr(todaySnapshot.netOperatingSurplus)}</div>
              <div className="text-[8px] text-muted-foreground mt-0.5 leading-tight">All real income minus all real expense, since day one</div>
            </div>
            <div>
              <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Bank Balance</div>
              <div className="text-lg font-black truncate">{inr(todaySnapshot.bankBalance)}</div>
              <div className="text-[8px] text-muted-foreground mt-0.5 leading-tight">True Opening Balance + Net Operating Surplus above</div>
            </div>
          </div>
        </div>
      )}

      {/* Configuration panel -- restored */}
      {configOpen && isWidgetVisible("forecasting.configPanel") && (
        <Card className="bg-muted/30">
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Forecast Configuration</CardTitle>
            <CardDescription className="text-xs">Methodology -- changes HOW the forecast is calculated, not just its inputs.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-3 pb-4">
            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Reference Window (mo)</label>
              <Input type="number" min={1} max={24} value={refWindow} onChange={(e) => setRefWindow(Number(e.target.value) || 12)} className="h-8 text-sm" />
              <p className="text-[10px] text-muted-foreground">As of today, {historyMonthsAvailable} mo of real history exist overall -- this grows by itself as each new month closes out, so expect it to be higher next time you check. Each category above only averages the months it actually has data for -- see "avg of N months" under each lever below.</p>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Inflation Combination</label>
              <Select value={combineMode} onValueChange={(v) => setCombineMode(v as "compound" | "additive")}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="compound">Compounding (standard)</SelectItem>
                  <SelectItem value="additive">Additive (simpler)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Apply Inflation To</label>
              <Select value={inflationScope} onValueChange={(v) => setInflationScope(v as "expense" | "both")}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="expense">Expenses only</SelectItem>
                  <SelectItem value="both">Income &amp; Expenses</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      {/* LEVERS -- Global Assumptions left exactly as it was (full card, unchanged) */}
      {isWidgetVisible("forecasting.assumptions") && (
        <div className="space-y-3">
          <Card>
            <CardHeader className="py-3"><CardTitle className="text-sm">Global Assumptions</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 pb-4">
              <LeverRow label="Maintenance Rate (₹/sqft/mo)" value={maintenanceRate} onChange={setMaintenanceRate} min={3} max={5} step={0.05} display={"₹" + maintenanceRate.toFixed(2)} defaultValue={4} formatValue={(v) => "₹" + v.toFixed(2)} />
              <LeverRow label="Maintenance Collection %" value={collectionPct} onChange={setCollectionPct} min={50} max={100} step={1} display={collectionPct + "%"} defaultValue={90} formatValue={(v) => v + "%"} />
              <LeverRow label="Interest on Surplus %" value={interestPct} onChange={setInterestPct} min={0} max={10} step={0.5} display={interestPct + "%"} defaultValue={0} formatValue={(v) => v + "%"} />
              <LeverRow label="Inflation (annual)" value={inflationPct} onChange={setInflationPct} min={0} max={15} step={0.5} display={inflationPct + "%"} defaultValue={6} formatValue={(v) => v + "%"} />
              <LeverRow
                label="Contingency Rate (₹/sqft/mo)"
                value={effectiveContingencyRate}
                onChange={setContingencyRate}
                min={0} max={5} step={0.05}
                display={"₹" + effectiveContingencyRate.toFixed(2)}
                defaultValue={defaultContingencyRate}
                formatValue={(v) => "₹" + v.toFixed(2)}
                sub={contingencyRate === null ? "Defaulted from the last month it was actually collected" : "Forecast months only -- actuals use the real recorded rate"}
              />
              <div className="space-y-1">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  Unknown Expense <span className="text-[10px] text-muted-foreground font-normal">(one-time, ₹)</span>
                  {unknownExpense !== 0 && (
                    <span className="inline-flex items-center gap-1 text-[9px] font-semibold text-amber-700 bg-amber-50 border border-amber-300 rounded-full px-1.5 py-0.5" title="Standard value is ₹0">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Changed
                    </span>
                  )}
                </label>
                <Input type="number" value={unknownExpense} step={10000} onChange={(e) => setUnknownExpense(Number(e.target.value) || 0)} className="h-8 text-sm" />
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Income Categories</CardTitle>
                <CardDescription className="text-xs">Top {Math.min(TOP_INCOME_COUNT, incomeLevers.length)} by size · % above baseline</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 pb-4">
                {incomeLevers.length === 0 && <p className="text-sm text-muted-foreground">No income category history available yet.</p>}
                {visibleIncomeLevers.map((lv) => (
                  <LeverRow
                    key={lv.name}
                    label={lv.name}
                    sub={"Baseline " + inr(lv.baseline) + "/mo (avg of " + lv.monthsUsed + " month" + (lv.monthsUsed === 1 ? "" : "s") + " with data)"}
                    value={lv.pct}
                    onChange={(v) => setIncomeCategoryPct((p) => ({ ...p, [lv.name]: v }))}
                    min={-80} max={80} step={1} display={lv.pct + "%"}
                    defaultValue={0} formatValue={(v) => v + "%"}
                  />
                ))}
                {incomeLevers.length > TOP_INCOME_COUNT && (
                  <button className="text-xs font-medium text-primary hover:underline" onClick={() => setShowAllIncome((v) => !v)}>
                    {showAllIncome ? "Show fewer" : "+ " + (incomeLevers.length - TOP_INCOME_COUNT) + " more categories"}
                  </button>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Expense Categories</CardTitle>
                <CardDescription className="text-xs">Top {Math.min(TOP_EXPENSE_COUNT, expenseLevers.length)} by size · % above inflation</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 pb-4">
                {expenseLevers.length === 0 && <p className="text-sm text-muted-foreground">No expense category history available yet.</p>}
                {visibleExpenseLevers.map((lv) => (
                  <LeverRow
                    key={lv.name}
                    label={lv.name}
                    sub={"Baseline " + inr(lv.baseline) + "/mo (avg of " + lv.monthsUsed + " month" + (lv.monthsUsed === 1 ? "" : "s") + " with data)"}
                    value={lv.pct}
                    onChange={(v) => setExpenseCategoryPct((p) => ({ ...p, [lv.name]: v }))}
                    min={-30} max={50} step={1} display={lv.pct + "%"}
                    defaultValue={0} formatValue={(v) => v + "%"}
                  />
                ))}
                {expenseLevers.length > TOP_EXPENSE_COUNT && (
                  <button className="text-xs font-medium text-primary hover:underline" onClick={() => setShowAllExpense((v) => !v)}>
                    {showAllExpense ? "Show fewer" : "+ " + (expenseLevers.length - TOP_EXPENSE_COUNT) + " more categories"}
                  </button>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {isWidgetVisible("forecasting.monthTable") && (
        <Card>
          <CardHeader className="cursor-pointer select-none py-3" onClick={() => setTableOpen((v) => !v)}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {tableOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                <CardTitle className="text-sm">Month-by-Month Detail · {fyLabelFor(fyStart)}</CardTitle>
              </div>
              <Badge variant="outline" className="text-[10px]">{actualMonthsCount} actual · {forecastMonthsCount} forecast{noDataMonthsCount > 0 ? " · " + noDataMonthsCount + " no data" : ""}</Badge>
            </div>
          </CardHeader>
          {tableOpen && (
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Income</TableHead>
                    <TableHead className="text-right">Expense</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead className="text-right">Closing</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monthRows.map((r) => (
                    <TableRow key={r.month}>
                      <TableCell className="font-medium">{r.month}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={
                          r.status === "actual" ? "border-blue-500/40 text-blue-600" :
                          r.status === "forecast" ? "border-dashed text-muted-foreground" :
                          "border-amber-500/40 text-amber-600 bg-amber-50"
                        }>
                          {r.status === "actual" ? "ACTUAL" : r.status === "forecast" ? "FORECAST" : "NO DATA"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-emerald-600">{inr(r.income)}</TableCell>
                      <TableCell className="text-right font-mono text-rose-600">{inr(r.expense)}</TableCell>
                      <TableCell className={"text-right font-mono font-semibold " + (r.net < 0 ? "text-rose-600" : "")}>{inr(r.net)}</TableCell>
                      <TableCell className={"text-right font-mono font-semibold " + (r.closing < 0 ? "text-rose-600" : "")}>{inr(r.closing)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          )}
        </Card>
      )}

      {(isWidgetVisible("forecasting.charts") || isWidgetVisible("forecasting.mix")) && (
        <Card>
          <Tabs defaultValue="trend">
            <CardHeader className="py-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-sm">Forecast Dashboard</CardTitle>
                <TabsList className="h-8">
                  {isWidgetVisible("forecasting.charts") && <TabsTrigger value="trend" className="text-xs h-6">Trend</TabsTrigger>}
                  {isWidgetVisible("forecasting.mix") && <TabsTrigger value="mix" className="text-xs h-6">Expense Mix</TabsTrigger>}
                </TabsList>
              </div>
            </CardHeader>
            <CardContent>
              {isWidgetVisible("forecasting.charts") && (
                <TabsContent value="trend" className="mt-0">
                  <ResponsiveContainer width="100%" height={280}>
                    <ComposedChart data={monthRows} margin={{ left: 8, right: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="month" fontSize={10} />
                      <YAxis tickFormatter={(v) => "₹" + (v / 100000).toFixed(0) + "L"} fontSize={10} />
                      <Tooltip trigger={getTooltipTrigger()} content={<SmartTooltipContent labelPrefix="Month" valueFormatter={(v: number) => inr(v)} />} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="income" name="Income" radius={[4, 4, 0, 0]}>
                        {monthRows.map((r, i) => <Cell key={i} fill={r.status === "actual" ? "#3b82f6" : r.status === "forecast" ? "#93c5fd" : "#e2e8f0"} />)}
                      </Bar>
                      <Bar dataKey="expense" name="Expense" radius={[4, 4, 0, 0]}>
                        {monthRows.map((r, i) => <Cell key={i} fill={r.status === "actual" ? "#f87171" : r.status === "forecast" ? "#fecaca" : "#e2e8f0"} />)}
                      </Bar>
                      <Line type="monotone" dataKey="closing" name="Closing Balance" stroke="#1e293b" strokeWidth={2} dot={{ r: 3 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </TabsContent>
              )}
              {isWidgetVisible("forecasting.mix") && (
                <TabsContent value="mix" className="mt-0">
                  <ResponsiveContainer width="100%" height={230}>
                    <PieChart>
                      <Pie data={mixData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                        {mixData.map((d, i) => <Cell key={i} fill={d.color} />)}
                      </Pie>
                      <Tooltip formatter={(v: number) => inr(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px] text-muted-foreground">
                    {mixData.map((d) => (
                      <span key={d.name} className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-sm inline-block" style={{ background: d.color }} />{d.name}
                      </span>
                    ))}
                  </div>
                </TabsContent>
              )}
            </CardContent>
          </Tabs>
        </Card>
      )}

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs space-y-1.5">
          <div>This is a what-if simulator, not an official published budget -- nothing you change here is saved or shared with anyone.</div>
          <div><span className="font-semibold text-foreground">Coverage:</span> {fyLabelFor(fyStart)} always shows all 12 months. As of today, {actualMonthsCount} {actualMonthsCount === 1 ? "is" : "are"} already actual (real recorded data) and {forecastMonthsCount} {forecastMonthsCount === 1 ? "is" : "are"} still forecast using the levers above -- this split updates on its own as each new month's real data comes in, so don't be surprised if these two numbers are different next time you check.</div>
          <div><span className="font-semibold text-foreground">Baselines:</span> each category's monthly baseline (shown as "avg of N months" under its lever) uses up to {refWindow} of that category's own real months only -- a month where that specific category had no recorded activity is skipped entirely, not treated as ₹0. {historyMonthsAvailable} months of real data exist for this community overall right now.</div>
          {noDataMonthsCount > 0 && (
            <div><span className="font-semibold text-foreground">No-data months:</span> {noDataMonthsCount} month{noDataMonthsCount === 1 ? "" : "s"} earlier in this FY (before real record-keeping began here) show as NO DATA, not FORECAST -- we never invent numbers for months that have already happened.</div>
          )}
          <div><span className="font-semibold text-foreground">Contingency Fund:</span> already shown as part of Closing Balance on the Opening &amp; Closing Balance page -- adjust its forecast assumption here using the Contingency Rate lever below.</div>
          <div><span className="font-semibold text-foreground">Changed levers:</span> any lever showing an amber "Changed" tag (and the "N levers changed" badge up top) is sitting away from its standard value -- the small tick mark on its slider shows exactly where standard sits, so a surprising number is always traceable back to what you moved.</div>
        </AlertDescription>
      </Alert>
    </div>
  );
}

// UX: every lever can silently drift far from a sane value while exploring
// this page (that's the whole point of a what-if tool) -- but nothing told
// you WHICH levers you'd actually touched, so a debatable number (e.g. an
// unrealistically low Income) was hard to trace back to its cause. Passing
// defaultValue (+ optionally formatValue, for proper units) now makes every
// lever self-report when it's been moved away from its standard value:
// a "Changed" tag next to the label, a tick mark on the track showing
// exactly where standard sits, and a caption spelling out the gap.
function LeverRow({
  label, sub, value, onChange, min, max, step, display, defaultValue, formatValue,
}: {
  label: string; sub?: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step: number; display: string;
  defaultValue?: number; formatValue?: (v: number) => string;
}) {
  const hasDefault = defaultValue !== undefined && Number.isFinite(defaultValue);
  const isChanged = hasDefault && Math.abs(value - (defaultValue as number)) > 1e-9;
  const defaultPct = hasDefault ? Math.min(100, Math.max(0, ((defaultValue as number) - min) / (max - min) * 100)) : null;
  const fmt = (v: number) => (formatValue ? formatValue(v) : String(v));
  const delta = hasDefault ? value - (defaultValue as number) : 0;
  return (
    <div>
      <div className="flex justify-between items-center gap-2">
        <label className="text-sm font-medium flex items-center gap-1.5 min-w-0">
          <span className="truncate">{label}</span>
          {isChanged && (
            <span
              className="shrink-0 inline-flex items-center gap-1 text-[9px] font-semibold text-amber-700 bg-amber-50 border border-amber-300 rounded-full px-1.5 py-0.5"
              title={"Standard value is " + fmt(defaultValue as number)}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Changed
            </span>
          )}
        </label>
        <span className={"font-bold text-sm shrink-0 " + (value < 0 ? "text-rose-600" : value > 0 ? "text-emerald-600" : "")}>{display}</span>
      </div>
      <div className="relative mt-1.5">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="relative z-10 w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-[#0082c9]"
        />
        {defaultPct !== null && (
          <div
            className="absolute top-1/2 -translate-y-1/2 h-2.5 w-[3px] rounded-full bg-slate-500/70 dark:bg-slate-300/70 pointer-events-none"
            style={{ left: "calc(" + defaultPct + "% - 1.5px)" }}
            title={"Standard: " + fmt(defaultValue as number)}
          />
        )}
      </div>
      {sub && <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mt-1">{sub}</p>}
      {isChanged && (
        <p className="text-[10px] text-amber-700 mt-0.5">
          Standard value is {fmt(defaultValue as number)} -- you're {delta > 0 ? fmt(Math.abs(delta)) + " above" : fmt(Math.abs(delta)) + " below"} that.
        </p>
      )}
    </div>
  );
}

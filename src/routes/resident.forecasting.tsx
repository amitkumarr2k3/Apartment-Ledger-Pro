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

type CategoryLever = { name: string; baseline: number; pct: number };
type MonthRow = { month: string; isActual: boolean; income: number; expense: number; net: number; closing: number };

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

  function computeBaseline(monthly: number[], window: number): number {
    const nonZero = monthly.filter((v) => v > 0);
    const sample = nonZero.slice(-window);
    if (sample.length === 0) return 0;
    return sample.reduce((s, v) => s + v, 0) / sample.length;
  }

  const expenseLevers: CategoryLever[] = useMemo(() => {
    return (expenseTree as Category[])
      .map((cat) => ({
        name: cat.name,
        baseline: computeBaseline(categoryMonthly(cat), refWindow),
        pct: expenseCategoryPct[cat.name] ?? 0,
      }))
      .filter((l) => l.baseline > 0)
      .sort((a, b) => b.baseline - a.baseline);
  }, [expenseTree, refWindow, expenseCategoryPct]);

  const incomeLevers: CategoryLever[] = useMemo(() => {
    return (incomeTree as Category[])
      .filter((cat) => !isReferenceRow(cat.name) && !isMaintenanceRow(cat.name) && !isLiabilityRow(cat.name))
      .map((cat) => ({
        name: cat.name,
        baseline: computeBaseline(categoryMonthly(cat), refWindow),
        pct: incomeCategoryPct[cat.name] ?? 0,
      }))
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

  // Contingency Fund: independent running total, actual months use the REAL
  // recorded rate for that exact month (0 where it genuinely wasn't
  // collected), forecast months use the adjustable rate above. This number
  // is informational only -- it does NOT get subtracted from Total Income
  // or Total Expense anywhere; it's a portion OF the closing balance you
  // already computed, same "part of, not additional to" rule used on the
  // Opening & Closing Balance page.
  const contingencyFundTotal = useMemo(() => {
    let total = 0;
    fyMonths.forEach((fm, i) => {
      const isActual = i <= lastCompletedIdx;
      const rate = isActual ? (contingencyRateByMonth.get(fm.label) ?? 0) : effectiveContingencyRate;
      total += rate * TOTAL_SQFT;
    });
    return total;
  }, [fyMonths, lastCompletedIdx, contingencyRateByMonth, effectiveContingencyRate]);

  function combinedFactor(pct: number): number {
    const inflation = inflationPct / 100;
    const cat = pct / 100;
    return combineMode === "additive" ? 1 + inflation + cat : (1 + inflation) * (1 + cat);
  }
  const forwardInflationMultiplier = Math.pow(1 + inflationPct / 100, yearsForward);

  // True opening balance for the SELECTED FY -- all-time opening balance
  // plus the net of every month that comes before this FY's first month.
  // Same approach as resident.balance.tsx's "TRUE OPENING BALANCE" logic:
  // find where the FY actually starts in the real data and sum everything
  // strictly before it, rather than assuming the all-time opening balance
  // (from /balance-strip, which is "ORDER BY month ASC LIMIT 1" -- i.e. the
  // balance as of the very FIRST month ever recorded, not this FY's start)
  // already represents "as of this FY's start". This is what makes the
  // forecast genuinely cumulative -- prior years roll into this one instead
  // of being silently dropped.
  const fyOpeningBalance = useMemo(() => {
    const firstMonthLabel = fyMonths[0]?.label;
    const idx = firstMonthLabel
      ? (monthlyTotals as any[]).findIndex((m) => m.month === firstMonthLabel)
      : -1;
    const priorMonths = idx >= 0 ? (monthlyTotals as any[]).slice(0, idx) : (monthlyTotals as any[]);
    const priorNet = priorMonths.reduce((s, m) => s + (m.collection ?? 0) - (m.expense ?? 0), 0);
    return (balanceStrip.opening || 0) + priorNet;
  }, [monthlyTotals, fyMonths, balanceStrip.opening]);

  const { rows: monthRows, mixByCategory } = useMemo(() => {
    let opening = fyOpeningBalance;
    const out: MonthRow[] = [];
    const mix: Record<string, number> = {};

    fyMonths.forEach((fm, i) => {
      const actual: any = actualByMonth[i];
      let income: number, expense: number;
      if (actual) {
        income = actual.collection ?? 0;
        expense = actual.expense ?? 0;
      } else {
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
      }
      const net = income - expense;
      const closing = opening + net;
      out.push({ month: fm.label, isActual: !!actual, income, expense, net, closing });
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
          <p className="text-xs text-muted-foreground">Every lever is yours to explore -- local to your browser, never saved or shared.</p>
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
          </div>
          <div className="rounded-lg p-3 bg-gradient-to-br from-[#0082c9] to-[#005f91] text-white">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-blue-100 truncate">Closing · {fyLabelFor(fyStart)}</div>
            <div className="text-sm sm:text-lg font-black truncate">{inr(closing)}</div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground truncate">Net Surplus</div>
            <div className={"text-sm sm:text-lg font-black truncate " + (fyNet < 0 ? "text-rose-600" : "")}>{inr(fyNet)}</div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground truncate">Risk</div>
            <Badge variant="outline" className={"mt-0.5 text-[10px] " + riskClass}>{riskLabel}</Badge>
          </div>
        </div>
      )}

      {/* Contingency Fund -- computed from the real per-sqft rate history,
          same mechanism as the Opening & Closing Balance page. This is a
          portion OF the Closing Balance above, not extra money on top of it. */}
      {isWidgetVisible("forecasting.kpiTiles") && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Contingency Fund · {fyLabelFor(fyStart)}
              </div>
              <div className="text-sm font-black">{inr(contingencyFundTotal)}</div>
            </div>
            <div className="h-1.5 w-full rounded-full overflow-hidden flex bg-slate-100 dark:bg-slate-800">
              <div
                className="h-full bg-pink-400"
                style={{ width: (closing > 0 ? Math.min(100, (contingencyFundTotal / closing) * 100) : 0) + "%" }}
                title={"Contingency (ring-fenced): " + inr(contingencyFundTotal)}
              />
              <div
                className="h-full bg-cyan-400"
                style={{ width: (closing > 0 ? Math.max(0, 100 - (contingencyFundTotal / closing) * 100) : 100) + "%" }}
                title={"Unrestricted: " + inr(Math.max(0, closing - contingencyFundTotal))}
              />
            </div>
            <div className="flex items-center justify-between w-full mt-1 text-[9px] text-muted-foreground leading-tight">
              <span>● <span className="text-pink-500 font-medium">Contingency</span> {inr(contingencyFundTotal)}</span>
              <span><span className="text-cyan-600 font-medium">Unrestricted</span> {inr(Math.max(0, closing - contingencyFundTotal))} ●</span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">
              Collected via its own per-sqft rate, not a share of Net Surplus -- actual months use the real recorded
              rate (which is genuinely ₹0 in some months), forecast months use the Contingency Rate lever below.
            </p>
          </CardContent>
        </Card>
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
              <p className="text-[10px] text-muted-foreground">{historyMonthsAvailable} mo of real history available.</p>
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
              <LeverRow label="Maintenance Rate (₹/sqft/mo)" value={maintenanceRate} onChange={setMaintenanceRate} min={2} max={10} step={0.25} display={"₹" + maintenanceRate.toFixed(2)} />
              <LeverRow label="Maintenance Collection %" value={collectionPct} onChange={setCollectionPct} min={50} max={100} step={1} display={collectionPct + "%"} />
              <LeverRow label="Interest on Surplus %" value={interestPct} onChange={setInterestPct} min={0} max={10} step={0.5} display={interestPct + "%"} />
              <LeverRow label="Inflation (annual)" value={inflationPct} onChange={setInflationPct} min={0} max={15} step={0.5} display={inflationPct + "%"} />
              <LeverRow
                label="Contingency Rate (₹/sqft/mo)"
                value={effectiveContingencyRate}
                onChange={setContingencyRate}
                min={0} max={5} step={0.05}
                display={"₹" + effectiveContingencyRate.toFixed(2)}
                sub={contingencyRate === null ? "Defaulted from the last month it was actually collected" : "Forecast months only -- actuals use the real recorded rate"}
              />
              <div className="space-y-1">
                <label className="text-sm font-medium">Unknown Expense <span className="text-[10px] text-muted-foreground font-normal">(one-time, ₹)</span></label>
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
                    sub={"Baseline " + inr(lv.baseline) + "/mo"}
                    value={lv.pct}
                    onChange={(v) => setIncomeCategoryPct((p) => ({ ...p, [lv.name]: v }))}
                    min={-80} max={80} step={1} display={lv.pct + "%"}
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
                    sub={"Baseline " + inr(lv.baseline) + "/mo"}
                    value={lv.pct}
                    onChange={(v) => setExpenseCategoryPct((p) => ({ ...p, [lv.name]: v }))}
                    min={-30} max={50} step={1} display={lv.pct + "%"}
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
              <Badge variant="outline" className="text-[10px]">{lastCompletedIdx + 1} actual · {12 - lastCompletedIdx - 1} forecast</Badge>
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
                        <Badge variant="outline" className={r.isActual ? "border-blue-500/40 text-blue-600" : "border-dashed text-muted-foreground"}>
                          {r.isActual ? "ACTUAL" : "FORECAST"}
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
                        {monthRows.map((r, i) => <Cell key={i} fill={r.isActual ? "#3b82f6" : "#93c5fd"} />)}
                      </Bar>
                      <Bar dataKey="expense" name="Expense" radius={[4, 4, 0, 0]}>
                        {monthRows.map((r, i) => <Cell key={i} fill={r.isActual ? "#f87171" : "#fecaca"} />)}
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
    </div>
  );
}

function LeverRow({
  label, sub, value, onChange, min, max, step, display,
}: {
  label: string; sub?: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step: number; display: string;
}) {
  return (
    <div>
      <div className="flex justify-between items-center">
        <label className="text-sm font-medium">{label}</label>
        <span className={"font-bold text-sm " + (value < 0 ? "text-rose-600" : value > 0 ? "text-emerald-600" : "")}>{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 mt-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-[#0082c9]"
      />
      {sub && <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mt-1">{sub}</p>}
    </div>
  );
}

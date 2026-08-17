import { createFileRoute } from "@tanstack/react-router";
import { PortalShell, usePeriod } from "@/components/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { SmartTooltipContent, getTooltipTrigger } from "@/components/smart-tooltip";
import { inr, categoryMonthly } from "@/lib/finance-mock";
import { useBalanceStrip, useMonthlyTotals, useIncomeTree, useWidgetVisibility } from "@/lib/hooks";
import { Info } from "lucide-react";

const TOTAL_SQFT = 701591;

export const Route = createFileRoute("/resident/balance")({
  component: Page,
  head: () => ({ meta: [{ title: "Resident · Opening & Closing Balance" }] }),
});

function Page() {
  return (
    <PortalShell title="Opening & closing balance" reqIds="RD-40 → RD-44" persona="resident">
      <Inner />
    </PortalShell>
  );
}

function Inner() {
  const { sliceMonthly } = usePeriod();
  const { isWidgetVisible } = useWidgetVisibility("resident.balance");
  const { data: monthlyTotals = [] } = useMonthlyTotals();
  const { data: balanceStrip = { opening: 0, income: 0, expense: 0, net: 0, closing: 0 } } = useBalanceStrip();
  const { data: incomeTree = [] } = useIncomeTree();
  const safeIncomeTree = incomeTree || [];
  const period = sliceMonthly(monthlyTotals);

  // TRUE OPENING BALANCE -- supplied via CSV (head=reference, category=
  // "Opening Balance Reference") instead of relying on the balances table
  // (which is empty for this community) or the "derived" all-time fallback.
  // Falls back to today's existing balanceStrip.opening behavior if this
  // hasn't been uploaded yet, so nothing breaks for communities without it.
  const isOpeningBalanceReference = (name: string) => /opening balance reference/i.test(name || "");
  const openingBalanceCategory = safeIncomeTree.find((c) => isOpeningBalanceReference(c.name));
  const openingBalanceFullMonthly = openingBalanceCategory ? categoryMonthly(openingBalanceCategory) : [];
  let trueOpeningAnchor: number | null = null;
  for (let idx = 0; idx < openingBalanceFullMonthly.length; idx++) {
    if (openingBalanceFullMonthly[idx]) { trueOpeningAnchor = openingBalanceFullMonthly[idx]; break; }
  }
  const hasTrueAnchor = trueOpeningAnchor !== null;

  // Opening at start of range = start balance + everything before this window.
  //
  // FIX: previously assumed the selected period was always the LAST N
  // months in monthlyTotals ("slice off the last period.length months").
  // That breaks the moment ANY month after the selected period exists in
  // the data -- e.g. a reference-only CSV (Expected Collection Reference /
  // Maintenance Rate Reference) dated for a future month stretches
  // mv_monthly_totals's month range even though that future month has zero
  // real income/expense. When that happens, "the last N months" no longer
  // equals "the selected period", and the selected period's own month(s)
  // silently stay INSIDE "prior", double-counting its net movement into
  // the opening balance.
  //
  // Correct approach: find where the selected period ACTUALLY starts by
  // matching month labels, and take everything strictly before that.
  const periodStartMonth = period[0]?.month;
  const periodStartIdx = periodStartMonth
    ? monthlyTotals.findIndex((m) => m.month === periodStartMonth)
    : -1;
  const priorMonths = periodStartIdx >= 0 ? monthlyTotals.slice(0, periodStartIdx) : [];
  const priorNet = priorMonths.reduce((s, m) => s + m.collection - m.expense, 0);
  const anchorOpening = hasTrueAnchor ? (trueOpeningAnchor as number) : balanceStrip.opening;
  let running = anchorOpening + priorNet;
  const rangeOpening = running;
  const hasOpeningGap = !Number.isFinite(rangeOpening) || rangeOpening < 0;
  const rows = period.map((m) => {
    const opening = running;
    const closing = opening + m.collection - m.expense;
    running = closing;
    return { month: m.month, opening, income: m.collection, expense: m.expense, closing };
  });
  const totalIncome = period.reduce((s, m) => s + m.collection, 0);
  const totalExpense = period.reduce((s, m) => s + m.expense, 0);
  const net = totalIncome - totalExpense;
  const closingBal = period.length ? rangeOpening + net : balanceStrip.closing;

  // NEW INSIGHT: months of expense covered by the closing balance -- a
  // simple "cash runway" indicator for a balance-focused page.
  const avgMonthlyExpense = period.length ? totalExpense / period.length : 0;
  const monthsCovered = avgMonthlyExpense > 0 ? closingBal / avgMonthlyExpense : null;

  // NEW: Contingency Fund -- same business rule as Overview/Cashflow Health.
  // Cumulative headline figure is deliberately NOT sliced by the period
  // filter (always reflects the full history to date); the chart below it
  // DOES respect the filter, same split as on the Overview dashboard.
  const isContingencyRateReference = (name: string) => /contingency rate reference/i.test(name || "");
  const contingencyCategory = safeIncomeTree.find((c) => isContingencyRateReference(c.name));
  const contingencyFullMonthly = contingencyCategory ? categoryMonthly(contingencyCategory) : [];
  const contingencyCash = contingencyFullMonthly.reduce(
    (sum, storedVal) => sum + ((storedVal || 0) / 100) * TOTAL_SQFT,
    0,
  );
  const contingencyMonthlySliced = contingencyCategory ? sliceMonthly(categoryMonthly(contingencyCategory)) : [];
  let runningContingency = 0;
  const contingencyRows = rows.map((r, i) => {
    const contingencyThisMonth = ((contingencyMonthlySliced[i] ?? 0) / 100) * TOTAL_SQFT;
    runningContingency += contingencyThisMonth;
    return { month: r.month, contingency_fund: contingencyThisMonth, cumulative_contingency: runningContingency };
  });

  // Contingency Cash is a RING-FENCED PORTION of Closing Balance, not
  // additional money on top of it -- drives the composition bar below.
  const unrestrictedClosing = Math.max(0, closingBal - contingencyCash);
  const contingencyShareOfClosing = closingBal > 0 ? Math.min(100, (contingencyCash / closingBal) * 100) : 0;

  return (
    <>

      {/* RD-40 balance strip */}
      {isWidgetVisible("balance.strip") && (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Balance strip · RD-40, RD-42</CardTitle>
          <CardDescription>Opening at start of range → net movement → closing at end of range</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {/* If historical carry-forward is incomplete and opening computes
                to a negative value, show N/A instead of a misleading amount. */}
            <StripCell label="Opening balance" value={hasOpeningGap ? "N/A" : inr(rangeOpening)} muted note="RD-42" />
            <StripCell label="Total income" value={inr(totalIncome)} tone="emerald" />
            <StripCell label="Total expense" value={inr(totalExpense)} tone="rose" />
            <StripCell label="Net movement" value={inr(net)} tone={net >= 0 ? "emerald" : "rose"} />
            <StripCell label="Closing balance" value={inr(closingBal)} tone="cyan" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <div className="rounded-md border border-border p-4">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Months of expense covered</div>
              <div className="text-xl font-mono mt-1">{monthsCovered === null ? "N/A" : `${monthsCovered.toFixed(1)} months`}</div>
              <div className="text-[10px] text-muted-foreground mt-1">Closing balance {'\u00f7'} average monthly expense for the selected range</div>
            </div>
            <div className="rounded-md border border-border p-4">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Contingency reserve within closing balance</div>
              <div className="h-1.5 w-full rounded-full overflow-hidden flex bg-gray-100 mt-2">
                <div
                  className="h-full bg-pink-400"
                  style={{ width: `${contingencyShareOfClosing}%` }}
                  title={`Contingency reserve (ring-fenced): ${inr(contingencyCash)}`}
                />
                <div
                  className="h-full bg-cyan-400"
                  style={{ width: `${100 - contingencyShareOfClosing}%` }}
                  title={`Unrestricted / freely usable: ${inr(unrestrictedClosing)}`}
                />
              </div>
              <div className="flex items-center justify-between w-full mt-1 text-[9px] text-gray-500 leading-tight">
                <span>● <span className="text-pink-500 font-medium">Contingency</span> {inr(contingencyCash)}</span>
                <span><span className="text-cyan-600 font-medium">Unrestricted</span> {inr(unrestrictedClosing)} ●</span>
              </div>
              <div className="mt-2 text-[9px] font-semibold text-pink-600 bg-pink-50 rounded px-2 py-1 leading-tight">
                ⊆ Contingency Cash is part of Closing Balance -- not additional funds
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      )}

      {hasOpeningGap && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Opening balance is marked as N/A because the selected range does not have a reliable historical carry-forward.
          </AlertDescription>
        </Alert>
      )}

      {/* Plain-language explanation -- residents (not just admins) read this,
          so no internal jargon, and no wording that reads like a
          fill-in-the-blank for one specific month. Explains the actual
          calculation, which works the same way for whichever period is
          currently selected. */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          {hasTrueAnchor ? (
            <>
              How this is calculated: the starting amount recorded when the society first began tracking finances in
              this app, plus every rupee saved (income minus expenses) from that date up to the start of whichever
              period you're viewing. That starting amount was{" "}
              <Badge variant="outline" className="mx-1 text-[10px] border-emerald-500/40 text-emerald-600">confirmed</Badge>
              by the society's management, so this is a real, verified figure -- not an estimate.
            </>
          ) : (
            <>
              How this is calculated: the starting amount from when the society first began tracking finances in this
              app, plus every rupee saved (income minus expenses) from that date up to the start of whichever period
              you're viewing. Since the exact starting amount hasn't been confirmed yet, this is our{" "}
              <Badge variant="outline" className="mx-1 text-[10px]">best estimate</Badge>
              based on everything recorded so far.
            </>
          )}
        </AlertDescription>
      </Alert>


      {/* RD-43 mini table */}
      {isWidgetVisible("balance.continuity") && (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Month-by-month continuity · RD-43</CardTitle>
          <CardDescription>Opening + income − expense = closing, rolled forward per month</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Opening</TableHead>
                <TableHead className="text-right">Income</TableHead>
                <TableHead className="text-right">Expense</TableHead>
                <TableHead className="text-right">Closing</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    No balance movement is available for this range.
                  </TableCell>
                </TableRow>
              ) : rows.map((r) => (
                <TableRow key={r.month}>
                  <TableCell className="font-medium">{r.month}</TableCell>
                  <TableCell className="text-right font-mono">{inr(r.opening)}</TableCell>
                  <TableCell className="text-right font-mono text-emerald-600">{inr(r.income)}</TableCell>
                  <TableCell className="text-right font-mono text-rose-600">{inr(r.expense)}</TableCell>
                  <TableCell className="text-right font-mono font-semibold">{inr(r.closing)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      )}

      {/* Monthly contingency fund collection -- moved here from Overview,
          since this is fundamentally a rolling-reserve/balance story, same
          shape of insight as the continuity table above. */}
      {isWidgetVisible("balance.contingencyChart") && (
      <Card id="contingency-fund-chart">
        <CardHeader>
          <CardTitle className="text-base">Monthly contingency fund collection</CardTitle>
          <CardDescription>Contingency portion of the maintenance charge, collected per month for the selected range. {'\u2286'} Part of Closing Balance above -- not additional funds.</CardDescription>
        </CardHeader>
        <CardContent>
          {contingencyCategory == null ? (
            <p className="text-sm text-muted-foreground">No contingency rate has been uploaded yet for this range.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={contingencyRows} margin={{ left: 8, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="month" fontSize={11} />
                <YAxis tickFormatter={(v) => `\u20B9${(v / 1000).toFixed(0)}k`} fontSize={11} />
                <Tooltip trigger={getTooltipTrigger()} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} content={<SmartTooltipContent labelPrefix="Month" valueFormatter={(v) => inr(v)} />} />
                <Legend />
                <Bar dataKey="contingency_fund" fill="var(--color-chart-2)" radius={[4, 4, 0, 0]} name="Contingency Collected" />
                <Line type="monotone" dataKey="cumulative_contingency" stroke="var(--color-chart-4, #a855f7)" strokeWidth={2} name="Cumulative Reserve" />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
      )}
    </>
  );
}

function StripCell({ label, value, tone, muted, note }: { label: string; value: string; tone?: "emerald" | "rose" | "cyan"; muted?: boolean; note?: string }) {
  const toneClass = tone === "emerald" ? "text-emerald-600" : tone === "rose" ? "text-rose-600" : tone === "cyan" ? "text-cyan-600" : "";
  return (
    <div className={`rounded-md border border-border p-4 ${muted ? "bg-muted/30" : ""}`}>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center justify-between">
        <span>{label}</span>
        {note && <span className="font-mono">{note}</span>}
      </div>
      <div className={`text-xl font-mono mt-1 ${toneClass}`}>{value}</div>
    </div>
  );
}

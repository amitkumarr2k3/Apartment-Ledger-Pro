import { createFileRoute } from "@tanstack/react-router";
import { PortalShell, usePeriod } from "@/components/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { inr } from "@/lib/finance-mock";
import { useBalanceStrip, useMonthlyTotals } from "@/lib/hooks";
import { Info } from "lucide-react";

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
  const { data: monthlyTotals = [] } = useMonthlyTotals();
  const { data: balanceStrip = { opening: 0, income: 0, expense: 0, net: 0, closing: 0 } } = useBalanceStrip();
  const period = sliceMonthly(monthlyTotals);
  // Opening at start of range = start balance + everything before this window
  const priorNet = monthlyTotals.slice(0, monthlyTotals.length - period.length)
    .reduce((s, m) => s + m.collection - m.expense, 0);
  let running = balanceStrip.opening + priorNet;
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

  return (
    <>

      {/* RD-40 balance strip */}
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
        </CardContent>
      </Card>

      {hasOpeningGap && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Opening balance is marked as N/A because the selected range does not have a reliable historical carry-forward.
          </AlertDescription>
        </Alert>
      )}

      {/* RD-44 derived warning */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          RD-44 · Opening balance for {period[0]?.month ?? "range start"} is <Badge variant="outline" className="mx-1 text-[10px]">derived</Badge>
          from earliest known carry-forward — original opening entry not present in historical sheets.
        </AlertDescription>
      </Alert>


      {/* RD-43 mini table */}
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

      {/* RD-41 note */}
      <p className="text-xs text-muted-foreground">
        RD-41 · Single-month view uses prior month's closing as opening. Switch the range picker to a single month to see this behaviour.
      </p>
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

import { createFileRoute } from "@tanstack/react-router";
import { PortalShell, usePeriod } from "@/components/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import { SmartTooltipContent, getTooltipTrigger } from "@/components/smart-tooltip";
import { inr, sumMonthly, total, months12 } from "@/lib/finance-mock";
import { useIncomeTree, useMonthlyTotals } from "@/lib/hooks";
import { filterReportableIncomeCategories } from "@/lib/income-utils";
import { Lightbulb } from "lucide-react";

export const Route = createFileRoute("/admin/income")({
  component: Page,
  head: () => ({ meta: [{ title: "Admin · Income Optimisation" }] }),
});

function Page() {
  return (
    <PortalShell title="Income optimisation insights" reqIds="AD-30 · AD-31 · AD-32 · AD-33" persona="admin">
      <Inner />
    </PortalShell>
  );
}

function Inner() {
  const { data: incomeTree = [] } = useIncomeTree();
  const { data: monthlyTotals = [] } = useMonthlyTotals();
  const { sliceMonthly, labels, view } = usePeriod();
  const reportableIncomeTree = filterReportableIncomeCategories(incomeTree);
  // FIX (2026-08-15): sort item-based tables by Amount, descending, so the
  // biggest income sources always appear first (previously unsorted).
  const rows = reportableIncomeTree.flatMap((c) =>
    c.vendors.flatMap((v) =>
      v.items.map((it) => {
        const monthly = sliceMonthly(it.monthly);
        const t = total(monthly);
        const active = monthly.filter((n) => n > 0).length;
        const recent = monthly.slice(-Math.min(3, monthly.length));
        // Compare against 12 expected months (full FY), not just available labels,
        // so a source present in 8 of 8 available months isn't wrongly flagged.
        const expectedMonths = Math.max(labels.length, 12);
        return {
          category: c.name,
          source: it.name,
          total: t,
          active,
          irregular: active < expectedMonths && active > 0,
          dropped: recent.length > 0 && recent.every((n) => n === 0) && active > 0,
        };
      }),
    ),
  ).sort((a, b) => b.total - a.total);
  const totalIncome = rows.reduce((s, r) => s + r.total, 0);

  // AD-31: expense-to-income ratio per month.
  // Income is derived from income sources (already ex-tax), while expense
  // continues to use monthly totals.
  //
  // FIX: previously called sliceMonthly() on TWO independently-aligned
  // arrays (income, which sumMonthly() always aligns to the full months12
  // window, and monthlyTotals, which only covers real recorded months) and
  // then zipped them together purely by ARRAY POSITION (monthlyIncome[i]
  // next to slicedTotals[i]). Whenever those two arrays don't share the
  // exact same native length/window -- e.g. income data reaches further
  // than monthlyTotals's real coverage, or vice versa -- that silently
  // shifts one series against the other. Once income read as 0 for a
  // month it didn't actually belong to, the ratio for that month collapsed
  // to 0% (see the `monthlyIncome[i] > 0 ? ... : 0` fallback below), which
  // is exactly the sudden cliff seen in the chart. Same root cause already
  // fixed on the Opening & Closing Balance page's contingency chart.
  //
  // Fix: look up both income and expense by their actual month LABEL
  // instead of by array position -- this can never misalign regardless of
  // how many months either underlying array actually covers.
  const monthlyIncomeByLabel = new Map<string, number>();
  {
    const fullMonthlyIncome = sumMonthly(
      reportableIncomeTree.flatMap((c) =>
        c.vendors.flatMap((v) => v.items.map((it) => it.monthly)),
      ),
    ); // aligned to months12
    months12.forEach((label, i) => monthlyIncomeByLabel.set(label, fullMonthlyIncome[i] ?? 0));
  }
  const expenseByLabel = new Map<string, number>();
  (monthlyTotals as any[]).forEach((m) => {
    if (m?.month) expenseByLabel.set(m.month, Number(m.expense ?? 0));
  });
  const coverage = labels.map((month) => {
    const income = monthlyIncomeByLabel.get(month) ?? 0;
    const expense = expenseByLabel.get(month) ?? 0;
    return { month, ratio: income > 0 ? Math.round((expense / income) * 100) : 0 };
  });

  const irregular = rows.filter((r) => r.irregular || r.dropped);

  return (
    <>
      {/* AD-30 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Income sources breakdown · AD-30</CardTitle>
          <CardDescription>Category, amount, and share of total income</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">% of income</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.source}>
                  <TableCell className="text-muted-foreground">{r.category}</TableCell>
                  <TableCell className="font-medium">{r.source}</TableCell>
                  <TableCell className="text-right font-mono">{inr(r.total)}</TableCell>
                  <TableCell className="text-right font-mono">{((r.total / totalIncome) * 100).toFixed(1)}%</TableCell>
                  <TableCell>
                    {r.dropped ? (
                      <Badge className="bg-rose-500/10 text-rose-600 border-rose-500/30" variant="outline">dropped</Badge>
                    ) : r.irregular ? (
                      <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/30" variant="outline">irregular</Badge>
                    ) : (
                      <Badge variant="outline" className="text-emerald-600 border-emerald-500/30">steady</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* AD-31 */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Expense / Income ratio trend · AD-31</CardTitle>
            <CardDescription>% of income spent on expenses per month (lower is healthier)</CardDescription>
          </CardHeader>
          <CardContent>
            {view === "chart" ? (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={coverage}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="month" fontSize={11} />
                  <YAxis tickFormatter={(v) => `${v}%`} fontSize={11} />
                  <Tooltip trigger={getTooltipTrigger()} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} content={<SmartTooltipContent labelPrefix="Month" valueFormatter={(v) => `${v}%`} />} />
                  <Line type="monotone" dataKey="ratio" stroke="var(--color-chart-2)" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="rounded-md border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left p-2">Month</th>
                      <th className="text-right p-2">Expense / income</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coverage.map((c) => (
                      <tr key={c.month} className="border-t border-border">
                        <td className="p-2">{c.month}</td>
                        <td className="p-2 text-right font-mono">{c.ratio}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* AD-32 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Irregular sources · AD-32</CardTitle>
            <CardDescription>Present in some months, absent in others</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {irregular.length === 0 && <p className="text-sm text-muted-foreground">All income sources are steady.</p>}
            {irregular.map((r) => (
              <div key={r.source} className="text-sm p-2 rounded border border-border">
                <div className="font-medium">{r.source}</div>
                <div className="text-xs text-muted-foreground">Active {r.active} of {labels.length} months</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* AD-33 */}
      {/* FIX (2026-08-15): this card claimed "(persisted in Settings)" but
          the Textarea had no onChange/save handler at all -- anything typed
          here vanished on refresh, and the "ideas" shown were hardcoded
          example text, not saved notes. For a persona that explicitly wants
          real control (not decorative features), a non-functional save
          claim is worse than admitting the limitation. Relabeled honestly
          for now; wiring up real persistence (a small settings endpoint) is
          a reasonable follow-up if this card proves useful in practice. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-amber-500" /> Income ideas · AD-33
          </CardTitle>
          <CardDescription>
            Scratchpad for brainstorming — not saved between sessions yet. Copy anything worth keeping elsewhere.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            defaultValue={"• Banner ads on entrance gate LED display\n• Paid parking for visitors (weekend rate)\n• Rooftop solar lease-back with vendor\n• Monthly car-wash tie-up (revenue share)"}
            className="min-h-[140px] font-mono text-sm"
          />
        </CardContent>
      </Card>
    </>
  );
}

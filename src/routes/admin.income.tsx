import { createFileRoute } from "@tanstack/react-router";
import { PortalShell } from "@/components/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import { SmartTooltipContent, getTooltipTrigger } from "@/components/smart-tooltip";
import { inr, categoryMonthly, months12, total } from "@/lib/finance-mock";
import { useIncomeTree } from "@/lib/hooks";
import { Lightbulb } from "lucide-react";

export const Route = createFileRoute("/admin/income")({
  component: Page,
  head: () => ({ meta: [{ title: "Admin · Income Optimisation" }] }),
});

function Page() {
  const { data: incomeTree = [] } = useIncomeTree();
  const rows = incomeTree.flatMap((c) =>
    c.vendors.flatMap((v) =>
      v.items.map((it) => {
        const t = total(it.monthly);
        const active = it.monthly.filter((n) => n > 0).length;
        return {
          category: c.name,
          source: it.name,
          total: t,
          active,
          irregular: active < months12.length && active > 0,
          dropped: it.monthly.slice(-3).every((n) => n === 0) && active > 0,
        };
      }),
    ),
  );
  const totalIncome = rows.reduce((s, r) => s + r.total, 0);

  // AD-31 coverage trend (illustrative): income / expense per month
  const coverage = months12.map((m, i) => {
    const inc = incomeTree.reduce((s, c) => s + categoryMonthly(c)[i], 0);
    const exp = 260000 + i * 1500;
    return { month: m, ratio: Math.round((inc / exp) * 100) };
  });

  const irregular = rows.filter((r) => r.irregular || r.dropped);

  return (
    <PortalShell title="Income optimisation insights" reqIds="AD-30 · AD-31 · AD-32 · AD-33" persona="admin">
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
            <CardTitle className="text-base">Income coverage trend · AD-31</CardTitle>
            <CardDescription>% of expense covered by non-maintenance income, per month</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={coverage}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="month" fontSize={11} />
                <YAxis tickFormatter={(v) => `${v}%`} fontSize={11} />
                <Tooltip trigger={getTooltipTrigger()} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} content={<SmartTooltipContent labelPrefix="Month" valueFormatter={(v) => `${v}%`} />} />
                <Line type="monotone" dataKey="ratio" stroke="var(--color-chart-2)" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
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
                <div className="text-xs text-muted-foreground">Active {r.active} of {months12.length} months</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* AD-33 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-amber-500" /> Potential income ideas · AD-33
          </CardTitle>
          <CardDescription>Free-text brainstorming panel (persisted in Settings)</CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            defaultValue={"• Banner ads on entrance gate LED display\n• Paid parking for visitors (weekend rate)\n• Rooftop solar lease-back with vendor\n• Monthly car-wash tie-up (revenue share)"}
            className="min-h-[140px] font-mono text-sm"
          />
        </CardContent>
      </Card>
    </PortalShell>
  );
}

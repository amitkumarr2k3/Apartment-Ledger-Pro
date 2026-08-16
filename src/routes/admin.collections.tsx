import { createFileRoute } from "@tanstack/react-router";
import { PortalShell, usePeriod } from "@/components/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tooltip, Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, XAxis, YAxis, Legend, Area, AreaChart } from "recharts";
import { SmartTooltipContent, getTooltipTrigger } from "@/components/smart-tooltip";
import { inr, pct, months12, categoryMonthly } from "@/lib/finance-mock";
import { AlertTriangle } from "lucide-react";
import { useMonthlyTotals, useIncomeTree } from "@/lib/hooks";
import { sumMaintenanceChargeMonthly } from "@/lib/income-utils";
import { NoDbData } from "@/components/mock-gate";

export const Route = createFileRoute("/admin/collections")({
  component: Page,
  head: () => ({ meta: [{ title: "Admin · Collection Performance" }] }),
});

function Page() {
  return (
    <PortalShell title="Collection performance (aggregate)" reqIds="AD-20 → AD-24" persona="admin">
      <Inner />
    </PortalShell>
  );
}

function Inner() {
  const { sliceMonthly, view } = usePeriod();
  const { data: apiMonthly } = useMonthlyTotals();
  const { data: incomeTree = [] } = useIncomeTree();
  const source = apiMonthly ?? [];
  if (source.length === 0) {
    return <NoDbData note="Collection charts appear once monthly income transactions are recorded." />;
  }

  // FIX (2026-08-15): the backend's monthlyTotals.collection is a raw sum of
  // EVERY income transaction -- GST/tax, rate-reference rows, Association
  // Fund, Late Payment Fine, outstanding/liability, etc. This chart's
  // "Expected Collection" concept is a per-sqft MAINTENANCE rate target, so
  // "Collection" here is meant to mean Collected Maintenance specifically --
  // exactly what Overview's Collected Maintenance card shows. Recompute it
  // the same way Overview does (sumMaintenanceChargeMonthly), so the two
  // dashboards report the same number instead of the backend's unfiltered
  // total (previously ~30.49L here vs ~25.77L on Overview for Jul '26).
  const maintenanceMonthly = sumMaintenanceChargeMonthly(incomeTree, months12.length);
  const maintenanceByMonth = new Map(months12.map((m, i) => [m, maintenanceMonthly[i]]));

  // FIX (2026-08-15): "vs expected" was in this chart's title from day one,
  // but no Expected Collection series was ever actually computed or
  // plotted -- the single biggest gap identified in the admin persona
  // review ("collection gaps" is an explicitly named focus area). Wired in
  // using the EXACT same per-sqft-rate formula as resident.overview.tsx /
  // resident.cashflow.tsx (Maintenance Rate Reference category, /100 to
  // un-scale the stored rate, x TOTAL_SQFT), so this number always agrees
  // with the resident-facing dashboards.
  const TOTAL_SQFT = 701591;
  const isMaintenanceRateReference = (name: string) => /maintenance rate reference/i.test(name || "");
  const rateCategory = incomeTree.find((c) => isMaintenanceRateReference(c.name));
  const rateMonthlyFull = rateCategory ? categoryMonthly(rateCategory) : [];
  const expectedByMonth = new Map(months12.map((m, i) => [m, ((rateMonthlyFull[i] ?? 0) / 100) * TOTAL_SQFT]));

  // FIX (2026-08-15): renamed collection -> actualCollection to match the
  // exact terminology resident.cashflow.tsx uses for the same figure
  // ("Actual Collection"), so both dashboards speak the same language.
  const adjustedSource = source.map((m) => {
    const actualCollection = maintenanceByMonth.get(m.month) ?? m.collection;
    const expectedCollection = expectedByMonth.get(m.month) ?? 0;
    return { ...m, collection: actualCollection, expectedCollection, net: actualCollection - m.expense };
  });

  const data = sliceMonthly(adjustedSource).map((m, i, arr) => {
    const prev = arr[i - 1]?.collection;
    const change = prev ? ((m.collection - prev) / prev) * 100 : 0;
    return { ...m, change };
  });

  const sharpDrops = data.filter((d) => d.change < -10);

  // Collection performance vs target -- same concept and language as
  // resident.cashflow.tsx's "Collection performance vs target" card.
  const totalActual = data.reduce((s, d) => s + d.collection, 0);
  const totalExpected = data.reduce((s, d) => s + d.expectedCollection, 0);
  const collectionVariancePct = totalExpected === 0 ? 0 : ((totalActual - totalExpected) / totalExpected) * 100;

  let cum = 0;
  const cumulative = data.map((d) => {
    cum += d.net;
    return { month: d.month, cumulative: cum };
  });

  const quarters: { q: string; collection: number; expense: number }[] = [];
  data.forEach((d, i) => {
    const qi = Math.floor(i / 3);
    if (!quarters[qi]) quarters[qi] = { q: `Q${qi + 1}`, collection: 0, expense: 0 };
    quarters[qi].collection += d.collection;
    quarters[qi].expense += d.expense;
  });

  return (
    <>
      {sharpDrops.length > 0 && (
        <Alert className="border-amber-500/40 bg-amber-500/5">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertTitle>Collection volatility · AD-21</AlertTitle>
          <AlertDescription>
            Sharp drop{sharpDrops.length > 1 ? "s" : ""} detected in:{" "}
            {sharpDrops.map((d) => `${d.month} (${pct(d.change)})`).join(", ")}
          </AlertDescription>
        </Alert>
      )}

      {/* FIX (2026-08-15): title/legend/table now say "Actual Collection" and
          "Expected Collection" -- matching resident.cashflow.tsx's exact
          terminology for the same two figures, instead of the old bare
          "Collection" label that didn't distinguish actual from target. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monthly collection: Actual vs Expected</CardTitle>
          <CardDescription>AD-20, AD-24 · Aggregate (uploaded data only)</CardDescription>
        </CardHeader>
        <CardContent>
          {view === "chart" ? (
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={data}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="month" fontSize={11} />
                <YAxis tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} fontSize={11} />
                <Tooltip trigger={getTooltipTrigger()} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} content={<SmartTooltipContent labelPrefix="Period" valueFormatter={(v) => inr(v)} />} />
                <Legend />
                <Bar dataKey="collection" name="Actual Collection" fill="var(--color-chart-2)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expense" name="Expense" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="expectedCollection" name="Expected Collection" stroke="var(--color-chart-4, #a855f7)" strokeWidth={2} strokeDasharray="4 2" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left p-2">Month</th>
                    <th className="text-right p-2">Actual Collection</th>
                    <th className="text-right p-2">Expected Collection</th>
                    <th className="text-right p-2">Expense</th>
                    <th className="text-right p-2">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((d) => (
                    <tr key={d.month} className="border-t border-border">
                      <td className="p-2">{d.month}</td>
                      <td className="p-2 text-right font-mono">{inr(d.collection)}</td>
                      <td className="p-2 text-right font-mono">{inr(d.expectedCollection)}</td>
                      <td className="p-2 text-right font-mono">{inr(d.expense)}</td>
                      <td className="p-2 text-right font-mono">{pct(d.change, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* New: Collection performance vs target -- same concept, same
          language, as resident.cashflow.tsx's card of the same name. */}
      <Card>
        <CardHeader className="pb-2">
          <CardDescription className="text-xs uppercase tracking-wider">Collection performance vs target</CardDescription>
          <CardTitle className={`text-3xl font-mono ${collectionVariancePct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
            {collectionVariancePct >= 0 ? "+" : ""}{collectionVariancePct.toFixed(1)}%
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            Actual maintenance collected ({inr(totalActual)}) vs the expected target ({inr(totalExpected)}) based on the per-sqft rate.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cumulative net movement · AD-23</CardTitle>
            <CardDescription>Running collections − expenses over the period</CardDescription>
          </CardHeader>
          <CardContent>
            {view === "chart" ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={cumulative}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="month" fontSize={11} />
                  <YAxis tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} fontSize={11} />
                  <Tooltip trigger={getTooltipTrigger()} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} content={<SmartTooltipContent labelPrefix="Period" valueFormatter={(v) => inr(v)} />} />
                  <Area type="monotone" dataKey="cumulative" stroke="var(--color-chart-3)" fill="var(--color-chart-3)" fillOpacity={0.2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="rounded-md border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left p-2">Month</th>
                      <th className="text-right p-2">Cumulative net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cumulative.map((c) => (
                      <tr key={c.month} className="border-t border-border">
                        <td className="p-2">{c.month}</td>
                        <td className="p-2 text-right font-mono">{inr(c.cumulative)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quarterly pattern · AD-22</CardTitle>
            <CardDescription>Identify seasonal pressure periods</CardDescription>
          </CardHeader>
          <CardContent>
            {quarters.length === 0 ? (
              <p className="text-sm text-muted-foreground">Not enough months in this range for a quarterly view.</p>
            ) : (
              view === "chart" ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={quarters}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="q" fontSize={11} />
                    <YAxis tickFormatter={(v) => `₹${(v / 100000).toFixed(1)}L`} fontSize={11} />
                    <Tooltip trigger={getTooltipTrigger()} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} content={<SmartTooltipContent labelPrefix="Period" valueFormatter={(v) => inr(v)} />} />
                    <Legend />
                    <Bar dataKey="collection" fill="var(--color-chart-2)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expense" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="rounded-md border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="text-left p-2">Quarter</th>
                        <th className="text-right p-2">Collection</th>
                        <th className="text-right p-2">Expense</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quarters.map((q) => (
                        <tr key={q.q} className="border-t border-border">
                          <td className="p-2">{q.q}</td>
                          <td className="p-2 text-right font-mono">{inr(q.collection)}</td>
                          <td className="p-2 text-right font-mono">{inr(q.expense)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

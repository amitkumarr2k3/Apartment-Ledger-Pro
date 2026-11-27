import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { PortalShell, usePeriod } from "@/components/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Tooltip, Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { useChartAnnotations } from "@/components/chart-annotations";
import { SmartTooltipContent, getTooltipTrigger } from "@/components/smart-tooltip";
import { ProcurementInfo } from "@/components/procurement-info";
import { DrilldownLineItemSummary } from "@/components/drilldown-line-item-summary";
import { inr, categoryMonthly, total } from "@/lib/finance-mock";
import { useExpenseTree, useIncomeTree } from "@/lib/hooks";
import { filterReportableIncomeCategories } from "@/lib/income-utils";
import { ChevronRight } from "lucide-react";

export const Route = createFileRoute("/resident/drilldown")({
  component: Page,
  head: () => ({ meta: [{ title: "Resident · Head Drill-down" }] }),
});

type Head = "expense" | "income";

function Page() {
  return (
    <PortalShell title="Head-wise drill-down" persona="resident">
      <Inner />
    </PortalShell>
  );
}

// RESIDENT-FACING drill-down: intentionally capped at ONE level deeper than
// the category list. Clicking a category shows the COMBINED monthly trend
// across every vendor under it (categoryMonthly() already sums across all
// of a category's vendors -- that's exactly the "add up all vendors for
// the selected months" cumulative chart requested) and stops there. There
// is no vendor list and no line-item list on this page at all -- not
// hidden behind a toggle, structurally absent -- so residents can never
// see the individual vendor/line-item breakdown. The full, unrestricted
// Heads -> Categories -> Vendors -> Line items -> Individual line item
// drill-down still exists in full for admins/superadmins, at
// /admin/drilldown (Admin · Dashboards nav).
function Inner() {
  const navigate = useNavigate();
  const { sliceMonthly, labels } = usePeriod();
  const search = useSearch({ strict: false }) as { head?: string; category?: string };
  const { data: expenseTree = [] } = useExpenseTree();
  const { data: incomeTree = [] } = useIncomeTree();
  const head: Head | null =
    search.head === "expense" || search.head === "income" ? search.head : null;
  const reportableIncomeTree = filterReportableIncomeCategories(incomeTree);
  const expenseCategories = expenseTree.filter(
    (category) => total(sliceMonthly(categoryMonthly(category))) !== 0,
  );
  const incomeCategories = reportableIncomeTree.filter(
    (category) => total(sliceMonthly(categoryMonthly(category))) !== 0,
  );
  const tree = head === "income" ? incomeCategories : expenseCategories;
  const category = search.category ? (tree.find((c) => c.name === search.category) ?? null) : null;

  const chartAnnotations = useChartAnnotations(category ? `drilldown:${head ?? ""}:${category.name}` : null, labels);

  const update = (patch: { head?: Head | null; category?: string | null }) => {
    navigate({
      to: "/resident/drilldown",
      search: ((prev: any) => ({
        ...prev,
        head: patch.head === null ? undefined : (patch.head ?? prev.head),
        category: patch.category === null ? undefined : (patch.category ?? prev.category),
      })) as any,
    });
  };

  const expenseTotal = expenseCategories.reduce(
    (s, c) => s + total(sliceMonthly(categoryMonthly(c))),
    0,
  );
  const incomeTotal = incomeCategories.reduce(
    (s, c) => s + total(sliceMonthly(categoryMonthly(c))),
    0,
  );

  const categoryMonthlySliced = category ? sliceMonthly(categoryMonthly(category)) : [];
  const categoryTotal = total(categoryMonthlySliced);
  const categoryChartData = labels.map((m, i) => ({
    month: m,
    value: categoryMonthlySliced[i] ?? 0,
  }));

  return (
    <>
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <button
              className="hover:text-foreground"
              onClick={() => update({ head: null, category: null })}
            >
              Heads
            </button>
          </BreadcrumbItem>
          {head && (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <button
                  className="hover:text-foreground capitalize"
                  onClick={() => update({ category: null })}
                >
                  {head}
                </button>
              </BreadcrumbItem>
            </>
          )}
          {category && (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem className="min-w-0">
                <span className="min-w-0 break-words text-foreground">{category.name}</span>
                <ProcurementInfo name={category.name} persona="resident" />
              </BreadcrumbItem>
            </>
          )}
        </BreadcrumbList>
      </Breadcrumb>

      {!head && (
        <div className="grid gap-4 md:grid-cols-2">
          <HeadCard
            label="Expense"
            total={expenseTotal}
            categories={expenseCategories.length}
            onClick={() => update({ head: "expense" })}
            tone="rose"
          />
          <HeadCard
            label="Income"
            total={incomeTotal}
            categories={incomeCategories.length}
            onClick={() => update({ head: "income" })}
            tone="emerald"
          />
        </div>
      )}

      {head && !category && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base capitalize">{head} categories</CardTitle>
            <CardDescription>Select a category to see its combined monthly trend</CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            {[...tree]
              .sort(
                (a, b) =>
                  total(sliceMonthly(categoryMonthly(b))) - total(sliceMonthly(categoryMonthly(a))),
              )
              .map((c) => {
                const t = total(sliceMonthly(categoryMonthly(c)));
                return (
                  <div
                    key={c.name}
                    className="flex min-w-0 items-center gap-2 hover:bg-accent/40 -mx-4 px-4 rounded"
                  >
                    <button
                      onClick={() => update({ category: c.name })}
                      className="min-w-0 flex-1 flex items-center justify-between gap-3 py-3 text-left"
                    >
                      <div className="min-w-0">
                        <div className="break-words font-medium">{c.name}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="font-mono text-sm">{inr(t)}</span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </button>
                    <ProcurementInfo name={c.name} persona="resident" />
                  </div>
                );
              })}
          </CardContent>
        </Card>
      )}

      {category && (
        <Card>
          <CardHeader>
            <CardTitle className="flex min-w-0 flex-wrap items-center gap-2 text-base">
              <span className="min-w-0 break-words">{category.name}</span>
              <ProcurementInfo name={category.name} persona="resident" />
              <span>· Combined monthly trend</span>
            </CardTitle>
            <CardDescription>
              <DrilldownLineItemSummary category={category} />
              {chartAnnotations.isSuperAdmin && <span className="mt-2 block text-amber-700">💡 Click the pencil on any month to add an explanation. Click an existing note to edit or delete it.</span>}
              {!chartAnnotations.isSuperAdmin && chartAnnotations.hasComments && <span className="mt-2 block text-amber-700">ℹ This period contains an explanation. Click the note symbol to read it.</span>}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={categoryChartData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="month" fontSize={11} />
                <YAxis tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} fontSize={11} />
                <Tooltip
                  trigger={getTooltipTrigger()}
                  cursor={{ fill: "var(--color-muted)", opacity: 0.35 }}
                  content={
                    <SmartTooltipContent labelPrefix="Month" valueFormatter={(v) => inr(v)} />
                  }
                />
                <Bar dataKey="value" fill="var(--color-chart-3)" radius={[4, 4, 0, 0]}>
                  <LabelList content={chartAnnotations.label} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-4 rounded-md border border-border p-3 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Total for selected period, all {head === "expense" ? "expense" : "income"} items
                combined
              </span>
              <span className="font-mono text-sm font-semibold">{inr(categoryTotal)}</span>
            </div>
          </CardContent>
        </Card>
      )}
      {chartAnnotations.dialog}
    </>
  );
}

function HeadCard({
  label,
  total: t,
  categories,
  onClick,
  tone,
}: {
  label: string;
  total: number;
  categories: number;
  onClick: () => void;
  tone: "rose" | "emerald";
}) {
  return (
    <button onClick={onClick} className="text-left">
      <Card className="hover:border-foreground/40 transition-colors">
        <CardHeader>
          <div className="flex items-center gap-2 mb-2">
            <span
              className={`h-2 w-2 rounded-full ${tone === "rose" ? "bg-rose-500" : "bg-emerald-500"}`}
            />
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Head</span>
          </div>
          <CardTitle className="text-2xl">{label}</CardTitle>
          <CardDescription>{categories} categories</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-mono">{inr(t)}</div>
          <div className="text-xs text-muted-foreground mt-1">selected period total</div>
        </CardContent>
      </Card>
    </button>
  );
}

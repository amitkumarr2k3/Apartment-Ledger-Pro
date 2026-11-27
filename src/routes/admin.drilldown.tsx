import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { PortalShell, usePeriod } from "@/components/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Tooltip,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Legend,
  LabelList,
} from "recharts";
import { useChartAnnotations } from "@/components/chart-annotations";
import { SmartTooltipContent, getTooltipTrigger } from "@/components/smart-tooltip";
import { ProcurementInfo } from "@/components/procurement-info";
import { DrilldownLineItemSummary } from "@/components/drilldown-line-item-summary";
import { formatVendorNames } from "@/lib/drilldown-vendor-text";
import { inr, categoryMonthly, vendorMonthly, total } from "@/lib/finance-mock";
import { useExpenseTree, useIncomeTree } from "@/lib/hooks";
import { filterReportableIncomeCategories } from "@/lib/income-utils";
import { ChevronRight } from "lucide-react";

export const Route = createFileRoute("/admin/drilldown")({
  component: Page,
  head: () => ({ meta: [{ title: "Admin · Head Drill-down" }] }),
});

type Head = "expense" | "income";

function vendorDisplayName(value: string) {
  return formatVendorNames([value]).names.join(", ") || "Unspecified vendor";
}

function Page() {
  return (
    <PortalShell title="Head-wise drill-down (Admin)" persona="admin">
      <Inner />
    </PortalShell>
  );
}

function Inner() {
  const navigate = useNavigate();
  const { sliceMonthly, labels } = usePeriod();
  const search = useSearch({ strict: false }) as {
    head?: string;
    category?: string;
    vendor?: string;
    line?: string;
  };
  const { data: expenseTree = [] } = useExpenseTree();
  const { data: incomeTree = [] } = useIncomeTree();
  // This is the ADMIN-hosted, full-depth version of Head Drill-down
  // (moved here from the Resident nav). Admins/superadmins always see the
  // complete Heads -> Categories -> Vendors -> Line items -> Individual
  // line item hierarchy, unrestricted -- there is deliberately no
  // role/widget check here at all. The resident-facing equivalent is a
  // separate, structurally simpler page that stops at a category's
  // combined chart by design.
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
  const vendor =
    category && search.vendor
      ? (category.vendors.find((v) => v.name === search.vendor) ?? null)
      : null;
  const line =
    vendor && search.line ? (vendor.items.find((it) => it.name === search.line) ?? null) : null;
  const vendorAnnotations = useChartAnnotations(vendor && !line ? `drilldown:${head ?? ""}:${category?.name ?? ""}:${vendor.name}` : null, labels);
  const lineAnnotations = useChartAnnotations(line ? `drilldown:${head ?? ""}:${category?.name ?? ""}:${vendor?.name ?? ""}:${line.name}` : null, labels);

  const update = (patch: {
    head?: Head | null;
    category?: string | null;
    vendor?: string | null;
    line?: string | null;
  }) => {
    navigate({
      to: "/admin/drilldown",
      search: ((prev: any) => ({
        ...prev,
        head: patch.head === null ? undefined : (patch.head ?? prev.head),
        category: patch.category === null ? undefined : (patch.category ?? prev.category),
        vendor: patch.vendor === null ? undefined : (patch.vendor ?? prev.vendor),
        line: patch.line === null ? undefined : (patch.line ?? prev.line),
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

  return (
    <>
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <button
              className="hover:text-foreground"
              onClick={() => update({ head: null, category: null, vendor: null, line: null })}
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
                  onClick={() => update({ category: null, vendor: null, line: null })}
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
                <button
                  className="min-w-0 break-words text-left hover:text-foreground"
                  onClick={() => update({ vendor: null, line: null })}
                >
                  {category.name}
                </button>
                <ProcurementInfo name={category.name} persona="admin" />
              </BreadcrumbItem>
            </>
          )}
          {vendor && (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <button className="hover:text-foreground" onClick={() => update({ line: null })}>
                  {vendorDisplayName(vendor.name)}
                </button>
                <ProcurementInfo name={vendor.name} persona="admin" />
              </BreadcrumbItem>
            </>
          )}
          {line && (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{line.name}</BreadcrumbPage>
                <ProcurementInfo name={line.name} persona="admin" />
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
            <CardDescription>Select a category to see vendor breakdown</CardDescription>
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
                    <ProcurementInfo name={c.name} persona="admin" />
                  </div>
                );
              })}
          </CardContent>
        </Card>
      )}

      {category && !vendor && (
        <Card>
          <CardHeader>
            <CardTitle className="flex min-w-0 flex-wrap items-center gap-2 text-base">
              <span className="min-w-0 break-words">{category.name}</span>
              <ProcurementInfo name={category.name} persona="admin" />
              <span>· Vendors</span>
            </CardTitle>
            <CardDescription>
              <DrilldownLineItemSummary category={category} />
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            {[...category.vendors]
              .sort(
                (a, b) =>
                  total(sliceMonthly(vendorMonthly(b))) - total(sliceMonthly(vendorMonthly(a))),
              )
              .map((v) => {
                const t = total(sliceMonthly(vendorMonthly(v)));
                return (
                  <div
                    key={v.name}
                    className="flex min-w-0 items-center gap-2 hover:bg-accent/40 -mx-4 px-4 rounded"
                  >
                    <button
                      onClick={() => update({ vendor: v.name })}
                      className="min-w-0 flex-1 flex items-center justify-between gap-3 py-3 text-left"
                    >
                      <div className="min-w-0">
                        <div className="font-medium flex flex-wrap items-center gap-2 break-words">
                          {vendorDisplayName(v.name)}
                          <Badge variant="outline" className="text-[10px]">
                            {v.kind}
                          </Badge>{" "}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {v.items.length} line item{v.items.length > 1 ? "s" : ""}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="font-mono text-sm">{inr(t)}</span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </button>
                    <ProcurementInfo name={v.name} persona="admin" />
                  </div>
                );
              })}
          </CardContent>
        </Card>
      )}

      {vendor && !line && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex min-w-0 flex-wrap items-center gap-2 text-base">
                <span className="min-w-0 break-words">{vendorDisplayName(vendor.name)}</span>
                <ProcurementInfo name={vendor.name} persona="admin" />
                <span>· Monthly trend</span>
              </CardTitle>
              <CardDescription>
                Total spend per month before drilling into items
                {vendorAnnotations.isSuperAdmin && <span className="mt-1 block text-amber-700">💡 Click the pencil on any month to add an explanation. Click an existing note to edit or delete it.</span>}
                {!vendorAnnotations.isSuperAdmin && vendorAnnotations.hasComments && <span className="mt-1 block text-amber-700">ℹ This period contains an explanation. Click the note symbol to read it.</span>}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={labels.map((m, i) => ({
                    month: m,
                    value: sliceMonthly(vendorMonthly(vendor))[i],
                  }))}
                >
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
                    <LabelList content={vendorAnnotations.label} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Line items</CardTitle>
              <CardDescription>Absent months show as ₹0</CardDescription>
            </CardHeader>
            <CardContent className="divide-y divide-border">
              {[...vendor.items]
                .sort((a, b) => total(sliceMonthly(b.monthly)) - total(sliceMonthly(a.monthly)))
                .map((it) => {
                  const sliced = sliceMonthly(it.monthly);
                  const t = total(sliced);
                  const activeMonths = sliced.filter((n) => n > 0).length;
                  return (
                    <div
                      key={it.name}
                      className="flex min-w-0 items-center gap-2 hover:bg-accent/40 -mx-4 px-4 rounded"
                    >
                      <button
                        onClick={() => update({ line: it.name })}
                        className="min-w-0 flex-1 flex items-center justify-between gap-3 py-3 text-left"
                      >
                        <div className="min-w-0">
                          <div className="break-words font-medium">{it.name}</div>
                          <div className="text-xs text-muted-foreground">
                            Active in {activeMonths} of {labels.length} months
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <span className="font-mono text-sm">{inr(t)}</span>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </button>
                      <ProcurementInfo name={it.name} persona="admin" />
                    </div>
                  );
                })}
            </CardContent>
          </Card>
        </>
      )}

      {line && (
        <Card>
          <CardHeader>
            <CardTitle className="flex min-w-0 flex-wrap items-center gap-2 text-base">
              <span className="min-w-0 break-words">{line.name}</span>
              <ProcurementInfo name={line.name} persona="admin" />
              <span>· Monthly trend</span>
            </CardTitle>
            <CardDescription>
              Selected-period bar chart · Absent months = ₹0
              {lineAnnotations.isSuperAdmin && <span className="mt-1 block text-amber-700">💡 Click the pencil on any month to add an explanation. Click an existing note to edit or delete it.</span>}
              {!lineAnnotations.isSuperAdmin && lineAnnotations.hasComments && <span className="mt-1 block text-amber-700">ℹ This period contains an explanation. Click the note symbol to read it.</span>}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={labels.map((m, i) => ({ month: m, value: sliceMonthly(line.monthly)[i] }))}
              >
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
                <Legend />
                <Bar
                  dataKey="value"
                  name={line.name}
                  fill="var(--color-chart-4)"
                  radius={[4, 4, 0, 0]}
                >
                  <LabelList content={lineAnnotations.label} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
              <Stat label="Total in period" value={inr(total(sliceMonthly(line.monthly)))} />
              <Stat label="Peak month" value={inr(Math.max(0, ...sliceMonthly(line.monthly)))} />
              <Stat
                label="Active months"
                value={`${sliceMonthly(line.monthly).filter((n) => n > 0).length} / ${labels.length}`}
              />
            </div>
          </CardContent>
        </Card>
      )}
      {vendorAnnotations.dialog}
      {lineAnnotations.dialog}
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-mono mt-1">{value}</div>
    </div>
  );
}

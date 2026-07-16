import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { PortalShell } from "@/components/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Tooltip, Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis, Legend } from "recharts";
import { SmartTooltipContent, getTooltipTrigger } from "@/components/smart-tooltip";
import {
  inr, months12, categoryMonthly, vendorMonthly, total,
} from "@/lib/finance-mock";
import { useExpenseTree, useIncomeTree } from "@/lib/hooks";
import { ChevronRight } from "lucide-react";

export const Route = createFileRoute("/resident/drilldown")({
  component: Page,
  head: () => ({ meta: [{ title: "Resident · Head Drill-down" }] }),
});

type Head = "expense" | "income";

function Page() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as {
    head?: string; category?: string; vendor?: string; line?: string;
  };
  const { data: expenseTree = [] } = useExpenseTree();
  const { data: incomeTree = [] } = useIncomeTree();
  const head: Head | null = search.head === "expense" || search.head === "income" ? search.head : null;
  const tree = head === "income" ? incomeTree : expenseTree;
  const category = search.category ? tree.find((c) => c.name === search.category) ?? null : null;
  const vendor = category && search.vendor ? category.vendors.find((v) => v.name === search.vendor) ?? null : null;
  const line = vendor && search.line ? vendor.items.find((it) => it.name === search.line) ?? null : null;

  const update = (patch: { head?: Head | null; category?: string | null; vendor?: string | null; line?: string | null }) => {
    navigate({
      to: "/resident/drilldown",
      search: (((prev: any) => ({
        ...prev,
        head: patch.head === null ? undefined : patch.head ?? prev.head,
        category: patch.category === null ? undefined : patch.category ?? prev.category,
        vendor: patch.vendor === null ? undefined : patch.vendor ?? prev.vendor,
        line: patch.line === null ? undefined : patch.line ?? prev.line,
      })) as any),
    });
  };

  const expenseTotal = expenseTree.reduce((s, c) => s + total(categoryMonthly(c)), 0);
  const incomeTotal = incomeTree.reduce((s, c) => s + total(categoryMonthly(c)), 0);

  return (
    <PortalShell title="Head-wise drill-down" reqIds="RD-10 → RD-15" persona="resident">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <button className="hover:text-foreground" onClick={() => update({ head: null, category: null, vendor: null, line: null })}>
              Heads
            </button>
          </BreadcrumbItem>
          {head && (<><BreadcrumbSeparator />
            <BreadcrumbItem>
              <button className="hover:text-foreground capitalize" onClick={() => update({ category: null, vendor: null, line: null })}>{head}</button>
            </BreadcrumbItem></>)}
          {category && (<><BreadcrumbSeparator />
            <BreadcrumbItem>
              <button className="hover:text-foreground" onClick={() => update({ vendor: null, line: null })}>{category.name}</button>
            </BreadcrumbItem></>)}
          {vendor && (<><BreadcrumbSeparator />
            <BreadcrumbItem>
              <button className="hover:text-foreground" onClick={() => update({ line: null })}>{vendor.name}</button>
            </BreadcrumbItem></>)}
          {line && (<><BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>{line.name}</BreadcrumbPage></BreadcrumbItem></>)}
        </BreadcrumbList>
      </Breadcrumb>

      <p className="text-xs text-muted-foreground -mt-3">
        URL-synced · share this link to open exactly this view. Press <kbd className="rounded border border-border bg-muted px-1 font-mono">⌘K</kbd> to jump elsewhere.
      </p>

      {!head && (
        <div className="grid gap-4 md:grid-cols-2">
          <HeadCard label="Expense" total={expenseTotal} categories={expenseTree.length} onClick={() => update({ head: "expense" })} tone="rose" />
          <HeadCard label="Income" total={incomeTotal} categories={incomeTree.length} onClick={() => update({ head: "income" })} tone="emerald" />
        </div>
      )}

      {head && !category && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base capitalize">{head} categories</CardTitle>
            <CardDescription>RD-10 · Select a category to see vendor breakdown</CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            {tree.map((c) => {
              const t = total(categoryMonthly(c));
              return (
                <button key={c.name} onClick={() => update({ category: c.name })} className="w-full flex items-center justify-between py-3 text-left hover:bg-accent/40 -mx-4 px-4 rounded">
                  <div>
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-muted-foreground">{c.vendors.length} vendor{c.vendors.length > 1 ? "s" : ""}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm">{inr(t)}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </button>
              );
            })}
          </CardContent>
        </Card>
      )}

      {category && !vendor && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{category.name} · Vendors</CardTitle>
            <CardDescription>RD-11 · Click a vendor to see line items</CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            {category.vendors.map((v) => {
              const t = total(vendorMonthly(v));
              return (
                <button key={v.name} onClick={() => update({ vendor: v.name })} className="w-full flex items-center justify-between py-3 text-left hover:bg-accent/40 -mx-4 px-4 rounded">
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      {v.name}
                      <Badge variant="outline" className="text-[10px]">{v.kind}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">{v.items.length} line item{v.items.length > 1 ? "s" : ""}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm">{inr(t)}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </button>
              );
            })}
          </CardContent>
        </Card>
      )}

      {vendor && !line && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{vendor.name} · Monthly trend</CardTitle>
              <CardDescription>RD-15 · Total vendor spend per month before drilling into items</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={months12.map((m, i) => ({ month: m, value: vendorMonthly(vendor)[i] }))}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="month" fontSize={11} />
                  <YAxis tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} fontSize={11} />
                  <Tooltip trigger={getTooltipTrigger()} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} content={<SmartTooltipContent labelPrefix="Month" valueFormatter={(v) => inr(v)} />} />
                  <Bar dataKey="value" fill="var(--color-chart-3)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Line items</CardTitle>
              <CardDescription>RD-12 · Absent months show as ₹0</CardDescription>
            </CardHeader>
            <CardContent className="divide-y divide-border">
              {vendor.items.map((it) => {
                const t = total(it.monthly);
                const activeMonths = it.monthly.filter((n) => n > 0).length;
                return (
                  <button key={it.name} onClick={() => update({ line: it.name })} className="w-full flex items-center justify-between py-3 text-left hover:bg-accent/40 -mx-4 px-4 rounded">
                    <div>
                      <div className="font-medium">{it.name}</div>
                      <div className="text-xs text-muted-foreground">Active in {activeMonths} of {months12.length} months</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm">{inr(t)}</span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </button>
                );
              })}
            </CardContent>
          </Card>
        </>
      )}

      {line && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{line.name} · Monthly trend</CardTitle>
            <CardDescription>RD-13 · 12-month bar chart · Absent months = ₹0</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={months12.map((m, i) => ({ month: m, value: line.monthly[i] }))}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="month" fontSize={11} />
                <YAxis tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} fontSize={11} />
                <Tooltip trigger={getTooltipTrigger()} cursor={{ fill: "var(--color-muted)", opacity: 0.35 }} content={<SmartTooltipContent labelPrefix="Month" valueFormatter={(v) => inr(v)} />} />
                <Legend />
                <Bar dataKey="value" name={line.name} fill="var(--color-chart-4)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
              <Stat label="Total in period" value={inr(total(line.monthly))} />
              <Stat label="Peak month" value={inr(Math.max(...line.monthly))} />
              <Stat label="Active months" value={`${line.monthly.filter(n=>n>0).length} / 12`} />
            </div>
          </CardContent>
        </Card>
      )}
    </PortalShell>
  );
}

function HeadCard({ label, total: t, categories, onClick, tone }: { label: string; total: number; categories: number; onClick: () => void; tone: "rose" | "emerald" }) {
  return (
    <button onClick={onClick} className="text-left">
      <Card className="hover:border-foreground/40 transition-colors">
        <CardHeader>
          <div className="flex items-center gap-2 mb-2">
            <span className={`h-2 w-2 rounded-full ${tone === "rose" ? "bg-rose-500" : "bg-emerald-500"}`} />
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

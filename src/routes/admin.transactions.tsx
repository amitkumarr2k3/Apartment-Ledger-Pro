import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PortalShell, usePeriod } from "@/components/portal-shell";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { inr, months12, expenseTree, incomeTree, type TxnRow } from "@/lib/finance-mock";
import { useAdminTransactions, type AdminTxnRow } from "@/lib/hooks";
import { Pencil, Plus, Trash2, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/transactions")({
  component: Page,
  head: () => ({ meta: [{ title: "Admin · Transactions" }] }),
});

type Draft = Omit<TxnRow, "id" | "source"> & {
  categoryId?: string;
  headId?: string;
  vendorId?: string;
};

const emptyDraft: Draft = {
  date: new Date().toISOString().slice(0, 10),
  month: months12[months12.length - 1],
  head: "expense",
  category: "",
  categoryId: undefined,
  vendor: undefined,
  vendorId: undefined,
  lineItem: "New line item",
  amount: 0,
  direction: "D",
  notes: "",
};

function Page() {
  return (
    <PortalShell title="Transactions" reqIds="AC-01 · AC-02 · AC-03 · AC-04 · AC-05" persona="admin">
      <Inner />
    </PortalShell>
  );
}

function Inner() {
  const { activeLabels, label } = usePeriod();
  const { data: fetched = [] } = useAdminTransactions();
  const rows: AdminTxnRow[] = fetched;
  const qc = useQueryClient();
  // Same invalidation set admin.imports.tsx already uses after a successful
  // commit, so every dashboard/chart reading these query keys refreshes too.
  async function refreshEverything() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["admin-transactions"] }),
      qc.invalidateQueries({ queryKey: ["monthly-totals"] }),
      qc.invalidateQueries({ queryKey: ["balance-strip"] }),
      qc.invalidateQueries({ queryKey: ["income-cat-totals"] }),
      qc.invalidateQueries({ queryKey: ["expense-cat-totals"] }),
      qc.invalidateQueries({ queryKey: ["expense-tree"] }),
      qc.invalidateQueries({ queryKey: ["income-tree"] }),
    ]);
  }

  // Derive {id, name} pickers from real transactions already fetched -- no
  // dedicated categories/heads/vendors lookup endpoint exists on the backend
  // yet, so this covers every category/head/vendor used at least once.
  // Adding a BRAND-NEW category/vendor never seen before still needs a proper
  // admin management screen (follow-up item, not covered here).
  const headOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: "expense" | "income" }>();
    for (const r of rows) if (r.headId) map.set(r.headId, { id: r.headId, name: r.head });
    return Array.from(map.values());
  }, [rows]);
  const categoryOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string; headId?: string }>();
    for (const r of rows) if (r.categoryId) map.set(r.categoryId, { id: r.categoryId, name: r.category, headId: r.headId });
    return Array.from(map.values());
  }, [rows]);
  const vendorOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string; categoryId?: string }>();
    for (const r of rows) if (r.vendorId && r.vendor) map.set(r.vendorId, { id: r.vendorId, name: r.vendor, categoryId: r.categoryId });
    return Array.from(map.values());
  }, [rows]);

  const [q, setQ] = useState("");
  const [month, setMonth] = useState<string>("period");
  const [head, setHead] = useState<string>("all");
  const [pageSize, setPageSize] = useState<number>(50);
  const [page, setPage] = useState<number>(1);
  // Reset to page 1 whenever a filter or the page size changes, so you never
  // land on an out-of-range page after narrowing results.
  useEffect(() => {
    setPage(1);
  }, [q, month, head, pageSize]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AdminTxnRow | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);

  const monthOptions = useMemo(
    () => Array.from(new Set([...activeLabels, ...rows.map((r) => r.month)])).filter(Boolean),
    [activeLabels, rows],
  );

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (month === "period" && !activeLabels.includes(r.month)) return false;
      if (month !== "all" && month !== "period" && r.month !== month) return false;
      if (head !== "all" && r.head !== head) return false;
      if (q) {
        const s = q.toLowerCase();
        if (![r.category, r.vendor ?? "", r.lineItem, r.notes ?? ""].some((x) => x.toLowerCase().includes(s))) return false;
      }
      return true;
    }).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [rows, q, month, head, activeLabels]);

  const totals = useMemo(() => {
    const inc = filtered.filter((r) => r.head === "income").reduce((s, r) => s + r.amount, 0);
    const exp = filtered.filter((r) => r.head === "expense").reduce((s, r) => s + r.amount, 0);
    return { inc, exp, net: inc - exp, count: filtered.length };
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const clampedPage = Math.min(page, totalPages);
  const pageRows = useMemo(
    () => filtered.slice((clampedPage - 1) * pageSize, clampedPage * pageSize),
    [filtered, clampedPage, pageSize],
  );

  function startCreate() { setEditing(null); setDraft(emptyDraft); setOpen(true); }
  function startEdit(r: AdminTxnRow) {
    setEditing(r);
    setDraft({
      date: r.date, month: r.month, head: r.head, category: r.category, categoryId: r.categoryId,
      vendor: r.vendor, vendorId: r.vendorId, lineItem: r.lineItem, amount: r.amount,
      direction: r.direction, notes: r.notes ?? "",
    });
    setOpen(true);
  }
  function authHeadersObj(): Record<string, string> {
    if (typeof window === "undefined") return {};
    const t = window.localStorage.getItem("apf.token");
    return t ? { Authorization: `Bearer ${t}` } : {};
  }

  async function save() {
    if (!draft.categoryId || !draft.headId) {
      toast.error("Pick a category and head (both are required by the backend).");
      return;
    }
    const body = {
      txn_date: draft.date,
      category_id: draft.categoryId,
      head_id: draft.headId,
      vendor_id: draft.vendorId ?? null,
      line_item_name: draft.lineItem,
      amount_paise: Math.round(draft.amount * 100),
      direction: draft.direction,
      notes: draft.notes ?? "",
    };
    try {
      const url = editing ? `/api/admin/transactions/${editing.id}` : "/api/admin/transactions";
      const method = editing ? "PATCH" : "POST";
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...authHeadersObj() },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(String(r.status));
      toast.success(editing ? `Updated ${editing.id}` : "Created transaction");
      await refreshEverything();
      setOpen(false);
    } catch {
      toast.error("Save failed — the change was not persisted to the server.");
    }
  }

  async function remove(r: AdminTxnRow) {
    if (!confirm(`Delete ${r.id} (${r.lineItem})?`)) return;
    try {
      const resp = await fetch(`/api/admin/transactions/${r.id}`, {
        method: "DELETE",
        headers: authHeadersObj(),
      });
      if (!resp.ok) throw new Error(String(resp.status));
      toast.success(`Deleted ${r.id}`);
      await refreshEverything();
    } catch {
      toast.error("Delete failed — the record was not removed on the server.");
    }
  }


  return (
    <>
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base">All transactions</CardTitle>
            <CardDescription>Filter by month/head. Full CRUD — every action is captured in the audit trail.</CardDescription>
          </div>
          <Button size="sm" onClick={startCreate}><Plus className="h-4 w-4 mr-1" /> New transaction</Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-4">
            <div className="relative sm:col-span-2">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search category / vendor / line item" className="pl-8 h-9" />
            </div>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="period">Current period · {label}</SelectItem>
                <SelectItem value="all">All months</SelectItem>
                {monthOptions.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={head} onValueChange={setHead}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All heads</SelectItem>
                <SelectItem value="expense">Expense</SelectItem>
                <SelectItem value="income">Income</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2 sm:grid-cols-4 text-sm">
            <Stat label="Rows" value={totals.count.toString()} />
            <Stat label="Income" value={inr(totals.inc)} tone="emerald" />
            <Stat label="Expense" value={inr(totals.exp)} tone="rose" />
            <Stat label="Net" value={inr(totals.net)} tone={totals.net >= 0 ? "emerald" : "rose"} />
          </div>

          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[90px]">ID</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Head</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Vendor / Item</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Src</TableHead>
                  <TableHead className="w-[90px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.id}</TableCell>
                    <TableCell className="text-xs">{r.date}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={r.head === "income" ? "border-emerald-500/40 text-emerald-600" : "border-rose-500/40 text-rose-600"}>{r.head}</Badge>
                    </TableCell>
                    <TableCell>{r.category}</TableCell>
                    <TableCell className="text-xs">
                      <div className="font-medium">{r.vendor ?? "—"}</div>
                      <div className="text-muted-foreground">{r.lineItem}</div>
                    </TableCell>
                    <TableCell className="text-right font-mono">{inr(r.amount)}</TableCell>
                    <TableCell className="text-xs uppercase text-muted-foreground">{r.source}</TableCell>
                    <TableCell className="text-right">
                      <Button size="icon" variant="ghost" onClick={() => startEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => remove(r)}><Trash2 className="h-3.5 w-3.5 text-rose-500" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">No transactions match those filters.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Showing {filtered.length === 0 ? 0 : (clampedPage - 1) * pageSize + 1}–{Math.min(clampedPage * pageSize, filtered.length)} of {filtered.length}
            </p>
            <div className="flex items-center gap-2">
              <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                <SelectTrigger className="h-8 w-[110px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10 / page</SelectItem>
                  <SelectItem value="50">50 / page</SelectItem>
                  <SelectItem value="100">100 / page</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1">
                <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={clampedPage <= 1} aria-label="Previous page">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs text-muted-foreground w-[80px] text-center">Page {clampedPage} of {totalPages}</span>
                <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={clampedPage >= totalPages} aria-label="Next page">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.id}` : "New transaction"}</DialogTitle>
            <DialogDescription>Create or edit a transaction entry.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Date"><Input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></Field>
            <Field label="Head">
              <Select
                value={draft.headId ?? ""}
                onValueChange={(id) => {
                  const opt = headOptions.find((h) => h.id === id);
                  if (!opt) return;
                  setDraft({ ...draft, headId: opt.id, head: opt.name, direction: opt.name === "income" ? "C" : "D", categoryId: undefined, category: "" });
                }}
              >
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>{headOptions.map((h) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Category">
              <Select
                value={draft.categoryId ?? ""}
                onValueChange={(id) => {
                  const opt = categoryOptions.find((c) => c.id === id);
                  if (!opt) return;
                  setDraft({ ...draft, categoryId: opt.id, category: opt.name });
                }}
              >
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {categoryOptions.filter((c) => !draft.headId || c.headId === draft.headId).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Vendor">
              <Select
                value={draft.vendorId ?? ""}
                onValueChange={(id) => {
                  const opt = vendorOptions.find((v) => v.id === id);
                  setDraft({ ...draft, vendorId: opt?.id, vendor: opt?.name });
                }}
              >
                <SelectTrigger><SelectValue placeholder="Select… (optional)" /></SelectTrigger>
                <SelectContent>
                  {vendorOptions.filter((v) => !draft.categoryId || v.categoryId === draft.categoryId).map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Line item" className="sm:col-span-2"><Input value={draft.lineItem} onChange={(e) => setDraft({ ...draft, lineItem: e.target.value })} /></Field>
            <Field label="Amount (₹)"><Input type="number" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: Number(e.target.value) })} /></Field>
            <Field label="Month">
              <Select value={draft.month} onValueChange={(v) => setDraft({ ...draft, month: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{monthOptions.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Notes" className="sm:col-span-2"><Input value={draft.notes ?? ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save}>{editing ? "Save changes" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`space-y-1 ${className ?? ""}`}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "emerald" | "rose" }) {
  const cls = tone === "emerald" ? "text-emerald-600" : tone === "rose" ? "text-rose-600" : "";
  return (
    <div className="rounded-md border p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-lg ${cls}`}>{value}</div>
    </div>
  );
}

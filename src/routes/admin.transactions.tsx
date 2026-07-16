import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PortalShell } from "@/components/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { inr, months12, expenseTree, incomeTree, type TxnRow } from "@/lib/finance-mock";
import { useAdminTransactions } from "@/lib/hooks";
import { Pencil, Plus, Trash2, Search } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/transactions")({
  component: Page,
  head: () => ({ meta: [{ title: "Admin · Transactions" }] }),
});

const emptyDraft: Omit<TxnRow, "id" | "source"> = {
  date: new Date().toISOString().slice(0, 10),
  month: months12[months12.length - 1],
  head: "expense",
  category: expenseTree[0].name,
  vendor: expenseTree[0].vendors[0]?.name,
  lineItem: "New line item",
  amount: 0,
  direction: "D",
  notes: "",
};

function Page() {
  const { data: fetched = [] } = useAdminTransactions();
  const [localOverride, setLocalOverride] = useState<TxnRow[] | null>(null);
  const rows = localOverride ?? fetched;
  const setRows = (updater: (prev: TxnRow[]) => TxnRow[]) => setLocalOverride(updater(rows));
  const [q, setQ] = useState("");
  const [month, setMonth] = useState<string>("all");
  const [head, setHead] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TxnRow | null>(null);
  const [draft, setDraft] = useState<Omit<TxnRow, "id" | "source">>(emptyDraft);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (month !== "all" && r.month !== month) return false;
      if (head !== "all" && r.head !== head) return false;
      if (q) {
        const s = q.toLowerCase();
        if (![r.category, r.vendor ?? "", r.lineItem, r.notes ?? ""].some((x) => x.toLowerCase().includes(s))) return false;
      }
      return true;
    }).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [rows, q, month, head]);

  const totals = useMemo(() => {
    const inc = filtered.filter((r) => r.head === "income").reduce((s, r) => s + r.amount, 0);
    const exp = filtered.filter((r) => r.head === "expense").reduce((s, r) => s + r.amount, 0);
    return { inc, exp, net: inc - exp, count: filtered.length };
  }, [filtered]);

  function startCreate() { setEditing(null); setDraft(emptyDraft); setOpen(true); }
  function startEdit(r: TxnRow) {
    setEditing(r);
    setDraft({ date: r.date, month: r.month, head: r.head, category: r.category, vendor: r.vendor, lineItem: r.lineItem, amount: r.amount, direction: r.direction, notes: r.notes ?? "" });
    setOpen(true);
  }
  function save() {
    if (editing) {
      setRows((rs) => rs.map((r) => r.id === editing.id ? { ...r, ...draft } : r));
      toast.success(`Updated ${editing.id}`);
    } else {
      const id = `T${Math.floor(Math.random() * 9000) + 1000}`;
      setRows((rs) => [{ id, source: "manual", ...draft }, ...rs]);
      toast.success(`Created ${id}`);
    }
    setOpen(false);
  }
  function remove(r: TxnRow) {
    if (!confirm(`Delete ${r.id} (${r.lineItem})?`)) return;
    setRows((rs) => rs.filter((x) => x.id !== r.id));
    toast.success(`Deleted ${r.id}`);
  }

  const treeForHead = draft.head === "expense" ? expenseTree : incomeTree;
  const catObj = treeForHead.find((c) => c.name === draft.category) ?? treeForHead[0];

  return (
    <PortalShell title="Transactions" reqIds="AC-01 · AC-02 · AC-03 · AC-04 · AC-05" persona="admin">
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
                <SelectItem value="all">All months</SelectItem>
                {months12.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
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
                {filtered.slice(0, 200).map((r) => (
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
          {filtered.length > 200 && <p className="text-xs text-muted-foreground">Showing first 200 of {filtered.length}. Narrow filters to see more.</p>}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.id}` : "New transaction"}</DialogTitle>
            <DialogDescription>Prototype only — changes stay in-memory and are echoed in the audit trail.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Date"><Input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></Field>
            <Field label="Head">
              <Select value={draft.head} onValueChange={(v: "expense" | "income") => setDraft({ ...draft, head: v, direction: v === "income" ? "C" : "D", category: (v === "expense" ? expenseTree : incomeTree)[0].name })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="expense">Expense</SelectItem><SelectItem value="income">Income</SelectItem></SelectContent>
              </Select>
            </Field>
            <Field label="Category">
              <Select value={draft.category} onValueChange={(v) => setDraft({ ...draft, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{treeForHead.map((c) => <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Vendor">
              <Select value={draft.vendor ?? ""} onValueChange={(v) => setDraft({ ...draft, vendor: v })}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>{catObj.vendors.map((v) => <SelectItem key={v.name} value={v.name}>{v.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Line item" className="sm:col-span-2"><Input value={draft.lineItem} onChange={(e) => setDraft({ ...draft, lineItem: e.target.value })} /></Field>
            <Field label="Amount (₹)"><Input type="number" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: Number(e.target.value) })} /></Field>
            <Field label="Month">
              <Select value={draft.month} onValueChange={(v) => setDraft({ ...draft, month: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{months12.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
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
    </PortalShell>
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

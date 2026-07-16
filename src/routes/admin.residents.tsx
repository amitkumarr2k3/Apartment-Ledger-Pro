import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PortalShell } from "@/components/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { seedResidents, type ResidentRow } from "@/lib/finance-mock";
import { Pencil, Plus, ShieldOff, ShieldCheck, Search, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { useShowMockData } from "@/components/mock-gate";

export const Route = createFileRoute("/admin/residents")({
  component: Page,
  head: () => ({ meta: [{ title: "Admin · Residents & Whitelist" }] }),
});

const empty: Omit<ResidentRow, "id" | "invitedAt"> = { email: "", name: "", flat: "", role: "resident", status: "invited" };

function Page() {
  const showMock = useShowMockData();
  const [rows, setRows] = useState<ResidentRow[]>(seedResidents);
  useEffect(() => { if (!showMock) setRows([]); }, [showMock]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [role, setRole] = useState("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ResidentRow | null>(null);
  const [draft, setDraft] = useState(empty);

  const filtered = useMemo(() => rows.filter((r) => {
    if (status !== "all" && r.status !== status) return false;
    if (role !== "all" && r.role !== role) return false;
    if (q) { const s = q.toLowerCase(); if (![r.email, r.name, r.flat].some((x) => x.toLowerCase().includes(s))) return false; }
    return true;
  }), [rows, q, status, role]);

  const counts = useMemo(() => ({
    total: rows.length,
    active: rows.filter((r) => r.status === "active").length,
    invited: rows.filter((r) => r.status === "invited").length,
    admin: rows.filter((r) => r.role === "admin").length,
  }), [rows]);

  function startCreate() { setEditing(null); setDraft(empty); setOpen(true); }
  function startEdit(r: ResidentRow) { setEditing(r); setDraft({ email: r.email, name: r.name, flat: r.flat, role: r.role, status: r.status }); setOpen(true); }
  function save() {
    if (!draft.email || !draft.name) { toast.error("Email and name are required"); return; }
    if (editing) {
      setRows((rs) => rs.map((r) => r.id === editing.id ? { ...r, ...draft } : r));
      toast.success(`Updated ${editing.email}`);
    } else {
      const id = `R${Math.floor(Math.random() * 900) + 100}`;
      setRows((rs) => [{ id, invitedAt: new Date().toISOString().slice(0, 10), ...draft }, ...rs]);
      toast.success(`Whitelisted ${draft.email}`);
    }
    setOpen(false);
  }
  function toggleRevoke(r: ResidentRow) {
    const next = r.status === "revoked" ? "active" : "revoked";
    setRows((rs) => rs.map((x) => x.id === r.id ? { ...x, status: next } : x));
    toast.success(`${r.email} ${next === "revoked" ? "revoked" : "reactivated"}`);
  }
  function resend(r: ResidentRow) { toast.success(`Magic link re-sent to ${r.email}`); }

  return (
    <PortalShell title="Residents & Whitelist" reqIds="AC-10 · AC-11 · AC-12 · AC-13" persona="admin">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Whitelist policy</CardTitle>
          <CardDescription>Only emails in this table can request a magic link. Admins receive elevated permissions.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-4 text-sm">
            <Stat label="Total emails" value={counts.total.toString()} />
            <Stat label="Active" value={counts.active.toString()} tone="emerald" />
            <Stat label="Pending invites" value={counts.invited.toString()} tone="amber" />
            <Stat label="Admins" value={counts.admin.toString()} tone="violet" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">Residents</CardTitle>
          <Button size="sm" onClick={startCreate}><Plus className="h-4 w-4 mr-1" /> Invite / whitelist</Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-4">
            <div className="relative sm:col-span-2">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search email / name / flat" className="pl-8 h-9" />
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="invited">Invited</SelectItem>
                <SelectItem value="revoked">Revoked</SelectItem>
              </SelectContent>
            </Select>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                <SelectItem value="resident">Resident</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Flat</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Invited</TableHead>
                  <TableHead className="text-right w-[140px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.email}</TableCell>
                    <TableCell>{r.name}</TableCell>
                    <TableCell className="text-xs">{r.flat}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={r.role === "admin" ? "border-violet-500/40 text-violet-600" : ""}>{r.role}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={
                        r.status === "active" ? "border-emerald-500/40 text-emerald-600" :
                        r.status === "invited" ? "border-amber-500/40 text-amber-600" :
                        "border-rose-500/40 text-rose-600"
                      }>{r.status}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.invitedAt}</TableCell>
                    <TableCell className="text-right">
                      {r.status === "invited" && <Button size="icon" variant="ghost" title="Resend magic link" onClick={() => resend(r)}><MailCheck className="h-3.5 w-3.5" /></Button>}
                      <Button size="icon" variant="ghost" onClick={() => startEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => toggleRevoke(r)}>
                        {r.status === "revoked"
                          ? <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                          : <ShieldOff className="h-3.5 w-3.5 text-rose-500" />}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">No residents match those filters.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit resident" : "Invite / whitelist"}</DialogTitle>
            <DialogDescription>{editing ? "Update this whitelist entry." : "Adds the email to the login whitelist and sends a magic link."}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Field label="Email"><Input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="name@example.com" /></Field>
            <Field label="Name"><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Flat"><Input value={draft.flat} onChange={(e) => setDraft({ ...draft, flat: e.target.value })} placeholder="A-101" /></Field>
              <Field label="Role">
                <Select value={draft.role} onValueChange={(v: "resident" | "admin") => setDraft({ ...draft, role: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="resident">Resident</SelectItem><SelectItem value="admin">Admin</SelectItem></SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="Status">
              <Select value={draft.status} onValueChange={(v: ResidentRow["status"]) => setDraft({ ...draft, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="invited">Invited</SelectItem>
                  <SelectItem value="revoked">Revoked</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save}>{editing ? "Save" : "Send invite"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PortalShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>;
}
function Stat({ label, value, tone }: { label: string; value: string; tone?: "emerald" | "amber" | "violet" | "rose" }) {
  const cls = tone === "emerald" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : tone === "violet" ? "text-violet-600" : tone === "rose" ? "text-rose-600" : "";
  return <div className="rounded-md border p-3"><div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div><div className={`mt-1 font-mono text-lg ${cls}`}>{value}</div></div>;
}

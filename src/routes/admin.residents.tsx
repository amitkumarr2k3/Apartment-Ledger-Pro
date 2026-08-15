import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { useShowMockData, NoDbData } from "@/components/mock-gate";

export const Route = createFileRoute("/admin/residents")({
  component: Page,
  head: () => ({ meta: [{ title: "Admin · Residents & Whitelist" }] }),
});

// ── API helpers ──────────────────────────────────────────────────────────────
function authHeader(): HeadersInit {
  if (typeof window === "undefined") return {};
  const t = window.localStorage.getItem("apf.token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// FIX (2026-08-15): the old mapper collapsed "superadmin" -> "admin" for
// display. That meant opening a superadmin's row and clicking "Save changes"
// -- even without touching the Role field -- would PATCH role: "admin" and
// silently, permanently demote them. We now keep the real role value and
// widen the type (ResidentRow from finance-mock.ts only declares
// "resident" | "admin", so we intersect rather than edit that shared file).
type AdminResidentRow = Omit<ResidentRow, "role"> & { role: "resident" | "admin" | "superadmin" };

function dbRowToResident(r: any): AdminResidentRow {
  return {
    id: r.email,
    email: r.email,
    name: r.name ?? "",
    flat: r.flat_code ?? "",
    role: r.role, // keep the real value -- resident / admin / superadmin
    status: r.revoked_at ? "revoked" : "active",
    invitedAt: r.invited_at ? String(r.invited_at).slice(0, 10) : "",
  };
}

async function fetchResidents(): Promise<ResidentRow[]> {
  const r = await fetch("/api/admin/residents", { headers: authHeader() });
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json() as any[]).map(dbRowToResident);
}

async function createResident(body: { email: string; name: string; flat_code: string; role: string }) {
  const r = await fetch("/api/admin/residents", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify(body),
  });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j?.error ?? String(r.status)); }
  return r.json();
}

async function patchResident(email: string, patch: Record<string, unknown>) {
  const r = await fetch(`/api/admin/residents/${encodeURIComponent(email)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify(patch),
  });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j?.error ?? String(r.status)); }
  return r.json();
}

// ── Draft shape ──────────────────────────────────────────────────────────────
const emptyDraft = { email: "", name: "", flat: "", role: "resident" as "resident" | "admin" | "superadmin" };
type Draft = { email: string; name: string; flat: string; role: "resident" | "admin" | "superadmin" };

// ── Page ─────────────────────────────────────────────────────────────────────
function Page() {
  const showMock = useShowMockData();
  return (
    <PortalShell title="Residents & Whitelist" reqIds="AC-10 · AC-11 · AC-12 · AC-13" persona="admin">
      {showMock ? <MockView /> : <LiveView />}
    </PortalShell>
  );
}

// ── Mock view (unauthenticated) ───────────────────────────────────────────────
function MockView() {
  const [rows, setRows] = useState<AdminResidentRow[]>(seedResidents as AdminResidentRow[]);

  function onSave(editing: AdminResidentRow | null, draft: Draft) {
    if (editing) {
      setRows((rs) => rs.map((r) => r.id === editing.id ? { ...r, ...draft } : r));
      toast.success(`Updated ${editing.email}`);
    } else {
      const id = `R${Math.floor(Math.random() * 900) + 100}`;
      setRows((rs) => [{ id, invitedAt: new Date().toISOString().slice(0, 10), status: "invited" as const, ...draft }, ...rs]);
      toast.success(`Whitelisted ${draft.email}`);
    }
  }
  function onToggleRevoke(r: AdminResidentRow) {
    const next = r.status === "revoked" ? "active" : "revoked";
    setRows((rs) => rs.map((x) => x.id === r.id ? { ...x, status: next as AdminResidentRow["status"] } : x));
    toast.success(`${r.email} ${next === "revoked" ? "revoked" : "reactivated"}`);
  }

  return (
    <>
      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
        Sign in with an admin account to manage residents in the database.
      </div>
      <ResidentTable rows={rows} onSave={onSave} onToggleRevoke={onToggleRevoke} onResend={() => {}} />
    </>
  );
}

// ── Live view (authenticated, real DB) ───────────────────────────────────────
function LiveView() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["residents"],
    queryFn: fetchResidents,
    staleTime: 30_000,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["residents"] });

  const createMut = useMutation({
    mutationFn: createResident,
    onSuccess: (_, v) => { toast.success(`Whitelisted ${v.email}`); invalidate(); },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  });
  const patchMut = useMutation({
    mutationFn: ({ email, patch }: { email: string; patch: Record<string, unknown> }) => patchResident(email, patch),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground py-8 text-center">Loading residents…</p>;
  if (isError) return <NoDbData note="Could not load residents. Check your connection or try refreshing." />;

  function onSave(editing: AdminResidentRow | null, draft: Draft) {
    if (editing) {
      patchMut.mutate(
        { email: editing.email, patch: { name: draft.name, flat_code: draft.flat, role: draft.role } },
        { onSuccess: () => toast.success(`Updated ${editing.email}`) },
      );
    } else {
      createMut.mutate({ email: draft.email, name: draft.name, flat_code: draft.flat, role: draft.role });
    }
  }
  function onToggleRevoke(r: AdminResidentRow) {
    const willRevoke = r.status !== "revoked";
    patchMut.mutate(
      { email: r.email, patch: { revoke: willRevoke } },
      { onSuccess: () => toast.success(`${r.email} ${willRevoke ? "revoked" : "reactivated"}`) },
    );
  }
  function onResend(r: AdminResidentRow) {
    toast.info(`Ask ${r.email} to use the OTP sign-in flow — a 6-digit code will be sent on their next attempt.`);
  }

  return <ResidentTable rows={data ?? []} onSave={onSave} onToggleRevoke={onToggleRevoke} onResend={onResend} />;
}

// ── Shared table + dialog ─────────────────────────────────────────────────────
function ResidentTable({
  rows,
  onSave,
  onToggleRevoke,
  onResend,
}: {
  rows: AdminResidentRow[];
  onSave: (editing: AdminResidentRow | null, draft: Draft) => void;
  onToggleRevoke: (r: AdminResidentRow) => void;
  onResend: (r: AdminResidentRow) => void;
}) {
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AdminResidentRow | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);

  const filtered = useMemo(() => rows.filter((r) => {
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (roleFilter !== "all" && r.role !== roleFilter) return false;
    if (q) { const s = q.toLowerCase(); if (![r.email, r.name, r.flat].some((x) => x.toLowerCase().includes(s))) return false; }
    return true;
  }), [rows, q, statusFilter, roleFilter]);

  const counts = useMemo(() => ({
    total: rows.length,
    active: rows.filter((r) => r.status === "active").length,
    invited: rows.filter((r) => r.status === "invited").length,
    // "Admins" stat intentionally includes superadmins too -- both are
    // administrative accounts; the exact role is still shown per-row.
    admin: rows.filter((r) => r.role === "admin" || r.role === "superadmin").length,
  }), [rows]);

  function startCreate() { setEditing(null); setDraft(emptyDraft); setOpen(true); }
  function startEdit(r: AdminResidentRow) {
    setEditing(r);
    // FIX (2026-08-15): previously forced anything non-"admin" down to
    // "resident", which also silently downgraded superadmins. Now preserves
    // the real role so saving without touching this field is a true no-op.
    setDraft({ email: r.email, name: r.name, flat: r.flat, role: r.role });
    setOpen(true);
  }
  function save() {
    if (!draft.email || !draft.name) { toast.error("Email and name are required"); return; }
    onSave(editing, draft);
    setOpen(false);
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Whitelist policy</CardTitle>
          <CardDescription>Only emails in this table can request an OTP. Every change is logged in the audit trail.</CardDescription>
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
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="invited">Invited</SelectItem>
                <SelectItem value="revoked">Revoked</SelectItem>
              </SelectContent>
            </Select>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                <SelectItem value="resident">Resident</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="superadmin">Superadmin</SelectItem>
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
                    <TableCell className="text-xs">{r.flat || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={
                        r.role === "superadmin" ? "border-fuchsia-500/40 text-fuchsia-600" :
                        r.role === "admin" ? "border-violet-500/40 text-violet-600" : ""
                      }>{r.role}</Badge>
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
                      {r.status !== "revoked" && (
                        <Button size="icon" variant="ghost" title="OTP sign-in info" onClick={() => onResend(r)}>
                          <MailCheck className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button size="icon" variant="ghost" onClick={() => startEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => onToggleRevoke(r)}>
                        {r.status === "revoked"
                          ? <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" title="Reactivate" />
                          : <ShieldOff className="h-3.5 w-3.5 text-rose-500" title="Revoke access" />}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">No residents match those filters.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit resident" : "Invite / whitelist"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Update this whitelist entry. Changes are saved to the database and logged in the audit trail."
                : "Adds the email to the OTP login whitelist. The resident signs in by requesting a one-time code."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Field label="Email">
              <Input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="name@example.com" disabled={!!editing} />
            </Field>
            <Field label="Name">
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Flat / Unit">
                <Input value={draft.flat} onChange={(e) => setDraft({ ...draft, flat: e.target.value })} placeholder="A-101" />
              </Field>
              <Field label="Role">
                <Select value={draft.role} onValueChange={(v: "resident" | "admin" | "superadmin") => setDraft({ ...draft, role: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="resident">Resident</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="superadmin">Superadmin</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save}>{editing ? "Save changes" : "Add to whitelist"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>;
}
function Stat({ label, value, tone }: { label: string; value: string; tone?: "emerald" | "amber" | "violet" | "rose" }) {
  const cls = tone === "emerald" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : tone === "violet" ? "text-violet-600" : tone === "rose" ? "text-rose-600" : "";
  return <div className="rounded-md border p-3"><div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div><div className={`mt-1 font-mono text-lg ${cls}`}>{value}</div></div>;
}

import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PortalShell } from "@/components/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, ShieldCheck } from "lucide-react";
import { useShowMockData } from "@/components/mock-gate";

export const Route = createFileRoute("/admin/audit")({
  component: Page,
  head: () => ({ meta: [{ title: "Admin · Audit Trail" }] }),
});

const actionColor: Record<string, string> = {
  create: "border-emerald-500/40 text-emerald-600",
  update: "border-amber-500/40 text-amber-600",
  delete: "border-rose-500/40 text-rose-600",
  login: "border-cyan-500/40 text-cyan-600",
  import: "border-violet-500/40 text-violet-600",
  settings: "border-blue-500/40 text-blue-600",
};

type AuditRow = {
  id: string;
  at: string;
  actor: string;
  action: string;
  entity: string;
  entityId?: string;
  summary: string;
  ip?: string;
};

function authHeader(): HeadersInit {
  if (typeof window === "undefined") return {};
  const t = window.localStorage.getItem("apf.token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function summarise(row: any): string {
  const after = row.after ?? {};
  if (row.action === "import" && after?.kind) {
    return `Imported ${after.inserted ?? 0}/${after.rows ?? 0} ${after.kind}` +
      (after.failed ? ` (${after.failed} skipped)` : "") +
      (after.filename ? ` — ${after.filename}` : "");
  }
  if (row.action === "login") return `Signed in`;
  const keys = Object.keys(after ?? {});
  if (keys.length) return keys.slice(0, 4).map((k) => `${k}=${JSON.stringify(after[k])}`).join(", ");
  return row.entity;
}

async function fetchAudit(): Promise<AuditRow[]> {
  const r = await fetch("/api/admin/audit?pageSize=200", { headers: authHeader() });
  if (!r.ok) throw new Error(String(r.status));
  const j = await r.json();
  return (j.rows as any[]).map((row): AuditRow => ({
    id: String(row.id),
    at: String(row.at).replace("T", " ").slice(0, 19),
    actor: row.actor_email ?? "system",
    action: row.action,
    entity: row.entity,
    entityId: row.entity_id ? String(row.entity_id).slice(0, 8) : undefined,
    summary: summarise(row),
    ip: row.ip ?? undefined,
  }));
}

function Page() {
  const showMock = useShowMockData();
  const [q, setQ] = useState("");
  const [action, setAction] = useState("all");
  const [entity, setEntity] = useState("all");

  const audit = useQuery({
    queryKey: ["audit-log"],
    queryFn: fetchAudit,
    enabled: !showMock,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  // Always run hooks unconditionally — React requires consistent hook call order.
  const source: AuditRow[] = audit.data ?? [];
  const entities = useMemo(() => Array.from(new Set(source.map((a) => a.entity))), [source]);
  const filtered = useMemo(() => source.filter((a) => {
    if (action !== "all" && a.action !== action) return false;
    if (entity !== "all" && a.entity !== entity) return false;
    if (q) {
      const s = q.toLowerCase();
      if (![a.actor, a.summary, a.entityId ?? ""].some((x) => x.toLowerCase().includes(s))) return false;
    }
    return true;
  }), [q, action, entity, source]);

  // Audit trail is only meaningful when authenticated — never fall back to mock.
  if (showMock) {
    return (
      <PortalShell title="Audit Trail" reqIds="AC-40 · AC-41" persona="admin">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-500" /> Audit Trail
            </CardTitle>
            <CardDescription>
              Sign in with your admin account to view the immutable activity log.
              Audit data is stored permanently in the database and is never deleted on logout.
            </CardDescription>
          </CardHeader>
        </Card>
      </PortalShell>
    );
  }

  return (
    <PortalShell title="Audit Trail" reqIds="AC-40 · AC-41" persona="admin">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-500" /> Immutable activity log</CardTitle>
          <CardDescription>Every create / update / delete / login / import is captured with actor, target entity, IP and timestamp.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-4">
            <div className="relative sm:col-span-2">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search actor / summary / entity id" className="pl-8 h-9" />
            </div>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                {["create","update","delete","login","import","settings"].map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={entity} onValueChange={setEntity}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All entities</SelectItem>
                {entities.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[170px]">When</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Summary</TableHead>
                  <TableHead className="w-[100px]">IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="text-xs font-mono">{a.at}</TableCell>
                    <TableCell className="text-xs">{a.actor}</TableCell>
                    <TableCell><Badge variant="outline" className={actionColor[a.action]}>{a.action}</Badge></TableCell>
                    <TableCell className="text-xs">
                      <div className="font-medium">{a.entity}</div>
                      {a.entityId && <div className="font-mono text-muted-foreground">{a.entityId}</div>}
                    </TableCell>
                    <TableCell className="text-sm">{a.summary}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{a.ip ?? "—"}</TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                      {audit.isLoading ? "Loading…" : "No entries match those filters."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">Showing {filtered.length} of {source.length} entries.</p>
        </CardContent>
      </Card>
    </PortalShell>
  );
}

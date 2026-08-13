import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PortalShell } from "@/components/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { seedImports, type ImportBatch } from "@/lib/finance-mock";
import { useShowMockData } from "@/components/mock-gate";
import { UploadCloud, CheckCircle2, AlertTriangle, FileText, ArrowRight, Wand2, XCircle } from "lucide-react";
import { toast } from "sonner";


export const Route = createFileRoute("/admin/imports")({
  component: Page,
  head: () => ({ meta: [{ title: "Admin · CSV Imports" }] }),
});

// Canonical schemas per kind. Each field lists { key, required, validate }.
type FieldSpec = { key: string; required: boolean; validate?: (v: string) => string | null };
const SCHEMAS: Record<ImportBatch["kind"], FieldSpec[]> = {
  transactions: [
    { key: "date", required: true, validate: (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? null : "date must be YYYY-MM-DD") },
    { key: "head", required: true, validate: (v) => (["expense", "income", "reference"].includes(v.toLowerCase()) ? null : "head must be expense, income, or reference") },
    { key: "category", required: true },
    { key: "vendor", required: false },
    { key: "line_item", required: false },
    { key: "amount", required: true, validate: (v) => (Number(v) > 0 ? null : "amount must be a positive number") },
    { key: "direction", required: true, validate: (v) => (["C", "D"].includes(v.toUpperCase()) ? null : "direction must be C or D") },
    { key: "flat_code", required: false },
    { key: "source_ref", required: false },
  ],
  residents: [
    { key: "email", required: true, validate: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : "invalid email") },
    { key: "name", required: false },
    { key: "flat_code", required: false },
  ],
  vendors: [
    { key: "name", required: true },
    { key: "kind", required: false, validate: (v) => (!v || ["company", "individual"].includes(v.toLowerCase()) ? null : "kind must be company or individual") },
  ],
};

const statusColor: Record<ImportBatch["status"], string> = {
  committed: "border-emerald-500/40 text-emerald-600",
  partial:   "border-amber-500/40 text-amber-600",
  failed:    "border-rose-500/40 text-rose-600",
  staged:    "border-cyan-500/40 text-cyan-600",
};

// Minimal RFC-4180-ish CSV parser (handles quoted fields, CRLF, escaped quotes).
function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { row.push(cur); cur = ""; }
      else if (ch === "\n") { row.push(cur); out.push(row); row = []; cur = ""; }
      else if (ch === "\r") { /* skip */ }
      else cur += ch;
    }
  }
  if (cur.length > 0 || row.length > 0) { row.push(cur); out.push(row); }
  return out.filter((r) => r.some((c) => c.trim() !== ""));
}

type MappedRow = { rowNo: number; values: Record<string, string>; errors: string[] };

function validateRows(rows: string[][], mapping: Record<string, string>, spec: FieldSpec[]): MappedRow[] {
  const headers = rows[0] ?? [];
  const dataRows = rows.slice(1);
  return dataRows.map((cols, i) => {
    const values: Record<string, string> = {};
    const errors: string[] = [];
    for (const f of spec) {
      const src = mapping[f.key];
      const idx = src ? headers.indexOf(src) : -1;
      const v = idx >= 0 ? (cols[idx] ?? "").trim() : "";
      values[f.key] = v;
      if (f.required && !v) errors.push(`${f.key} is required`);
      if (v && f.validate) {
        const err = f.validate(v);
        if (err) errors.push(err);
      }
    }
    return { rowNo: i + 2, values, errors };
  });
}

// Quotes a CSV field only when needed (contains comma, quote, or newline).
function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

// Rebuilds a canonical CSV (headers = spec keys) from the mapped+validated rows,
// so the backend — which expects exact canonical column names — receives data
// that matches the mapping the user configured in the UI, not the raw file headers.
function buildCanonicalCsv(rows: MappedRow[], spec: FieldSpec[]): string {
  const header = spec.map((f) => f.key);
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(header.map((k) => csvEscape(r.values[k] ?? "")).join(","));
  }
  return lines.join("\r\n");
}

function authHeader(): HeadersInit {
  if (typeof window === "undefined") return {};
  const t = window.localStorage.getItem("apf.token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function fetchImportHistory(): Promise<ImportBatch[]> {
  const r = await fetch("/api/admin/imports", { headers: authHeader() });
  if (!r.ok) throw new Error(String(r.status));
  const j = await r.json();
  return (j.rows as any[]).map((b): ImportBatch => ({
    id: String(b.id).slice(0, 8),
    filename: b.filename,
    kind: b.kind,
    uploadedBy: b.uploader_email ?? "—",
    uploadedAt: String(b.created_at).replace("T", " ").slice(0, 16),
    rows: Number(b.row_count ?? 0),
    committed: Number(b.committed ?? 0),
    status: (b.status ?? "staged") as ImportBatch["status"],
  }));
}

function Page() {
  const showMock = useShowMockData();
  const qc = useQueryClient();
  const [kind, setKind] = useState<ImportBatch["kind"]>("transactions");
  const [file, setFile] = useState<string>("");
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [step, setStep] = useState<"upload" | "map" | "preview">("upload");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [committing, setCommitting] = useState(false);
  const [showErrorsOnly, setShowErrorsOnly] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 100;

  const history = useQuery({
    queryKey: ["import-history", showMock],
    queryFn: fetchImportHistory,
    enabled: !showMock,
    staleTime: 15_000,
  });
  const batches: ImportBatch[] = showMock ? seedImports : (history.data ?? []);

  const headers = rawRows[0] ?? [];
  const spec = SCHEMAS[kind];

  const validated = useMemo(
    () => (rawRows.length > 1 ? validateRows(rawRows, mapping, spec) : []),
    [rawRows, mapping, spec],
  );
  const ok = validated.filter((r) => r.errors.length === 0);
  const bad = validated.filter((r) => r.errors.length > 0);
  const missingRequired = spec.filter((f) => f.required && !mapping[f.key]);
  const displayRows = showErrorsOnly ? bad : validated;
  const pageCount = Math.max(1, Math.ceil(displayRows.length / PAGE_SIZE));
  const pagedRows = displayRows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f.name);
    setPickedFile(f);
    const text = await f.text();
    const parsed = parseCsv(text);
    setRawRows(parsed);
    const auto: Record<string, string> = {};
    const hdrs = parsed[0] ?? [];
    for (const fs of SCHEMAS[kind]) {
      const hit = hdrs.find((h) => h.trim().toLowerCase() === fs.key.toLowerCase());
      if (hit) auto[fs.key] = hit;
    }
    setMapping(auto);
    setStep("map");
  }

  async function commit() {
    if (missingRequired.length) {
      toast.error(`Map required columns: ${missingRequired.map((f) => f.key).join(", ")}`);
      return;
    }
    if (ok.length === 0) {
      toast.error("No valid rows to commit");
      return;
    }
    if (!pickedFile) {
      toast.error("Pick a CSV file first");
      return;
    }
    setCommitting(true);
    try {
      // Send the mapped/canonical rows (not the raw file) so the backend's
      // column names line up with what the user actually mapped in step 2.
      const canonicalCsv = buildCanonicalCsv(ok, spec);
      const blob = new Blob([canonicalCsv], { type: "text/csv" });
      const fd = new FormData();
      fd.append("file", blob, pickedFile.name);
      const r = await fetch(`/api/admin/imports/${kind}`, {
        method: "POST",
        headers: authHeader(),
        body: fd,
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        throw new Error(txt || `HTTP ${r.status}`);
      }
      const j = await r.json();
      toast.success(
        `Imported ${j.inserted}/${j.rows} row${j.rows === 1 ? "" : "s"}` +
        (j.failed ? ` (${j.failed} skipped)` : ""),
      );
      setStep("upload"); setFile(""); setPickedFile(null); setRawRows([]); setMapping({});
      await qc.invalidateQueries({ queryKey: ["import-history"] });
      // Rollups changed → refresh dashboards
      await qc.invalidateQueries({ queryKey: ["monthly-totals"] });
      await qc.invalidateQueries({ queryKey: ["balance-strip"] });
      await qc.invalidateQueries({ queryKey: ["income-cat-totals"] });
      await qc.invalidateQueries({ queryKey: ["expense-tree"] });
      await qc.invalidateQueries({ queryKey: ["income-tree"] });
      await qc.invalidateQueries({ queryKey: ["admin-transactions"] });
    } catch (e: any) {
      toast.error(`Import failed: ${e?.message ?? e}`);
    } finally {
      setCommitting(false);
    }
  }


  return (
    <PortalShell title="CSV Imports" reqIds="AC-50 · AC-51 · AC-52" persona="admin">
      <Tabs defaultValue="new">
        <TabsList>
          <TabsTrigger value="new">New import</TabsTrigger>
          <TabsTrigger value="history">Import history</TabsTrigger>
          <TabsTrigger value="rules">Transformation rules</TabsTrigger>
        </TabsList>

        <TabsContent value="new" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><UploadCloud className="h-4 w-4" /> Upload → Map → Preview → Commit</CardTitle>
              <CardDescription>File is parsed in the browser. Nothing is written until you commit. Vendors (name + kind) are auto-created from the transactions CSV — you only need the separate Vendor master upload to pre-register vendors that have no transactions yet.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-4 items-end">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">What are you importing?</Label>
                  <Select value={kind} onValueChange={(v: ImportBatch["kind"]) => { setKind(v); setMapping({}); }}>
                    <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="transactions">Transactions (Expense + Income) — vendors auto-derived</SelectItem>
                      <SelectItem value="residents">Residents / Whitelist</SelectItem>
                      <SelectItem value="vendors">Vendor master (optional — only for vendors with no transactions yet)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">CSV file</Label>
                  <Input type="file" accept=".csv" onChange={onPick} className="w-[280px]" />
                </div>
                {file && <Badge variant="outline"><FileText className="h-3 w-3 mr-1" />{file} · {validated.length} data rows</Badge>}
              </div>

              <ol className="flex flex-wrap items-center gap-3 text-xs">
                {(["upload","map","preview"] as const).map((s, i) => (
                  <li key={s} className={`flex items-center gap-2 ${step === s ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                    <span className={`h-6 w-6 rounded-full border grid place-items-center ${step === s ? "bg-primary text-primary-foreground border-primary" : ""}`}>{i+1}</span>
                    <span className="capitalize">{s}</span>
                    {i < 2 && <ArrowRight className="h-3 w-3 opacity-50" />}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          {step !== "upload" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Column mapping</CardTitle>
                <CardDescription>
                  Match your CSV headers to canonical fields.
                  {missingRequired.length > 0 && (
                    <span className="ml-2 text-rose-600">
                      Missing required: {missingRequired.map((f) => f.key).join(", ")}
                    </span>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-3">
                {spec.map((f) => (
                  <div key={f.key} className="space-y-1">
                    <Label className="text-xs capitalize text-muted-foreground">
                      {f.key} {f.required && <span className="text-rose-500">*</span>}
                    </Label>
                    <Select value={mapping[f.key] ?? "__none__"} onValueChange={(v) => setMapping({ ...mapping, [f.key]: v === "__none__" ? "" : v })}>
                      <SelectTrigger><SelectValue placeholder="— none —" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— none —</SelectItem>
                        {headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
                <div className="sm:col-span-3 flex justify-end">
                  <Button size="sm" onClick={() => { setStep("preview"); setPage(0); setShowErrorsOnly(false); }} disabled={missingRequired.length > 0}>
                    <Wand2 className="h-4 w-4 mr-1" /> Apply mapping & preview
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {step === "preview" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  Preview — {ok.length} valid, {bad.length} with errors
                </CardTitle>
                <CardDescription className="flex flex-wrap items-center gap-2">
                  <span>
                    {bad.length > 0
                      ? `Rows with errors will be skipped on commit. Fix them in the source CSV and re-upload if needed.`
                      : `All rows validated. Nothing is written until you commit.`}
                  </span>
                  {bad.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => { setShowErrorsOnly((v) => !v); setPage(0); }}
                    >
                      {showErrorsOnly ? `Show all ${validated.length} rows` : `Show only ${bad.length} error row${bad.length === 1 ? "" : "s"}`}
                    </Button>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-md border overflow-x-auto max-h-[420px] overflow-y-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background">
                      <TableRow>
                        <TableHead className="w-[60px]">Row</TableHead>
                        <TableHead className="w-[80px]">Status</TableHead>
                        {spec.map((f) => <TableHead key={f.key} className="capitalize">{f.key}</TableHead>)}
                        <TableHead>Errors</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedRows.map((r) => (
                        <TableRow key={r.rowNo} className={r.errors.length ? "bg-rose-500/5" : ""}>
                          <TableCell className="font-mono text-xs">{r.rowNo}</TableCell>
                          <TableCell>
                            {r.errors.length === 0 ? (
                              <Badge variant="outline" className="border-emerald-500/40 text-emerald-600">
                                <CheckCircle2 className="h-3 w-3 mr-1" /> ok
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="border-rose-500/40 text-rose-600">
                                <XCircle className="h-3 w-3 mr-1" /> err
                              </Badge>
                            )}
                          </TableCell>
                          {spec.map((f) => (
                            <TableCell key={f.key} className="text-xs font-mono">{r.values[f.key] || <span className="text-muted-foreground">—</span>}</TableCell>
                          ))}
                          <TableCell className="text-xs text-rose-600">
                            {r.errors.length ? r.errors.join("; ") : ""}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {displayRows.length > PAGE_SIZE && (
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      Showing rows {page * PAGE_SIZE + 1}–{Math.min(displayRows.length, (page + 1) * PAGE_SIZE)} of {displayRows.length}
                      {showErrorsOnly ? " error rows" : " rows"}.
                    </span>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" className="h-6 px-2" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Prev</Button>
                      <span>Page {page + 1} of {pageCount}</span>
                      <Button variant="outline" size="sm" className="h-6 px-2" disabled={page >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}>Next</Button>
                    </div>
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => { setStep("upload"); setFile(""); setPickedFile(null); setRawRows([]); }}>Cancel</Button>
                  <Button size="sm" onClick={commit} disabled={ok.length === 0 || committing}>
                    {committing ? "Committing…" : `Commit ${ok.length} row${ok.length === 1 ? "" : "s"}`}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent imports</CardTitle>
              <CardDescription>Each batch is idempotent — re-uploading the same file will not create duplicates.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>File</TableHead>
                      <TableHead>Kind</TableHead>
                      <TableHead>Uploaded by</TableHead>
                      <TableHead>When</TableHead>
                      <TableHead className="text-right">Rows</TableHead>
                      <TableHead className="text-right">Committed</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batches.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell className="font-mono text-xs">{b.id}</TableCell>
                        <TableCell className="text-xs">{b.filename}</TableCell>
                        <TableCell><Badge variant="outline">{b.kind}</Badge></TableCell>
                        <TableCell className="text-xs">{b.uploadedBy}</TableCell>
                        <TableCell className="text-xs">{b.uploadedAt}</TableCell>
                        <TableCell className="text-right font-mono">{b.rows}</TableCell>
                        <TableCell className="text-right font-mono">{b.committed}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={statusColor[b.status]}>
                            {b.status === "failed" && <AlertTriangle className="h-3 w-3 mr-1" />}
                            {b.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rules" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Transformation rules</CardTitle>
              <CardDescription>Regex-based rules run at staging time to normalise vendor names, infer categories, and set direction.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Priority</TableHead>
                      <TableHead>When</TableHead>
                      <TableHead>Set</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[
                      { p: 10, m: `desc ~ /BESCOM|electricity/i`, s: `category = Utilities · vendor = Bescom · direction = D` },
                      { p: 20, m: `desc ~ /BWSSB|water/i`, s: `category = Utilities · vendor = BWSSB · direction = D` },
                      { p: 30, m: `desc ~ /^flat [A-Z]-\\d+ maint/i`, s: `category = Maintenance Collections · direction = C` },
                      { p: 40, m: `desc ~ /hall|community\\s?hall/i`, s: `category = Other Income · vendor = Community Hall · direction = C` },
                      { p: 99, m: `default`, s: `stage row for admin review` },
                    ].map((r) => (
                      <TableRow key={r.p}>
                        <TableCell className="font-mono text-xs">{r.p}</TableCell>
                        <TableCell className="font-mono text-xs">{r.m}</TableCell>
                        <TableCell className="font-mono text-xs">{r.s}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </PortalShell>
  );
}

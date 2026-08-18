import { Link, useRouterState, useNavigate, useSearch } from "@tanstack/react-router";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { navSections, monthlyTotals, months12, inr, expenseTree, incomeTree } from "@/lib/finance-mock";
import { getSession, signOut, type Session } from "@/lib/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetHeader } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import { Home, BarChart3, Table2, Menu, ChevronLeft, LogOut, UserCircle2, HelpCircle, Code2 } from "lucide-react";

// ─── Period context ──────────────────────────────────────────────────────
export type PeriodValue = "month-prev" | "range-3m" | "range-6m" | "range-12m" | "fy" | "fy-prev";

// Format like "Jul '26" — matches finance-mock months12 and hooks.isoMonthToLabel
const MONTH_ABBRS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtMonthLabel(d: Date): string {
  const mon = MONTH_ABBRS[d.getMonth()] ?? "Jan";
  return `${mon} '${String(d.getFullYear()).slice(-2)}`;
}
function parseMonthLabel(label: string): Date | null {
  // "Jul '26" → 2026-07
  const m = /^([A-Za-z]{3})\s'(\d{2})$/.exec(label ?? "");
  if (!m) return null;
  const monthIdx = MONTH_ABBRS.indexOf(m[1]);
  if (monthIdx < 0) return null;
  return new Date(2000 + Number(m[2]), monthIdx, 1);
}

// Dynamic reference date — "current month - 1" is the default reporting anchor.
const NOW = new Date();
const PREV_MONTH = new Date(NOW.getFullYear(), NOW.getMonth() - 1, 1);
const PREV_LABEL = fmtMonthLabel(PREV_MONTH);
// Indian FY runs Apr → Mar
function fiscalStartYearFor(d: Date): number {
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
}
const FY_START_YEAR = fiscalStartYearFor(PREV_MONTH);
const FY_START = new Date(FY_START_YEAR, 3, 1);
const FY_END = new Date(FY_START_YEAR + 1, 2, 31);
const FY_LABEL = `FY ${FY_START_YEAR}-${String(FY_START_YEAR + 1).slice(-2)}`;
const PREV_FY_START_YEAR = FY_START_YEAR - 1;
const PREV_FY_LABEL = `FY ${PREV_FY_START_YEAR}-${String(PREV_FY_START_YEAR + 1).slice(-2)}`;

type PeriodMeta = { label: string; count: number };
const periodConfig: Record<PeriodValue, PeriodMeta> = {
  "month-prev": { label: `${PREV_LABEL} only`, count: 1 },
  "range-3m": { label: "Last 3 months", count: 3 },
  "range-6m": { label: "Last 6 months", count: 6 },
  "range-12m": { label: "Last 12 months", count: 12 },
  "fy": { label: FY_LABEL, count: 12 },
  "fy-prev": { label: PREV_FY_LABEL, count: 12 },
};

function labelForItem(x: unknown, i: number, fallback: string[]): string {
  if (x && typeof x === "object" && "month" in (x as any) && typeof (x as any).month === "string") {
    return (x as any).month as string;
  }
  return fallback[i] ?? "";
}

function anchorIndex(labels: string[]): number {
  if (labels.length === 0) return -1;
  const exact = labels.indexOf(PREV_LABEL);
  if (exact >= 0) return exact;

  const prevTime = PREV_MONTH.getTime();
  let best = -1;
  let bestTime = Number.NEGATIVE_INFINITY;
  labels.forEach((label, i) => {
    const d = parseMonthLabel(label);
    if (!d) return;
    const t = d.getTime();
    if (t <= prevTime && t > bestTime) {
      best = i;
      bestTime = t;
    }
  });
  return best >= 0 ? best : labels.length - 1;
}

function selectIndices(period: PeriodValue, labels: string[]): number[] {
  const anchor = anchorIndex(labels);
  if (anchor < 0) return [];

  if (period === "fy") {
    // Always derive FY boundaries from PREV_MONTH (the canonical reference date),
    // not from the anchor in the data. When backend data ends before PREV_MONTH,
    // using the anchor date gives the wrong fiscal year.
    const fyStartYear = fiscalStartYearFor(PREV_MONTH);
    const fyStart = new Date(fyStartYear, 3, 1);
    const fyEnd = new Date(fyStartYear + 1, 2, 31);
    return labels
      .map((l, i) => ({ i, d: parseMonthLabel(l) }))
      .filter(({ d }) => d && d >= fyStart && d <= fyEnd && d <= PREV_MONTH)
      .map(({ i }) => i);
  }
  if (period === "fy-prev") {
    const fyStartYear = fiscalStartYearFor(PREV_MONTH) - 1;
    const fyStart = new Date(fyStartYear, 3, 1);
    const fyEnd = new Date(fyStartYear + 1, 2, 31);
    return labels
      .map((l, i) => ({ i, d: parseMonthLabel(l) }))
      .filter(({ d }) => d && d >= fyStart && d <= fyEnd)
      .map(({ i }) => i);
  }
  if (period === "month-prev") {
    return [anchor];
  }
  const count = periodConfig[period].count;
  const start = Math.max(0, anchor - count + 1);
  return labels.slice(start, anchor + 1).map((_, i) => start + i);
}

type PeriodCtx = {
  value: PeriodValue;
  count: number;
  label: string;
  labels: string[];               // month labels within selected period (fallback: months12)
  activeLabels: string[];
  sliceMonthly: <T>(arr: T[]) => T[];
  priorSliceMonthly: <T>(arr: T[]) => T[];
  view: "chart" | "number";
  setView: (v: "chart" | "number") => void;
};
const Ctx = createContext<PeriodCtx | null>(null);
export function usePeriod(): PeriodCtx {
  return useContext(Ctx) ?? {
    value: "fy", count: 12, label: FY_LABEL,
    labels: months12,
    activeLabels: months12,
    sliceMonthly: (a) => a,
    priorSliceMonthly: () => [],
    view: "chart", setView: () => {},
  };
}


function SidebarNav({
  pathname,
  persona,
  switchPersona,
  onNavigate,
  session,
  visibleSections,
}: {
  pathname: string;
  persona: "resident" | "admin";
  switchPersona: (p: "resident" | "admin") => void;
  onNavigate?: () => void;
  session: Session | null;
  visibleSections: typeof navSections;
}) {
  const isAdmin = session?.role === "admin";
  return (
    <>
      <div className="p-5 border-b border-border space-y-3">
        <Link to="/" onClick={onNavigate} className="flex items-center gap-2 text-sm font-semibold">
          <Home className="h-4 w-4" />
          CG Boulevard Ledger
        </Link>
        {isAdmin && (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
              Viewing as
            </div>
            <ToggleGroup
              type="single"
              value={persona}
              onValueChange={(v) => v && (switchPersona(v as "resident" | "admin"), onNavigate?.())}
              className="w-full grid grid-cols-2"
              aria-label="Switch persona"
            >
              <ToggleGroupItem
                value="resident"
                size="sm"
                className="text-xs data-[state=on]:bg-cyan-500/10 data-[state=on]:text-cyan-700 dark:data-[state=on]:text-cyan-400 data-[state=on]:border-cyan-500/40"
              >
                🏠 Resident
              </ToggleGroupItem>
              <ToggleGroupItem
                value="admin"
                size="sm"
                className="text-xs data-[state=on]:bg-violet-500/10 data-[state=on]:text-violet-700 dark:data-[state=on]:text-violet-400 data-[state=on]:border-violet-500/40"
              >
                🔧 Admin
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        )}
      </div>
      <nav className="p-3 space-y-6">
        {visibleSections.map((s) => {
          const isCurrent = s.tone === persona;
          const dot = s.tone === "resident" ? "bg-cyan-500" : "bg-violet-500";
          const activeTint =
            s.tone === "resident"
              ? "bg-cyan-500/10 text-cyan-800 dark:text-cyan-300 border-l-2 border-cyan-500"
              : "bg-violet-500/10 text-violet-800 dark:text-violet-300 border-l-2 border-violet-500";
          return (
            <div key={s.label} className={isCurrent ? "" : "opacity-50"}>
              <div className="px-2 mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${dot}`} />
                {s.label}
                {isCurrent && (
                  <span className="ml-auto text-[9px] font-medium text-foreground/70 border border-border rounded px-1">
                    current
                  </span>
                )}
              </div>
              <ul className="space-y-1">
                {s.items.map((it) => {
                  const active = pathname === it.to;
                  return (
                    <li key={it.to}>
                      <Link
                        to={it.to}
                        search={(((prev: any) => ({ period: prev.period, view: prev.view })) as any)}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        className={`block rounded-md px-3 py-2 text-sm transition-colors ${
                          active
                            ? `${activeTint} font-medium`
                            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                        }`}
                      >
                        <div>{it.label}</div>
                        <div className="text-[10px] font-mono opacity-70">{it.req}</div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
    </>
  );
}


// ⌘K palette — jump to any screen, head, category, or vendor
function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const go = (opts: Parameters<typeof navigate>[0]) => {
    onOpenChange(false);
    navigate(opts);
  };
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Jump to a screen, head, category, or vendor…" />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>
        {navSections.map((s) => (
          <CommandGroup key={s.label} heading={s.label}>
            {s.items.map((it) => (
              <CommandItem
                key={it.to}
                value={`${s.label} ${it.label} ${it.req}`}
                onSelect={() => go({ to: it.to, search: ((prev: any) => ({ period: prev.period, view: prev.view })) as any })}
              >
                <span className={`mr-2 h-2 w-2 rounded-full ${s.tone === "resident" ? "bg-cyan-500" : "bg-violet-500"}`} />
                <span>{it.label}</span>
                <span className="ml-auto text-[10px] font-mono opacity-60">{it.req}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        <CommandSeparator />
        <CommandGroup heading="Drill into expense">
          {expenseTree.map((c) => (
            <CommandItem
              key={`e-${c.name}`}
              value={`expense ${c.name}`}
              onSelect={() => go({ to: "/resident/drilldown", search: ((prev: any) => ({ ...prev, head: "expense", category: c.name, vendor: undefined, line: undefined })) as any })}
            >
              <span className="text-xs text-rose-500 mr-2">expense</span>
              {c.name}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Drill into income">
          {incomeTree.map((c) => (
            <CommandItem
              key={`i-${c.name}`}
              value={`income ${c.name}`}
              onSelect={() => go({ to: "/resident/drilldown", search: ((prev: any) => ({ ...prev, head: "income", category: c.name, vendor: undefined, line: undefined })) as any })}
            >
              <span className="text-xs text-emerald-500 mr-2">income</span>
              {c.name}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Vendors">
          {expenseTree.flatMap((c) => c.vendors.map((v) => ({ v, c }))).map(({ v, c }) => (
            <CommandItem
              key={v.name}
              value={`vendor ${v.name} ${c.name}`}
              onSelect={() => go({ to: "/resident/drilldown", search: ((prev: any) => ({ ...prev, head: "expense", category: c.name, vendor: v.name, line: undefined })) as any })}
            >
              <span className="text-xs text-muted-foreground mr-2">{c.name}</span>
              {v.name}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

export function PortalShell({
  title,
  reqIds,
  persona,
  children,
  showViewToggle = true,
}: {
  title: string;
  reqIds: string;
  persona: "resident" | "admin";
  children: ReactNode;
  showViewToggle?: boolean;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { period?: string; view?: string };
  // FIX (2026-08-15): default period changed from "Last 12 months" to "fy"
  // (current fiscal year, dynamically computed from today's date via
  // fiscalStartYearFor) -- applies to every persona/role since this is the
  // single shared PortalShell used by both admin and resident routes.
  const period = (search.period as PeriodValue) in periodConfig ? (search.period as PeriodValue) : "fy";
  const view: "chart" | "number" = search.view === "number" ? "number" : "chart";
  const setPeriod = (v: PeriodValue) => navigate({ to: pathname, search: (((prev: any) => ({ ...prev, period: v })) as any), replace: false });
  const setView = (v: "chart" | "number") => navigate({ to: pathname, search: (((prev: any) => ({ ...prev, view: v })) as any), replace: true });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const periodCtx = useMemo<PeriodCtx>(() => {
    const { count, label } = periodConfig[period];
    const labelsInPeriod = selectIndices(period, months12).map((i) => months12[i]);
    return {
      value: period,
      count,
      label,
      labels: labelsInPeriod,
      activeLabels: labelsInPeriod,
      sliceMonthly: <T,>(arr: T[]): T[] => {
        const derivedLabels = arr.map((x, i) => labelForItem(x, i, months12));
        const idxs = selectIndices(period, derivedLabels);
        return idxs.map((i) => arr[i]);
      },
      priorSliceMonthly: <T,>(arr: T[]): T[] => {
        const derivedLabels = arr.map((x, i) => labelForItem(x, i, months12));
        const idxs = selectIndices(period, derivedLabels);
        if (idxs.length === 0) return [];
        const first = idxs[0];
        const start = Math.max(0, first - idxs.length);
        return arr.slice(start, first);
      },
      view,
      setView,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, view]);


  // ── Session-driven RBAC: residents never see admin sections. Admins see both
  // and can flip persona via the sidebar toggle to preview the resident view.
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    const refresh = () => setSession(getSession());
    refresh();
    window.addEventListener("apf-session-change", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("apf-session-change", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  // FIX (2026-08-15): plain "admin" now sees Admin Dashboards but not
  // Admin Controls (Transactions CRUD, Residents & Whitelist, Dashboard
  // Controls, Audit Trail, ...). Only superadmin sees Controls sections.
  // isAdmin means "admin or above" so the persona toggle and Admin
  // *dashboards* still work for plain admins.
  const isSuperAdmin = session?.role === "superadmin";
  const isAdmin = session?.role === "admin" || isSuperAdmin;
  const visibleNavSections = isAdmin
    ? navSections.filter((s) => s.group !== "controls" || isSuperAdmin)
    : navSections.filter((s) => s.tone === "resident");

  const personaSections = visibleNavSections.filter((s) => s.tone === persona);
  const personaItems = personaSections.flatMap((s) => s.items);
  const accent = persona === "resident"
    ? "border-cyan-500 text-cyan-700 dark:text-cyan-400"
    : "border-violet-500 text-violet-700 dark:text-violet-400";

  const residentFirst = navSections.find((s) => s.tone === "resident")?.items[0]?.to ?? "/";
  const adminFirst = navSections.find((s) => s.tone === "admin")?.items[0]?.to ?? "/";
  const switchPersona = (next: "resident" | "admin") => {
    if (next === persona) return;
    if (next === "admin" && !isAdmin) return; // guard: residents cannot become admin
    const currentIdx = personaItems.findIndex((it) => it.to === pathname);
    const otherItems = navSections.filter((s) => s.tone === next).flatMap((s) => s.items);
    const target = otherItems[currentIdx]?.to ?? (next === "resident" ? residentFirst : adminFirst);
    navigate({ to: target as string, search: ((prev: any) => ({ period: prev.period, view: prev.view })) as any });
  };

  const handleSignOut = () => {
    signOut();
    window.location.replace("/login");
  };

  return (
    <Ctx.Provider value={periodCtx}>
    <TooltipProvider delayDuration={200}>
    <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    <div className="min-h-screen bg-background text-foreground">
      <aside className="hidden lg:flex lg:flex-col fixed inset-y-0 left-0 w-64 border-r border-border bg-card overflow-y-auto no-print">
        <SidebarNav pathname={pathname} persona={persona} switchPersona={switchPersona} session={session} visibleSections={visibleNavSections} />
      </aside>

      <main className="lg:pl-64">
        <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur no-print">
          <div className="px-4 sm:px-8 pt-2 sm:pt-3 flex items-center justify-between gap-2 text-xs">
            <Link to="/" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
              <ChevronLeft className="h-3.5 w-3.5" /> Dashboard home
            </Link>
            <span className="text-muted-foreground truncate hidden sm:inline">
              Viewing: <span className="text-foreground">{periodCtx.label}</span>
            </span>
          </div>
          <div className="px-4 sm:px-8 py-2 sm:py-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:gap-4">
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="lg:hidden shrink-0 hover:bg-accent/80 transition-colors" aria-label="Open navigation menu">
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="p-0 w-72 overflow-y-auto">
                  <SheetHeader className="sr-only">
                    <SheetTitle>Navigation</SheetTitle>
                  </SheetHeader>
                  <SidebarNav
                    pathname={pathname}
                    persona={persona}
                    switchPersona={switchPersona}
                    session={session}
                    visibleSections={visibleNavSections}
                    onNavigate={() => setMobileOpen(false)}
                  />
                </SheetContent>
              </Sheet>
              <h1 className="sr-only">{title}</h1>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              {session && (
                <div className="hidden sm:flex items-center gap-2 rounded-xl border border-border bg-card px-2 py-1.5 shadow-sm">
                  <UserCircle2 className="h-6 w-6 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="text-xs font-medium leading-tight truncate max-w-[180px]">{session.name}</div>
                    <div className="text-[10px] text-muted-foreground leading-tight truncate max-w-[180px]">
                      {session.flatCode ? `Flat ${session.flatCode} · ` : ""}
                      {session.role}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Sign out" onClick={handleSignOut}>
                    <LogOut className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
              {/* Persona switcher: admin-only, visible md–lg (no sidebar yet) */}
              {isAdmin && (
                <div className="hidden md:flex lg:hidden items-center gap-2" role="group" aria-label="Viewing as persona">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Mode</span>
                  <ToggleGroup
                    type="single"
                    value={persona}
                    onValueChange={(v) => v && switchPersona(v as "resident" | "admin")}
                    aria-label="Switch persona"
                  >
                    <ToggleGroupItem value="resident" size="sm" aria-label="View as Resident" className="text-xs data-[state=on]:bg-cyan-500/10 data-[state=on]:text-cyan-700 dark:data-[state=on]:text-cyan-400">
                      🏠 Resident
                    </ToggleGroupItem>
                    <ToggleGroupItem value="admin" size="sm" aria-label="View as Admin" className="text-xs data-[state=on]:bg-violet-500/10 data-[state=on]:text-violet-700 dark:data-[state=on]:text-violet-400">
                      🔧 Admin
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>
              )}
              <div className="flex items-center gap-1.5 rounded-xl border border-border/70 bg-muted/40 p-1 shadow-sm">
                <Select value={period} onValueChange={(v) => setPeriod(v as PeriodValue)}>
                  <SelectTrigger className="w-[130px] sm:w-[180px] border-none bg-background shadow-none focus:ring-1 focus:ring-primary/40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(periodConfig) as PeriodValue[]).map((k) => (
                      <SelectItem key={k} value={k}>{periodConfig[k].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {showViewToggle && (
                  <ToggleGroup type="single" value={view} onValueChange={(v) => v && setView(v as "chart" | "number")} className="bg-background rounded-lg">
                    <ToggleGroupItem value="chart" size="sm" aria-label="Chart view" className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground transition-colors">
                      <BarChart3 className="h-4 w-4" />
                    </ToggleGroupItem>
                    <ToggleGroupItem value="number" size="sm" aria-label="Number view" className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground transition-colors">
                      <Table2 className="h-4 w-4" />
                    </ToggleGroupItem>
                  </ToggleGroup>
                )}
              </div>
            </div>
          </div>
          <div className="px-4 sm:hidden pb-3 space-y-2">
            {session && (
              <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2">
                <div className="min-w-0">
                  <div className="text-xs font-medium truncate">{session.name}</div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {session.flatCode ? `Flat ${session.flatCode} · ` : ""}
                    {session.role}
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="h-7 px-2" onClick={handleSignOut}>
                  <LogOut className="h-3.5 w-3.5 mr-1" /> Sign out
                </Button>
              </div>
            )}
            {isAdmin && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground shrink-0">Mode</span>
                <ToggleGroup
                  type="single"
                  value={persona}
                  onValueChange={(v) => v && switchPersona(v as "resident" | "admin")}
                  className="flex-1 grid grid-cols-2"
                  aria-label="Switch persona"
                >
                  <ToggleGroupItem value="resident" size="sm" aria-label="View as Resident" className="text-xs data-[state=on]:bg-cyan-500/10 data-[state=on]:text-cyan-700 dark:data-[state=on]:text-cyan-400 data-[state=on]:border-cyan-500/40">
                    🏠 Resident
                  </ToggleGroupItem>
                  <ToggleGroupItem value="admin" size="sm" aria-label="View as Admin" className="text-xs data-[state=on]:bg-violet-500/10 data-[state=on]:text-violet-700 dark:data-[state=on]:text-violet-400 data-[state=on]:border-violet-500/40">
                    🔧 Admin
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
            )}
            <Select
              value={personaItems.find((it) => it.to === pathname)?.to ?? ""}
              onValueChange={(to) => {
                if (to && to !== pathname) navigate({ to: to as string, search: ((prev: any) => ({ period: prev.period, view: prev.view })) as any });
              }}
            >
              <SelectTrigger className="w-full" aria-label={`Jump to ${persona} section`}>
                <SelectValue placeholder="Jump to section" />
              </SelectTrigger>
              <SelectContent>
                {personaSections.map((section) => (
                  <div key={section.label}>
                    {personaSections.length > 1 && (
                      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {section.label}
                      </div>
                    )}
                    {section.items.map((it) => (
                      <SelectItem key={it.to} value={it.to}>
                        {it.label}
                        <span className="ml-2 text-[10px] font-mono opacity-60">{it.req}</span>
                      </SelectItem>
                    ))}
                  </div>
                ))}
              </SelectContent>
            </Select>
          </div>
          <nav className="hidden sm:flex px-4 sm:px-8 items-center gap-1 overflow-x-auto scrollbar-none" aria-label={`${persona} sections`}>
            {personaSections.map((section, si) => (
              <div key={section.label} className="flex items-center gap-1">
                {si > 0 && (
                  <>
                    <span className="mx-2 h-4 w-px bg-border" aria-hidden />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap mr-1">
                      {section.group === "controls" ? "Controls" : "Dashboards"}
                    </span>
                  </>
                )}
                {section.items.map((it) => {
                  const active = pathname === it.to;
                  const activeBg = persona === "resident" ? "bg-cyan-500/5" : "bg-violet-500/5";
                  return (
                    <Link
                      key={it.to}
                      to={it.to}
                      search={(((prev: any) => ({ period: prev.period, view: prev.view })) as any)}
                      aria-current={active ? "page" : undefined}
                      className={`whitespace-nowrap px-3 py-2 -mb-px border-b-2 text-sm transition-colors ${
                        active
                          ? `${accent} ${activeBg} font-medium`
                          : "border-transparent text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {it.label}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        </header>
        <div className="print-header hidden">
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground font-mono">{reqIds} · {periodCtx.label}</p>
        </div>
        <div className="p-4 sm:p-6 xl:p-8 space-y-6 w-full max-w-[1680px] mx-auto">{children}</div>
      {/* Persistent credit -- appears on every page since it lives in the
          shared layout. Kept understated (no "open to opportunities"
          framing, no banner-style callout) since this is a live app for
          real residents -- but given real contrast/a background band so it
          actually registers instead of disappearing into the page. */}
      <footer className="py-4 text-center text-xs sm:text-[13px] text-muted-foreground border-t border-border bg-muted/30 mt-4">
        <span className="inline-flex items-center gap-1.5">
          <Code2 className="h-3.5 w-3.5 opacity-70" />
          Built by <span className="font-medium text-foreground">Amit Kumar</span>
          <span className="opacity-40">·</span>
          <a
            href="https://www.amitkumardev.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary hover:underline underline-offset-2"
          >
            View Portfolio
          </a>
        </span>
      </footer>
      </main>
    </div>

    {/* Floating help button -- fixed to the viewport, always visible on every
        page regardless of scroll position, deliberately NOT buried inside the
        header toolbar where it's easy to overlook among the other controls.
        A brief pulse ring draws the eye on first paint; the visible "Need
        help?" label (not just an icon) makes its purpose obvious without
        requiring a hover tooltip, which doesn't work on touch devices anyway. */}
    <button
      type="button"
      onClick={() => window.open(isAdmin ? "/dashboard-user-guide-admin.html" : "/dashboard-user-guide-resident.html", "_blank", "noopener,noreferrer")}
      aria-label="How to read this dashboard"
      className="fixed bottom-5 right-5 sm:bottom-6 sm:right-6 z-50 flex items-center gap-2 rounded-full bg-gradient-to-br from-indigo-500 to-blue-600 pl-3 pr-3 py-3 sm:pr-4 text-white shadow-lg shadow-indigo-500/30 transition-all duration-200 hover:scale-105 hover:shadow-xl hover:shadow-indigo-500/40 active:scale-95"
    >
      <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/40 opacity-75" />
        <HelpCircle className="relative h-5 w-5" />
      </span>
      <span className="hidden sm:inline text-sm font-medium whitespace-nowrap">Need help?</span>
    </button>
    </TooltipProvider>
    </Ctx.Provider>
  );
}

export function EmptyLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Button asChild variant="link" className="px-0">
      <Link to={to}>{children}</Link>
    </Button>
  );
}

// Re-export helpers callers may want.
export { monthlyTotals, months12, inr };

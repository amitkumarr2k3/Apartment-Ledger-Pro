import { Link, useRouterState, useNavigate, useSearch } from "@tanstack/react-router";
import { createContext, useContext, useEffect, useMemo, useState, useRef, type ReactNode } from "react";
import { navSections, monthlyTotals, months12, inr, expenseTree, incomeTree } from "@/lib/finance-mock";
import { getSession, signOut, type Session } from "@/lib/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetHeader } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import { Home, BarChart3, Table2, Menu, ChevronLeft, LogOut, UserCircle2, HelpCircle, Code2, Activity, MessageSquare, Send, X, Bot, FileText, Sparkles, Minus, ChevronUp } from "lucide-react";

// ─── Period context ──────────────────────────────────────────────────────

// —————————————————————————————————————————————————————————————————————————————————————
// Help Chat (BETA)
// Answer priority, highest first: ROUTE_MAP ("where can I find X"), then CURATED
// (page-aware exact UI terms), then HELP_* (generic, auto-derived from the guides).
// Matching uses normalizeWords()+stem() so plurals/typos still hit, instead of
// brittle raw substring checks.
// Persistence: chat history, open state, and minimized state live in sessionStorage
// so they survive a route change -- PortalShell fully remounts on navigation.
// History is explicitly cleared when the user clicks X to close -- persists until
// closed, not forever.
// —————————————————————————————————————————————————————————————————————————————————————
type HelpEntry = { keywords: string[]; answer: string };
type CuratedEntry = { keywords: string[]; answer: string; contexts?: string[] };
type RouteEntry = { keywords: string[]; page: string; to: string; description: string };
type ChatLink = { to: string; label: string };
type ChatMessage = { role: "bot" | "user"; text: string; link?: ChatLink };

const HELP_COMMON: HelpEntry[] = [
  { keywords: ["all", "time", "badge", "dashed"], answer: "The 'All-Time' badge (dashed border, light grey background) means that card always shows the complete picture from day one until today. Changing the date filter at the top will NOT change these numbers -- every other card responds to whatever date range you've picked." },
  { keywords: ["arrow", "blue", "corner", "clickable"], answer: "The small blue arrow in the corner of a card means it's clickable -- tap or click it to jump into a detailed, line-by-line breakdown of that number." },
  { keywords: ["filter", "date", "period", "range"], answer: "Use the period dropdown at the top of the page to change the reporting range (e.g. Last 3 months, current fiscal year). Most charts, tables and cards update automatically -- except any card marked 'All-Time'." },
  { keywords: ["export", "print", "pdf"], answer: "Most dashboard pages support printing/exporting via your browser's print dialog (Ctrl/Cmd+P) -- the layout switches to a clean print-friendly header automatically." },
  { keywords: ["otp", "login", "password"], answer: "Residents sign in with a one-time code (OTP) emailed to their registered address. Only the Super Admin account uses a traditional email + password login." },
  { keywords: ["superadmin", "admin", "role", "roles"], answer: "There are three roles: Resident (view-only, own flat data), Admin (sees all Admin Dashboards but not Controls), and Super Admin (full access including Transactions CRUD, Residents & Whitelist, Dashboard Controls, and Audit Trail)." },
];

// Precise, page-aware answers for concrete UI terms. `contexts`, when present,
// restricts the entry to specific currentView labels so the same word, such as
// "preview", can mean different things on different pages without colliding.
const CURATED: CuratedEntry[] = [
  { keywords: ["vendor", "rank", "ranking"], contexts: ["Vendor Insights"],
     answer: "Vendor ranking lists every vendor sorted by total spend for the selected period. The 'Period change' column shows how much that vendor's spend moved versus the prior period -- rows are flagged when it's more than +20%. Click Preview for a quick chart without leaving the page, or Drill to open the full category to vendor to line-item breakdown." },
  { keywords: ["top", "vendors", "concentration"], contexts: ["Vendor Insights"],
     answer: "This callout shows how concentrated your spend is -- e.g. 'Top 3 vendors make up 85% of total spend' means most of the budget flows through just a handful of vendors, useful to know for negotiation leverage or over-reliance risk." },
  { keywords: ["preview"], contexts: ["Vendor Insights", "Cost Alerts & Trends", "Action Needed"],
     answer: "Preview opens a quick chart or detail panel for that specific row right on this page -- no navigation needed. Use Drill instead if you want the full breakdown on the Head Drill-down page." },
  { keywords: ["preview"], contexts: ["CSV Imports"],
     answer: "During a CSV import, Preview shows exactly what will be written before anything is saved -- your file is read and checked entirely in your browser; nothing touches the database until you explicitly click Commit." },
  { keywords: ["drill"], contexts: ["Vendor Insights", "Cost Alerts & Trends", "Action Needed"],
     answer: "Drill takes you straight to the Head Drill-down page, pre-filtered to that category or vendor, so you can see every underlying line item." },
  { keywords: ["monthly", "trend", "steady", "rise", "pattern"], contexts: ["Vendor Insights"],
     answer: "A vendor's monthly trend chart plots that vendor's spend month by month, so you can visually spot a steady rise, a one-off spike, or a seasonal pattern rather than just reading a single total-spend number." },
  { keywords: ["line", "items", "breakdown"], contexts: ["Vendor Insights"],
     answer: "Line items lists every individual expense entry that makes up a vendor's total spend -- e.g. Security Guards Salary, Housekeeping, Management Fee -- so you can see exactly what you're paying that vendor for." },
  { keywords: ["period", "change"],
     answer: "Period change is the percentage difference between this period's value and the prior period for that same row -- rows are flagged when the increase exceeds the threshold (usually +20%)." },
  { keywords: ["flagged", "flag"],
     answer: "Flagged rows are ones whose spend changed by more than the threshold (usually +20%) compared to the prior period -- worth a closer look before approving next month's budget." },
  { keywords: ["cumulative", "movement"], contexts: ["Collections"],
     answer: "Cumulative net movement is a running total of collections minus expenses across the whole period, so you can see whether the society's overall cash position is trending up or down -- not just a single month's number." },
  { keywords: ["quarterly", "pattern"], contexts: ["Collections"],
     answer: "Quarterly pattern groups the monthly figures into quarters, which makes seasonal pressure, such as spikes around certain months, easier to spot than scrolling through 12 separate months." },
  { keywords: ["actual", "expected", "monthly", "collection"], contexts: ["Collections"],
     answer: "This chart compares Actual Collection (green) against Expense (orange) each month, with a dashed line marking Expected Collection -- the target derived from the per-sqft maintenance rate. If the green bar falls short of the dashed line, that month collected less than expected." },
  { keywords: ["collection", "performance", "target"],
     answer: "Collection performance vs target compares what was actually collected against the expected amount, which is calculated from the per-sqft maintenance rate. A negative percentage means the society collected less than expected for that period." },
  { keywords: ["expected", "collection"],
     answer: "Expected Collection is the target amount the society should collect for the period, calculated from the per-sqft maintenance rate multiplied by the total billable area." },
  { keywords: ["steady", "irregular", "dropped"],
     answer: "These badges describe how consistently an income source is received: Steady = recorded every month in range, Irregular = present in some months but not others, Dropped = zero for the last 3 consecutive months after being active before." },
  { keywords: ["outstanding", "dues"],
     answer: "Outstanding Dues is an All-Time figure -- the total maintenance still owed by residents across the entire history of the society, not just the selected period." },
  { keywords: ["audited", "report"],
     answer: "The Audited Report card links to the society's official, professionally audited financial statement for the year -- a PDF prepared and signed off by an independent chartered accountant." },
  { keywords: ["collected", "maintenance"],
     answer: "Collected Maintenance shows how much maintenance money has actually been received from residents so far for the selected period, as opposed to Expected Collection which is the target." },
  { keywords: ["other", "income"],
     answer: "Other Income covers everything besides maintenance dues -- e.g. clubhouse rent, parking charges, event income -- kept separate so you can see how reliant the society is on maintenance alone." },
  { keywords: ["total", "income"],
     answer: "Total Income is Maintenance Collections plus Other Income combined for the selected period." },
  { keywords: ["net", "surplus", "deficit", "operating"],
     answer: "Net Operating Surplus/Deficit is Total Income minus Total Expense for the period -- shown in green as 'Positive' when the society saved money, or in red as a deficit when expenses exceeded income." },
  { keywords: ["commit", "import", "csv", "template", "mapping", "step"], contexts: ["CSV Imports"],
     answer: "CSV import is a 4-step, cautious process: choose what you're importing, Transactions, Residents, or Vendors, each with its own required column format, choose your file and map columns if needed, Preview -- checked entirely in your browser, nothing saved yet, then explicitly click Commit to write it to the database. You can back out at any step before Commit." },
  { keywords: ["etl", "session", "provider"], contexts: ["ETL Integration"],
     answer: "ETL Integration tracks automated data-sync sessions from connected external providers, separate from manual CSV uploads -- useful for auditing when and how data last refreshed automatically." },
];

const HELP_RESIDENT: HelpEntry[] = [
  { keywords: ["collected", "maintenance", "unpaid", "maintenance", "recovery", "rate", "months", "dues"], answer: "Four headline figures for the selected period, giving you the summary before you look at the month-by-month detail in the two charts below. 📊 Collected vs unpaid maintenance Shows, month by month: how much maintenance was collected (green bars), how much remained unpaid (red bars), and the Expected Collection target (dashed line) — a clean, currency-only view of whether the society is hitting its per-square-foot…" },
  { keywords: ["little", "blue", "arrow", "corner", "card"], answer: "If you see a small circular arrow tucked into the corner of a card, that card is clickable — tap or click it to jump straight into a detailed, line-by-line breakdown of that number. 🏠 Overview Your one-page summary — if you only ever look at one screen, make it this one. 📄 Audited Report The society's official, professionally audited financial report for the year, prepared by an independent chartered accountant." },
  { keywords: ["surplus", "months", "deficit", "months"], answer: "Out of all the months in your selected range, how many months did the society end up saving money (Surplus), and how many months did it spend more than it earned (Deficit)? Collection performance vs target Compares actual maintenance collected against the Expected Collection target, shown as a percentage difference. A number like \"−7.9%\" means collection came in just under 8% short of the target for that period." },
  { keywords: ["closing", "balance"], answer: "Opening Balance plus Net Movement — the society's cash position at the end of your selected period. This becomes next period's Opening Balance. Months of expense covered A simple \"safety cushion\" indicator: if the society stopped collecting any income today, how many months could it keep paying its regular expenses using only the money it currently has? A higher number means a stronger financial safety net." },
  { keywords: ["monthly", "contingency", "fund", "collection"], answer: "Tracks how much was added to the emergency reserve each month (bars) and the running total built up over time (line) — the same reserve referenced in the Contingency Cash card on Overview. 🔍 Head Drill-down The \"zoom in\" page — follow any number all the way down to the smallest transaction. How to use this page Start by choosing Expense or Income . From there, simply keep clicking to go deeper: Category." },
  { keywords: ["expense", "income", "ratio"], answer: "What percentage of income has been spent, for your selected period. A colored bar and label (Healthy / Caution / Over Budget) give you an instant read on whether spending is under control. 📊 Top 5 charts (expense categories, income sources, vendors) Three quick-glance charts showing the society's biggest expense categories, its top income sources (excluding maintenance), and the vendors paid the most." },
  { keywords: ["opening", "balance"], answer: "How this is calculated: the starting amount recorded when the society first began tracking finances digitally, plus every rupee saved (income minus expenses) from that date up to the start of whichever period you're viewing. A small badge next to this figure tells you whether it's a real, confirmed starting figure or our best estimate (see the note just below the balance strip for details)." },
  { keywords: ["expense", "income"], answer: "A compact summary card showing total income, total expense, and whether the period ended in Surplus or Deficit — the same calculation used everywhere else on the dashboard. Collected Maintenance / Unpaid Maintenance / Recovery Rate / Months with Dues Four headline figures for the selected period, giving you the summary before you look at the month-by-month detail in the two charts below." },
  { keywords: ["contingency", "reserve", "within", "closing", "balance"], answer: "Just like on the Overview page, this shows what portion of the Closing Balance is the ring-fenced emergency reserve versus money that's freely available for regular society operations. 📋 Month-by-month continuity table A transparent, line-by-line ledger: for every month, Opening + Income − Expense = Closing, and that Closing amount automatically becomes the next month's Opening." },
  { keywords: ["use", "page"], answer: "Start by choosing Expense or Income . From there, simply keep clicking to go deeper: Category (e.g. \"Utilities\") → Vendor (e.g. \"BESCOM\") → Line Item (the individual transaction). Every list is sorted from largest amount to smallest, so the biggest numbers are always at the top, easiest to spot. Use the breadcrumb trail at the top of the page to jump back up a level at any time." },
  { keywords: ["corpus", "interest", "accumulated", "all", "time"], answer: "All-Time The society's long-term savings fund (sometimes called a \"sinking fund\") — money set aside over the years for major future repairs, like repainting the building or replacing lifts. Contingency Cash All-Time Click for trend A small portion of every resident's maintenance payment is deliberately set aside as an emergency reserve, separate from day-to-day operating funds." },
  { keywords: ["total", "expense"], answer: "Click for details Everything the society spent during the period — staff salaries, electricity, water, housekeeping, repairs, and more. Click to see the full breakdown. Net Operating Surplus Total Income minus Total Expense. Shown in green with \"Positive\" when the society saved money during the period; shown in red as \"Net Operating Deficit\" if it spent more than it earned." },
  { keywords: ["contingency", "cash", "all", "time", "trend"], answer: "All-Time Click for trend A small portion of every resident's maintenance payment is deliberately set aside as an emergency reserve, separate from day-to-day operating funds. Important: this money is not extra cash on top of the Bank Balance — it's already included inside it, just ring-fenced for emergencies. Click this card to see how the reserve has grown month by month." },
  { keywords: ["recovery", "rate", "trend"], answer: "Shown as its own dedicated chart, right next to the collection chart: what percentage of due maintenance was actually recovered, month by month, compared against a 90% \"healthy\" benchmark line. Keeping this separate from the currency chart above makes both easier to read at a glance. 🏦 Opening & Closing Balance Think of this page as the society's running bank passbook." },
];

const HELP_ADMIN: HelpEntry[] = [
  { keywords: ["category", "trend", "dropdown", "pick", "any", "category"], answer: "Pick any expense category from the dropdown to see its full monthly spend history as bars, with a smooth 3-month moving-average line overlaid — useful for telling apart \"one unusual month\" from \"a genuine upward trend.\" Month-over-month change table Every expense category, colour-coded at a glance: green means spend went down since last period, amber means it moved within ±15%, and red flags a rise of more than 15%." },
  { keywords: ["upload", "map", "preview", "commit"], answer: "A deliberately cautious, four-step process. Your file is read and checked entirely in your browser — nothing is written to the database until you explicitly click Commit on the final step, so you can always back out if something looks wrong. Step 1 — What are you importing? Choose Transactions (Expense + Income + Reference), Residents, or Vendors — each has its own required column format. Then choose your CSV file." },
  { keywords: ["preview", "resident", "save", "changes"], answer: "Click Preview as resident on any dashboard card to see exactly what a resident would see with your current toggle settings, before committing to anything. Changes only take effect the next time a resident loads the app — someone already viewing the dashboard in another tab won't see things disappear live. Don't forget to click Save changes at the top — toggling switches alone doesn't persist anything until you do." },
  { keywords: ["collected", "maintenance", "unpaid", "maintenance", "recovery", "rate", "months", "dues"], answer: "Four headline figures for the selected period, giving you the summary before you look at the month-by-month detail in the two charts below. 📊 Collected vs unpaid maintenance Shows, month by month: how much maintenance was collected (green bars), how much remained unpaid (red bars), and the Expected Collection target (dashed line) — a clean, currency-only view of whether the society is hitting its per-square-foot…" },
  { keywords: ["surplus", "months", "deficit", "months"], answer: "Out of all the months in your selected range, how many months did the society end up saving money (Surplus), and how many months did it spend more than it earned (Deficit)? Collection performance vs target Compares actual maintenance collected against the Expected Collection target, shown as a percentage difference. A number like \"−7.9%\" means collection came in just under 8% short of the target for that period." },
  { keywords: ["why", "head", "drill", "down", "has", "whole", "page", "toggle"], answer: "That page is one continuous flow (Category → Vendor → Line item, each screen replacing the last), so individual sections can't be hidden without breaking the navigation itself — it's an all-or-nothing page by design. \"Preview as resident\" and \"Save changes\" Click Preview as resident on any dashboard card to see exactly what a resident would see with your current toggle settings, before committing to anything." },
  { keywords: ["closing", "balance"], answer: "Opening Balance plus Net Movement — the society's cash position at the end of your selected period. This becomes next period's Opening Balance. Months of expense covered A simple \"safety cushion\" indicator: if the society stopped collecting any income today, how many months could it keep paying its regular expenses using only the money it currently has? A higher number means a stronger financial safety net." },
  { keywords: ["expense", "income", "ratio", "trend"], answer: "What percentage of income was spent on expenses, tracked month by month as a line chart. A lower line is healthier; a climbing line over several months is worth investigating before it becomes a real problem. Irregular sources A focused list of exactly which income sources are inconsistent — present in some months, absent in others — along with how many of the last 12 months each one was actually active in." },
  { keywords: ["total", "emails", "active", "pending", "invites", "admins"], answer: "A snapshot of your access list: how many people are whitelisted in total, how many have an active account, how many have been invited but haven't logged in yet, and how many hold admin-level access. Residents table & the three roles Each row shows an email, name, flat number, role, status, and when they were invited. The three roles, from least to most access: resident — sees only the Resident dashboards." },
  { keywords: ["monthly", "contingency", "fund", "collection"], answer: "Tracks how much was added to the emergency reserve each month (bars) and the running total built up over time (line) — the same reserve referenced in the Contingency Cash card on Overview. 🔍 Head Drill-down The \"zoom in\" page — follow any number all the way down to the smallest transaction. How to use this page Start by choosing Expense or Income . From there, simply keep clicking to go deeper: Category." },
  { keywords: ["cost", "alerts"], answer: "Lists every expense category whose spend increased by more than 15% compared to the prior period. If nothing qualifies, you'll see a reassuring \"No categories exceed the 15% threshold this period\" message instead of an empty table. Sudden spike anomalies Flags a category when its most recent month's spend is dramatically higher than its own trailing 3-month average — shown as a multiplier (e.g. \"1.9×\")." },
  { keywords: ["above", "average", "spend", "month"], answer: "Categories currently spending noticeably more than their own historical average for the selected range — shown as a multiplier (e.g. \"1.6× avg\"). This is intentionally a softer signal than the red \"Top 5\" alerts above: worth keeping an eye on, not necessarily a red flag on its own. 📈 Cost Alerts & Trends Requirement IDs AD-01 → AD-05 · The full expense-side deep-dive behind the alerts on Action Needed." },
  { keywords: ["expense", "income", "ratio"], answer: "What percentage of income has been spent, for your selected period. A colored bar and label (Healthy / Caution / Over Budget) give you an instant read on whether spending is under control. 📊 Top 5 charts (expense categories, income sources, vendors) Three quick-glance charts showing the society's biggest expense categories, its top income sources (excluding maintenance), and the vendors paid the most." },
  { keywords: ["concentration", "risk", "callout"], answer: "A one-line summary like \"Top 3 vendors make up 84% of total spend\" — this answers a genuine risk-management question: are you dangerously dependent on a handful of vendors, where losing one relationship (or one contract renegotiation going badly) could seriously disrupt operations? Vendor ranking table Every vendor, sorted by total spend (or total collected, on the Income tab) with the highest first." },
];

const ROUTE_MAP: RouteEntry[] = [
  { keywords: ["sqft", "squarefoot", "persqft", "rate"], page: "Collections", to: "/admin/collections", description: "the per-sqft collection rate and the 'Collection performance vs target' trend" },
  { keywords: ["vendor", "vendors", "ranking", "rank"], page: "Vendor Insights", to: "/admin/vendors", description: "vendor ranking, spend by vendor, and vendor monthly trends" },
  { keywords: ["cashflow", "cash", "flow"], page: "Cashflow Health", to: "/resident/cashflow", description: "community cashflow health, income vs expense over time" },
  { keywords: ["income", "sources", "maintenance"], page: "Income Visibility", to: "/resident/income", description: "income sources and maintenance collection breakdown" },
  { keywords: ["balance", "opening", "closing", "corpus", "contingency", "bank"], page: "Opening & Closing Balance", to: "/resident/balance", description: "opening/closing balance, bank balance, corpus and contingency cash" },
  { keywords: ["drilldown", "drill", "lineitem", "category"], page: "Head Drill-down", to: "/resident/drilldown", description: "the full category to vendor to line-item drill-down" },
  { keywords: ["action", "needed"], page: "Action Needed", to: "/admin/actions", description: "flagged items that need committee attention" },
  { keywords: ["alert", "alerts", "anomaly", "spike"], page: "Cost Alerts & Trends", to: "/admin/alerts", description: "cost alerts and month-over-month spend trends" },
  { keywords: ["optimisation", "optimization", "steady", "irregular", "dropped"], page: "Income Optimisation", to: "/admin/income", description: "income consistency status, Steady, Irregular, or Dropped" },
  { keywords: ["transaction", "transactions", "crud"], page: "Transactions (CRUD)", to: "/admin/transactions", description: "creating, editing or deleting individual transactions" },
  { keywords: ["resident", "residents", "whitelist"], page: "Residents & Whitelist", to: "/admin/residents", description: "managing resident accounts and the login whitelist" },
  { keywords: ["widget", "dashboardcontrol", "settings"], page: "Dashboard Controls", to: "/admin/settings", description: "toggling which widgets/dashboards residents can see" },
  { keywords: ["audit", "trail", "log"], page: "Audit Trail", to: "/admin/audit", description: "a log of every create, update, delete and import action taken in the system" },
  { keywords: ["import", "csv", "upload", "bulk"], page: "CSV Imports", to: "/admin/imports", description: "bulk-importing transactions, residents or vendors via CSV" },
  { keywords: ["etl", "integration"], page: "ETL Integration", to: "/admin/etl", description: "automated data integration / ETL sessions" },
];

const WHERE_INTENT = /\b(where|which page|find|navigate|locate|show me)\b/;

function normalizeWords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function stem(w: string): string {
  return w.replace(/(ings|ing)$/, "").replace(/(es|s)$/, "").replace(/ed$/, "");
}

function tokenScore(query: string, keywords: string[]): number {
  const qWords = new Set(normalizeWords(query).map(stem));
  const qLower = query.toLowerCase();
  let score = 0;
  for (const k of keywords) {
    const kl = k.toLowerCase();
    if (qWords.has(stem(kl))) score += Math.max(2, kl.length);
    else if (qLower.includes(kl)) score += 1;
  }
  return score;
}

function getBotAnswer(rawQuery: string, persona: "resident" | "admin", currentView: string): { text: string; link?: ChatLink } {
  const q = rawQuery.toLowerCase().trim();
  if (!q) {
    return { text: "Go ahead, ask me anything about this dashboard -- e.g. \"what is vendor rank?\" or \"where can I find the per-sqft trend?\"" };
  }
  if (/^(hi|hello|hey)\b/.test(q)) {
    return { text: `Hi! I'm your PulseLedger assistant (beta). You're currently on **${currentView}**. Ask me about any card, badge, or chart you see here, or ask "where can I find..." to be pointed to the right page.` };
  }

  if (WHERE_INTENT.test(q)) {
    const routeMatches = ROUTE_MAP.map((r) => ({ r, score: tokenScore(q, r.keywords) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);
    if (routeMatches.length > 0) {
      const best = routeMatches[0].r;
      return { text: `You'll find ${best.description} on the **${best.page}** page.`, link: { to: best.to, label: best.page } };
    }
  }

  const curatedPool = CURATED.filter((c) => !c.contexts || c.contexts.includes(currentView));
  const curatedScored = curatedPool
    .map((c) => ({ c, score: tokenScore(q, c.keywords) * 3 }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  if (curatedScored.length > 0) {
    return { text: curatedScored[0].c.answer };
  }

  const pool = [...HELP_COMMON, ...(persona === "admin" ? HELP_ADMIN : HELP_RESIDENT)];
  const scored = pool
    .map((entry) => ({ entry, score: tokenScore(q, entry.keywords) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length > 0) {
    return { text: scored[0].entry.answer };
  }

  const looseRoute = ROUTE_MAP.map((r) => ({ r, score: tokenScore(q, r.keywords) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  if (looseRoute.length > 0) {
    const best = looseRoute[0].r;
    return { text: `I'm not fully sure what you meant, but that sounds related to the **${best.page}** page -- ${best.description}. Want to head there?`, link: { to: best.to, label: best.page } };
  }

  return {
    text: `I couldn't find an exact match for that yet (this assistant is still in beta). Try asking about specific terms you see on screen (e.g. "vendor rank", "period change", "All-Time badge"), or ask "where can I find..." followed by what you're looking for.`,
  };
}

const CHAT_STORAGE_PREFIX = "pulseledger-help-chat";

function loadStoredMessages(persona: "resident" | "admin"): ChatMessage[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(`${CHAT_STORAGE_PREFIX}-${persona}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function saveStoredMessages(persona: "resident" | "admin", messages: ChatMessage[]) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(`${CHAT_STORAGE_PREFIX}-${persona}`, JSON.stringify(messages));
  } catch {
    // sessionStorage unavailable, e.g. private browsing -- chat still works, just won't persist
  }
}

function clearStoredMessages(persona: "resident" | "admin") {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(`${CHAT_STORAGE_PREFIX}-${persona}`);
  } catch {
    // ignore
  }
}

function HelpChat({ persona, currentView, onClose }: { persona: "resident" | "admin"; currentView: string; onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const stored = loadStoredMessages(persona);
    if (stored) return stored;
    return [
      { role: "bot", text: `Hi! I'm your PulseLedger assistant. You're currently viewing **${currentView}**. Ask me anything about the cards, badges, or charts on this page -- or ask "where can I find..." something.` },
    ];
  });
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [minimized, setMinimized] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.sessionStorage.getItem(`${CHAT_STORAGE_PREFIX}-minimized-${persona}`) === "1";
    } catch {
      return false;
    }
  });
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, typing, minimized]);

  useEffect(() => {
    saveStoredMessages(persona, messages);
  }, [persona, messages]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(`${CHAT_STORAGE_PREFIX}-minimized-${persona}`, minimized ? "1" : "0");
    } catch {
      // ignore
    }
  }, [persona, minimized]);

  function handleSend() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text }]);
    setTyping(true);
    window.setTimeout(() => {
      const answer = getBotAnswer(text, persona, currentView);
      setMessages((prev) => [...prev, { role: "bot", text: answer.text, link: answer.link }]);
      setTyping(false);
    }, 500 + Math.random() * 400);
  }

  function handleClose() {
    clearStoredMessages(persona);
    onClose();
  }

  return (
    <div className={`flex flex-col bg-card border border-border rounded-2xl shadow-2xl overflow-hidden transition-all duration-200 ${minimized ? "h-auto w-[280px]" : "h-[460px] w-[320px] sm:w-[380px]"}`}>
      <div
        className="p-4 bg-gradient-to-br from-indigo-500 to-blue-600 text-white flex items-center justify-between shrink-0 cursor-pointer"
        onClick={() => minimized && setMinimized(false)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="bg-white/20 p-1.5 rounded-lg shrink-0">
            <Bot className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-sm leading-tight flex items-center gap-1.5">
              Pulse Assistant
              <span className="text-[8px] font-bold uppercase tracking-wide bg-white/25 px-1.5 py-0.5 rounded-full shrink-0">Beta</span>
            </div>
            {!minimized && (
              <div className="text-[10px] opacity-80 flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                <span className="truncate">Viewing: {currentView}</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/10 h-8 w-8"
            onClick={(e) => { e.stopPropagation(); setMinimized((v) => !v); }}
            aria-label={minimized ? "Expand chat" : "Minimize chat"}
          >
            {minimized ? <ChevronUp className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/10 h-8 w-8"
            onClick={(e) => { e.stopPropagation(); handleClose(); }}
            aria-label="Close chat"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {!minimized && (
        <>
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] p-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
                    m.role === "user"
                      ? "bg-indigo-600 text-white rounded-tr-none"
                      : "bg-muted text-foreground rounded-tl-none border border-border"
                  }`}
                >
                  <div>{m.text}</div>
                  {m.link && (
                    <Link
                      to={m.link.to}
                      className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      Go to {m.link.label} →
                    </Link>
                  )}
                </div>
              </div>
            ))}
            {typing && (
              <div className="flex justify-start">
                <div className="bg-muted border border-border rounded-2xl rounded-tl-none px-4 py-3 flex gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce" />
                </div>
              </div>
            )}
          </div>

          <div className="p-3 border-t border-border bg-muted/30 shrink-0 space-y-1.5">
            <div className="flex items-center gap-2">
              <input
                className="flex-1 bg-background border border-border rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                placeholder="Ask about this dashboard..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
              />
              <Button size="icon" className="rounded-xl bg-indigo-600 hover:bg-indigo-700 shrink-0" onClick={handleSend} aria-label="Send">
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground text-center leading-tight">
              Beta feature, still learning -- thanks for testing!
            </p>
          </div>
        </>
      )}
    </div>
  );
}


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
      <div className="p-6 mb-2 border-b border-border space-y-4">
        <Link 
          to="/" 
          onClick={onNavigate} 
          className="group flex items-center gap-3 transition-all duration-200"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#0082c9] to-[#005f91] text-white shadow-md shadow-blue-500/20 group-hover:scale-105 transition-transform">
            <Activity className="h-6 w-6" strokeWidth={2.5} />
          </div>
          <div className="flex flex-col">
            <span className="text-xl font-black leading-none tracking-tight text-slate-900 dark:text-white">
              Pulse<span className="text-[#0082c9]">Ledger</span>
            </span>
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.15em] mt-1">
              CG Boulevard
            </span>
          </div>
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [chatOpen, setChatOpenState] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.sessionStorage.getItem("pulseledger-help-chat-open") === "1";
    } catch {
      return false;
    }
  });
  const setChatOpen = (v: boolean) => {
    setChatOpenState(v);
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.setItem("pulseledger-help-chat-open", v ? "1" : "0");
      } catch {
        // ignore -- sessionStorage may be unavailable (e.g. private browsing)
      }
    }
  };

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
  const [session, setSession] = useState<Session | null>(() => (typeof window !== "undefined" ? getSession() : null));
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

  const currentViewLabel = navSections.flatMap((s) => s.items).find((it) => it.to === pathname)?.label ?? title;

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
            className="font-medium text-[#0082c9] dark:text-[#4db8f0] underline decoration-[#0082c9]/40 dark:decoration-[#4db8f0]/40 underline-offset-2 hover:decoration-[#0082c9] dark:hover:decoration-[#4db8f0] transition-colors"
          >
            View Portfolio
          </a>
        </span>
      </footer>
      </main>
    </div>

    {/* Floating help launcher -- fixed to the viewport, always visible on every
        page regardless of scroll position. Clicking it opens a CONTROLLED menu
        (menuOpen) that closes immediately on selection. chatOpen/minimized/
        history persist via sessionStorage across navigation, and are cleared
        only when the user explicitly closes the chat (X). */}
    <div className="fixed bottom-5 right-5 sm:bottom-6 sm:right-6 z-50 flex flex-col items-end gap-3">
      {chatOpen && (
        <HelpChat persona={isAdmin ? "admin" : "resident"} currentView={currentViewLabel} onClose={() => setChatOpen(false)} />
      )}

      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="How to read this dashboard"
            className="flex items-center gap-2 rounded-full bg-gradient-to-br from-indigo-500 to-blue-600 pl-3 pr-3 py-3 sm:pr-4 text-white shadow-lg shadow-indigo-500/30 transition-all duration-200 hover:scale-105 hover:shadow-xl hover:shadow-indigo-500/40 active:scale-95"
          >
            <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/40 opacity-75" />
              <HelpCircle className="relative h-5 w-5" />
            </span>
            <span className="hidden sm:inline text-sm font-medium whitespace-nowrap">Need help?</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" side="top" className="w-60 p-2 rounded-2xl border-border shadow-xl">
          <div className="grid gap-1">
            <Button
              variant="ghost"
              className="justify-start gap-2 rounded-xl text-sm h-11"
              onClick={() => {
                setMenuOpen(false);
                window.open(isAdmin ? "/dashboard-user-guide-admin.html" : "/dashboard-user-guide-resident.html", "_blank", "noopener,noreferrer");
              }}
            >
              <FileText className="h-4 w-4 text-blue-500" />
              Read User Guide
            </Button>
            <Button
              variant="ghost"
              className="justify-start gap-2 rounded-xl text-sm h-11"
              onClick={() => {
                setMenuOpen(false);
                setChatOpen(true);
              }}
            >
              <div className="relative">
                <MessageSquare className="h-4 w-4 text-indigo-500" />
                <Sparkles className="h-2 w-2 text-amber-400 absolute -top-1 -right-1" />
              </div>
              <span className="flex items-center gap-1.5">
                Chat with Assistant
                <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 leading-none border-amber-500/40 text-amber-600 dark:text-amber-400 font-semibold">
                  Beta
                </Badge>
              </span>
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
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

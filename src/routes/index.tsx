import { createFileRoute, redirect } from "@tanstack/react-router";
import { getSession } from "@/lib/session";

// This route used to render a full "landing directory" page -- a sitemap-
// style grid listing every dashboard, useful during early development but
// unwanted in production. It's also, per the HTTPS-cutover incident, the
// one page most likely to sit there visibly showing that mock content if
// the JS bundle ever fails to boot for any reason (stale cached index.html
// after a deploy, etc.) -- there was no fallback redirect for a signed-out
// visitor at all, only for a signed-in one.
//
// It now has no content. beforeLoad runs before this route's component is
// ever mounted, so under normal conditions nothing from this file is ever
// actually rendered -- it either sends a signed-in visitor straight to
// their dashboard, or a signed-out one straight to /login. component
// renders null as a safety net for the rare split-second before that
// resolves, instead of a confusing fake "portal" page.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    // SSR-safe: getSession() reads localStorage and always returns null on
    // the server (see lib/session.ts's isBrowser() guard) -- skip entirely
    // there so SSR is unaffected, and let the client-side pass (which runs
    // immediately during hydration/routing, not after a full render) make
    // the real decision.
    if (typeof window === "undefined") return;
    const session = getSession();
    if (session) {
      throw redirect({ to: session.role === "admin" ? "/admin/actions" : "/resident/overview", replace: true });
    }
    throw redirect({ to: "/login", replace: true });
  },
  component: () => null,
  head: () => ({
    meta: [{ title: "CG Boulevard Apartment Ledger Portal" }],
  }),
});

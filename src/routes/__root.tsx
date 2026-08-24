import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  useNavigate,
  HeadContent,
  Scripts,
  redirect,
} from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { getSession, canAccess, signOut } from "@/lib/session";
import { AUTH_ENABLED } from "@/lib/feature-flags";

// Public routes accessible without a session. Everything else requires OTP login.
const PUBLIC_PATHS = new Set<string>(["/login"]);
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
// sessionStorage clears when the tab is closed, so a stale timestamp from a
// previous browser session can never trigger an immediate idle-logout on fresh open.
const LAST_ACTIVE_KEY = "apf.lastActiveAt";

function RouteGuard() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();

  // ── Idle-timer effect: mounts ONCE, never restarts on navigation ─────────
  // Keeping this separate from the auth-guard effect is critical: if both
  // live in the same effect (deps=[pathname,...]) the idle interval is torn
  // down and recreated on every route change, and the first check() call of
  // the new effect would immediately read a stale lastActiveAt timestamp from
  // a previous login session → instant forced logout.
  useEffect(() => {
    if (!AUTH_ENABLED) return;

    const touch = () => {
      if (getSession()) window.sessionStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
    };

    const idleTick = () => {
      const session = getSession();
      if (!session) return;
      const last = Number(window.sessionStorage.getItem(LAST_ACTIVE_KEY) ?? "0");
      if (!last) { touch(); return; }                          // first tick: start clock
      if (Date.now() - last > IDLE_TIMEOUT_MS) {
        signOut();
        // Read live pathname so the redirect param is always current.
        const p = window.location.pathname;
        navigate({
          to: "/login",
          search: PUBLIC_PATHS.has(p) ? {} as never : { redirect: p } as never,
          replace: true,
        });
      }
    };

    const id = window.setInterval(idleTick, 30_000);
    const opts = { passive: true } as const;
    window.addEventListener("mousemove", touch, opts);
    window.addEventListener("keydown", touch);
    window.addEventListener("click", touch, opts);
    window.addEventListener("scroll", touch, opts);
    window.addEventListener("touchstart", touch, opts);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("mousemove", touch);
      window.removeEventListener("keydown", touch);
      window.removeEventListener("click", touch);
      window.removeEventListener("scroll", touch);
      window.removeEventListener("touchstart", touch);
    };
  // navigate is a stable reference from useNavigate – effectively runs once.
  }, [navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auth-guard effect: runs on every pathname change ─────────────────────
  useEffect(() => {
    if (!AUTH_ENABLED) {
      if (pathname === "/login") navigate({ to: "/", replace: true });
      return;
    }

    const check = () => {
      const session = getSession();
      if (session && pathname === "/") {
        navigate({ to: session.role === "admin" ? "/admin/actions" : "/resident/overview", replace: true });
        return;
      }
      if (PUBLIC_PATHS.has(pathname)) return;
      if (!session) {
        navigate({ to: "/login", search: { redirect: pathname } as never, replace: true });
        return;
      }
      if (!canAccess(pathname, session.role)) {
        navigate({ to: "/resident/overview", replace: true });
      }
    };

    check();
    window.addEventListener("apf-session-change", check);
    return () => window.removeEventListener("apf-session-change", check);
  }, [pathname, navigate]);

  return null;
}

const rootSearchSchema = z.object({
  period: z.string().optional(),
  view: z.string().optional(),
  head: z.string().optional(),
  category: z.string().optional(),
  vendor: z.string().optional(),
  line: z.string().optional(),
});

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  // FIX: this is the actual fix for the "briefly see the old/protected page
  // before bouncing to /login" flash. The auth check used to live ONLY in
  // RouteGuard's useEffect below, which by definition cannot run until
  // AFTER the matched route's component has already mounted and painted --
  // so typing a protected URL directly always rendered a frame (or more) of
  // that page's real content first. beforeLoad runs during route matching,
  // before any component for the matched route is mounted, so a redirect
  // thrown here means the protected page's component is never rendered on
  // the client at all -- nothing to flash.
  //
  // Client-only, deliberately: getSession() reads localStorage and returns
  // null on the server (see lib/session.ts's isBrowser() guard), so running
  // this unguarded would make beforeLoad treat every SSR render as logged
  // out -- including for genuinely authenticated users -- and redirect the
  // server-rendered output to /login every time. Skipping entirely when
  // `window` doesn't exist leaves SSR output exactly as it is today; the
  // client-side pass (which runs immediately after, as part of hydration/
  // routing, still well before RouteGuard's effect would have fired) is
  // what actually prevents the flash.
  beforeLoad: ({ location }) => {
    if (typeof window === "undefined") return;
    if (!AUTH_ENABLED) return;

    const session = getSession();
    const pathname = location.pathname;

    if (session && pathname === "/") {
      throw redirect({ to: session.role === "admin" ? "/admin/actions" : "/resident/overview", replace: true });
    }
    if (PUBLIC_PATHS.has(pathname)) return;
    if (!session) {
      throw redirect({ to: "/login", search: { redirect: pathname } as never, replace: true });
    }
    if (!canAccess(pathname, session.role)) {
      throw redirect({ to: "/resident/overview", replace: true });
    }
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "CG Boulevard Apartment Ledger Portal" },
      { name: "description", content: "Unified finance dashboards for residents and admins with secure OTP access, audit tracking, and insights across collections, expenses, and cashflow." },
      { property: "og:title", content: "CG Boulevard Apartment Ledger Portal" },
      { property: "og:description", content: "Unified finance dashboards for residents and admins with secure OTP access, audit tracking, and insights across collections, expenses, and cashflow." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "CG Boulevard Apartment Ledger Portal" },
      { name: "twitter:description", content: "Unified finance dashboards for residents and admins with secure OTP access, audit tracking, and insights across collections, expenses, and cashflow." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/9bd5624d-5aaf-45a3-b3ed-271beacb5f0c/id-preview-bfc9bbc8--5f4910d9-cc7e-478e-a2c6-2827c8a63769.lovable.app-1783860026025.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/9bd5624d-5aaf-45a3-b3ed-271beacb5f0c/id-preview-bfc9bbc8--5f4910d9-cc7e-478e-a2c6-2827c8a63769.lovable.app-1783860026025.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
  validateSearch: zodValidator(rootSearchSchema),
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <RouteGuard />
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { navSections } from "@/lib/finance-mock";
import { getSession, signOut, type Session } from "@/lib/session";
import { ArrowRight, LogOut } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
  head: () => ({
    meta: [
      { title: "CG Boulevard Apartment Ledger Portal" },
      { name: "description", content: "Unified finance dashboards for residents and admins with secure OTP access, audit tracking, and monthly transparency." },
    ],
  }),
});

function Landing() {
  const navigate = useNavigate();
  // Read session only after hydration — getSession() depends on localStorage
  // and returns different values on server vs client, which caused a
  // hydration mismatch on the landing page.
  const [session, setSession] = useState<Session | null>(null);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const s = getSession();
    setSession(s);
    setHydrated(true);
    if (s) {
      navigate({ to: s.role === "admin" ? "/admin/actions" : "/resident/overview", replace: true });
    }
  }, [navigate]);
  // RBAC: residents never see admin sections on the landing directory.
  const visible = !hydrated || session?.role === "admin"
    ? navSections
    : navSections.filter((s) => s.tone === "resident");
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-6xl mx-auto px-6 py-8 lg:py-10">
        <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-2">CG Boulevard Apartment Ledger Portal</h1>
            <p className="text-lg text-muted-foreground max-w-2xl">
              A single, secure operations hub for residents and admins with live finance dashboards,
              OTP sign-in, audit-ready actions, and month-by-month visibility across collections and spend.
            </p>
          </div>
          {session && (
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Signed in as</div>
              <div className="text-sm font-medium">{session.name}</div>
              {session.flatCode && <div className="text-xs text-foreground/80">Flat {session.flatCode}</div>}
              <div className="text-[11px] font-mono text-muted-foreground">{session.email}</div>
              <Badge variant="outline" className="text-[10px] capitalize mt-1">{session.role}</Badge>
              <Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => { signOut(); window.location.replace("/login"); }}>
                <LogOut className="h-3.5 w-3.5 mr-1" /> Sign out
              </Button>
            </div>
          )}
        </div>

        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {visible.map((section) => (
            <div key={section.label}>
              <div className="flex items-center gap-2 mb-4">
                <span className={`h-3 w-3 rounded-full ${section.tone === "resident" ? "bg-cyan-500" : "bg-violet-500"}`} />
                <h2 className="text-lg font-semibold">{section.label}</h2>
                <Badge variant="outline" className="text-[10px]">{section.group}</Badge>
              </div>
              <div className="space-y-3">
                {section.items.map((item) => (
                  <Link key={item.to} to={item.to} className="block group">
                    <Card className="transition-colors hover:border-foreground/30">
                      <CardHeader className="py-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <CardTitle className="text-base flex items-center gap-2">
                              {item.label}
                              <ArrowRight className="h-4 w-4 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                            </CardTitle>
                            <CardDescription className="font-mono text-xs mt-1">{item.req}</CardDescription>
                          </div>
                        </div>
                      </CardHeader>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
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
      { title: "Apartment Ledger Pro — Prototype Index" },
      { name: "description", content: "Index of prototype screens covering every requirement in the Apartment Ledger Pro Phase 2 document." },
    ],
  }),
});

function Landing() {
  // Read session only after hydration — getSession() depends on localStorage
  // and returns different values on server vs client, which caused a
  // hydration mismatch on the landing page.
  const [session, setSession] = useState<Session | null>(null);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setSession(getSession()); setHydrated(true); }, []);
  // RBAC: residents never see admin sections on the landing directory.
  const visible = !hydrated || session?.role === "admin"
    ? navSections
    : navSections.filter((s) => s.tone === "resident");
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-5xl mx-auto px-6 py-16">
        <div className="mb-12 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <Badge variant="outline" className="mb-3">Prototype · v1.0 Draft</Badge>
            <h1 className="text-4xl font-bold tracking-tight mb-3">Apartment Ledger Pro</h1>
            <p className="text-lg text-muted-foreground max-w-2xl">
              Next-gen dashboard prototype. One screen per requirement group from the Phase 2 document.
              Uses illustrative mock data.
            </p>
          </div>
          {session && (
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Signed in as</div>
              <div className="text-sm font-medium">{session.name}</div>
              <div className="text-[11px] font-mono text-muted-foreground">{session.email}</div>
              <Badge variant="outline" className="text-[10px] capitalize mt-1">{session.role}</Badge>
              <Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => signOut()}>
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

        <div className="mt-16 text-xs text-muted-foreground border-t border-border pt-6">
          <p>Scope: single apartment complex · Platform: Google Apps Script + Google Sheets · All numbers are mock data.</p>
        </div>
      </div>
    </div>
  );
}

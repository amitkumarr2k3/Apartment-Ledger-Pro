import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { PortalShell } from "@/components/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { seedDashboardControls, type DashboardControl } from "@/lib/finance-mock";
import { Eye, EyeOff, Save, ExternalLink } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/settings")({
  component: Page,
  head: () => ({ meta: [{ title: "Admin · Dashboard Controls" }] }),
});

function Page() {
  const [controls, setControls] = useState<DashboardControl[]>(seedDashboardControls);
  const [dirty, setDirty] = useState(false);

  function toggleDash(key: string) {
    setControls((cs) => cs.map((c) => c.key === key ? { ...c, enabled: !c.enabled } : c));
    setDirty(true);
  }
  function toggleWidget(key: string, wid: string) {
    setControls((cs) => cs.map((c) => {
      if (c.key !== key) return c;
      const hidden = c.hiddenWidgets.includes(wid) ? c.hiddenWidgets.filter((x) => x !== wid) : [...c.hiddenWidgets, wid];
      return { ...c, hiddenWidgets: hidden };
    }));
    setDirty(true);
  }
  function saveAll() {
    toast.success("Dashboard visibility saved for all residents");
    setDirty(false);
  }

  const enabledCount = controls.filter((c) => c.enabled).length;

  return (
    <PortalShell title="Dashboard Controls" reqIds="AC-30 · AC-31 · AC-32" persona="admin">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base">What residents see</CardTitle>
            <CardDescription>Toggle whole dashboards or hide individual widgets. Changes apply the next time a resident loads the app.</CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline">{enabledCount} of {controls.length} dashboards enabled</Badge>
            <Button size="sm" disabled={!dirty} onClick={saveAll}><Save className="h-4 w-4 mr-1" /> Save changes</Button>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {controls.map((c) => (
          <Card key={c.key} className={c.enabled ? "" : "opacity-60 border-dashed"}>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    {c.enabled ? <Eye className="h-4 w-4 text-emerald-500" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                    {c.label}
                  </CardTitle>
                  <CardDescription className="font-mono text-xs mt-1">{c.key}</CardDescription>
                </div>
                <Switch checked={c.enabled} onCheckedChange={() => toggleDash(c.key)} />
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Widgets</div>
              <ul className="divide-y divide-border rounded-md border">
                {c.widgets.map((w) => {
                  const shown = !c.hiddenWidgets.includes(w.id);
                  return (
                    <li key={w.id} className="flex items-center justify-between px-3 py-2 text-sm">
                      <div>
                        <div className="font-medium">{w.label}</div>
                        <div className="text-[11px] font-mono text-muted-foreground">{w.id}</div>
                      </div>
                      <Switch checked={shown} onCheckedChange={() => toggleWidget(c.key, w.id)} disabled={!c.enabled} />
                    </li>
                  );
                })}
              </ul>
              <div className="pt-2">
                <Link to={c.key.startsWith("resident.") ? `/${c.key.replace(".", "/")}` : "/"} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                  Preview as resident <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </PortalShell>
  );
}

// Client-side gate: when a user is signed in (apf.token present) and a screen
// is not yet wired to the real API, show a clear "No data yet" state instead
// of misleading mock numbers. Prevents the "why is DB empty but dashboard
// still full?" confusion.
import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Database } from "lucide-react";

export function useShowMockData(): boolean {
  // Default true so SSR renders the mock (matches unauth'd initial paint);
  // flip to false on client after hydration if a session token is present.
  const [show, setShow] = useState(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const authed = !!window.localStorage.getItem("apf.token")
      || !!window.localStorage.getItem("apf.session");
    if (authed) setShow(false);
  }, []);
  return show;
}

export function NoDbData({ note }: { note?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" /> No data available
        </CardTitle>
        <CardDescription>
          This dashboard reads from the database. There are no matching records
          for your community in the selected period.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          {note ?? "Import transactions via Admin → CSV Import, or add them manually under Transactions (CRUD)."}
        </p>
      </CardContent>
    </Card>
  );
}

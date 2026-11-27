import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getSession } from "@/lib/session";
import { Pencil, StickyNote, Trash2 } from "lucide-react";
import { toast } from "sonner";

export type ChartAnnotation = {
  id: string;
  chart_key: string;
  point_key: string;
  title: string;
  comment: string;
  visibility: "all" | "resident" | "admin";
};

type Draft = { pointKey: string; title: string; comment: string; visibility: ChartAnnotation["visibility"] };

export function resolveAnnotationPointKey(props: any, visiblePointKeys: string[]): string {
  const index = Number(props?.index ?? -1);
  return String(props?.payload?.month ?? visiblePointKeys[index] ?? props?.value ?? "");
}

export function hasVisibleChartAnnotation(items: ChartAnnotation[], visiblePointKeys: string[]): boolean {
  const visible = new Set(visiblePointKeys);
  return items.some((item) => visible.has(item.point_key));
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, credentials: "include" });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export function useChartAnnotations(chartKey: string | null, visiblePointKeys: string[] = []) {
  const queryClient = useQueryClient();
  const session = getSession();
  const isSuperAdmin = session?.role === "superadmin";
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>({ pointKey: "", title: "", comment: "", visibility: "all" });
  const queryKey = ["chart-annotations", chartKey] as const;
  const query = useQuery({
    queryKey,
    enabled: !!chartKey,
    queryFn: async () => {
      const result = await request<{ rows: ChartAnnotation[] }>(`/api/annotations?chartKey=${encodeURIComponent(chartKey!)}`);
      return result.rows;
    },
    staleTime: 30_000,
  });
  const annotations = query.data ?? [];
  const byPoint = useMemo(() => new Map(annotations.map((item) => [item.point_key, item])), [annotations]);
  const hasComments = hasVisibleChartAnnotation(annotations, visiblePointKeys);

  const save = useMutation({
    mutationFn: () => request(`/api/annotations`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chartKey, ...draft, pointKey: draft.pointKey }),
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      setOpen(false);
      toast.success("Chart explanation saved");
    },
    onError: () => toast.error("Could not save chart explanation"),
  });
  const remove = useMutation({
    mutationFn: () => request(`/api/annotations`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chartKey, pointKey: draft.pointKey }),
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      setOpen(false);
      toast.success("Chart explanation deleted");
    },
    onError: () => toast.error("Could not delete chart explanation"),
  });

  const openPoint = (pointKey: string) => {
    if (!chartKey) return;
    const item = byPoint.get(pointKey);
    setDraft({
      pointKey,
      title: item?.title ?? "",
      comment: item?.comment ?? "",
      visibility: item?.visibility ?? "all",
    });
    setOpen(true);
  };

  const label = (props: any) => {
    const pointKey = resolveAnnotationPointKey(props, visiblePointKeys);
    if (!pointKey) return null;
    const item = byPoint.get(pointKey);
    if (!item && !isSuperAdmin) return null;
    const x = Number(props.x ?? 0) + Number(props.width ?? 0) - 12;
    const y = Math.max(2, Number(props.y ?? 0) - 12);
    return (
      <foreignObject x={x} y={y} width={28} height={28} overflow="visible">
        <button
          type="button"
          aria-label={item ? `Read explanation for ${pointKey}` : `Add explanation for ${pointKey}`}
          className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-amber-500 text-white shadow hover:bg-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={(event) => { event.stopPropagation(); openPoint(pointKey); }}
        >
          {item || !isSuperAdmin ? <StickyNote className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
        </button>
      </foreignObject>
    );
  };

  const dialog = (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent onInteractOutside={() => setOpen(false)}>
        <DialogHeader>
          <DialogTitle>{isSuperAdmin && !byPoint.has(draft.pointKey) ? "Explain chart deviation" : draft.title || "Chart explanation"}</DialogTitle>
          <DialogDescription>{isSuperAdmin ? `Explanation for ${draft.pointKey}` : `Explanation for ${draft.pointKey}`}</DialogDescription>
        </DialogHeader>
        {isSuperAdmin ? (
          <div className="space-y-3">
              {!draft.pointKey && <p className="text-xs text-red-600">The chart month could not be identified. Close this dialog and try the month icon again.</p>}
            <div className="space-y-1.5"><Label htmlFor="annotation-title">Headline</Label><Input id="annotation-title" value={draft.title} maxLength={160} onChange={(e) => setDraft((v) => ({ ...v, title: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label htmlFor="annotation-comment">Explanation</Label><Textarea id="annotation-comment" rows={5} value={draft.comment} maxLength={4000} onChange={(e) => setDraft((v) => ({ ...v, comment: e.target.value }))} /></div>
            <div className="space-y-1.5">
              <Label>Visibility</Label>
              <Select value={draft.visibility} onValueChange={(value) => setDraft((v) => ({ ...v, visibility: value as Draft["visibility"] }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Admin + Residents</SelectItem>
                  <SelectItem value="resident">Resident only</SelectItem>
                  <SelectItem value="admin">Admin only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-between gap-2">
              {byPoint.has(draft.pointKey) ? <Button type="button" variant="destructive" onClick={() => remove.mutate()} disabled={remove.isPending || save.isPending}><Trash2 className="mr-2 h-4 w-4" />Delete</Button> : <span />}
              <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>              <Button type="button" disabled={!draft.pointKey || !draft.title.trim() || !draft.comment.trim() || save.isPending || remove.isPending} onClick={() => save.mutate()}>Save</Button></div>
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{draft.comment}</p>
        )}
      </DialogContent>
    </Dialog>
  );

  return { label, dialog, hasComments, isSuperAdmin };
}

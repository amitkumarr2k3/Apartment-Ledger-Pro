import * as React from "react";

/**
 * Returns the correct Recharts `<Tooltip trigger>` for this device:
 * "click" on coarse/no-hover pointers so mobile users can tap to open,
 * "hover" everywhere else. Safe to call anywhere (not a hook).
 */
export function getTooltipTrigger(): "hover" | "click" {
  if (typeof window === "undefined") return "hover";
  return window.matchMedia("(hover: none), (pointer: coarse)").matches
    ? "click"
    : "hover";
}

type ContentProps = {
  labelPrefix?: string;
  valueFormatter?: (v: number) => string;
  labelFormatter?: (label: unknown) => string;
  // Recharts injects these:
  active?: boolean;
  payload?: Array<{
    name?: string;
    dataKey?: string | number;
    value?: number | string | null;
    color?: string;
    payload?: { fill?: string };
  }>;
  label?: unknown;
};

const defaultFormat = (v: number) =>
  Number.isFinite(v) ? String(v) : "—";

/**
 * Pass as the `content` prop of Recharts' `<Tooltip>`. Renders a card with
 * the period label in bold, a color swatch + series name + formatted value
 * per row, and a "tap to update" hint on touch devices.
 */
export function SmartTooltipContent({
  labelPrefix,
  valueFormatter = defaultFormat,
  labelFormatter,
  active,
  payload,
  label,
}: ContentProps) {
  const isTouch =
    typeof window !== "undefined" &&
    window.matchMedia("(hover: none), (pointer: coarse)").matches;

  if (!active || !payload || payload.length === 0) return null;
  const title = labelFormatter
    ? labelFormatter(label)
    : labelPrefix
      ? `${labelPrefix} · ${label ?? ""}`
      : String(label ?? "");
  return (
    <div className="min-w-[10rem] rounded-md border border-border bg-popover/95 px-3 py-2 text-popover-foreground shadow-md backdrop-blur">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <ul className="space-y-1">
        {payload.map((p, i) => {
          const color = p.color ?? p.payload?.fill ?? "var(--color-primary)";
          return (
            <li
              key={`${p.dataKey ?? p.name ?? i}-${i}`}
              className="flex items-center justify-between gap-4 text-sm"
            >
              <span className="flex items-center gap-2 text-muted-foreground">
                <span
                  aria-hidden
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ background: color }}
                />
                {p.name ?? p.dataKey}
              </span>
              <span className="font-mono tabular-nums text-foreground">
                {valueFormatter(Number(p.value ?? NaN))}
              </span>
            </li>
          );
        })}
      </ul>
      {isTouch ? (
        <div className="mt-1 text-[10px] text-muted-foreground/70">
          Tap another point to update
        </div>
      ) : null}
    </div>
  );
}

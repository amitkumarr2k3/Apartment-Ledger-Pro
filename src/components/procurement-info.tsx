import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { defaultExpenseInfoSettings, useExpenseInfoSettings } from "@/lib/hooks";

export const procurementCategory = "One Time Operational Procurement";

export function ProcurementInfo({ name, persona = "resident" }: { name: string; persona?: "resident" | "admin" | "superadmin" }) {
  const { data: settings = defaultExpenseInfoSettings } = useExpenseInfoSettings();
  if (!settings.procurementNames.some((alias) => alias.trim().toLowerCase() === name.trim().toLowerCase())) return null;
  const manual = persona === "resident" ? "resident" : "admin";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`About ${name.trim()}`}
          title={`About ${name.trim()}`}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring align-middle"
          onClick={(event) => event.stopPropagation()}
        >
          <Info className="h-4 w-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="max-w-[calc(100vw-2rem)] text-sm font-normal" onClick={(event) => event.stopPropagation()}>
        <p className="font-semibold">{name.trim()}</p>
        <p className="mt-2">Unexpected, non-recurring purchases for society operations, such as a security cabin or gardening pipes.</p>
        <p className="mt-2">Contact the Treasurer for item-wise details and supporting records.</p>
        <a className="mt-3 inline-block text-primary underline underline-offset-4" href={`/dashboard-user-guide-${manual}.html#one-time-operational-procurement`} target="_blank" rel="noopener noreferrer">
          Read the user manual FAQ
        </a>
      </PopoverContent>
    </Popover>
  );
}
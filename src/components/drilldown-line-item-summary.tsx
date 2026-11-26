import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Category } from "@/lib/finance-mock";

export function categoryLineItemNames(category: Category) {
  return [
    ...new Set(category.vendors.flatMap((vendor) => vendor.items.map((item) => item.name.trim()))),
  ]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

export function categoryLineItemDisplayNames(category: Category) {
  const names = categoryLineItemNames(category);
  const groups = new Map<string, string[]>();

  for (const name of names) {
    const separator = name.indexOf(" - ");
    if (separator < 1) continue;
    const prefix = name.slice(0, separator).trim();
    const suffix = name.slice(separator + 3).trim();
    if (!prefix || !suffix) continue;
    const suffixes = groups.get(prefix) ?? [];
    suffixes.push(suffix);
    groups.set(prefix, suffixes);
  }

  const repeatedPrefixes = new Map(
    [...groups]
      .filter(([, suffixes]) => suffixes.length > 1)
      .map(([prefix, suffixes]) => [prefix, new Set(suffixes)]),
  );
  if (repeatedPrefixes.size === 0) return names;

  const groupedNames = [...repeatedPrefixes].map(
    ([prefix, suffixes]) => `${prefix} - ${[...suffixes].join(", ")}`,
  );
  const ungroupedNames = names.filter((name) => {
    const separator = name.indexOf(" - ");
    return separator < 1 || !repeatedPrefixes.has(name.slice(0, separator).trim());
  });

  return [...groupedNames, ...ungroupedNames].sort((a, b) => a.localeCompare(b));
}

export function DrilldownLineItemSummary({
  category,
  previewLimit = 4,
}: {
  category: Category;
  previewLimit?: number;
}) {
  const names = categoryLineItemDisplayNames(category);
  const itemCount = categoryLineItemNames(category).length;
  const visible = names.slice(0, previewLimit);
  const hidden = names.slice(previewLimit);

  if (names.length === 0) {
    return <span>No line-item description available.</span>;
  }

  const prefix = names.length > 1 ? "Sum of all " : "Sum of ";

  return (
    <span className="inline">
      {prefix}
      {visible.join(", ")}
      {hidden.length > 0 && (
        <>
          {" "}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="font-medium text-primary underline underline-offset-2"
              >
                +{hidden.length} more
              </button>
            </PopoverTrigger>
            <PopoverContent
              className="max-h-72 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto"
              align="start"
            >
              <p className="font-medium text-foreground">All line items ({itemCount})</p>
              <ul className="mt-2 space-y-1 text-sm text-foreground">
                {names.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            </PopoverContent>
          </Popover>
        </>
      )}{" "}
      per month, for the selected range — this is the final level of detail available here
    </span>
  );
}

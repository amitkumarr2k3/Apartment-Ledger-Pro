export function formatVendorNames(values: string[]) {
  const ignored = ["—", "-", "n/a", "not applicable"];
  const names: string[] = [];
  let hasMultipleVendorGroup = false;

  for (const value of values) {
    let name = value.trim();
    if (!name || ignored.includes(name.toLowerCase())) continue;

    const grouped = name.match(/^Multiple Vendors\s*\((.*)\)$/i);
    if (grouped) {
      name = grouped[1].trim();
      hasMultipleVendorGroup = true;
    } else if (/^Multiple Vendors$/i.test(name)) {
      continue;
    }

    if (name && !names.some((existing) => existing.toLowerCase() === name.toLowerCase())) {
      names.push(name);
    }
  }

  return { names, hasMultipleVendorGroup };
}

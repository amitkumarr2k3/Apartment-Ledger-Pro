import { describe, it, expect } from "vitest";
import { parse } from "csv-parse/sync";

describe("CSV parser", () => {
  it("parses transactions header + row", () => {
    const csv = `date,head,category,vendor,line_item,amount,direction
2026-06-15,expense,Utilities,Bescom,Common area electricity,48250,D`;
    const rows = parse(csv, { columns: true, skip_empty_lines: true, trim: true });
    expect(rows.length).toBe(1);
    expect(rows[0].category).toBe("Utilities");
    expect(rows[0].direction).toBe("D");
  });

  it("tolerates missing optional columns", () => {
    const csv = `date,head,category,amount,direction\n2026-06-15,expense,Petty Cash,900,D`;
    const rows = parse(csv, { columns: true, skip_empty_lines: true, trim: true });
    expect(rows[0].vendor).toBeUndefined();
    expect(Number(rows[0].amount)).toBe(900);
  });
});

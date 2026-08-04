import pandas as pd
import yaml
import re
import shutil

from pathlib import Path
from datetime import datetime

INPUT_DIR = "input"
PROCESSED_DIR = "processed"
CONFIG_FILE = "config/mapping.yaml"

OUTPUT_CSV = "output/transactions.csv"
OUTPUT_XLSX = "output/transactions.xlsx"

Path(PROCESSED_DIR).mkdir(exist_ok=True)
Path("output").mkdir(exist_ok=True)

with open(CONFIG_FILE, "r") as f:
    cfg = yaml.safe_load(f)

vendors = cfg.get("vendors", {}).copy()

# -------------------------------------------------------
# Expand Vendor Groups (EXOZEN, etc.)
# -------------------------------------------------------

for grp, items in cfg.get("vendor_groups", {}).items():
    for item in items:
        if item not in vendors:
            vendors[item] = {
                "vendor": grp,
                "vendor_kind": "company"
            }

# -------------------------------------------------------
# Process Vendor Bill Report First
# -------------------------------------------------------

for vf in Path(INPUT_DIR).glob("*Vendor*"):

    try:

        df = pd.read_excel(vf)

        if (
            "Expense A/C" in df.columns
            and "Vendor Name" in df.columns
        ):

            cand = cfg.setdefault(
                "vendor_candidates",
                {}
            )

            for _, r in df.iterrows():

                acct = str(
                    r.get("Expense A/C", "")
                ).strip()

                vendor_name = str(
                    r.get("Vendor Name", "")
                ).strip()

                if (
                    not acct
                    or acct.lower() == "nan"
                ):
                    continue

                if (
                    not vendor_name
                    or vendor_name.lower() == "nan"
                ):
                    continue

                lst = cand.setdefault(
                    acct,
                    []
                )

                if vendor_name not in lst:
                    lst.append(vendor_name)

                # auto-add only if deterministic
                if (
                    acct not in vendors
                    and len(lst) == 1
                ):
                    vendors[acct] = {
                        "vendor": vendor_name,
                        "vendor_kind": "company"
                    }

            cfg["vendors"] = vendors

            with open(CONFIG_FILE, "w") as f:
                yaml.safe_dump(
                    cfg,
                    f,
                    sort_keys=False,
                    allow_unicode=True
                )

        ts = datetime.now().strftime(
            "%Y%m%d_%H%M%S"
        )

        shutil.move(
            str(vf),
            f"{PROCESSED_DIR}/{vf.stem}_{ts}{vf.suffix}"
        )

    except Exception as ex:
        print(
            f"Vendor processing error: {vf} -> {ex}"
        )

# -------------------------------------------------------
# Normalize Helper
# -------------------------------------------------------

def norm(x):
    return re.sub(
        r"\s+",
        " ",
        str(x).strip()
    ).lower()

# -------------------------------------------------------
# Category Lookup
# -------------------------------------------------------

expense_map = {}

for cat, items in cfg.get(
    "expense_categories",
    {}
).items():

    for item in items:
        expense_map[norm(item)] = cat

income_map = {}

for cat, items in cfg.get(
    "income_categories",
    {}
).items():

    for item in items:
        income_map[norm(item)] = cat

months = {
    "April": 4,
    "May": 5,
    "June": 6,
    "July": 7,
    "August": 8,
    "September": 9,
    "October": 10,
    "November": 11,
    "December": 12,
    "January": 1,
    "February": 2,
    "March": 3,
}

rows = []

EXPECTED_COLUMNS = [
    "date",
    "head",
    "category",
    "vendor",
    "vendor_kind",
    "line_item",
    "amount",
    "direction",
    "flat_code",
    "source_ref",
]

# -------------------------------------------------------
# Process Expense / Receipt Files
# -------------------------------------------------------

for file in Path(INPUT_DIR).glob("*.xls*"):

    if "vendor" in file.name.lower():
        continue

    try:

        name = file.name.lower()

        head = (
            "expense"
            if "expense" in name
            else "income"
        )

        direction = (
            "D"
            if head == "expense"
            else "C"
        )

        raw = pd.read_excel(
            file,
            header=None
        )

        fy = ""

        for _, r in raw.iterrows():

            txt = " ".join(
                [
                    str(x)
                    for x in r
                    if pd.notna(x)
                ]
            )

            if "Financial Year" in txt:
                fy = txt
                break

        m = re.search(
            r"(\d{4})-(\d{4})",
            fy
        )

        if not m:
            print(
                f"Skipping {file.name}: could not find 'Financial Year' header"
            )
            continue

        start_year = int(m.group(1))
        end_year = int(m.group(2))

        hdr = next(
            (
                i
                for i, r in raw.iterrows()
                if "April"
                in [str(x) for x in r.values]
            ),
            None
        )

        if hdr is None:
            print(
                f"Skipping {file.name}: could not find header row containing 'April'"
            )
            continue

        df = pd.read_excel(
            file,
            header=hdr
        )

        ledger_col = df.columns[0]

        for _, r in df.iterrows():

            ledger = str(
                r[ledger_col]
            ).strip()

            if ledger.lower() == "total":
                continue

            ledger_norm = norm(ledger)

            for mon, num in months.items():

                if mon not in df.columns:
                    continue

                amt = r.get(mon)

                if (
                    pd.isna(amt)
                    or float(amt) == 0
                ):
                    continue

                yr = (
                    start_year
                    if num >= 4
                    else end_year
                )

                category = (
                    expense_map
                    if head == "expense"
                    else income_map
                ).get(
                    ledger_norm,
                    "Uncategorized"
                )

                vendor_info = {}

                for k, vv in vendors.items():

                    if norm(k) == ledger_norm:
                        vendor_info = vv
                        break

                vendor = vendor_info.get(
                    "vendor",
                    "Individual"
                )

                vendor_kind = vendor_info.get(
                    "vendor_kind",
                    "individual"
                )

                rows.append(
                    {
                        "date":
                            f"{yr}-{num:02d}-01",

                        "head":
                            head,

                        "category":
                            category,

                        "vendor":
                            vendor,

                        "vendor_kind":
                            vendor_kind,

                        "line_item":
                            ledger,

                        "amount":
                            amt,

                        "direction":
                            direction,

                        "flat_code":
                            "",

                        "source_ref":
                            f"{direction}|"
                            f"{category}|"
                            f"{vendor}|"
                            f"{ledger}|"
                            f"{yr}-{num:02d}"
                    }
                )

    except Exception as ex:
        print(
            f"Error processing {file.name}: {ex}"
        )

    finally:
        # Always move the input file so it isn't reprocessed, even if it
        # failed or produced no rows.
        ts = datetime.now().strftime(
            "%Y%m%d_%H%M%S"
        )

        try:
            shutil.move(
                str(file),
                f"{PROCESSED_DIR}/{file.stem}_{ts}{file.suffix}"
            )
        except Exception as move_ex:
            print(
                f"Could not move {file.name} to processed: {move_ex}"
            )

# -------------------------------------------------------
# Outputs
# -------------------------------------------------------

output_df = pd.DataFrame(rows, columns=EXPECTED_COLUMNS)

if output_df.empty:
    print(
        "Warning: no transaction rows were extracted from the uploaded "
        "files (check that they contain a 'Financial Year' header, a "
        "month header row starting with 'April', and non-zero amounts)."
    )

# Force ISO date format YYYY-MM-DD
output_df["date"] = pd.to_datetime(
    output_df["date"],
    errors="coerce"
).dt.strftime("%Y-%m-%d")

# CSV Export
output_df.to_csv(
    OUTPUT_CSV,
    index=False
)

# Excel Export with date formatting
with pd.ExcelWriter(
    OUTPUT_XLSX,
    engine="openpyxl"
) as writer:

    output_df.to_excel(
        writer,
        index=False,
        sheet_name="Transactions"
    )

    worksheet = writer.sheets["Transactions"]

    # Find Date column
    date_col_idx = output_df.columns.get_loc("date") + 1

    for row in range(2, len(output_df) + 2):
        worksheet.cell(
            row=row,
            column=date_col_idx
        ).number_format = "yyyy-mm-dd"

print(
    f"Generated {len(output_df)} rows"
)
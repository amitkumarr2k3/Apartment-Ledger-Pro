import pandas as pd
import yaml
import re
import shutil

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
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
vendor_candidates = cfg.get("vendor_candidates", {}).copy()


def resolve_vendor_label(line_item, configured_vendor):
    candidates = vendor_candidates.get(line_item, [])
    if len(candidates) == 1:
        return candidates[0]

    if configured_vendor != "Multiple Vendors":
        return configured_vendor

    if len(candidates) == 1:
        return candidates[0]
    if len(candidates) > 1:
        return "Multiple Vendors (" + " / ".join(candidates) + ")"
    return "Multiple Vendors"


line_item_aliases = {
    norm_key: str(canonical).strip()
    for norm_key, canonical in {
        re.sub(r"\s+", " ", str(k).strip()).lower(): v
        for k, v in cfg.get("line_item_aliases", {}).items()
    }.items()
}

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

all_vendor_mapping_gaps = []
processed_vendor_reports = []

for vf in Path(INPUT_DIR).glob("*Vendor*"):

    try:

        header_preview = pd.read_excel(vf, header=None)
        header_row = next(
            (
                row_index
                for row_index, row in header_preview.iterrows()
                if "expense a/c" in {
                    re.sub(r"\s+", " ", str(value).strip()).lower()
                    for value in row.tolist()
                }
                and "vendor name" in {
                    re.sub(r"\s+", " ", str(value).strip()).lower()
                    for value in row.tolist()
                }
            ),
            None,
        )

        if header_row is None:
            raise ValueError(
                "Vendor report must contain 'Expense A/C' and 'Vendor Name' columns"
            )

        df = pd.read_excel(vf, header=header_row)

        if (
            "Expense A/C" in df.columns
            and "Vendor Name" in df.columns
        ):

            cand = cfg.setdefault(
                "vendor_candidates",
                {}
            )
            vendor_mapping_gaps = []

            for _, r in df.iterrows():

                raw_accts = str(
                    r.get("Expense A/C", "")
                ).strip()

                vendor_name = str(
                    r.get("Vendor Name", "")
                ).strip()

                if (
                    not raw_accts
                    or raw_accts.lower() == "nan"
                ):
                    continue

                if (
                    not vendor_name
                    or vendor_name.lower() == "nan"
                ):
                    continue

                accounts = list(dict.fromkeys(
                    acct.strip()
                    for acct in raw_accts.split(",")
                    if acct.strip()
                    and acct.strip().lower() != "nan"
                ))

                for acct in accounts:
                    lst = cand.setdefault(acct, [])

                    if vendor_name not in lst:
                        lst.append(vendor_name)

                    existing_vendor = vendors.get(acct, {})
                    existing_name = existing_vendor.get("vendor")
                    existing_kind = existing_vendor.get("vendor_kind")

                    if len(lst) == 1:
                        resolved_vendor = lst[0]
                        vendors[acct] = {
                            "vendor": resolved_vendor,
                            "vendor_kind": "company"
                        }
                    else:
                        resolved_vendor = "Multiple Vendors"
                        vendors[acct] = {
                            "vendor": resolved_vendor,
                            "vendor_kind": "company"
                        }
                        vendor_candidates[acct] = list(lst)
                        cfg["vendor_candidates"] = vendor_candidates

                    if (
                        existing_name != resolved_vendor
                        or existing_kind != "company"
                    ):
                        vendor_mapping_gaps.append({
                            "source_file": vf.name,
                            "expense_account": acct,
                            "vendor_name": " / ".join(lst),
                            "previous_vendor": existing_name or "",
                            "previous_vendor_kind": existing_kind or "",
                            "resolved_vendor": resolved_vendor,
                            "resolved_vendor_kind": "company",
                            "classification": "UPDATED_FROM_VENDOR_REPORT"
                        })

            cfg["vendors"] = vendors

            all_vendor_mapping_gaps.extend(vendor_mapping_gaps)

            with open(CONFIG_FILE, "w") as f:
                yaml.safe_dump(
                    cfg,
                    f,
                    sort_keys=False,
                    allow_unicode=True
                )

            with open(CONFIG_FILE, "r") as f:
                cfg = yaml.safe_load(f)
            vendors = cfg.get("vendors", {}).copy()
            vendor_candidates = cfg.get("vendor_candidates", {}).copy()
            processed_vendor_reports.append(vf.name)
        else:
            raise ValueError(
                "Vendor report must contain 'Expense A/C' and 'Vendor Name' columns"
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
        all_vendor_mapping_gaps.append({
            "source_file": vf.name,
            "expense_account": "",
            "vendor_name": "",
            "previous_vendor": "",
            "previous_vendor_kind": "",
            "resolved_vendor": "",
            "resolved_vendor_kind": "",
            "classification": "VENDOR_REPORT_PARSE_ERROR",
        })

# Always produce the reconciliation report, including when vendor reports
# are absent or no mapping change is detected.
if not processed_vendor_reports and not all_vendor_mapping_gaps:
    all_vendor_mapping_gaps.append({
        "source_file": "",
        "expense_account": "",
        "vendor_name": "",
        "previous_vendor": "",
        "previous_vendor_kind": "",
        "resolved_vendor": "",
        "resolved_vendor_kind": "",
        "classification": "NO_VENDOR_REPORTS_FOUND",
    })

vendor_gap_file = Path("output/vendor_mapping_gaps.csv")
vendor_gap_file.parent.mkdir(exist_ok=True)
pd.DataFrame(
    all_vendor_mapping_gaps,
    columns=[
        "source_file",
        "expense_account",
        "vendor_name",
        "previous_vendor",
        "previous_vendor_kind",
        "resolved_vendor",
        "resolved_vendor_kind",
        "classification",
    ]
).to_csv(vendor_gap_file, index=False)

# -------------------------------------------------------
# Normalize Helper
# -------------------------------------------------------

def norm(x):
    return re.sub(
        r"\s+",
        " ",
        str(x).strip()
    ).lower()


def canonical_line_item(value):
    raw = str(value).strip()
    return line_item_aliases.get(norm(raw), raw)

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


def normalize_amount(value):
    try:
        numeric = Decimal(str(value).replace(",", "").strip())
    except (InvalidOperation, AttributeError, ValueError):
        return value

    rounded = numeric.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if rounded == rounded.to_integral_value():
        return int(rounded)
    return float(rounded)


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
# Process Collection / SQFT Report Files
# -------------------------------------------------------

for file in Path(INPUT_DIR).glob("*.xls*"):

    name = file.name.lower()

    if "collection" not in name and "sqft" not in name:
        continue

    try:
        raw = pd.read_excel(file, header=None)

        month_short = {
            "jan": 1, "january": 1,
            "feb": 2, "february": 2,
            "mar": 3, "march": 3,
            "apr": 4, "april": 4,
            "may": 5,
            "jun": 6, "june": 6,
            "jul": 7, "july": 7,
            "aug": 8, "august": 8,
            "sep": 9, "sept": 9, "september": 9,
            "oct": 10, "october": 10,
            "nov": 11, "november": 11,
            "dec": 12, "december": 12,
        }

        first_row = [str(x).strip() for x in raw.iloc[0].values if pd.notna(x)]

        if first_row and norm(first_row[0]) == "month":
            df = pd.read_excel(file, header=0)

            as_of_match = re.search(
                r"as\s*(?:of|on)?\s*([A-Za-z]+)\s*[-]?\s*(20\d{2}|\d{2})",
                file.name,
                re.IGNORECASE,
            )

            as_of_year = None
            if as_of_match:
                year_text = as_of_match.group(2)
                as_of_year = int(year_text) if len(year_text) == 4 else int("20" + year_text)

            month_col = df.columns[0]

            for _, r in df.iterrows():
                month_text = str(r[month_col]).strip()
                month_info = re.match(r"([A-Za-z]+)", month_text)
                month_num = None
                year_num = None

                raw_month_value = r[month_col]
                if isinstance(raw_month_value, (pd.Timestamp, datetime)):
                    month_num = raw_month_value.month
                    year_num = raw_month_value.year

                # Support exported date values such as Oct-25 and Oct 2025,
                # in addition to plain month names.
                month_match = re.match(
                    r"([A-Za-z]{3,})[\s\-/']+(\d{2}|20\d{2})",
                    month_text,
                    re.IGNORECASE,
                )

                if month_match:
                    month_key = month_match.group(1).lower()
                    month_num = next(
                        (num for key, num in month_short.items() if key.startswith(month_key[:3])),
                        None,
                    )
                    year_text = month_match.group(2)
                    year_num = int(year_text) if len(year_text) == 4 else int("20" + year_text)
                elif month_info is not None:
                    month_key = month_info.group(1).lower()
                    month_num = next(
                        (num for key, num in month_short.items() if key.startswith(month_key[:3])),
                        None,
                    )

                    if month_num is None:
                        continue

                    if as_of_year is not None:
                        year_num = as_of_year
                    else:
                        year_num = datetime.now().year

                if month_num is None or year_num is None:
                    continue

                for col in df.columns[1:]:
                    source_ledger = str(col).strip()
                    ledger = canonical_line_item(source_ledger)
                    ledger_norm = norm(ledger)

                    # Maintenance Charge is sourced only from the Income/Receipt report.
                    if ledger_norm == "maintenance charge":
                        continue

                    amt = r.get(col)

                    if pd.isna(amt):
                        continue

                    try:
                        amount = float(str(amt).replace(",", "").strip())
                    except (TypeError, ValueError):
                        continue

                    multiplier = cfg.get("collection_amount_multipliers", {}).get(ledger)
                    if multiplier is not None:
                        amount = amount * float(multiplier)
                    amount = normalize_amount(amount)

                    category = income_map.get(ledger_norm)
                    reference_category = cfg.get("collection_reference_categories", {}).get(ledger)

                    if reference_category:
                        head = "reference"
                        category = reference_category
                    elif category:
                        head = "income"
                    else:
                        continue

                    vendor_info = vendors.get(source_ledger, vendors.get(ledger, {}))
                    vendor = resolve_vendor_label(
                        source_ledger,
                        vendor_info.get("vendor", "Individual")
                    )
                    vendor_kind = vendor_info.get("vendor_kind", "individual")

                    flat_code = ""
                    if ledger == "Previous Arrears Brought Forward":
                        flat_code = f"OUT-BF-{year_num}-{month_num:02d}"
                    elif ledger == "Current Month Unpaid Maintenance":
                        flat_code = f"OUT-CUR-{year_num}-{month_num:02d}"

                    date_value = f"{year_num}-{month_num:02d}-01"
                    source_ref = ""
                    if head == "income":
                        source_ref = f"C|{category}|{vendor}|{ledger}|{year_num}-{month_num:02d}"

                    rows.append({
                        "date": date_value,
                        "head": head,
                        "category": category,
                        "vendor": vendor,
                        "vendor_kind": vendor_kind,
                        "line_item": ledger,
                        "amount": amount,
                        "direction": "C",
                        "flat_code": flat_code,
                        "source_ref": source_ref,
                    })

            continue

        fy = ""
        for _, r in raw.iterrows():
            txt = " ".join(str(x) for x in r if pd.notna(x))
            if "Financial Year" in txt:
                fy = txt
                break

        start_year = None
        end_year = None
        fy_match = re.search(r"(\d{4})-(\d{2,4})", fy)
        if fy_match:
            start_year = int(fy_match.group(1))
            end_part = fy_match.group(2)
            end_year = int(end_part) if len(end_part) == 4 else int(str(start_year)[:2] + end_part)

        if start_year is None:
            fname_fy = re.search(r"FY\s*(\d{4})[\s\-]+(\d{2,4})", file.name, re.IGNORECASE)
            if fname_fy:
                start_year = int(fname_fy.group(1))
                end_part = fname_fy.group(2)
                end_year = int(end_part) if len(end_part) == 4 else int(str(start_year)[:2] + end_part)

        def parse_month_column(value):
            text = re.sub(r"\s+", " ", str(value).strip()).lower()
            month_num = None
            for month_name, num in month_short.items():
                if re.search(r"(?:^|[^a-z])" + re.escape(month_name) + r"(?:[^a-z]|$)", text):
                    month_num = num
                    break
            if month_num is None:
                return None

            year_match = re.search(r"(?<!\d)(20\d{2}|\d{2})(?!\d)", text)
            if year_match:
                year_text = year_match.group(1)
                year_num = int(year_text) if len(year_text) == 4 else int("20" + year_text)
                return month_num, year_num

            if start_year is not None:
                year_num = start_year if month_num >= 9 else end_year
                return month_num, year_num

            as_of_text = " ".join(str(x) for x in raw.fillna("").to_numpy().ravel())
            as_of_match = re.search(
                r"(?:as\s*(?:of|on)|date)\s*[:\-]?\s*(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s*['\-]?\s*(20\d{2}|\d{2})",
                as_of_text,
                re.IGNORECASE,
            )
            if as_of_match:
                month_text = as_of_match.group(1).lower()
                month_num = next(num for key, num in month_short.items() if key.startswith(month_text[:3]))
                year_text = as_of_match.group(2)
                year_num = int(year_text) if len(year_text) == 4 else int("20" + year_text)
                return month_num, year_num

            return month_num, datetime.now().year

        hdr = None
        for i, r in raw.iterrows():
            if any(parse_month_column(x) is not None for x in r.values if pd.notna(x)):
                hdr = i
                break

        if hdr is None:
            print(f"Skipping {file.name}: could not find month columns")
            continue

        df = pd.read_excel(file, header=hdr)
        ledger_col = df.columns[0]
        for _, r in df.iterrows():
            source_ledger = str(r[ledger_col]).strip()
            if not source_ledger or source_ledger.lower() == "nan" or source_ledger.lower() == "total":
                continue

            ledger = canonical_line_item(source_ledger)
            ledger_norm = norm(ledger)

            if ledger_norm == "maintenance charge":
                continue

            for col in df.columns:
                month_info = parse_month_column(col)
                if month_info is None:
                    continue

                month_num, year_num = month_info
                amt = r.get(col)
                if pd.isna(amt):
                    continue

                try:
                    amount = float(str(amt).replace(",", "").strip())
                except (TypeError, ValueError):
                    continue

                multiplier = cfg.get("collection_amount_multipliers", {}).get(ledger)
                if multiplier is not None:
                    amount = amount * float(multiplier)
                amount = normalize_amount(amount)

                category = income_map.get(ledger_norm, "Uncategorized")
                head = "income"

                reference_category = cfg.get("collection_reference_categories", {}).get(ledger)
                if reference_category:
                    category = reference_category
                    head = "reference"

                vendor_info = vendors.get(source_ledger, vendors.get(ledger, {}))
                vendor = resolve_vendor_label(
                    source_ledger,
                    vendor_info.get("vendor", "Individual")
                )
                vendor_kind = vendor_info.get("vendor_kind", "individual")

                flat_code = ""
                if ledger == "Previous Arrears Brought Forward":
                    flat_code = f"OUT-BF-{year_num}-{month_num:02d}"
                elif ledger == "Current Month Unpaid Maintenance":
                    flat_code = f"OUT-CUR-{year_num}-{month_num:02d}"

                date_value = f"{year_num}-{month_num:02d}-01"
                source_ref = ""
                if head == "income":
                    source_ref = f"C|{category}|{vendor}|{ledger}|{year_num}-{month_num:02d}"

                rows.append({
                    "date": date_value,
                    "head": head,
                    "category": category,
                    "vendor": vendor,
                    "vendor_kind": vendor_kind,
                    "line_item": ledger,
                    "amount": amount,
                    "direction": "C",
                    "flat_code": flat_code,
                    "source_ref": source_ref,
                })

    except Exception as ex:
        print(f"Error processing collection report {file.name}: {ex}")

    finally:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        try:
            shutil.move(str(file), f"{PROCESSED_DIR}/{file.stem}_{ts}{file.suffix}")
        except Exception as move_ex:
            print(f"Could not move {file.name} to processed: {move_ex}")

# -------------------------------------------------------
# Process Expense / Receipt Files
# -------------------------------------------------------

for file in Path(INPUT_DIR).glob("*.xls*"):

    name = file.name.lower()

    if "vendor" in name:
        continue

    if "collection" in name or "sqft" in name:
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

        if m:
            start_year = int(m.group(1))
            end_year = int(m.group(2))
        else:
            # FIX: some report exports (e.g. the FY2025-26 ones) start
            # directly at the ledger/month header row with no "Financial
            # Year" title block above it at all -- there is nothing in the
            # sheet content to find. Fall back to parsing the fiscal year
            # straight out of the FILENAME instead, which consistently
            # follows the "FY<yyyy>-<yy>" convention across every report
            # (e.g. "FY2025-26 Expense Report.xls").
            fname_m = re.search(
                r"FY\s*(\d{4})[\s\-]+(\d{2,4})",
                file.name,
                re.IGNORECASE,
            )

            if fname_m:
                start_year = int(fname_m.group(1))
                end_part = fname_m.group(2)
                end_year = (
                    int(end_part)
                    if len(end_part) == 4
                    else int(str(start_year)[:2] + end_part)
                )
            else:
                print(
                    f"Skipping {file.name}: could not find 'Financial Year' "
                    f"header in the sheet, or parse an FY<yyyy>-<yy> pattern "
                    f"from the filename"
                )
                continue

        # FIX: previously only recognised a header row that literally
        # contained "April" -- i.e. assumed every report always starts its
        # column headers at the beginning of the fiscal year. That's wrong
        # for a partial-year report like FY2025-26, where real record-
        # keeping only began in October -- its header row is
        # "Ledgers, October, November, ..., March" and never contains
        # "April" at all, so it was being skipped entirely even though it's
        # perfectly valid data. Detect the header row by matching ANY of the
        # 12 month names instead, so it works no matter which month the
        # columns actually start from.
        month_names = set(months.keys())

        hdr = next(
            (
                i
                for i, r in raw.iterrows()
                if month_names & {str(x) for x in r.values}
            ),
            None
        )

        if hdr is None:
            print(
                f"Skipping {file.name}: could not find a header row "
                f"containing any recognised month name"
            )
            continue

        df = pd.read_excel(
            file,
            header=hdr
        )

        ledger_col = df.columns[0]

        for _, r in df.iterrows():

            source_ledger = str(
                r[ledger_col]
            ).strip()

            if source_ledger.lower() == "total":
                continue

            ledger = canonical_line_item(source_ledger)

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
                source_ledger_norm = norm(source_ledger)

                for k, vv in vendors.items():

                    if norm(k) in {source_ledger_norm, ledger_norm}:
                        vendor_info = vv
                        if norm(k) == source_ledger_norm:
                            break

                vendor = resolve_vendor_label(
                    source_ledger,
                    vendor_info.get("vendor", "Individual")
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
                            normalize_amount(amt),

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

# Add configured final reference entries exactly once, at the end of the CSV.
opening_balance_line = "True Opening Balance"
output_df = output_df[
    ~((output_df["line_item"] == opening_balance_line) &
      (output_df["head"] == "reference"))
].copy()

for entry in cfg.get("final_reference_entries", []):
    final_entry = {column: entry.get(column, "") for column in EXPECTED_COLUMNS}
    final_entry["amount"] = normalize_amount(final_entry["amount"])
    output_df = pd.concat(
        [output_df, pd.DataFrame([final_entry], columns=EXPECTED_COLUMNS)],
        ignore_index=True,
    )

# CSV Export
output_df.to_csv(
    OUTPUT_CSV,
    index=False
)

# Excel Export with date formatting. Keep CSV generation successful even
# if transactions.xlsx is currently open and locked by Excel.
try:
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
except PermissionError:
    print(
        f"Warning: could not update {OUTPUT_XLSX} because it is open or locked; "
        "the CSV output was generated successfully."
    )

print(
    f"Generated {len(output_df)} rows"
)
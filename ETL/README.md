# RWA Finance Transformer

Convert monthly Expense Analysis and Receipt Analysis sheets into transaction format.

---

## Features

- Supports multiple expense files
- Supports multiple receipt files
- Configuration driven mapping
- Generates consolidated output
- Generates unmapped report

---

## Input Files

Place all files inside:

input/

Examples:

Expense-analysis-2025-2026.xls
Expense-analysis-2026-2027.xls

Receipt-analysis-2025-2026.xls
Receipt-analysis-2026-2027.xls

---

## Run

Install dependencies

pip install -r requirements.txt

Execute

python transform.py

---

## Output

Generated under

output/

Files:

transactions.xlsx
transactions.csv
unmapped_items.csv

---

## Mapping Configuration

Edit:

config/mapping.yaml

### Expense Category Example

expense_categories:

  Utilities:
    - BESCOM A Block
    - BESCOM B Block

### Income Category Example

income_categories:

  Facility Rental:
    - AV room

---

## Vendor Configuration

vendors:

  AV room:
      vendor: Residents
      vendor_kind: individual

---

## Defaults

If no mapping found:

category = Uncategorized

vendor = Individual

vendor_kind = individual

---

## Rules Applied

Expenses

head = expense
direction = D

Income

head = income
direction = C

Date

1st day of month

Examples:

April 2026 → 2026-04-01

January 2027 → 2027-01-01

---

## Continuous Improvement

After every run check:

unmapped_items.csv

Add those ledgers in:

config/mapping.yaml

for better categorization and vendor identification.
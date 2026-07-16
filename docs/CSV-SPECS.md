## Sample CSV files

### transactions.csv
```csv
date,head,category,vendor,line_item,amount,direction,flat_code,source_ref
2026-06-15,expense,Utilities,Bescom,Common area electricity,48250,D,,BSCM-2026-06
2026-06-15,expense,Maintenance,ABC Enterprise,STP salt purchase,9200,D,,ABC-STP-2026-06
2026-06-05,income,Maintenance Collections,Monthly maintenance,Flat maintenance dues,4500,C,A-001,DUE-A001-202606
```

### residents.csv
```csv
email,name,flat_code
resident1@example.com,Alice,A-001
resident2@example.com,Bob,A-002
```

### vendors.csv
```csv
name,kind
Bescom,company
John (Plumber),individual
```

- Missing columns are OK if optional (`vendor`, `line_item`, `flat_code`, `source_ref`).
- Amount is in rupees (not paise); API converts.
- `source_ref` makes re-upload idempotent — same value → no duplicate row.

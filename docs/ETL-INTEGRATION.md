# ETL Integration Guide

## Overview

The ETL (Extract, Transform, Load) module has been fully integrated into the application, enabling automated processing of expense, receipt, and vendor files directly from the UI.

### What Changed

**Before:**
- Files manually placed in `ETL/input/` directory
- Scripts run manually via command line
- CSV output manually uploaded from UI
- Multi-step manual process

**After:**
- Upload files directly from web UI
- Automated end-to-end processing
- Files automatically imported into database
- Single-step simplified workflow

---

## Architecture

### Components

#### 1. Backend Service (`backend/src/etl.ts`)
Core ETL processing engine that:
- Initializes ETL directories (input, processed, output)
- Saves uploaded files to input directory
- Spawns Python transform.py process
- Moves processed files to processed folder
- Reads and returns output files
- Handles cleanup of old files

**Key Functions:**
```typescript
initializeETLDirs()           // Setup directories
saveUploadedFiles()           // Save uploaded files
runETLTransformation()        // Execute transform.py
getOutputFiles()              // List generated outputs
readTransformedTransactions() // Read output CSV
cleanupOldFiles()             // Maintenance cleanup
```

#### 2. API Routes (`backend/src/routes/admin.etl.ts`)
Fastify routes for ETL operations:

**Endpoints:**
```
POST   /api/admin/etl/upload        Upload and process files
GET    /api/admin/etl/sessions      List processing sessions
GET    /api/admin/etl/sessions/:id  Get session details
GET    /api/admin/etl/output-files  List output files
```

#### 3. UI Components
- **FileUploadZone** - Reusable drag-drop file upload
- **ETLFileUploadZone** - Specialized component for expense/receipt/vendor files
- **Admin ETL Route** - Complete UI page for ETL management

#### 4. Database Schema
New table `etl_sessions` tracks processing history:
```sql
CREATE TABLE etl_sessions (
  id            UUID PRIMARY KEY,
  community_id  UUID NOT NULL,
  session_id    TEXT NOT NULL,
  uploaded_by   UUID NOT NULL,
  input_files   JSONB,
  output_files  JSONB,
  status        TEXT,              -- processing|completed|failed
  error_message TEXT,
  created_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ
);
```

---

## ETL Processing Pipeline

### Step-by-Step Flow

```
┌─────────────────────────────────────────────────────────┐
│ 1. FILE UPLOAD                                          │
│    User uploads expense, receipt, and vendor files      │
└─────────────┬───────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│ 2. SAVE TO INPUT                                        │
│    Files → ETL/input/                                   │
│    Naming: {filename}_{type}_{timestamp}.{ext}          │
└─────────────┬───────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│ 3. TRANSFORMATION                                       │
│    Python transform.py processes files                  │
│    Uses config/mapping.yaml for category/vendor mapping │
│    Generates transactions.csv & transactions.xlsx       │
└─────────────┬───────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│ 4. FILE MANAGEMENT                                      │
│    Input files → ETL/processed/                         │
│    Output files → ETL/output/                           │
└─────────────┬───────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│ 5. AUTO-IMPORT                                          │
│    Read transactions.csv                                │
│    Create import_batches record                         │
│    Parse and validate each row                          │
│    Insert into database with SAVEPOINT rollback         │
│    Record any errors in import_staging                  │
└─────────────┬───────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│ 6. COMPLETION                                           │
│    Update ETL session status                            │
│    Audit log entry                                      │
│    Return results to UI                                 │
└─────────────────────────────────────────────────────────┘
```

---

## File Upload Flow

### Supported File Types

| Type | Field Name | Purpose |
|------|-----------|---------|
| **Expense** | `expense` | Expense Analysis sheet |
| **Receipt** | `receipt` | Receipt Analysis sheet |
| **Vendor** | `vendor` | Vendor list data |

### File Requirements

- **Format**: CSV, XLS, or XLSX
- **Max Size**: 10 MB per file
- **Encoding**: UTF-8 recommended
- **Structure**: Must match expected schema (same as manual upload)

### Expected CSV Columns (from transform.py output)

**transactions.csv:**
```
date,head,category,vendor,line_item,amount,direction,flat_code,source_ref
2025-01-15,expense,Utilities,BESCOM,Power-A Block,5000,D,A1,
2025-01-20,income,Facility Rental,Residents,Event Hall,2000,C,A2,
```

---

## Configuration

### Mapping Configuration (`ETL/config/mapping.yaml`)

The transform.py uses this file to map expense/receipt items to categories and vendors.

**Example Structure:**
```yaml
defaults:
  expense_head: expense
  income_head: income

expense_categories:
  Utilities:
    - BESCOM A Block
    - BESCOM B Block
  Maintenance:
    - AMC (Lift)
    - DG Service

income_categories:
  Facility Rental:
    - AV room
    - Meeting Room

vendors:
  BESCOM:
    vendor: BESCOM Ltd
    vendor_kind: company
  Residents:
    vendor: Residents
    vendor_kind: individual

vendor_groups:
  Facilities:
    - Facility Manager
    - Help Desk
```

**To update mappings:**
1. Edit `ETL/config/mapping.yaml`
2. Restart backend service
3. Re-upload files for new mappings to apply

---

## Usage Guide

### For End Users

#### Upload Files

1. Navigate to **Admin → ETL Integration**
2. Click on "Upload Files" tab
3. Select file type (Expense/Receipt/Vendor)
4. Upload the file (drag-drop or click)
5. Repeat for other file types (optional)
6. Click "Start ETL Process"
7. Monitor progress and view results

#### View History

1. Go to **Admin → ETL Integration**
2. Click on "Processing History" tab
3. See all previous sessions with status and details
4. Identifies successful/failed processing runs

### For Administrators

#### Monitor Sessions

**Backend logging:**
```bash
# Check ETL service logs
docker compose logs backend | grep ETL
```

**Database queries:**
```sql
-- View all ETL sessions
SELECT * FROM etl_sessions 
ORDER BY created_at DESC 
LIMIT 10;

-- Count successful uploads
SELECT status, COUNT(*) 
FROM etl_sessions 
GROUP BY status;

-- View associated import batches
SELECT eb.*, es.session_id
FROM etl_sessions es
JOIN import_batches eb ON eb.id = es.id
WHERE es.community_id = 'xxx';
```

#### Troubleshooting

**If ETL fails:**

1. Check backend logs for Python errors
2. Verify file format matches expected schema
3. Review mapping.yaml configuration
4. Check ETL/input directory for files
5. Check file permissions in ETL folders

**Common Issues:**

| Issue | Cause | Solution |
|-------|-------|----------|
| "No such file" | Python script not found | Ensure transform.py exists in ETL/ |
| "Column not found" | CSV header mismatch | Check CSV structure matches schema |
| "Mapping failed" | Category not in mapping.yaml | Add mapping or use generic category |
| "Import error" | Invalid transaction data | Check amount, date, direction fields |

---

## API Reference

### POST /api/admin/etl/upload

Upload and process ETL files.

**Request:**
```bash
curl -X POST http://localhost:4000/api/admin/etl/upload \
  -H "Authorization: Bearer {token}" \
  -F "expense=@expense.csv" \
  -F "receipt=@receipt.xlsx" \
  -F "vendor=@vendor.csv"
```

**Response:**
```json
{
  "success": true,
  "sessionId": "abc-123-def-456",
  "batchId": "batch-id",
  "importBatchId": "import-batch-id",
  "message": "ETL process completed and transactions imported",
  "stats": {
    "inputFiles": 3,
    "outputFiles": 2,
    "transactionsImported": 245,
    "transactionsFailed": 3
  },
  "logs": [
    "[STDOUT] Processing expense.csv...",
    "[STDOUT] Found 150 expense records"
  ]
}
```

**Error Response:**
```json
{
  "success": false,
  "sessionId": "abc-123-def-456",
  "message": "ETL transformation failed",
  "error": "Python script error details",
  "logs": ["[STDERR] Error message"]
}
```

### GET /api/admin/etl/sessions

List all ETL processing sessions for community.

**Response:**
```json
{
  "sessions": [
    {
      "id": "session-id",
      "session_id": "abc-123",
      "uploaded_by": "user-id",
      "input_files": ["expense_123.csv", "receipt_456.xlsx"],
      "output_files": ["transactions.csv", "transactions.xlsx"],
      "status": "completed",
      "error_message": null,
      "created_at": "2025-01-15T10:30:00Z",
      "completed_at": "2025-01-15T10:35:00Z"
    }
  ]
}
```

### GET /api/admin/etl/sessions/:sessionId

Get details for specific ETL session.

### GET /api/admin/etl/output-files

Get list of available output files in ETL/output directory.

---

## Error Handling

### Row-Level Error Handling

Each transaction row is processed with a SAVEPOINT:
- If row insert fails, it's rolled back but doesn't abort batch
- Error recorded in `import_staging` table
- Import batch status becomes "partial" if some rows fail
- Users can review and retry failed rows

### Transaction Rollback Strategy

```typescript
await c.query("SAVEPOINT row_sp");
try {
  // Insert row
  await c.query("RELEASE SAVEPOINT row_sp");
  inserted++;
} catch (e) {
  await c.query("ROLLBACK TO SAVEPOINT row_sp");
  // Record error
  failed++;
}
```

### Audit Logging

All ETL operations are logged:
```sql
SELECT * FROM audit_log 
WHERE entity = 'etl_session'
ORDER BY created_at DESC;
```

---

## Directory Structure

```
ETL/
├── input/                      # Uploaded files
│   ├── expense_2025_01_15.csv
│   └── receipt_2025_01_15.xlsx
│
├── processed/                  # Files after processing
│   ├── expense_2025_01_15.csv  (moved from input)
│   └── receipt_2025_01_15.xlsx
│
├── output/                     # Generated files
│   ├── transactions.csv        # Final import file
│   ├── transactions.xlsx
│   └── unmapped_items.csv      # Items without mapping
│
├── config/
│   └── mapping.yaml            # Category and vendor mappings
│
├── transform.py                # Main transformation script
├── requirements.txt
└── README.md
```

---

## Performance Considerations

### Processing Time

- **Small files** (<1000 rows): ~2-5 seconds
- **Medium files** (1000-10000 rows): ~5-15 seconds
- **Large files** (>10000 rows): ~15-60 seconds

Times include:
- File read/parse
- Python transformation
- Database import (with validation)

### Resource Requirements

- **Memory**: ~100-500MB for typical processing
- **Disk**: Files stored temporarily, moved after processing
- **CPU**: Single-threaded Python process

### Optimization Tips

1. **Split large files** - Process files in batches
2. **Update mapping.yaml** - Reduces manual fixes after import
3. **Pre-validate CSV** - Ensure correct format and encoding
4. **Clean old files** - Run cleanup periodically

---

## Maintenance

### Cleanup Old Files

Backend includes automatic cleanup:
```typescript
// Remove files older than 7 days
await cleanupOldFiles(7);
```

**Manual cleanup:**
```bash
# Remove files older than 30 days
find ETL/input ETL/processed -mtime +30 -delete
```

### Database Maintenance

```sql
-- Archive old ETL sessions (older than 90 days)
DELETE FROM etl_sessions 
WHERE created_at < NOW() - INTERVAL '90 days';

-- Clean up orphaned import_staging rows
DELETE FROM import_staging 
WHERE batch_id NOT IN (SELECT id FROM import_batches);
```

---

## Integration Points

### With Existing Features

1. **Import Batches** - Creates `import_batches` records
2. **Transactions** - Auto-creates from transformed CSV
3. **Categories/Vendors** - Auto-created or matched
4. **Audit Log** - Records all ETL operations
5. **Rollups** - Refreshed after import

### Connecting to Other Systems

**To send to external system after import:**

1. Add webhook in `admin.etl.ts` after successful import
2. Call external API with transaction data
3. Log response in audit trail

**Example:**
```typescript
if (result.success && externalSyncEnabled) {
  await notifyExternalSystem({
    sessionId,
    importBatchId,
    transactionCount: inserted,
  });
}
```

---

## Development

### Adding New File Types

1. Add type to `KIND` enum in `admin.etl.ts`
2. Add validation in route handler
3. Add UI button in `admin.etl.tsx`
4. Update transform.py to handle type

### Extending Transform Pipeline

1. Create new Python function in `transform.py`
2. Call from main transform flow
3. Update logging in `etl.ts`
4. Test with sample files

### Testing ETL

```bash
# Manual Python test
cd ETL
python transform.py

# API test
curl -X POST http://localhost:4000/api/admin/etl/upload \
  -H "Authorization: Bearer {token}" \
  -F "expense=@test.csv"

# Verify database import
psql -U postgres -d finance_db -c \
  "SELECT COUNT(*) FROM transactions WHERE source_ref LIKE 'etl%';"
```

---

## Troubleshooting Common Issues

### Python Script Not Found
```
Error: "Failed to spawn Python process"
```
**Solution:** Ensure `transform.py` exists in ETL directory
```bash
ls -la ETL/transform.py
```

### File Size Exceeds Limit
```
Error: "exceeds max size of 10MB"
```
**Solution:** Split files or increase limit in backend
```typescript
// In server.ts
multipart: { limits: { fileSize: 50 * 1024 * 1024 } }
```

### Import Fails with Permission Error
```
Error: "PERMISSION DENIED" on ETL/input
```
**Solution:** Fix directory permissions
```bash
chmod -R 755 ETL/
chmod -R 777 ETL/input ETL/output
```

### Transform Script Times Out
```
Error: "Python process closed unexpectedly"
```
**Solution:** Increase timeout or optimize script
```typescript
// Set timeout in etl.ts
const timeout = setTimeout(() => python.kill(), 120000); // 2 minutes
```

---

## Support and Questions

For issues or questions:
1. Check logs: `docker compose logs backend`
2. Review mapping.yaml configuration
3. Verify CSV file structure
4. Check database permissions
5. See troubleshooting section above

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-01-15 | Initial ETL integration |


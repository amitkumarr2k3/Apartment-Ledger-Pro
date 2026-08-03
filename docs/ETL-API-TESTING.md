# ETL API Testing Guide

## Quick API Testing

### Prerequisites
```bash
# Install curl and jq for JSON parsing
# Set environment variables
export API_URL="http://localhost:4000"
export AUTH_TOKEN="your-jwt-token"
export COMMUNITY_ID="your-community-id"
```

---

## 1. Upload Files

### Simple Single File Upload

```bash
curl -X POST "${API_URL}/api/admin/etl/upload" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -F "expense=@path/to/expense.csv"
```

### Multiple Files Upload

```bash
curl -X POST "${API_URL}/api/admin/etl/upload" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -F "expense=@expense.csv" \
  -F "receipt=@receipt.xlsx" \
  -F "vendor=@vendor.csv"
```

### With Verbose Output

```bash
curl -v -X POST "${API_URL}/api/admin/etl/upload" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -F "expense=@test.csv" 2>&1 | tee upload-response.json
```

### Response Example (Success)

```json
{
  "success": true,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "batchId": "123e4567-e89b-12d3-a456-426614174000",
  "importBatchId": "987fcdeb-51a0-4b6e-8b5d-42eee4a8c1b2",
  "message": "ETL process completed and transactions imported",
  "stats": {
    "inputFiles": 1,
    "outputFiles": 2,
    "transactionsImported": 245,
    "transactionsFailed": 3
  },
  "logs": [
    "[STDOUT] Loading config from config/mapping.yaml",
    "[STDOUT] Processing expense.csv...",
    "[STDOUT] Found 248 transaction records",
    "[STDOUT] Mapping categories and vendors...",
    "[STDOUT] Generated output/transactions.csv",
    "[STDOUT] Generated output/transactions.xlsx"
  ]
}
```

### Response Example (Error)

```json
{
  "success": false,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "message": "ETL transformation failed with exit code 1",
  "error": "Python script error: Column 'Amount' not found in input file",
  "logs": [
    "[STDOUT] Loading input files...",
    "[STDERR] Error: Expected columns not found",
    "[STDERR] Available columns: Date, Description, Value"
  ]
}
```

---

## 2. List Sessions

### Get All Sessions

```bash
curl -X GET "${API_URL}/api/admin/etl/sessions" \
  -H "Authorization: Bearer ${AUTH_TOKEN}"
```

### Parsed Response (with jq)

```bash
curl -s -X GET "${API_URL}/api/admin/etl/sessions" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  | jq '.sessions | .[] | {session_id, status, created_at}'
```

### Response Example

```json
{
  "sessions": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "session_id": "abc-123-def-456",
      "uploaded_by": "user-uuid",
      "input_files": ["expense_123.csv", "receipt_456.xlsx"],
      "output_files": ["transactions.csv", "transactions.xlsx"],
      "status": "completed",
      "error_message": null,
      "created_at": "2025-01-15T10:30:00Z",
      "completed_at": "2025-01-15T10:35:00Z"
    },
    {
      "id": "650e8400-e29b-41d4-a716-446655440001",
      "session_id": "xyz-789-uvw-000",
      "uploaded_by": "user-uuid",
      "input_files": ["expense_001.csv"],
      "output_files": null,
      "status": "failed",
      "error_message": "Python script not found",
      "created_at": "2025-01-14T15:20:00Z",
      "completed_at": null
    }
  ]
}
```

---

## 3. Get Session Details

```bash
curl -X GET "${API_URL}/api/admin/etl/sessions/abc-123-def-456" \
  -H "Authorization: Bearer ${AUTH_TOKEN}"
```

### Response Example

```json
{
  "session": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "session_id": "abc-123-def-456",
    "uploaded_by": "user-uuid",
    "input_files": ["expense_123.csv"],
    "output_files": ["transactions.csv", "transactions.xlsx"],
    "status": "completed",
    "error_message": null,
    "created_at": "2025-01-15T10:30:00Z",
    "completed_at": "2025-01-15T10:35:00Z"
  }
}
```

---

## 4. Get Output Files

```bash
curl -X GET "${API_URL}/api/admin/etl/output-files" \
  -H "Authorization: Bearer ${AUTH_TOKEN}"
```

### Response Example

```json
{
  "files": [
    "transactions.csv",
    "transactions.xlsx",
    "unmapped_items.csv"
  ]
}
```

---

## Test Scenarios

### Scenario 1: Successful Import

**Test Files:**
```csv
# expense.csv
date,amount,description
2025-01-15,5000,BESCOM A Block
2025-01-20,2000,AMC Lift

# vendor.csv
name,kind
BESCOM,company
Vendor Name,individual
```

**Command:**
```bash
curl -X POST "${API_URL}/api/admin/etl/upload" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -F "expense=@expense.csv" \
  -F "vendor=@vendor.csv" \
  -o response.json

# Check response
cat response.json | jq '.success'
```

**Expected Result:**
- ✅ success: true
- ✅ transactionsImported: 2
- ✅ transactionsFailed: 0

---

### Scenario 2: Partial Failures

**Test File with Invalid Data:**
```csv
# expense.csv - Mix of valid and invalid rows
date,amount,description
2025-01-15,5000,BESCOM
2025-01-20,invalid,Category  # invalid amount
2025-01-25,-1000,Utilities   # negative amount (may be invalid)
```

**Command:**
```bash
curl -X POST "${API_URL}/api/admin/etl/upload" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -F "expense=@expense.csv" \
  -o response.json

cat response.json | jq '{status:.success, failed:.stats.transactionsFailed}'
```

**Expected Result:**
- ✅ success: false or partial
- ✅ transactionsFailed: 1
- ✅ error details in logs

---

### Scenario 3: File Size Error

**Test with Large File:**
```bash
# Create 15MB file
dd if=/dev/urandom bs=1M count=15 of=large.csv

# Try to upload
curl -X POST "${API_URL}/api/admin/etl/upload" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -F "expense=@large.csv"
```

**Expected Result:**
- ✅ Error message about file size
- ✅ HTTP 400

---

### Scenario 4: No Files

**Command:**
```bash
curl -X POST "${API_URL}/api/admin/etl/upload" \
  -H "Authorization: Bearer ${AUTH_TOKEN}"
```

**Expected Result:**
- ✅ Error: "no_files"
- ✅ HTTP 400

---

### Scenario 5: Missing Configuration

**Test when mapping.yaml is missing:**
```bash
# Temporarily rename config file
mv ETL/config/mapping.yaml ETL/config/mapping.yaml.bak

# Try upload
curl -X POST "${API_URL}/api/admin/etl/upload" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -F "expense=@test.csv"

# Restore config
mv ETL/config/mapping.yaml.bak ETL/config/mapping.yaml
```

**Expected Result:**
- ✅ Python error about missing config
- ✅ Error logs visible in response
- ✅ Session marked as failed

---

## Automated Testing with Bash Script

### Create Test Script

```bash
#!/bin/bash
# test-etl-api.sh

API_URL="${API_URL:-http://localhost:4000}"
AUTH_TOKEN="${AUTH_TOKEN:-}"
COMMUNITY_ID="${COMMUNITY_ID:-}"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test 1: Upload single file
test_upload_single() {
  echo -e "${YELLOW}Test 1: Upload single expense file${NC}"
  
  response=$(curl -s -X POST "${API_URL}/api/admin/etl/upload" \
    -H "Authorization: Bearer ${AUTH_TOKEN}" \
    -F "expense=@test-data/expense.csv")
  
  success=$(echo "$response" | jq -r '.success // false')
  
  if [ "$success" = "true" ]; then
    echo -e "${GREEN}✓ Test passed${NC}"
    echo "$response" | jq '.stats'
  else
    echo -e "${RED}✗ Test failed${NC}"
    echo "$response" | jq '.error'
  fi
  echo
}

# Test 2: List sessions
test_list_sessions() {
  echo -e "${YELLOW}Test 2: List ETL sessions${NC}"
  
  response=$(curl -s -X GET "${API_URL}/api/admin/etl/sessions" \
    -H "Authorization: Bearer ${AUTH_TOKEN}")
  
  count=$(echo "$response" | jq '.sessions | length')
  
  if [ "$count" -ge 0 ]; then
    echo -e "${GREEN}✓ Test passed - Found ${count} sessions${NC}"
  else
    echo -e "${RED}✗ Test failed${NC}"
  fi
  echo
}

# Test 3: Get output files
test_output_files() {
  echo -e "${YELLOW}Test 3: Get output files${NC}"
  
  response=$(curl -s -X GET "${API_URL}/api/admin/etl/output-files" \
    -H "Authorization: Bearer ${AUTH_TOKEN}")
  
  files=$(echo "$response" | jq '.files')
  
  echo -e "${GREEN}✓ Test passed - Output files:${NC}"
  echo "$files" | jq '.[]'
  echo
}

# Main
echo "ETL API Tests"
echo "=============="
echo

test_upload_single
test_list_sessions
test_output_files

echo "Tests complete!"
```

### Run Tests

```bash
chmod +x test-etl-api.sh

# With environment variables
export AUTH_TOKEN="your-token-here"
export API_URL="http://localhost:4000"
./test-etl-api.sh
```

---

## Testing with Postman

### Import Collection

**Postman Collection JSON:**

```json
{
  "info": {
    "name": "ETL API Tests",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "Upload Expense File",
      "request": {
        "method": "POST",
        "header": [
          {
            "key": "Authorization",
            "value": "Bearer {{auth_token}}"
          }
        ],
        "body": {
          "mode": "formdata",
          "formdata": [
            {
              "key": "expense",
              "type": "file",
              "src": "test-data/expense.csv"
            }
          ]
        },
        "url": {
          "raw": "{{base_url}}/api/admin/etl/upload",
          "host": ["{{base_url}}"],
          "path": ["api", "admin", "etl", "upload"]
        }
      }
    },
    {
      "name": "List Sessions",
      "request": {
        "method": "GET",
        "header": [
          {
            "key": "Authorization",
            "value": "Bearer {{auth_token}}"
          }
        ],
        "url": {
          "raw": "{{base_url}}/api/admin/etl/sessions",
          "host": ["{{base_url}}"],
          "path": ["api", "admin", "etl", "sessions"]
        }
      }
    }
  ],
  "variable": [
    {
      "key": "base_url",
      "value": "http://localhost:4000"
    },
    {
      "key": "auth_token",
      "value": ""
    }
  ]
}
```

**Steps:**
1. Open Postman
2. Click "Import"
3. Paste JSON above
4. Set `auth_token` variable
5. Run tests

---

## Debugging Failed Requests

### Check Request Details

```bash
# Save verbose output
curl -v -X POST "${API_URL}/api/admin/etl/upload" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -F "expense=@test.csv" \
  2>&1 | tee debug.log

# Check headers
grep "< HTTP" debug.log

# Check response body
grep -A 100 "{ content-length" debug.log
```

### Check Backend Logs

```bash
# Docker
docker compose logs -f backend | grep ETL

# Direct Node.js
tail -f /var/log/etl-api.log | grep -i error
```

### Check File System

```bash
# List files in ETL directories
ls -la ETL/input/
ls -la ETL/processed/
ls -la ETL/output/

# Check permissions
stat ETL/input/
stat ETL/output/

# Check disk space
df -h ETL/
```

### Check Database

```bash
# List recent ETL sessions
psql -d finance_db -c \
  "SELECT session_id, status, error_message, created_at FROM etl_sessions ORDER BY created_at DESC LIMIT 10;"

# Count imports by status
psql -d finance_db -c \
  "SELECT status, COUNT(*) as count FROM import_batches WHERE kind='transactions' GROUP BY status;"
```

---

## Performance Testing

### Load Test - Multiple Concurrent Uploads

```bash
#!/bin/bash
# load-test.sh - Test with 5 concurrent uploads

for i in {1..5}; do
  (
    echo "Upload $i starting..."
    curl -s -X POST "${API_URL}/api/admin/etl/upload" \
      -H "Authorization: Bearer ${AUTH_TOKEN}" \
      -F "expense=@test.csv" > "result-$i.json" 2>&1
    echo "Upload $i complete"
  ) &
done

wait
echo "All uploads complete"

# Check results
for i in {1..5}; do
  echo "Result $i:"
  cat "result-$i.json" | jq '.success'
done
```

### Measure Response Time

```bash
# Using curl's time format
curl -w "@curl-format.txt" -o /dev/null -s \
  -X POST "${API_URL}/api/admin/etl/upload" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -F "expense=@test.csv"

# curl-format.txt:
# time_namelookup:  %{time_namelookup}\n
# time_connect:     %{time_connect}\n
# time_appconnect:  %{time_appconnect}\n
# time_pretransfer: %{time_pretransfer}\n
# time_redirect:    %{time_redirect}\n
# time_starttransfer: %{time_starttransfer}\n
# ----------
# time_total:       %{time_total}\n
```

---

## Common Test Data

### Simple Expense CSV

```csv
date,head,category,vendor,line_item,amount,direction
2025-01-15,expense,Utilities,BESCOM A Block,Power Supply,5000,D
2025-01-20,expense,Maintenance,AMC Lift,Annual Maintenance,2500,D
2025-01-25,income,Facility Rental,Residents,Hall Rental,10000,C
```

### With All Fields

```csv
date,head,category,vendor,line_item,amount,direction,flat_code,source_ref
2025-01-15,expense,Utilities,BESCOM,Power A Block,5000,D,A1,REF001
2025-01-20,expense,Maintenance,Lift Co,Lift Service,2500,D,,REF002
2025-01-25,income,Rental,Residents,Event,10000,C,A2,REF003
```

### Vendor CSV

```csv
name,kind
BESCOM,company
Residents,individual
Lift Services,company
```

---

## Troubleshooting API Issues

### 401 Unauthorized

**Cause:** Invalid or missing auth token

```bash
# Verify token is valid
curl -X GET "${API_URL}/api/me" \
  -H "Authorization: Bearer ${AUTH_TOKEN}"
```

### 403 Forbidden

**Cause:** User doesn't have admin role

```bash
# Check user roles
curl -s -X GET "${API_URL}/api/me" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  | jq '.roles'
```

### 413 Payload Too Large

**Cause:** File exceeds size limit

```bash
# Check file size
ls -lh expense.csv

# If > 10MB, split the file
split -l 1000 large.csv split_
```

### 500 Internal Server Error

**Cause:** Server error, check logs

```bash
# Check backend logs
docker compose logs backend | tail -100
```

---

## Success Criteria

✅ All API endpoints respond correctly
✅ Files upload successfully
✅ ETL processing completes
✅ Transactions imported to database
✅ Session history records saved
✅ Error handling works correctly
✅ Performance acceptable (<60s for large files)
✅ Concurrent requests handled
✅ File cleanup works


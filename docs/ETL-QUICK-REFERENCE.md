# ETL Integration - Quick Reference Card

## 🎯 What is This?
Automated ETL processing integrated into your app. Upload expense, receipt, and vendor files from the web UI. They're automatically processed and imported into the database.

---

## 🚀 Quick Start (2 minutes)

### For Users
1. Go to **Admin → ETL Integration**
2. Click file type button (Expense/Receipt/Vendor)
3. Upload file (drag-drop or click)
4. Click **"Start ETL Process"**
5. Done! View history tab for status

### For Developers
1. Start backend: `npm run dev` (in backend/)
2. Start frontend: `npm run dev` (in root)
3. Go to http://localhost:3000/admin/etl
4. Upload test CSV file
5. Check database for imported transactions

---

## 📁 Key Files

### Backend
| File | Purpose |
|------|---------|
| `backend/src/etl.ts` | Core ETL service |
| `backend/src/routes/admin.etl.ts` | API endpoints |
| `backend/db/migrations/0005_etl.sql` | Database schema |

### Frontend
| File | Purpose |
|------|---------|
| `src/routes/admin.etl.tsx` | Admin ETL page |
| `src/components/file-upload-zone.tsx` | Upload components |

### Configuration
| File | Purpose |
|------|---------|
| `ETL/config/mapping.yaml` | Category/vendor mappings |
| `ETL/transform.py` | Python processing script |

---

## 🔌 API Endpoints

```
POST   /api/admin/etl/upload             Upload files
GET    /api/admin/etl/sessions           List sessions
GET    /api/admin/etl/sessions/:id       Get session
GET    /api/admin/etl/output-files       List outputs
```

### Upload Example
```bash
curl -X POST http://localhost:4000/api/admin/etl/upload \
  -H "Authorization: Bearer {token}" \
  -F "expense=@expense.csv" \
  -F "receipt=@receipt.xlsx"
```

---

## 📊 Database Changes

**New Table:** `etl_sessions`
```sql
- id (UUID primary key)
- community_id (foreign key)
- session_id (text, unique)
- uploaded_by (foreign key to users)
- input_files (jsonb)
- output_files (jsonb)
- status (text: processing|completed|failed)
- error_message (text)
- created_at, completed_at (timestamps)
```

**Run Migration:**
```bash
npm run migrate
```

---

## 🔄 Processing Pipeline

```
Files Uploaded
    ↓
Save to ETL/input/
    ↓
Python transform.py processes
(uses config/mapping.yaml)
    ↓
Files → ETL/processed/
Output → ETL/output/
    ↓
Read output CSV
    ↓
Auto-import to database
    ↓
Record session
    ↓
Audit log entry
```

**Time:** Usually 5-60 seconds depending on file size

---

## ⚙️ Configuration

### Update Category Mappings

Edit `ETL/config/mapping.yaml`:

```yaml
expense_categories:
  Utilities:
    - BESCOM A Block
    - Water Supply
  Maintenance:
    - AMC Lift
```

Changes apply to next upload.

### Adjust File Size Limit

In `backend/src/server.ts`:
```typescript
multipart: { limits: { fileSize: 50 * 1024 * 1024 } }  // 50MB
```

---

## 🧪 Quick Test

### Test with Sample CSV
```csv
date,head,category,vendor,line_item,amount,direction
2025-01-15,expense,Utilities,BESCOM,Power,5000,D
2025-01-20,income,Rental,Residents,Hall,10000,C
```

### Upload and Verify
1. Upload file via UI
2. Check database:
   ```sql
   SELECT * FROM transactions 
   WHERE source_ref LIKE 'etl%'
   LIMIT 10;
   ```

---

## 🐛 Quick Troubleshooting

| Issue | Fix |
|-------|-----|
| "Python not found" | Ensure Python 3.8+ installed |
| "File too large" | Split file or increase limit |
| "Column not found" | Check CSV headers match schema |
| "No transactions imported" | Check mapping.yaml config |
| "Permission denied" | Fix ETL/ directory permissions: `chmod 755 ETL/` |

---

## 📚 Documentation Files

| File | Purpose | Read Time |
|------|---------|-----------|
| **ETL-INDEX.md** | Navigation guide | 5 min |
| **ETL-SUMMARY.md** | Overview | 10 min |
| **ETL-QUICK-START.md** | User guide | 15 min |
| **ETL-INTEGRATION.md** | Complete reference | 40 min |
| **ETL-ARCHITECTURE.md** | Diagrams | 20 min |
| **ETL-API-TESTING.md** | Testing guide | 30 min |
| **ETL-IMPLEMENTATION-CHECKLIST.md** | Checklist | 20 min |

**Start with:** ETL-INDEX.md

---

## 🔐 Security

- ✅ Authentication required (JWT token)
- ✅ Authorization required (Admin/Superadmin role)
- ✅ Audit logging of all operations
- ✅ File permissions enforced
- ✅ SAVEPOINT rollback on errors

---

## 🚀 Deploy Checklist

- [ ] Run migrations: `npm run migrate`
- [ ] Deploy backend
- [ ] Deploy frontend
- [ ] Test file upload
- [ ] Verify transactions imported
- [ ] Monitor logs
- [ ] Update team documentation

---

## 📞 Common Questions

**Q: Can I upload multiple files at once?**
A: Yes, one of each type (expense, receipt, vendor)

**Q: What happens if import fails?**
A: Partial rows imported, errors logged in `import_staging` table

**Q: How long does processing take?**
A: 5-60 seconds depending on file size

**Q: Where are files stored?**
A: `ETL/input/`, moved to `ETL/processed/`, output in `ETL/output/`

**Q: Can I customize categories?**
A: Yes, edit `ETL/config/mapping.yaml`

**Q: Is this production ready?**
A: Yes, fully implemented and documented

---

## 🎯 Key Takeaways

✅ Automated ETL processing from web UI
✅ Supports expense, receipt, vendor files
✅ Auto-imports to database
✅ Full error handling & recovery
✅ Audit logging included
✅ Production ready
✅ Comprehensively documented

---

## 🔗 Related Files

- **Admin ETL Page:** `src/routes/admin.etl.tsx`
- **Upload Components:** `src/components/file-upload-zone.tsx`
- **API Routes:** `backend/src/routes/admin.etl.ts`
- **ETL Service:** `backend/src/etl.ts`
- **Python Script:** `ETL/transform.py`
- **Config File:** `ETL/config/mapping.yaml`

---

## 📋 Feature Matrix

| Feature | Status |
|---------|--------|
| Upload UI | ✅ Complete |
| File validation | ✅ Complete |
| Python integration | ✅ Complete |
| Auto-import | ✅ Complete |
| Error handling | ✅ Complete |
| Audit logging | ✅ Complete |
| Session tracking | ✅ Complete |
| Configuration | ✅ Complete |
| Documentation | ✅ Complete |
| Testing guide | ✅ Complete |
| API endpoints | ✅ Complete |
| Database schema | ✅ Complete |

---

## ⏱️ Timeline

- **Setup:** 2 min (with npm run dev)
- **First upload:** 5 min
- **Verify import:** 2 min
- **Total first-time:** ~10 minutes

---

## 🎓 Learning Order

1. **Users:** ETL-QUICK-START.md
2. **Developers:** ETL-SUMMARY.md → ETL-ARCHITECTURE.md → code
3. **Admins:** ETL-SUMMARY.md → ETL-INTEGRATION.md
4. **QA:** ETL-API-TESTING.md → ETL-IMPLEMENTATION-CHECKLIST.md

---

**Print this card or bookmark ETL-INDEX.md for quick reference!** 📌


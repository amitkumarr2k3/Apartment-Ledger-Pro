# ETL Quick Start Guide

## What is ETL Integration?

Upload expense, receipt, and vendor files directly from the web interface. The system automatically processes them and imports the data into your database.

**No more:**
- Manual file copying to input folders
- Running scripts from command line
- Manually uploading CSV files

**Now:**
- Single upload interface
- Automatic processing
- Instant data import

---

## How to Use

### 1. Navigate to ETL Page

1. Log in as **Admin** or **Superadmin**
2. Go to **Admin Menu → ETL Integration**

### 2. Upload Files

**For each file type:**
1. Click the file type button:
   - 📊 **Expense** - Expense Analysis
   - 📄 **Receipt** - Receipt Analysis  
   - 🏢 **Vendor** - Vendor List
2. Select or drag-drop your file
3. Repeat for other file types (optional)

**Supported formats:** CSV, XLS, XLSX (max 10MB each)

### 3. Start Processing

1. Click **"Start ETL Process"** button
2. Wait for processing to complete
3. See results with import statistics

### 4. Review History

1. Click **"Processing History"** tab
2. View all previous uploads and their status
3. Check for any errors

---

## File Requirements

### Expense File
- Contains expense data from your accounting system
- Expected columns depend on your source
- Will be transformed to standard format

### Receipt File
- Contains receipt/income data
- Same flexible schema
- Auto-mapped to categories

### Vendor File
- Contains vendor information
- Columns: vendor name, type (company/individual)
- Auto-creates vendors in system

**Note:** Exact column names handled by config. See mapping.yaml in ETL folder.

---

## Common Questions

### Q: What happens to my uploaded files?
**A:** 
1. Saved to `ETL/input/` during processing
2. Moved to `ETL/processed/` after completion
3. Can be deleted after import (handled by cleanup)

### Q: Can I upload multiple files at once?
**A:** Yes! You can upload one file of each type (expense, receipt, vendor) in a single batch.

### Q: What if there are errors?
**A:** 
- System logs errors for individual rows
- Check the "Processing History" for details
- Review error logs in admin panel
- See documentation for troubleshooting

### Q: How long does processing take?
**A:**
- Small files (< 1000 rows): ~2-5 seconds
- Medium files (1000-10000 rows): ~5-15 seconds
- Large files (> 10000 rows): ~15-60 seconds

### Q: Can I retry a failed upload?
**A:** Yes, simply upload the file again. Each upload is a separate session.

### Q: Where does my data go?
**A:** 
1. Transformed to standard transaction format
2. Automatically imported into database
3. Available in Reports and Analysis sections
4. Searchable in Transactions view

### Q: How do I update category mappings?
**A:** 
1. Edit `ETL/config/mapping.yaml`
2. Add/modify category names
3. Re-upload files for new mappings to apply

---

## Workflow Example

### Scenario: Monthly Closing Process

**Day 1 - Extract**
- Export Expense Analysis from accounting system
- Export Receipt Analysis from accounting system
- Prepare vendor list (if updated)

**Day 1 - Upload**
1. Go to Admin → ETL Integration
2. Upload all three files
3. Review results (should show "completed" status)

**Day 1 - Review**
1. Check "Processing History" for any errors
2. Navigate to Transactions to verify data
3. If errors, check mapping in ETL/config/mapping.yaml

**Day 2 - Analysis**
- Use Reports to analyze monthly financials
- All data already imported and available
- No manual data entry needed

---

## Tips & Best Practices

### Before Uploading

- ✅ Verify CSV encoding is UTF-8
- ✅ Check file is not corrupted
- ✅ Ensure all required columns present
- ✅ Remove any test data rows
- ✅ Save backup of original files

### During Upload

- ⏳ Don't close browser tab during processing
- 📵 Keep internet connection stable
- 🔄 Refresh page if stuck (safe, won't re-upload)

### After Upload

- 📋 Review "Processing History" tab
- ✓ Spot-check transactions in main view
- 🔍 Search for specific vendors/categories
- 📊 Run reports to verify data

### Maintenance

- 🧹 Old files cleaned automatically after 7 days
- 📦 Keep backup of uploaded files (manual backup)
- 📝 Document any mapping changes
- 🔄 Test new file formats before bulk import

---

## Troubleshooting

### Upload Fails Immediately

**Issue:** "no_files" error
- **Fix:** Ensure at least one file is selected

**Issue:** File size error
- **Fix:** File exceeds 10MB, split into smaller batches

**Issue:** "Upload failed" with no details
- **Fix:** Check internet connection, try again

### Processing Completes But Shows Errors

**Issue:** Some transactions imported, some failed
- **Fix:** This is normal for partial failures. Check the error log for details.
- **How:** Look at row numbers and error messages in "Processing History"

**Issue:** No transactions imported (all failed)
- **Fix:** File format doesn't match expected schema
- **How:** 
  1. Check column names in CSV
  2. Verify mapping.yaml has your categories
  3. Contact admin if configuration is wrong

### Can't Find ETL Page

**Issue:** No "ETL Integration" in Admin menu
- **Fix:** You must have Admin or Superadmin role
- **How:** Ask your admin to grant access

---

## Support

If you encounter issues:

1. **Check this guide** - Most issues covered above
2. **Review Processing History** - See error details
3. **Check ETL documentation** - See `/docs/ETL-INTEGRATION.md`
4. **Contact Admin** - They can check server logs

---

## Next Steps

- Ready to upload? Go to Admin → ETL Integration
- Need help with file format? See detailed documentation
- Want to customize mappings? Edit ETL/config/mapping.yaml
- Have feedback? Contact your admin


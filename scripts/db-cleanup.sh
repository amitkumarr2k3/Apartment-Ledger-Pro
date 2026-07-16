#!/usr/bin/env bash
# Backs up the Postgres volume, then truncates ONLY transaction / activity
# tables — preserving reference data (community, users, allowed_emails,
# roles, flats, heads, categories, vendors, line_items, dashboard_settings,
# import_rules). This way the superadmin login and category structure
# survive; you re-import fresh transactions via CSV or seed.
#
# Usage:
#   scripts/db-cleanup.sh              # backup + prompt + truncate
#   scripts/db-cleanup.sh --yes        # skip confirmation
#   scripts/db-cleanup.sh --backup-only
#   scripts/db-cleanup.sh --no-backup --yes         # danger: truncate w/o backup
#   scripts/db-cleanup.sh --full --yes              # danger: wipe EVERYTHING incl. users
set -euo pipefail

CONFIRM=""
DO_BACKUP=1
DO_TRUNCATE=1
MODE="txn"   # txn (default) | full
for arg in "$@"; do
  case "$arg" in
    --yes)         CONFIRM="--yes" ;;
    --backup-only) DO_TRUNCATE=0 ;;
    --no-backup)   DO_BACKUP=0 ;;
    --full)        MODE="full" ;;
    -h|--help)
      grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
  esac
done

DB_SVC="db"
DB_USER="apf"
DB_NAME="apartment_finance"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="./backups"
BACKUP_FILE="${BACKUP_DIR}/apf-${STAMP}.sql.gz"

if ! docker compose ps --status running "$DB_SVC" >/dev/null 2>&1; then
  echo "[cleanup] starting db service..."
  docker compose up -d "$DB_SVC"
  for i in $(seq 1 30); do
    if docker compose exec -T "$DB_SVC" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi

if [ "$DO_BACKUP" = "1" ]; then
  mkdir -p "$BACKUP_DIR"
  echo "[cleanup] backing up → $BACKUP_FILE"
  docker compose exec -T "$DB_SVC" \
    pg_dump -U "$DB_USER" -d "$DB_NAME" --clean --if-exists --no-owner \
    | gzip > "$BACKUP_FILE"
  ls -lh "$BACKUP_FILE"
fi

if [ "$DO_TRUNCATE" = "0" ]; then
  echo "[cleanup] backup-only mode — done."
  exit 0
fi

if [ "$CONFIRM" != "--yes" ]; then
  echo ""
  if [ "$MODE" = "full" ]; then
    echo "About to TRUNCATE **ALL** application tables (users, superadmin, everything)."
  else
    echo "About to TRUNCATE transaction/activity tables only."
    echo "PRESERVED: communities, users, user_roles, allowed_emails, flats,"
    echo "           heads, categories, vendors, line_items, dashboard_settings, import_rules."
  fi
  read -r -p "Type 'yes' to continue: " reply
  [ "$reply" = "yes" ] || { echo "aborted."; exit 1; }
fi

echo "[cleanup] truncating tables (mode=$MODE)..."

if [ "$MODE" = "full" ]; then
  docker compose exec -T "$DB_SVC" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE stmt text;
BEGIN
  SELECT 'TRUNCATE TABLE ' ||
         string_agg(format('%I.%I', schemaname, tablename), ', ') ||
         ' RESTART IDENTITY CASCADE'
    INTO stmt
    FROM pg_tables
   WHERE schemaname = 'public' AND tablename NOT IN ('schema_migrations','_migrations');
  IF stmt IS NOT NULL THEN
    RAISE NOTICE '%', stmt;
    EXECUTE stmt;
  END IF;
END $$;
REFRESH MATERIALIZED VIEW mv_monthly_totals;
REFRESH MATERIALIZED VIEW mv_category_monthly;
REFRESH MATERIALIZED VIEW mv_vendor_ranking;
SQL
else
  docker compose exec -T "$DB_SVC" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 <<'SQL'
-- Transaction / activity tables + CSV-imported reference data
-- (vendors, line_items, categories, heads — all rebuilt by CSV import).
-- Preserved: communities, users, user_roles, allowed_emails, flats,
--            dashboard_settings, import_rules.
TRUNCATE TABLE
  public.transactions,
  public.collections_dues,
  public.balances,
  public.import_staging,
  public.import_batches,
  public.audit_log,
  public.otp_codes,
  public.periods,
  public.line_items,
  public.categories,
  public.heads,
  public.vendors
RESTART IDENTITY CASCADE;

REFRESH MATERIALIZED VIEW mv_monthly_totals;
REFRESH MATERIALIZED VIEW mv_category_monthly;
REFRESH MATERIALIZED VIEW mv_vendor_ranking;
SQL
fi

docker compose exec -T "$DB_SVC" psql -U "$DB_USER" -d "$DB_NAME" -c \
  "SELECT relname AS table, n_live_tup AS rows FROM pg_stat_user_tables ORDER BY relname;"

echo ""
echo "[cleanup] done."
if [ "$MODE" = "full" ]; then
  echo "  Re-seed dummy data:  docker compose run --rm seed"
else
  echo "  Reference data (superadmin, categories, vendors, flats) preserved."
  echo "  Re-import transactions via Admin → CSV Import, or:"
  echo "     docker compose run --rm seed   # re-seeds transactions if community empty"
fi
echo "  Restore backup instead:"
echo "     gunzip -c $BACKUP_FILE | docker compose exec -T $DB_SVC psql -U $DB_USER -d $DB_NAME"

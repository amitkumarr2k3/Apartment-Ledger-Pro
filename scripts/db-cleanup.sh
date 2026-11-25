#!/usr/bin/env bash
# Backs up the Postgres database, then truncates only the explicitly selected
# tables. Every non-selected table is preserved. Use --full for a full wipe.
#
# Usage:
#   scripts/db-cleanup.sh --tables=transactions              # backup + prompt
#   scripts/db-cleanup.sh --tables=transactions,balances --yes
#   scripts/db-cleanup.sh --backup-only
#   scripts/db-cleanup.sh --no-backup --yes --tables=transactions
#   scripts/db-cleanup.sh --full --yes                       # danger: wipe EVERYTHING
#
# Supported --tables values:
#   transactions, collections_dues, balances, import_staging,
#   import_batches, audit_log, otp_codes, periods, line_items,
#   categories, heads, vendors
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_NAME="$(basename "${BASH_SOURCE[0]}")"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$DEPLOY_DIR"

# Prefer an explicit project, then an existing db container, then the deployment directory.
if [ -z "${COMPOSE_PROJECT_NAME:-}" ]; then
  COMPOSE_PROJECT_NAME="$(docker ps --filter label=com.docker.compose.service=db --format '{{.Label "com.docker.compose.project"}}' 2>/dev/null | awk 'NF' | sort -u | head -n1)"
fi
if [ -z "${COMPOSE_PROJECT_NAME:-}" ]; then
  COMPOSE_PROJECT_NAME="$(docker ps -a --filter label=com.docker.compose.service=db --format '{{.Label "com.docker.compose.project"}}' 2>/dev/null | awk 'NF' | sort -u | head -n1)"
fi
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-deploy}"

CONFIRM=""
DO_BACKUP=1
DO_TRUNCATE=1
MODE="tables"
TABLES=""
for arg in "$@"; do
  case "$arg" in
    --yes)         CONFIRM="--yes" ;;
    --backup-only) DO_TRUNCATE=0 ;;
    --no-backup)   DO_BACKUP=0 ;;
    --full)        MODE="full" ;;
    --tables=*)    TABLES="${arg#--tables=}" ;;
    -h|--help)
      grep -E '^#( |$)' "$SCRIPT_DIR/$SCRIPT_NAME" | sed 's/^# \{0,1\}//'
      exit 0 ;;
  esac
done

if [ "$MODE" = "full" ] && [ -n "$TABLES" ]; then
  echo "[cleanup] --full cannot be combined with --tables." >&2
  exit 1
fi

if [ "$MODE" = "tables" ] && [ "$DO_TRUNCATE" = "1" ] && [ -z "$TABLES" ]; then
  echo "[cleanup] Missing required --tables parameter." >&2
  echo "Example: scripts/db-cleanup.sh --tables=transactions" >&2
  exit 1
fi

SQL_TABLES=""
if [ "$MODE" = "tables" ]; then
  IFS=',' read -r -a requested_tables <<< "$TABLES"
  for table in "${requested_tables[@]}"; do
    case "$table" in
      transactions|collections_dues|balances|import_staging|import_batches|audit_log|otp_codes|periods|line_items|categories|heads|vendors)
        if [ -n "$SQL_TABLES" ]; then SQL_TABLES+=", "; fi
        SQL_TABLES+="public.$table"
        ;;
      *)
        echo "[cleanup] Unsupported table: $table" >&2
        echo "Supported: transactions, collections_dues, balances, import_staging, import_batches, audit_log, otp_codes, periods, line_items, categories, heads, vendors" >&2
        exit 1
        ;;
    esac
  done
fi

DB_SVC="db"
DB_USER="apf"
DB_NAME="apartment_finance"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$SCRIPT_DIR/backups"
BACKUP_FILE="${BACKUP_DIR}/apf-${STAMP}.sql.gz"

echo "[cleanup] using Compose project '$COMPOSE_PROJECT_NAME'; starting db service if needed..."
docker compose up -d "$DB_SVC"
DB_READY=0
for i in $(seq 1 30); do
  if docker compose exec -T "$DB_SVC" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
    DB_READY=1
    break
  fi
  sleep 1
done

if [ "$DB_READY" != "1" ]; then
  echo "[cleanup] database service did not become ready; inspect with: docker compose ps db" >&2
  exit 1
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
    echo "About to TRUNCATE explicitly selected tables: $TABLES"
    echo "All other tables will be preserved."
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
  docker compose exec -T "$DB_SVC" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 <<SQL
TRUNCATE TABLE $SQL_TABLES RESTART IDENTITY CASCADE;

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
  echo "  Selected tables cleared: $TABLES"
  echo "  Other tables were preserved."
fi
echo "  Restore backup instead:"
echo "     cd $DEPLOY_DIR && gunzip -c $BACKUP_FILE | docker compose exec -T $DB_SVC psql -U $DB_USER -d $DB_NAME"

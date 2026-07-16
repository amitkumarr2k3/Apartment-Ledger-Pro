#!/usr/bin/env bash
# Docker-compose smoke test.
# Verifies:
#   1. API liveness   (GET /health)
#   2. API readiness  (GET /ready — with exponential backoff until DB + migrations are ready)
#   3. Web liveness   (GET /health via nginx)
#   4. Web SPA shell  (GET / returns HTML)
#   5. Nginx → API proxy (GET /api/... through the web container hits the API)
#
# On any failure, dumps recent docker compose logs for api/web/db/migrate.
#
# Usage:
#   ./scripts/smoke-test.sh
#   API_URL=http://localhost:4010 WEB_URL=http://localhost:8090 ./scripts/smoke-test.sh
#   TIMEOUT=180 READY_TIMEOUT=240 LOG_LINES=200 ./scripts/smoke-test.sh
set -uo pipefail

API_URL="${API_URL:-http://localhost:4010}"
WEB_URL="${WEB_URL:-http://localhost:8090}"
TIMEOUT="${TIMEOUT:-60}"                # per-endpoint liveness wait
READY_TIMEOUT="${READY_TIMEOUT:-180}"   # /ready backoff budget (DB + migrations)
LOG_LINES="${LOG_LINES:-100}"
COMPOSE="${COMPOSE:-docker compose}"

RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; NC=$'\033[0m'
pass() { echo "${GREEN}PASS${NC} $1"; }
info() { echo "${YELLOW}...${NC}  $1"; }

dump_logs() {
  echo ""
  echo "${YELLOW}== docker compose ps ==${NC}"
  $COMPOSE ps || true
  for svc in api web db migrate; do
    echo ""
    echo "${YELLOW}== last ${LOG_LINES} lines: ${svc} ==${NC}"
    $COMPOSE logs --tail="${LOG_LINES}" --no-color "$svc" 2>&1 || true
  done
}

fail() {
  echo "${RED}FAIL${NC} $1"
  dump_logs
  exit 1
}

wait_for() {
  local url="$1" expected="$2" name="$3" follow="${4:-no}"
  info "waiting for $name at $url (up to ${TIMEOUT}s, follow=$follow)"
  local elapsed=0 code="000" curl_opts="-s"
  [ "$follow" = "follow" ] && curl_opts="-sL"
  while [ $elapsed -lt "$TIMEOUT" ]; do
    code=$(curl $curl_opts -o /dev/null -w "%{http_code}" "$url" || echo "000")
    if [ "$code" = "$expected" ]; then
      pass "$name responded $code"
      return 0
    fi
    sleep 2; elapsed=$((elapsed + 2))
  done
  fail "$name never returned $expected (last=$code)"
}

# ------------------------------------------------------------------
# JSON field extraction — tries jq, then python3, then grep/sed.
# Usage: json_get "<json>" "<dotted.path>"
#   e.g. json_get "$body" "checks.migrations.applied"
# Returns empty string when the field is absent.
# ------------------------------------------------------------------
JSON_BACKEND=""
_detect_json_backend() {
  if command -v jq >/dev/null 2>&1; then JSON_BACKEND="jq"
  elif command -v python3 >/dev/null 2>&1; then JSON_BACKEND="python3"
  elif command -v python  >/dev/null 2>&1; then JSON_BACKEND="python"
  else JSON_BACKEND="grep"
  fi
  info "JSON parser: ${JSON_BACKEND}"
}
json_get_py() {
  local body="$1" path="$2" bin="$3"
  JSON_BODY="$body" "$bin" - "$path" <<'PYEOF' 2>/dev/null
import json, os, sys
try:
    data = json.loads(os.environ.get("JSON_BODY", "") or "null")
except Exception:
    sys.exit(0)
cur = data
for part in sys.argv[1].split("."):
    if isinstance(cur, dict) and part in cur:
        cur = cur[part]
    else:
        sys.exit(0)
if cur is None: sys.exit(0)
if isinstance(cur, bool):
    print("true" if cur else "false")
elif isinstance(cur, (dict, list)):
    print(json.dumps(cur))
else:
    print(cur)
PYEOF
}
json_get() {
  local body="$1" path="$2"
  case "$JSON_BACKEND" in
    jq)      echo "$body" | jq -r ".${path} // empty" 2>/dev/null ;;
    python3) json_get_py "$body" "$path" python3 ;;
    python)  json_get_py "$body" "$path" python ;;
    grep)
      local last_key="${path##*.}"
      echo "$body" \
        | grep -oE "\"${last_key}\"[[:space:]]*:[[:space:]]*(\"[^\"]*\"|true|false|null|-?[0-9]+(\\.[0-9]+)?)" \
        | head -1 \
        | sed -E "s/.*\"${last_key}\"[[:space:]]*:[[:space:]]*//; s/^\"//; s/\"$//"
      ;;
  esac
}

# ------------------------------------------------------------------
# /ready with exponential backoff.
# Polls until status=ready AND db.ok=true AND migrations.applied>=1,
# or READY_TIMEOUT seconds elapse. Backoff: 1s, 2s, 4s, 8s, capped at 15s.
# ------------------------------------------------------------------
wait_for_ready() {
  local url="$1/ready"
  info "polling $url with exponential backoff (budget ${READY_TIMEOUT}s)"
  local delay=1 elapsed=0 attempt=0
  local body="" http="000" status="" db_ok="" mig_n="0"
  while [ $elapsed -lt "$READY_TIMEOUT" ]; do
    attempt=$((attempt + 1))
    http=$(curl -s -o /tmp/smoke-ready.json -w "%{http_code}" "$url" || echo "000")
    body=$(cat /tmp/smoke-ready.json 2>/dev/null || echo "")
    status=$(json_get "$body" "status")
    db_ok=$(json_get  "$body" "checks.db.ok")
    mig_n=$(json_get  "$body" "checks.migrations.applied")
    mig_n="${mig_n:-0}"

    if [ "$http" = "200" ] && [ "$status" = "ready" ] && [ "$db_ok" = "true" ] && [ "$mig_n" -ge 1 ] 2>/dev/null; then
      pass "API /ready ready after ${attempt} attempt(s) / ${elapsed}s (http=$http status=$status db.ok=true migrations=$mig_n)"
      READY_BODY="$body"
      return 0
    fi

    info "attempt $attempt: http=$http status='${status:-?}' db.ok='${db_ok:-?}' migrations='${mig_n}' — sleep ${delay}s"
    sleep "$delay"
    elapsed=$((elapsed + delay))
    delay=$((delay * 2))
    [ $delay -gt 15 ] && delay=15
  done
  READY_BODY="$body"
  fail "/ready did not become ready within ${READY_TIMEOUT}s (last http=$http status='$status' db.ok='$db_ok' migrations='$mig_n' body=$body)"
}

echo "== docker-compose smoke test =="
echo "   API_URL       = $API_URL"
echo "   WEB_URL       = $WEB_URL"
echo "   TIMEOUT       = ${TIMEOUT}s (liveness)"
echo "   READY_TIMEOUT = ${READY_TIMEOUT}s (/ready backoff)"
echo ""

_detect_json_backend

# ---------- 1. Liveness ----------
wait_for "$API_URL/health"  "200" "API /health (liveness)"
wait_for "$WEB_URL/health"  "200" "Web /health"
wait_for "$WEB_URL/"        "200" "Web /       (SPA shell)" follow

root_body=$(curl -sfL "$WEB_URL/" || true)
echo "$root_body" | grep -qi "Welcome to nginx" \
  && fail "Web / is serving the default nginx welcome page. Rebuild the web image with: docker compose build --no-cache web" \
  || true
echo "$root_body" | grep -qi "<script" \
  && pass "Web / serves the built SPA shell (script bundle present)" \
  || fail "Web / returned HTML but no SPA script bundle was found; web image may be stale. First 300 chars: ${root_body:0:300}"

# ---------- 2. API /health body ----------
body=$(curl -sf "$API_URL/health" || true)
echo "$body" | grep -q '"ok":true' \
  && pass "API /health body ok" \
  || fail "API /health body unexpected: $body"

# ---------- 3. /ready with exponential backoff, then structural checks ----------
READY_BODY=""
wait_for_ready "$API_URL"
echo "   /ready payload: $READY_BODY"

for field in "status" "ok" "checks.db.ok" "checks.db.latency_ms" \
             "checks.migrations.ok" "checks.migrations.applied" "checks.migrations.last.name"; do
  v=$(json_get "$READY_BODY" "$field")
  [ -n "$v" ] || fail "/ready missing field: $field"
done
[ "$(json_get "$READY_BODY" status)" = "ready" ]              || fail "/ready status != ready"
[ "$(json_get "$READY_BODY" ok)" = "true" ]                   || fail "/ready ok != true"
[ "$(json_get "$READY_BODY" checks.db.ok)" = "true" ]         || fail "/ready checks.db.ok != true"
[ "$(json_get "$READY_BODY" checks.migrations.ok)" = "true" ] || fail "/ready checks.migrations.ok != true"
mig_n=$(json_get "$READY_BODY" checks.migrations.applied)
[ "${mig_n:-0}" -ge 1 ] 2>/dev/null || fail "/ready migrations.applied must be >=1 (got '$mig_n')"
mig_last=$(json_get "$READY_BODY" checks.migrations.last.name)
pass "API /ready fields present & correct (migrations.applied=$mig_n, last=$mig_last)"

# ---------- 4. Web content-type ----------
ctype=$(curl -sIL "$WEB_URL/" | tr -d '\r' | awk -F': ' 'tolower($1)=="content-type"{print $2}' | tail -1)
case "$ctype" in
  text/html*) pass "Web content-type $ctype" ;;
  *)          fail "Web unexpected content-type: $ctype" ;;
esac

# ---------- 5. Nginx → API proxy ----------
proxy_url="$WEB_URL/api/dashboard/monthly-totals"
info "checking nginx → api proxy via $proxy_url"
proxy_code=$(curl -s -o /tmp/smoke-proxy-body -w "%{http_code}" "$proxy_url" || echo "000")
proxy_body=$(cat /tmp/smoke-proxy-body 2>/dev/null || true)

case "$proxy_code" in
  200|400|401)
    pass "Web → API proxy reachable (HTTP $proxy_code, body ${#proxy_body} bytes)"
    ;;
  502|503|504)
    fail "Web → API proxy failed at nginx (HTTP $proxy_code) — request did NOT reach API. Body: $proxy_body"
    ;;
  000)
    fail "Web → API proxy: no response from $proxy_url"
    ;;
  *)
    fail "Web → API proxy unexpected status HTTP $proxy_code. Body: $proxy_body"
    ;;
esac

direct_code=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/dashboard/monthly-totals" || echo "000")
if [ "$direct_code" = "$proxy_code" ]; then
  pass "Proxy vs direct API status match (both HTTP $direct_code) — request truly reached API"
else
  info "Proxy=$proxy_code Direct=$direct_code (different, but both non-5xx is acceptable if auth differs)"
fi

echo ""
echo "${GREEN}==============================${NC}"
echo "${GREEN} All smoke checks passed. ✅${NC}"
echo "${GREEN}==============================${NC}"

#!/bin/sh
# Container entrypoint for the API image.
# Validates the compiled JS entrypoint exists BEFORE handing off to Node,
# so a broken build fails loudly instead of Node crashing with MODULE_NOT_FOUND.
set -eu

cmd="${1:-server}"

echo "[backend] ============================================================"
echo "[backend] startup command : ${cmd}"
echo "[backend] cwd             : $(pwd)"
echo "[backend] node            : $(node --version)"
echo "[backend] image dist tree :"
if [ -d dist ]; then
  find dist -maxdepth 4 -type f | sort | sed 's/^/[backend]   /'
else
  echo "[backend]   (no dist/ directory found)"
fi
echo "[backend] ============================================================"

validate_and_exec() {
  target="$1"
  label="$2"

  echo "[backend] validating ${label} entrypoint: ${target}"

  if [ ! -e "${target}" ]; then
    echo ""
    echo "[backend] ############################################################"
    echo "[backend] # STARTUP VALIDATION FAILED"
    echo "[backend] # Expected compiled entrypoint is MISSING: ${target}"
    echo "[backend] #"
    echo "[backend] # This means the TypeScript build did not emit the file,"
    echo "[backend] # or the image was built from a stale layer."
    echo "[backend] #"
    echo "[backend] # Fix:"
    echo "[backend] #   docker compose down"
    echo "[backend] #   docker compose build --no-cache api"
    echo "[backend] #   docker compose up -d"
    echo "[backend] ############################################################"
    exit 1
  fi

  if [ ! -f "${target}" ]; then
    echo "[backend] STARTUP VALIDATION FAILED: ${target} exists but is not a regular file"
    exit 1
  fi

  if [ ! -s "${target}" ]; then
    echo "[backend] STARTUP VALIDATION FAILED: ${target} is empty (0 bytes)"
    exit 1
  fi

  # Syntax-check the file so a corrupt bundle fails fast with a readable error.
  if ! node --check "${target}" 2>&1; then
    echo "[backend] STARTUP VALIDATION FAILED: ${target} failed node --check"
    exit 1
  fi

  echo "[backend] validation OK — launching: node ${target}"
  exec node "${target}"
}

case "${cmd}" in
  server|api)
    validate_and_exec "dist/src/server.js" "api"
    ;;
  migrate)
    validate_and_exec "dist/scripts/migrate.js" "migration"
    ;;
  seed)
    validate_and_exec "dist/scripts/seed.js" "seed"
    ;;
  *)
    exec "$@"
    ;;
esac

#!/usr/bin/env bash
# Copyright (C) Siemens AG 2026. All rights reserved. Confidential.
set -euo pipefail

# End-to-end image deployment to a VM with one command.
# Builds images locally, creates tarball, copies runtime files, loads images,
# and starts the stack remotely using docker compose.
#
# Example (HTTP/staging):
#   ./scripts/release-to-vm.sh --host azureuser@1.2.3.4 --key ~/.ssh/apf_vm --tag 2026.09.08 --mode local
#
# Example (HTTPS/production):
#   ./scripts/release-to-vm.sh --host azureuser@1.2.3.4 --key ~/.ssh/apf_vm --tag 2026.09.08 --mode prod

usage() {
  cat <<'EOF'
Usage:
  ./scripts/release-to-vm.sh --host <user@vm> --key <ssh-key-path> [options]

Required:
  --host <user@vm>          SSH target, e.g. azureuser@20.244.x.x
  --key <ssh-key-path>      SSH private key path

Optional:
  --tag <tag>               Image tag (default: YYYYmmdd-HHMMSS)
  --mode <local|prod>       local=HTTP base compose, prod=prod+https overlays (default: local)
  --env-file <path>         Env file to copy as .env on VM (default: .env)
  --project-name <name>     Docker Compose project name on VM (default: apartment-ledger-pro)
  --remote-dir <dir>        Remote deploy directory under HOME (default: deploy)
  --skip-build              Reuse existing release-<tag>.tar, skip local build

Notes:
  - In prod mode, DOMAIN must be set inside the env file.
  - Recommended for prod: keep a separate untracked file (for example, .env.prod)
    and pass it via --env-file .env.prod.
  - This script does not copy source code; only images + compose/env runtime files.
  - Before starting, stale app containers are removed and database volumes are preserved.
  - Old release archives and superseded app image tags are pruned only after health checks pass.
EOF
}

HOST=""
KEY=""
TAG="$(date +%Y%m%d-%H%M%S)"
MODE="local"
ENV_FILE=".env"
PROJECT_NAME="apartment-ledger-pro"
REMOTE_DIR="deploy"
SKIP_BUILD="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)
      HOST="${2:-}"; shift 2 ;;
    --key)
      KEY="${2:-}"; shift 2 ;;
    --tag)
      TAG="${2:-}"; shift 2 ;;
    --mode)
      MODE="${2:-}"; shift 2 ;;
    --env-file)
      ENV_FILE="${2:-}"; shift 2 ;;
    --project-name)
      PROJECT_NAME="${2:-}"; shift 2 ;;
    --remote-dir)
      REMOTE_DIR="${2:-}"; shift 2 ;;
    --skip-build)
      SKIP_BUILD="true"; shift ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1 ;;
  esac
done

if [[ -z "$HOST" || -z "$KEY" ]]; then
  echo "--host and --key are required." >&2
  usage
  exit 1
fi

if [[ "$MODE" != "local" && "$MODE" != "prod" ]]; then
  echo "--mode must be either local or prod." >&2
  exit 1
fi

if [[ ! "$PROJECT_NAME" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
  echo "Invalid --project-name '$PROJECT_NAME'." >&2
  echo "Use only lowercase letters, digits, hyphens, and underscores; start with a letter or digit." >&2
  exit 1
fi

# WSL convenience: if key path is missing, try matching by filename under
# /mnt/c/Users/*/.ssh/ (common when users pass ~/.ssh but key is in Windows home).
if [[ ! -f "$KEY" ]]; then
  KEY_NAME="$(basename "$KEY")"
  if [[ -n "${WSL_DISTRO_NAME:-}" ]]; then
    shopt -s nullglob
    key_candidates=(/mnt/c/Users/*/.ssh/"$KEY_NAME")
    shopt -u nullglob
    if [[ ${#key_candidates[@]} -eq 1 ]]; then
      echo "Key not found at $KEY; using detected WSL/Windows key: ${key_candidates[0]}"
      KEY="${key_candidates[0]}"
    fi
  fi
fi

if [[ ! -f "$KEY" ]]; then
  echo "SSH key not found: $KEY" >&2
  echo "Tip: on WSL, use --key /mnt/c/Users/<windows-user>/.ssh/<key-file>" >&2
  exit 1
fi

KEY_CLEANUP=""
# OpenSSH on Linux/WSL rejects private keys from Windows mounts when perms look
# too open (for example 0777). Create a secure temp copy and use that.
if [[ -n "${WSL_DISTRO_NAME:-}" && "$KEY" == /mnt/* ]]; then
  KEY_TMP="$(mktemp "${TMPDIR:-/tmp}/release-key.XXXXXX")"
  cp "$KEY" "$KEY_TMP"
  chmod 600 "$KEY_TMP"
  KEY="$KEY_TMP"
  KEY_CLEANUP="$KEY_TMP"
  trap 'if [[ -n "${KEY_CLEANUP:-}" && -f "$KEY_CLEANUP" ]]; then rm -f "$KEY_CLEANUP"; fi' EXIT
  echo "Using secure temporary key copy for SSH auth (WSL mounted key detected)."
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Resolve env file path after switching to repo root so relative paths are stable.
if [[ "$MODE" == "prod" && "$ENV_FILE" == ".env" && -f ".env.prod" ]]; then
  echo "Prod mode detected .env.prod. Using .env.prod (override with --env-file)."
  ENV_FILE=".env.prod"
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Env file not found: $ENV_FILE" >&2
  if [[ "$MODE" == "prod" ]]; then
    echo "Tip: create an untracked .env.prod and run with --env-file .env.prod" >&2
  fi
  exit 1
fi

if [[ ! -f "docker-compose.yml" || ! -f "docker-compose.images.yml" ]]; then
  echo "Run this script from repository root (or keep scripts/ under repo)." >&2
  exit 1
fi

if [[ "$MODE" == "prod" ]]; then
  if ! grep -Eq '^DOMAIN=.+' "$ENV_FILE"; then
    echo "Prod mode requires DOMAIN in $ENV_FILE." >&2
    echo "Tip: keep local values in .env and prod values in .env.prod, then use --env-file .env.prod" >&2
    exit 1
  fi
fi

RELEASE_TAR="release-${TAG}.tar"
SSH_OPTS=(-i "$KEY" -o StrictHostKeyChecking=accept-new)
RSYNC_SSH_CMD=$(printf 'ssh -i %q -o StrictHostKeyChecking=accept-new' "$KEY")

COMPOSE_ARGS="-f docker-compose.yml -f docker-compose.images.yml"
if [[ "$MODE" == "prod" ]]; then
  COMPOSE_ARGS+=" -f docker-compose.prod.yml -f docker-compose.https.yml"
fi

if [[ "$SKIP_BUILD" != "true" ]]; then
  echo "[1/7] Building + packaging images locally..."
  ./scripts/build-release-images.sh "$TAG" "$RELEASE_TAR"
else
  if [[ ! -f "$RELEASE_TAR" ]]; then
    echo "--skip-build set, but tarball not found: $RELEASE_TAR" >&2
    exit 1
  fi
fi

echo "[2/7] Preparing remote directory..."
ssh "${SSH_OPTS[@]}" "$HOST" "mkdir -p \"\$HOME/$REMOTE_DIR\""
ssh "${SSH_OPTS[@]}" "$HOST" "sudo mkdir -p \"\$HOME/$REMOTE_DIR/web/templates-https\" \"\$HOME/$REMOTE_DIR/ETL/config\" \"\$HOME/$REMOTE_DIR/ETL/input\" \"\$HOME/$REMOTE_DIR/ETL/output\" \"\$HOME/$REMOTE_DIR/web\" \"\$HOME/$REMOTE_DIR/hk_scripts\""
ssh "${SSH_OPTS[@]}" "$HOST" "sudo chown -R azureuser:azureuser \"\$HOME/$REMOTE_DIR\""

echo "[3/7] Copying image bundle + runtime files..."
scp "${SSH_OPTS[@]}" "$RELEASE_TAR" "$HOST:~/$REMOTE_DIR/$RELEASE_TAR"
if [[ -f "${RELEASE_TAR}.sha256" ]]; then
  scp "${SSH_OPTS[@]}" "${RELEASE_TAR}.sha256" "$HOST:~/$REMOTE_DIR/${RELEASE_TAR}.sha256"
fi
scp "${SSH_OPTS[@]}" \
  docker-compose.yml \
  docker-compose.images.yml \
  docker-compose.prod.yml \
  docker-compose.https.yml \
  "$HOST:~/$REMOTE_DIR/"
rsync -a --delete --checksum --no-owner --no-group -e "$RSYNC_SSH_CMD" \
  "ETL/transform.py" \
  "ETL/README.md" \
  "ETL/requirements.txt" \
  "ETL/config/mapping.yaml" \
  "$HOST:~/$REMOTE_DIR/ETL/"
rsync -a --delete --checksum --no-owner --no-group -e "$RSYNC_SSH_CMD" "web/" "$HOST:~/$REMOTE_DIR/web/"
rsync -a --checksum --no-owner --no-group -e "$RSYNC_SSH_CMD" "scripts/db-cleanup.sh" "$HOST:~/$REMOTE_DIR/hk_scripts/"
rsync -a --checksum --no-owner --no-group -e "$RSYNC_SSH_CMD" "scripts/vm_housekeeping.sh" "$HOST:~/$REMOTE_DIR/hk_scripts/"
scp "${SSH_OPTS[@]}" "$ENV_FILE" "$HOST:~/$REMOTE_DIR/.env"

echo "[4/7] Loading images on VM..."
ssh "${SSH_OPTS[@]}" "$HOST" "cd \"\$HOME/$REMOTE_DIR\" && docker load -i \"$RELEASE_TAR\""

echo "[5/7] Removing stale app containers and MailHog..."
ssh "${SSH_OPTS[@]}" "$HOST" bash -s -- "$PROJECT_NAME" <<'REMOTE'
set -euo pipefail
PROJECT_NAME="$1"

# Remove containers from a previous Compose project, including containers
# that publish the ports needed by this application.
for project in "deploy" "$PROJECT_NAME"; do
  container_ids="$(docker ps -aq --filter "label=com.docker.compose.project=$project")"
  if [[ -n "$container_ids" ]]; then
    docker rm -f $container_ids >/dev/null
  fi
done

for name_pattern in 'deploy-*' 'apartment-ledger-pro-*'; do
  container_ids="$(docker ps -aq --filter "name=$name_pattern")"
  if [[ -n "$container_ids" ]]; then
    docker rm -f $container_ids >/dev/null
  fi
done

for port in 80 443 4010 5442; do
  container_ids="$(docker ps -aq --filter "publish=$port")"
  if [[ -n "$container_ids" ]]; then
    docker rm -f $container_ids >/dev/null
  fi
done

mailhog_ids="$(docker ps -aq --filter 'name=mailhog')"
if [[ -n "$mailhog_ids" ]]; then
  docker rm -f $mailhog_ids >/dev/null 2>&1 || true
fi
mailhog_images="$(docker images -q 'mailhog/mailhog')"
if [[ -n "$mailhog_images" ]]; then
  docker rmi -f $mailhog_images >/dev/null 2>&1 || true
fi
REMOTE

echo "[6/7] Starting and validating stack on VM (mode=$MODE)..."
ssh "${SSH_OPTS[@]}" "$HOST" bash -s -- "$PROJECT_NAME" "$TAG" "$REMOTE_DIR" "$MODE" <<'REMOTE'
set -euo pipefail
PROJECT_NAME="$1"
TAG="$2"
REMOTE_DIR="$3"
MODE="$4"

cd "$HOME/$REMOTE_DIR"
export APP_IMAGE_TAG="$TAG"

compose_args=(-p "$PROJECT_NAME" -f docker-compose.yml -f docker-compose.images.yml)
if [[ "$MODE" == "prod" ]]; then
  compose_args+=(-f docker-compose.prod.yml -f docker-compose.https.yml)
fi

# Let Docker Compose own dependency ordering: db -> migrate -> seed -> api -> ssr -> web.
echo "Starting database, migrations, seed, and application services..."
if ! docker compose "${compose_args[@]}" up -d --force-recreate --remove-orphans; then
  echo "Compose stack startup failed" >&2
  docker compose "${compose_args[@]}" ps -a >&2 || true
  docker compose "${compose_args[@]}" logs db migrate seed api ssr web --tail=200 >&2 || true
  exit 1
fi

for service in db api ssr web; do
  for attempt in $(seq 1 60); do
    container_id="$(docker compose "${compose_args[@]}" ps --status running -q "$service")"
    if [[ -n "$container_id" ]]; then
      break
    fi
    if [[ "$attempt" == "60" ]]; then
      echo "Required service is not running: $service" >&2
      docker compose "${compose_args[@]}" ps -a >&2 || true
      docker compose "${compose_args[@]}" logs db migrate seed api ssr web --tail=200 >&2 || true
      exit 1
    fi
    sleep 2
  done
done

for attempt in $(seq 1 60); do
  if curl -fsS http://127.0.0.1/health >/dev/null 2>&1 && curl -fsS http://127.0.0.1:4010/ready >/dev/null 2>&1; then
    echo "Stack health checks passed"
    docker compose "${compose_args[@]}" ps
    break
  fi
  if [[ "$attempt" == "60" ]]; then
    echo "Stack failed health checks" >&2
    docker compose "${compose_args[@]}" ps >&2 || true
    docker compose "${compose_args[@]}" logs api web ssr db --tail=100 >&2 || true
    exit 1
  fi
  sleep 2
done
REMOTE

echo "[7/7] Deployment succeeded — removing superseded releases and images..."
ssh "${SSH_OPTS[@]}" "$HOST" bash -s -- "$PROJECT_NAME" "$TAG" "$REMOTE_DIR" "$MODE" <<'REMOTE'
set -euo pipefail
PROJECT_NAME="$1"
TAG="$2"
REMOTE_DIR="$3"
MODE="$4"

cd "$HOME/$REMOTE_DIR"
export APP_IMAGE_TAG="$TAG"

compose_args=(-p "$PROJECT_NAME" -f docker-compose.yml -f docker-compose.images.yml)
if [[ "$MODE" == "prod" ]]; then
  compose_args+=(-f docker-compose.prod.yml -f docker-compose.https.yml)
fi

# Re-check the complete stack before deleting any recovery artifacts.  Using
# the same compose files is important: a bare `docker compose ps` can silently
# omit overlay-defined services or resolve a different image tag.
for service in db api ssr web; do
  container_id="$(docker compose "${compose_args[@]}" ps --status running -q "$service")"
  if [[ -z "$container_id" ]]; then
    echo "Refusing cleanup: required service is not running: $service" >&2
    docker compose "${compose_args[@]}" ps >&2 || true
    docker compose "${compose_args[@]}" logs "$service" --tail=100 >&2 || true
    exit 1
  fi
done

# Keep only the just-installed release archive and checksum.
find . -maxdepth 1 -type f -name 'release-*.tar' ! -name "release-$TAG.tar" -delete
find . -maxdepth 1 -type f -name 'release-*.tar.sha256' ! -name "release-$TAG.tar.sha256" -delete

# Remove superseded tags only when no container references them. Never force
# image removal: old and new tags can point to the same image ID, and a forced
# removal can make diagnosis/recovery impossible.
for repository in apf-backend apf-ssr apf-web; do
  while read -r old_tag; do
    [[ -z "$old_tag" || "$old_tag" == "$TAG" ]] && continue
    image_ref="${repository}:${old_tag}"
    if [[ -n "$(docker ps -aq --filter "ancestor=$image_ref")" ]]; then
      echo "Retaining in-use image: $image_ref"
      continue
    fi
    docker rmi "$image_ref" >/dev/null 2>&1 || true
  done < <(docker images "$repository" --format '{{.Tag}}')
done

# Only remove genuinely dangling images. Do not sweep all unused tagged images:
# those tags are needed for a safe rollback after a failed deployment.

# Remove only the legacy deploy network if Docker reports it unused.
docker network rm "deploy_default" >/dev/null 2>&1 || true

# Confirm cleanup did not disturb any required service and print status using
# the exact compose model used for this release.
for service in db api ssr web; do
  if [[ -z "$(docker compose "${compose_args[@]}" ps --status running -q "$service")" ]]; then
    echo "Required service stopped after cleanup: $service" >&2
    exit 1
  fi
done

echo "Release retained: release-$TAG.tar"
docker compose "${compose_args[@]}" ps
REMOTE

echo
echo "Release complete."
echo "Host: $HOST"
echo "Tag : $TAG"
echo "Mode: $MODE"
echo "Proj: $PROJECT_NAME"

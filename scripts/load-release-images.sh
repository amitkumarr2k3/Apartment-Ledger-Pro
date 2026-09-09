#!/usr/bin/env bash
set -euo pipefail

# Load deployable images tarball on target host.
# Usage:
#   ./scripts/load-release-images.sh <release-tar-file>

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <release-tar-file>" >&2
  exit 1
fi

TAR_FILE="$1"

if [[ ! -f "$TAR_FILE" ]]; then
  echo "File not found: $TAR_FILE" >&2
  exit 1
fi

echo "Loading images from $TAR_FILE ..."
docker load -i "$TAR_FILE"

echo "Images loaded."
echo "Next: set APP_IMAGE_TAG=<same tag used while build-release-images.sh>"
echo "Then run docker compose with docker-compose.images.yml override."

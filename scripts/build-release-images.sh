#!/usr/bin/env bash
set -euo pipefail

# Build deployable images locally and pack them into a single tarball.
# Usage:
#   ./scripts/build-release-images.sh [TAG] [OUTPUT_TAR]
# Example:
#   ./scripts/build-release-images.sh 2026.09.08 release-2026.09.08.tar

TAG="${1:-$(date +%Y%m%d-%H%M%S)}"
OUT="${2:-release-${TAG}.tar}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[1/5] Building backend image..."
docker build -t "apf-backend:${TAG}" backend

echo "[2/5] Building SSR image..."
docker build -f web/Dockerfile --target ssr -t "apf-ssr:${TAG}" .

echo "[3/5] Building web image..."
docker build -f web/Dockerfile --target web -t "apf-web:${TAG}" .

echo "[4/5] Pulling infra images to include in bundle..."
docker pull postgres:16-alpine
docker pull mailhog/mailhog:latest

echo "[5/5] Saving all images to ${OUT} ..."
docker save \
  "apf-backend:${TAG}" \
  "apf-ssr:${TAG}" \
  "apf-web:${TAG}" \
  "postgres:16-alpine" \
  "mailhog/mailhog:latest" \
  -o "${OUT}"

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "${OUT}" > "${OUT}.sha256"
  echo "Wrote checksum: ${OUT}.sha256"
fi

echo
echo "Release bundle created: ${OUT}"
echo "Image tag to use on VM: ${TAG}"
echo "Start command on VM will require: APP_IMAGE_TAG=${TAG}"

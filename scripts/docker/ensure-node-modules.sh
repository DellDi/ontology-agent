#!/usr/bin/env bash

set -euo pipefail

STAMP_FILE="node_modules/.install-stamp"
LOCKFILE_HASH="$(sha256sum pnpm-lock.yaml | awk '{print $1}')"
PLATFORM_SIGNATURE="$(uname -s)-$(uname -m)-node$(node -p 'process.versions.node')"
EXPECTED_STAMP="${LOCKFILE_HASH} ${PLATFORM_SIGNATURE}"
CURRENT_STAMP="$(cat "${STAMP_FILE}" 2>/dev/null || true)"

if [ ! -f node_modules/.modules.yaml ] || [ "${CURRENT_STAMP}" != "${EXPECTED_STAMP}" ]; then
  echo "[deps] Detected missing or stale node_modules; running pnpm install..."
  pnpm install --force --no-frozen-lockfile
  mkdir -p node_modules
  printf '%s\n' "${EXPECTED_STAMP}" > "${STAMP_FILE}"
fi

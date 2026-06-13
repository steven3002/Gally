#!/usr/bin/env bash
# Local CI runner — mirrors .github/workflows/ci.yml steps exactly.
# Usage: wsl bash .github/scripts/ci_local.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "===== CI — Gally Core Tests (local) ====="
echo ""

echo "--- Step: Verify Sui version ---"
sui --version
echo ""

echo "--- Step: Build gally_core ---"
cd "$REPO_ROOT/gally_core"
sui move build
echo ""

echo "--- Step: Run gally_core tests ---"
sui move test
echo ""

echo "===== ✅ CI PASSED — build clean, all tests green ====="

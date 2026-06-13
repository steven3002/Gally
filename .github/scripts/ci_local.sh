#!/usr/bin/env bash
# Local CI runner — mirrors .github/workflows/ci.yml steps exactly.
set -euo pipefail

echo "===== Simulating CI Workflow: CI — Gally Core Tests ====="
echo ""

echo "--- Step: Verify Sui version ---"
sui --version
echo ""

echo "--- Step: Build gally_core ---"
cd "$(dirname "$0")/../../gally_core"
sui move build
echo ""

echo "--- Step: Run gally_core tests ---"
sui move test
echo ""

echo "===== ✅ CI PASSED — build clean, all tests green ====="

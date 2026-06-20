#!/usr/bin/env bash
# Local CI runner — mirrors .github/workflows/ci.yml as closely as a laptop allows.
# Skips suites whose tooling is absent so it never hard-fails on a partial setup.
# Usage: bash .github/scripts/ci_local.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

FAILED=()
have() { command -v "$1" >/dev/null 2>&1; }
section() { echo ""; echo "===== $* ====="; }
# step "<label>" "<dir>" <cmd...> — runs in a subshell; records failure in the PARENT.
step() {
  local label="$1" dir="$2"; shift 2
  echo "+ ($dir) $*"
  ( cd "$dir" && "$@" ) || FAILED+=("$label")
}

# ── Move: build + tests for every package (mainnet env resolves usdc offline) ──
if have sui; then
  section "Move — build & test"
  step "usdc build"                 usdc                   sui move build --build-env mainnet
  step "entity_token_template test" entity_token_template  sui move test  --build-env mainnet
  step "gally_mock_faucet test"     gally_mock_faucet      sui move test  --build-env mainnet
  step "gally_core test"            gally_core             sui move test  --build-env mainnet

  section "Script test — instantiate.sh generate & build"
  GEN="$(mktemp -d)/ci_probe_deed"
  step "instantiate.sh"   entity_token_template  bash scripts/instantiate.sh ci_probe_deed \
        --out "$GEN" --name "CI Probe Deed" --symbol CIPD --description "CI script-test token" --force
  [ -d "$GEN" ] && step "generated pkg test" "$GEN" sui move test --build-env mainnet
else
  echo "SKIP Move suites — 'sui' not on PATH"
fi

# ── Rust: Live Simulation Bot (offline) + Backend Indexer (needs Postgres) ──
if have cargo; then
  section "Rust — Live Simulation Bot"
  step "bot build" "Live Simulation Bot" cargo build --locked
  step "bot test"  "Live Simulation Bot" cargo test  --locked

  section "Rust — Backend Indexer"
  step "indexer build" "Backend Indexer" cargo build --locked
  if [ -n "${DATABASE_URL:-}" ]; then
    step "indexer test" "Backend Indexer" cargo test --locked
  else
    echo "SKIP indexer tests — set DATABASE_URL to a running Postgres to enable"
  fi
else
  echo "SKIP Rust suites — 'cargo' not on PATH"
fi

# ── Frontend: typecheck, lint, unit, build (e2e is a separate CI job) ──
if have pnpm; then
  section "Frontend — install, typecheck, lint, unit, build"
  step "frontend" frontend-explorer bash -c '
    pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test && pnpm build'
else
  echo "SKIP frontend — 'pnpm' not on PATH"
fi

# ── Shell scripts: syntax gate ──
section "Shell — bash -n syntax check"
for s in run_stack.sh run_devnet.sh entity_token_template/scripts/instantiate.sh .github/scripts/ci_local.sh; do
  step "syntax $s" "$REPO_ROOT" bash -n "$s"
done

echo ""
if [ ${#FAILED[@]} -eq 0 ]; then
  echo "===== ✅ CI PASSED — all run suites green ====="
else
  echo "===== ❌ CI FAILED — ${#FAILED[@]} step(s): ====="
  printf '  - %s\n' "${FAILED[@]}"
  exit 1
fi

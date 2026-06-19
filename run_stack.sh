#!/usr/bin/env bash
# =============================================================================
# run_stack.sh — Gally one-command stack orchestration (SIM-M5).
#
# Brings the WHOLE live environment up from a clean state, with the Sui node on a
# REMOTE server (low local RAM) reached over an SSH tunnel:
#
#   1. restart a fresh remote Sui node (--force-regenesis) + open the SSH tunnel
#      and wait until 127.0.0.1:9000 answers JSON-RPC locally;
#   2. deploy gally_core (M8) + the mock faucet + N entity-token templates to the
#      fresh chain (handles the Sui 1.73 [environments]/Published.toml steps);
#   3. write config.toml + sim_state.json with the captured ids;
#   4. boot the Postgres container + the BI-M8 indexer (background);
#   5. run the simulation bot: full genesis (--seed-all) and, optionally, a
#      bounded daemon soak (--soak N) to prove unattended activity.
#
# Idempotent-ish: each run starts a brand-new chain and rewrites the local config.
# No web server in the bot (R6); the sim USDC is local-only (R1).
#
# Usage:
#   ./run_stack.sh [--soak CYCLES] [--no-node] [--pool N] [--pace P]
#   SSH_ALIAS=trace ENTITY_POOL_SIZE=6 ./run_stack.sh --soak 60
#
# Env overrides: SSH_ALIAS(trace) RPC_PORT(9000) FAUCET_PORT(9123)
#   ENTITY_POOL_SIZE(6) PG_CONTAINER(gally-pg) INDEXER_DB(gally_live)
#   INDEXER_BIND(127.0.0.1:8088)
# =============================================================================
set -euo pipefail

# ---------- config ----------
SSH_ALIAS="${SSH_ALIAS:-trace}"
RPC_PORT="${RPC_PORT:-9000}"
FAUCET_PORT="${FAUCET_PORT:-9123}"
RPC_URL="http://127.0.0.1:${RPC_PORT}"
FAUCET_URL="http://127.0.0.1:${FAUCET_PORT}/gas"
ENTITY_POOL_SIZE="${ENTITY_POOL_SIZE:-6}"
PG_CONTAINER="${PG_CONTAINER:-gally-pg}"
PG_BASE="${PG_BASE:-postgres://postgres:postgres@localhost:5432}"
INDEXER_DB="${INDEXER_DB:-gally_live}"
INDEXER_BIND="${INDEXER_BIND:-127.0.0.1:8088}"
SOAK_CYCLES=0
START_NODE=1
PACE="accelerated"   # accelerated so the soak exercises disputes (windows are AdminCap-warped)
GAS_BUDGET="${GAS_BUDGET:-3000000000}"   # 3 SUI; every publish needs ONE operator coin ≥ this

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$HOME/.local/bin:$PATH"
BUILD_ENV="${BUILD_ENV:-mainnet}"   # gally_core Move.lock workaround (see CLAUDE.md memory)

# ---------- args ----------
while [ $# -gt 0 ]; do
  case "$1" in
    --soak) SOAK_CYCLES="$2"; shift 2;;
    --pool) ENTITY_POOL_SIZE="$2"; shift 2;;
    --pace) PACE="$2"; shift 2;;
    --no-node) START_NODE=0; shift;;      # reuse an already-running node+tunnel
    -h|--help) sed -n '2,40p' "$0"; exit 0;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done

log()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ---------- 0. preflight ----------
log "0. Preflight"
for t in sui cargo docker ssh curl python3; do command -v "$t" >/dev/null || die "missing tool: $t"; done
ssh -o ConnectTimeout=15 -o BatchMode=yes "$SSH_ALIAS" 'command -v sui >/dev/null' \
  || die "ssh '$SSH_ALIAS' unreachable or sui not on its PATH"
ok "tools present; ssh '$SSH_ALIAS' reachable with sui"

# Clean up our own stale local processes (old indexer / tunnel / bot) — never the node.
pkill -f 'target/debug/gally_indexer' 2>/dev/null || true
pkill -f 'gally_sim_bot --daemon'     2>/dev/null || true
# Match the tunnel by its forward spec, NOT "ssh -N -L": the real cmdline is
# `ssh -o ExitOnForwardFailure=yes -N -L 9000:127.0.0.1:9000 …`, so "ssh -N -L 9000"
# never matches and the stale tunnel survives → "Address already in use" next open.
pkill -f -- "-L ${RPC_PORT}:127.0.0.1:${RPC_PORT}" 2>/dev/null || true
ok "cleared stale local indexer / bot / tunnel processes"

# ---------- 1. remote node + tunnel ----------
if [ "$START_NODE" = "1" ]; then
  log "1. Restart remote Sui node (fresh regenesis) + open tunnel"
  # Kill the old node by PROCESS NAME (pkill -x sui), NOT full cmdline (pkill -f sui): a full-cmdline
  # match would also hit this very ssh wrapper shell and kill the launch. Same goal, self-safe.
  # Also remove the stale `/tmp/.tmp*` RocksDB dirs each `--force-regenesis` leaves behind — they
  # accumulate and eventually trip the remote's per-user disk quota (EDQUOT), which silently prevents
  # the fresh node from binding. Self-healing so an unattended re-run never wedges on a full quota.
  ssh "$SSH_ALIAS" 'pkill -x sui 2>/dev/null; sleep 1; rm -rf /tmp/.tmp* 2>/dev/null; \
      nohup sui start --with-faucet --force-regenesis > sui.log 2>&1 & \
      sleep 1; echo "remote sui (re)started"'
  ok "remote node restarting (--with-faucet --force-regenesis; stale DBs cleaned)"

  pkill -f -- "-L ${RPC_PORT}:127.0.0.1:${RPC_PORT}" 2>/dev/null || true
  # Wait for the local forward port to actually free up before re-binding (avoids
  # "bind [127.0.0.1]:9000: Address already in use" from a not-yet-reaped tunnel).
  for _ in $(seq 1 10); do
    python3 -c "import socket,sys; s=socket.socket(); r=s.connect_ex(('127.0.0.1',${RPC_PORT})); s.close(); sys.exit(0 if r else 1)" \
      && break || sleep 1
  done
  ssh -o ExitOnForwardFailure=yes -N \
      -L "${RPC_PORT}:127.0.0.1:${RPC_PORT}" \
      -L "${FAUCET_PORT}:127.0.0.1:${FAUCET_PORT}" "$SSH_ALIAS" &
  TUNNEL_PID=$!
  ok "tunnel opened (pid $TUNNEL_PID): ${RPC_PORT}+${FAUCET_PORT} → $SSH_ALIAS"
fi

log "Waiting for the node to answer JSON-RPC at $RPC_URL …"
CHAIN_ID=""
for i in $(seq 1 60); do
  CHAIN_ID="$(curl -s -m 3 -X POST "$RPC_URL" -H 'Content-Type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"sui_getChainIdentifier","params":[]}' 2>/dev/null \
      | python3 -c 'import sys,json;print(json.load(sys.stdin).get("result",""))' 2>/dev/null || true)"
  [ -n "$CHAIN_ID" ] && break
  sleep 2
done
[ -n "$CHAIN_ID" ] || die "node did not become reachable at $RPC_URL within ~120s"
ok "node reachable — chain id: $CHAIN_ID"

# Point the sui CLI at the tunneled node.
sui client switch --env localnet >/dev/null 2>&1 || sui client new-env --alias localnet --rpc "$RPC_URL" >/dev/null 2>&1 || true
OPERATOR="$(sui client active-address)"
ok "operator (deployer) address: $OPERATOR"

# ---------- gas for the operator ----------
log "Funding operator gas from the faucet"
# `sui client gas` exits 0 even with ZERO coins, so a bare `|| die` proves nothing — the
# previous run marched into publish unfunded and hit "Cannot find gas coin … sufficient for
# the required gas budget". Publish gas-selection needs ONE coin ≥ $GAS_BUDGET, so verify a
# coin that big actually landed; the faucet on a just-booted node can lag or drop the first
# request, hence the retry. (curl to the tunneled faucet is deterministic; CLI is a fallback.)
funded=0; best=0
for attempt in $(seq 1 15); do
  curl -s -m 10 -X POST "$FAUCET_URL" -H 'Content-Type: application/json' \
    -d "{\"FixedAmountRequest\":{\"recipient\":\"$OPERATOR\"}}" >/dev/null 2>&1 || true
  sui client faucet >/dev/null 2>&1 || true
  sleep 3
  best="$(sui client gas --json 2>/dev/null \
    | python3 -c 'import sys,re; print(max([int(x) for x in re.findall(r"\d{9,}", sys.stdin.read())] or [0]))' 2>/dev/null || echo 0)"
  if [ "${best:-0}" -ge "$GAS_BUDGET" ]; then funded=1; ok "operator funded (largest gas coin: ${best} MIST)"; break; fi
  printf '  · faucet attempt %s: largest coin %s MIST (< %s) — retrying\n' "$attempt" "${best:-0}" "$GAS_BUDGET"
done
[ "$funded" = 1 ] || die "operator never received a gas coin ≥ ${GAS_BUDGET} MIST after 15 faucet attempts"

# ---------- helpers: env-block rewrite, Published.toml reset, publish+parse ----------
set_env_and_reset() {  # $1 = package dir
  python3 - "$1" "$CHAIN_ID" <<'PY'
import sys, re, pathlib
pkg, chain = sys.argv[1], sys.argv[2]
mt = pathlib.Path(pkg, "Move.toml"); t = mt.read_text()
block = f'[environments]\nlocalnet = "{chain}"\n'
if "[environments]" in t:
    t = re.sub(r'\[environments\][^\[]*', block + "\n", t, count=1)
else:
    # insert after the [package] table (before [dependencies] if present)
    t = t.replace("\n[dependencies]", "\n" + block + "\n[dependencies]", 1) if "[dependencies]" in t else t + "\n" + block
mt.write_text(t)
pub = pathlib.Path(pkg, "Published.toml")
pub.write_text("# Generated by Move\n# Published versions per environment.\n# This file SHOULD be committed to source control\n")
print("ok")
PY
}

publish_pkg() {  # $1 = dir, $2 = out json path
  ( cd "$1" && sui client publish --json --gas-budget "$GAS_BUDGET" --skip-dependency-verification ) > "$2" 2>"$2.err" \
    || { echo "publish failed for $1:"; tail -8 "$2.err"; tail -3 "$2"; return 1; }
}

# ---------- 2. deploy ----------
log "2. Deploy gally_core (M8) → fresh chain $CHAIN_ID"
sui move build --path "$REPO/gally_core" --build-env "$BUILD_ENV" >/dev/null 2>&1 || true
set_env_and_reset "$REPO/gally_core"
publish_pkg "$REPO/gally_core" /tmp/rs_gally.json || die "gally_core publish failed"
eval "$(python3 - <<'PY'
import json
d=json.load(open('/tmp/rs_gally.json')); pkg=None; cfg=adm=cap=None
for c in d.get("objectChanges",[]):
    t=c.get("type"); ot=c.get("objectType","")
    if t=="published": pkg=c["packageId"]
    if "::protocol::ProtocolConfig" in ot: cfg=c["objectId"]
    if "::protocol::AdminCap" in ot: adm=c["objectId"]
    if "TreasuryCap<" in ot and "::usdc::USDC" in ot: cap=c["objectId"]
print(f'GALLY_PACKAGE_ID={pkg}\nPROTOCOL_CONFIG_ID={cfg}\nADMIN_CAP_ID={adm}\nUSDC_TREASURY_CAP_ID={cap}')
PY
)"
[ -n "${GALLY_PACKAGE_ID:-}" ] || die "could not parse gally_core ids"
ok "gally_core: $GALLY_PACKAGE_ID (config $PROTOCOL_CONFIG_ID, admin $ADMIN_CAP_ID, usdc-cap $USDC_TREASURY_CAP_ID)"

log "Deploy gally_mock_faucet"
set_env_and_reset "$REPO/gally_mock_faucet"
publish_pkg "$REPO/gally_mock_faucet" /tmp/rs_faucet.json || die "faucet publish failed"
eval "$(python3 - <<'PY'
import json
d=json.load(open('/tmp/rs_faucet.json')); pkg=fct=None
for c in d.get("objectChanges",[]):
    if c.get("type")=="published": pkg=c["packageId"]
    if "::faucet::MockFaucet" in c.get("objectType",""): fct=c["objectId"]
print(f'FAUCET_PACKAGE_ID={pkg}\nMOCK_FAUCET_ID={fct}')
PY
)"
[ -n "${FAUCET_PACKAGE_ID:-}" ] || die "could not parse faucet ids"
ok "faucet: $FAUCET_PACKAGE_ID (MockFaucet $MOCK_FAUCET_ID)"

log "Publish $ENTITY_POOL_SIZE entity-token templates (SIM-D4 pool)"
ETDIR=/tmp/rs_etpool; rm -rf "$ETDIR"; mkdir -p "$ETDIR"
for i in $(seq 1 "$ENTITY_POOL_SIZE"); do
  slug="gally_entity_$i"; out="$ETDIR/et$i"
  bash "$REPO/entity_token_template/scripts/instantiate.sh" "$slug" \
      --out "$out" --name "Gally Entity Token $i" --symbol "GET$i" --description "Sim entity token $i" --force >/dev/null 2>&1 \
      || die "instantiate et$i failed"
  printf '\n[environments]\nlocalnet = "%s"\n' "$CHAIN_ID" >> "$out/Move.toml"
  publish_pkg "$out" "$ETDIR/pub$i.json" || die "publish et$i failed"
  printf '  · et%s published\n' "$i"
done
python3 - "$ETDIR" "$ENTITY_POOL_SIZE" "$REPO/sim_state.json" <<'PY'
import json, sys
etdir, n, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
tokens=[]
for i in range(1, n+1):
    d=json.load(open(f"{etdir}/pub{i}.json")); pkg=cap=meta=None
    for c in d.get("objectChanges",[]):
        ot=c.get("objectType","")
        if c.get("type")=="published": pkg=c["packageId"]
        if "TreasuryCap<" in ot: cap=c["objectId"]
        if "CoinMetadata<" in ot: meta=c["objectId"]
    slug=f"gally_entity_{i}"
    tokens.append({"package_id":pkg,"module":slug,"witness":slug.upper(),
                   "treasury_cap_id":cap,"metadata_id":meta})
json.dump({"validator_pool_id":None,"validator_cap_id":None,"asset_id":None,"entity_cap_id":None,
           "time_warped":False,"validator_pools":[],"validator_caps":[],
           "entity_tokens":tokens,"entity_tokens_used":0,"lifecycle":{}},
          open(out,"w"), indent=2)
print(f"  wrote sim_state.json with {len(tokens)} entity tokens")
PY
ok "entity-token pool published ($ENTITY_POOL_SIZE)"

# ---------- 3. config.toml ----------
log "3. Write config.toml"
OPERATOR_KEY="$(python3 -c 'import json;print(json.load(open("'"$HOME"'/.sui/sui_config/sui.keystore"))[0])')"
cat > "$REPO/config.toml" <<EOF
RPC_URL = "$RPC_URL"
FAUCET_URL = "$FAUCET_URL"
OPERATOR_KEY = "$OPERATOR_KEY"
GALLY_PACKAGE_ID = "$GALLY_PACKAGE_ID"
PROTOCOL_CONFIG_ID = "$PROTOCOL_CONFIG_ID"
ADMIN_CAP_ID = "$ADMIN_CAP_ID"
USDC_TREASURY_CAP_ID = "$USDC_TREASURY_CAP_ID"
FAUCET_PACKAGE_ID = "$FAUCET_PACKAGE_ID"
MOCK_FAUCET_ID = "$MOCK_FAUCET_ID"
SIM_STATE_PATH = "$REPO/sim_state.json"
USER_KEYS_PATH = "$REPO/sim_users.json"
EOF
ok "config.toml written (operator + all ids)"

# ---------- 4. Postgres + indexer ----------
log "4. Boot Postgres + BI-M8 indexer"
docker start "$PG_CONTAINER" >/dev/null 2>&1 || die "could not start container $PG_CONTAINER"
for i in $(seq 1 20); do docker exec "$PG_CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
if [ "$START_NODE" = "1" ]; then
  # Fresh chain ⇒ fresh index: drop the prior run's DB so the explorer shows ONLY this chain's
  # objects (otherwise old regenesis runs accumulate as phantom assets). The indexer re-creates its
  # whole schema via run_migrations on boot, so an empty DB is safe. FORCE terminates any lingering
  # connection (PG13+). With --no-node we reuse the existing DB instead.
  docker exec "$PG_CONTAINER" psql -U postgres -c "DROP DATABASE IF EXISTS $INDEXER_DB WITH (FORCE);" >/dev/null 2>&1 || true
fi
docker exec "$PG_CONTAINER" psql -U postgres -c "CREATE DATABASE $INDEXER_DB;" >/dev/null 2>&1 || true
( cd "$REPO/Backend Indexer" && cargo build >/dev/null 2>&1 ) || die "indexer build failed"
DATABASE_URL="$PG_BASE/$INDEXER_DB" SUI_NODE_URL="$RPC_URL" GALLY_PACKAGE_ID="$GALLY_PACKAGE_ID" \
  API_BIND="$INDEXER_BIND" RUST_LOG=warn \
  nohup "$REPO/Backend Indexer/target/debug/gally_indexer" > /tmp/rs_indexer.log 2>&1 &
INDEXER_PID=$!
ok "indexer started (pid $INDEXER_PID) → http://$INDEXER_BIND  (db $INDEXER_DB)"

# ---------- 5. bot: genesis + optional soak ----------
log "5. Build + run the simulation bot"
( cd "$REPO/Live Simulation Bot" && cargo build >/dev/null 2>&1 ) || die "bot build failed"
BOT="$REPO/Live Simulation Bot/target/debug/gally_sim_bot"
( cd "$REPO" && SIM_CONFIG="$REPO/config.toml" RUST_LOG=info "$BOT" --seed-all ) \
  || die "genesis (--seed-all) failed"
ok "genesis complete — all lifecycle states seeded"

if [ "$SOAK_CYCLES" -gt 0 ]; then
  log "Daemon soak: $SOAK_CYCLES ticks (--pace $PACE)"
  ( cd "$REPO" && SIM_CONFIG="$REPO/config.toml" RUST_LOG=info "$BOT" --daemon --pace "$PACE" --cycles "$SOAK_CYCLES" ) \
    || die "daemon soak failed"
  ok "soak complete ($SOAK_CYCLES ticks)"
fi

# ---------- 6. summary ----------
log "Stack is up ✅"
cat <<EOF
  chain id        : $CHAIN_ID
  gally package   : $GALLY_PACKAGE_ID
  indexer API     : http://$INDEXER_BIND   (e.g. curl http://$INDEXER_BIND/assets)
  config.toml     : $REPO/config.toml
  continue traffic: cd "$REPO" && SIM_CONFIG=$REPO/config.toml "$BOT" --daemon --pace $PACE
  tear down       : pkill -f gally_indexer; pkill -f 'ssh -N -L ${RPC_PORT}'; ssh $SSH_ALIAS 'pkill -x sui'
EOF

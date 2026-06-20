#!/usr/bin/env bash
# =============================================================================
# run_devnet.sh — Devnet E2E orchestration (DEV-M1).
#
# Brings the WHOLE stack up against the OFFICIAL Sui Devnet (not a local node):
#   1. point the sui client at devnet + the funded operator (the recovery-phrase
#      wallet 0x2f35…); NO devnet faucet — gas comes from that wallet (DEV-G1);
#   2. publish usdc(mock) + gally_core + faucet + N entity-token templates to devnet
#      (usdc's mainnet→Circle Published.toml entry is preserved);
#   3. write config.toml with RPC=devnet, the operator key, GAS_SOURCE=operator, ids;
#   4. boot Postgres + the BI indexer pointed at the devnet RPC;
#   5. run the gas-aware bot: --seed-all (genesis), then (optionally) a bounded
#      --daemon soak. The bot's pre-flight throttle caps the cohort to the wallet.
#
# Devnet packages persist across runs (unlike a local regenesis), so each run is a
# fresh deploy; the bot's genesis is idempotent (SI-5) against sim_state.json.
#
# Usage:  ./run_devnet.sh [--soak CYCLES] [--users N] [--pool N] [--no-deploy]
# =============================================================================
set -euo pipefail

RPC_URL="${RPC_URL:-https://fullnode.devnet.sui.io:443}"
OPERATOR_ADDR="${OPERATOR_ADDR:-0x2f35202a4822c065e1551ebff78ed753103182f569e9e681917e9d5fd2eca0d3}"
ENTITY_POOL_SIZE="${ENTITY_POOL_SIZE:-4}"
USER_COUNT="${USER_COUNT:-60}"          # requested; the bot's DEV-G1 throttle may downscale
PG_CONTAINER="${PG_CONTAINER:-gally-pg}"
PG_BASE="${PG_BASE:-postgres://postgres:postgres@localhost:5432}"
INDEXER_DB="${INDEXER_DB:-gally_devnet}"
INDEXER_BIND="${INDEXER_BIND:-127.0.0.1:8088}"
GAS_BUDGET="${GAS_BUDGET:-2000000000}"  # 2 SUI per publish
SOAK_CYCLES=0
DEPLOY=1

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$HOME/.local/bin:$PATH"
BUILD_ENV="devnet"

while [ $# -gt 0 ]; do
  case "$1" in
    --soak) SOAK_CYCLES="$2"; shift 2;;
    --users) USER_COUNT="$2"; shift 2;;
    --pool) ENTITY_POOL_SIZE="$2"; shift 2;;
    --no-deploy) DEPLOY=0; shift;;
    -h|--help) sed -n '2,22p' "$0"; exit 0;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done

log() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()  { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ---------- 0. preflight: devnet env + operator + balance ----------
log "0. Preflight — devnet env + operator wallet"
for t in sui cargo docker python3 curl; do command -v "$t" >/dev/null || die "missing tool: $t"; done
CHAIN_ID="$(curl -s -m 10 -X POST "$RPC_URL" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"sui_getChainIdentifier","params":[]}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("result",""))')"
[ -n "$CHAIN_ID" ] || die "devnet unreachable at $RPC_URL"
ok "devnet reachable — chain id: $CHAIN_ID"

sui client new-env --alias devnet --rpc "$RPC_URL" >/dev/null 2>&1 || true
sui client switch --env devnet >/dev/null 2>&1 || true
# The operator must be in the keystore (import the recovery phrase once, outside this script):
#   sui keytool import "<recovery phrase>" ed25519
sui client switch --address "$OPERATOR_ADDR" >/dev/null 2>&1 \
  || die "operator $OPERATOR_ADDR not in keystore — run: sui keytool import \"<recovery phrase>\" ed25519"
ok "operator: $OPERATOR_ADDR (devnet)"

BAL="$(curl -s -m 10 -X POST "$RPC_URL" -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"suix_getBalance\",\"params\":[\"$OPERATOR_ADDR\"]}" \
  | python3 -c 'import sys,json;print(int(json.load(sys.stdin)["result"]["totalBalance"]))')"
printf '  operator SUI balance: %s MIST (%.2f SUI)\n' "$BAL" "$(python3 -c "print($BAL/1e9)")"
[ "$BAL" -ge "$GAS_BUDGET" ] || die "operator balance below one publish budget ($GAS_BUDGET) — fund $OPERATOR_ADDR"

# OPERATOR_KEY = the keystore base64(flag||priv) whose address is the operator. `sui keytool
# list --json` is in keystore-array order, so its matching index selects the keystore entry.
OPERATOR_KEY="$(python3 - "$HOME/.sui/sui_config/sui.keystore" "$OPERATOR_ADDR" <<'PY'
import sys, json, subprocess
ks_path, want = sys.argv[1], sys.argv[2]
ks = json.load(open(ks_path))
lst = json.loads(subprocess.check_output(["sui","keytool","list","--json"]).decode())
addrs = [e.get("suiAddress") for e in lst]
idx = addrs.index(want) if want in addrs else None
print(ks[idx] if idx is not None and idx < len(ks) else "", end="")
PY
)"
[ -n "$OPERATOR_KEY" ] || die "could not resolve OPERATOR_KEY for $OPERATOR_ADDR from the keystore"
ok "operator key resolved from keystore"

# ---------- helpers ----------
set_env_devnet() {  # $1 = pkg dir ; rewrite [environments] devnet ; reset Published.toml (keep usdc mainnet)
  python3 - "$1" "$CHAIN_ID" <<'PY'
import sys, re, pathlib
pkg, chain = sys.argv[1], sys.argv[2]
mt = pathlib.Path(pkg, "Move.toml"); t = mt.read_text()
block = f'[environments]\ndevnet = "{chain}"\n'
t = re.sub(r'\[environments\][^\[]*', block + "\n", t, count=1) if "[environments]" in t else (
    t.replace("\n[dependencies]", "\n" + block + "\n[dependencies]", 1) if "[dependencies]" in t else t + "\n" + block)
mt.write_text(t)
pub = pathlib.Path(pkg, "Published.toml")
# usdc keeps its static mainnet (Circle) entry; everything else resets clean.
CIRCLE = "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7"
if pkg.rstrip("/").endswith("usdc"):
    pub.write_text("# Generated by Move\n# This file SHOULD be committed to source control\n\n"
        "[published.mainnet]\nchain-id = \"35834a8a\"\n"
        f"published-at = \"{CIRCLE}\"\noriginal-id = \"{CIRCLE}\"\n"
        "version = 1\ntoolchain-version = \"1.73.1\"\nbuild-config = { flavor = \"sui\", edition = \"2024\" }\n")
else:
    pub.write_text("# Generated by Move\n# This file SHOULD be committed to source control\n")
print("ok")
PY
}
publish_pkg() { ( cd "$1" && sui client publish --json --gas-budget "$GAS_BUDGET" --skip-dependency-verification ) > "$2" 2>"$2.err" \
  || { echo "publish failed for $1:"; tail -8 "$2.err"; return 1; }; }

if [ "$DEPLOY" = 1 ]; then
  # ---------- 1. publish usdc(mock) → gally_core → faucet ----------
  log "1. Publish usdc (mintable mock) → devnet $CHAIN_ID"
  set_env_devnet "$REPO/usdc"
  publish_pkg "$REPO/usdc" /tmp/dv_usdc.json || die "usdc publish failed"
  eval "$(python3 - <<'PY'
import json
d=json.load(open("/tmp/dv_usdc.json")); pkg=cap=None
for c in d.get("objectChanges",[]):
    ot=c.get("objectType","")
    if c.get("type")=="published": pkg=c["packageId"]
    if "TreasuryCap<" in ot and "::usdc::USDC" in ot: cap=c["objectId"]
print(f'USDC_PACKAGE_ID={pkg}\nUSDC_TREASURY_CAP_ID={cap}')
PY
)"
  ok "usdc: $USDC_PACKAGE_ID (TreasuryCap<USDC> $USDC_TREASURY_CAP_ID)"

  log "Publish gally_core → devnet"
  set_env_devnet "$REPO/gally_core"
  publish_pkg "$REPO/gally_core" /tmp/dv_gally.json || die "gally_core publish failed"
  eval "$(python3 - <<'PY'
import json
d=json.load(open("/tmp/dv_gally.json")); pkg=cfg=adm=None
for c in d.get("objectChanges",[]):
    t=c.get("type"); ot=c.get("objectType","")
    if t=="published": pkg=c["packageId"]
    if "::protocol::ProtocolConfig" in ot: cfg=c["objectId"]
    if "::protocol::AdminCap" in ot: adm=c["objectId"]
print(f'GALLY_PACKAGE_ID={pkg}\nPROTOCOL_CONFIG_ID={cfg}\nADMIN_CAP_ID={adm}')
PY
)"
  [ -n "${GALLY_PACKAGE_ID:-}" ] || die "could not parse gally_core ids"
  ok "gally_core: $GALLY_PACKAGE_ID (config $PROTOCOL_CONFIG_ID, admin $ADMIN_CAP_ID)"

  log "Publish gally_mock_faucet → devnet"
  set_env_devnet "$REPO/gally_mock_faucet"
  publish_pkg "$REPO/gally_mock_faucet" /tmp/dv_faucet.json || die "faucet publish failed"
  eval "$(python3 - <<'PY'
import json
d=json.load(open("/tmp/dv_faucet.json")); pkg=fct=None
for c in d.get("objectChanges",[]):
    if c.get("type")=="published": pkg=c["packageId"]
    if "::faucet::MockFaucet" in c.get("objectType",""): fct=c["objectId"]
print(f'FAUCET_PACKAGE_ID={pkg}\nMOCK_FAUCET_ID={fct}')
PY
)"
  [ -n "${FAUCET_PACKAGE_ID:-}" ] || die "could not parse faucet ids"
  ok "faucet: $FAUCET_PACKAGE_ID (MockFaucet $MOCK_FAUCET_ID)"

  log "Publish $ENTITY_POOL_SIZE entity-token templates → devnet"
  ETDIR=/tmp/dv_etpool; rm -rf "$ETDIR"; mkdir -p "$ETDIR"
  for i in $(seq 1 "$ENTITY_POOL_SIZE"); do
    slug="gally_entity_$i"; out="$ETDIR/et$i"
    bash "$REPO/entity_token_template/scripts/instantiate.sh" "$slug" \
        --out "$out" --name "Gally Entity Token $i" --symbol "GET$i" --description "Devnet entity token $i" --force >/dev/null 2>&1 \
        || die "instantiate et$i failed"
    printf '\n[environments]\ndevnet = "%s"\n' "$CHAIN_ID" >> "$out/Move.toml"
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
    tokens.append({"package_id":pkg,"module":slug,"witness":slug.upper(),"treasury_cap_id":cap,"metadata_id":meta})
json.dump({"validator_pool_id":None,"validator_cap_id":None,"asset_id":None,"entity_cap_id":None,
           "time_warped":False,"validator_pools":[],"validator_caps":[],
           "entity_tokens":tokens,"entity_tokens_used":0,"lifecycle":{}}, open(out,"w"), indent=2)
print(f"  wrote sim_state.json with {len(tokens)} entity tokens")
PY
  ok "entity-token pool published ($ENTITY_POOL_SIZE)"

  # ---------- 2. devnet config.toml ----------
  log "2. Write config.toml (devnet, operator-funded gas)"
  cat > "$REPO/config.toml" <<EOF
RPC_URL = "$RPC_URL"
FAUCET_URL = "unused-on-devnet"
GAS_SOURCE = "operator"
USER_COUNT = "$USER_COUNT"
PACE = "accelerated"
OPERATOR_KEY = "$OPERATOR_KEY"
GALLY_PACKAGE_ID = "$GALLY_PACKAGE_ID"
USDC_PACKAGE_ID = "$USDC_PACKAGE_ID"
PROTOCOL_CONFIG_ID = "$PROTOCOL_CONFIG_ID"
ADMIN_CAP_ID = "$ADMIN_CAP_ID"
USDC_TREASURY_CAP_ID = "$USDC_TREASURY_CAP_ID"
FAUCET_PACKAGE_ID = "$FAUCET_PACKAGE_ID"
MOCK_FAUCET_ID = "$MOCK_FAUCET_ID"
SIM_STATE_PATH = "$REPO/sim_state.json"
USER_KEYS_PATH = "$REPO/sim_users.json"
EOF
  ok "config.toml written (devnet ids + GAS_SOURCE=operator)"
else
  log "1-2. --no-deploy: reusing existing config.toml + sim_state.json"
  GALLY_PACKAGE_ID="$(grep -E '^GALLY_PACKAGE_ID' "$REPO/config.toml" | cut -d'"' -f2)"
fi

# ---------- 3. Postgres + indexer (devnet) ----------
log "3. Boot Postgres + BI indexer (pointed at devnet)"
docker start "$PG_CONTAINER" >/dev/null 2>&1 || die "could not start container $PG_CONTAINER"
for i in $(seq 1 20); do docker exec "$PG_CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
[ "$DEPLOY" = 1 ] && docker exec "$PG_CONTAINER" psql -U postgres -c "DROP DATABASE IF EXISTS $INDEXER_DB WITH (FORCE);" >/dev/null 2>&1 || true
docker exec "$PG_CONTAINER" psql -U postgres -c "CREATE DATABASE $INDEXER_DB;" >/dev/null 2>&1 || true
( cd "$REPO/Backend Indexer" && cargo build >/dev/null 2>&1 ) || die "indexer build failed"
pkill -f 'target/debug/gally_indexer' 2>/dev/null || true
DATABASE_URL="$PG_BASE/$INDEXER_DB" SUI_NODE_URL="$RPC_URL" GALLY_PACKAGE_ID="$GALLY_PACKAGE_ID" \
  API_BIND="$INDEXER_BIND" RUST_LOG=warn \
  nohup "$REPO/Backend Indexer/target/debug/gally_indexer" > /tmp/dv_indexer.log 2>&1 &
ok "indexer started → http://$INDEXER_BIND (db $INDEXER_DB, devnet RPC)"

# ---------- 4. bot: genesis + optional soak ----------
log "4. Build + run the gas-aware simulation bot (devnet)"
( cd "$REPO/Live Simulation Bot" && cargo build >/dev/null 2>&1 ) || die "bot build failed"
BOT="$REPO/Live Simulation Bot/target/debug/gally_sim_bot"
( cd "$REPO" && SIM_CONFIG="$REPO/config.toml" RUST_LOG=info "$BOT" --seed-all ) || die "genesis (--seed-all) failed"
ok "genesis complete (gas-throttled cohort, operator-funded)"

if [ "$SOAK_CYCLES" -gt 0 ]; then
  log "Daemon soak: $SOAK_CYCLES ticks (resumes from sim_state.json — no re-publish/re-seed)"
  ( cd "$REPO" && SIM_CONFIG="$REPO/config.toml" RUST_LOG=info "$BOT" --daemon --pace accelerated --cycles "$SOAK_CYCLES" ) || die "daemon soak failed"
  ok "soak complete ($SOAK_CYCLES ticks)"
fi

log "Devnet stack is up ✅"
cat <<EOF
  chain id      : $CHAIN_ID (devnet)
  gally package : ${GALLY_PACKAGE_ID:-?}
  indexer API   : http://$INDEXER_BIND   (curl http://$INDEXER_BIND/assets)
  config.toml   : $REPO/config.toml
  daemon resume : cd "$REPO" && SIM_CONFIG=$REPO/config.toml "$BOT" --daemon --pace accelerated
EOF

#!/usr/bin/env bash
# Register the most traded launchpad pools (script/data/v4-seed-pools.json) on the deployed Uniswap V4 adapter, so
# those tokens route on day one. Anyone may register; already-known or full pairs are skipped.
# Usage: RPC=... PRIVATE_KEY=... ADAPTER=0x... [SEED=script/data/v4-seed-pools-4663.json] ./script/seed-v4.sh
set -uo pipefail
cd "$(dirname "$0")/.."
ok=0; skip=0
while read -r k; do
  if cast send "$ADAPTER" "register((address,address,uint24,int24,address))" "$k" --private-key "$PRIVATE_KEY" --rpc-url "$RPC" >/dev/null 2>&1; then
    ok=$((ok+1))
  else
    skip=$((skip+1))
  fi
done < <(jq -r '.[] | "(\(.currency0),\(.currency1),\(.fee),\(.tickSpacing),\(.hooks))"' "${SEED:-script/data/v4-seed-pools.json}")
echo "registered $ok pools, skipped $skip"

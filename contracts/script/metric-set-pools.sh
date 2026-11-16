#!/usr/bin/env bash
# Point the Metric adapter at the best Metric pools of each pair, from script/data/metric-pools-4663.json
# (python3 -I script/data/metric_pools.py writes it). Sends setPools only for pairs whose list changed.
# Usage: RPC=... PRIVATE_KEY=<keeper> ADAPTER=0x... ./script/metric-set-pools.sh
set -uo pipefail
cd "$(dirname "$0")/.."
LIST="${LIST:-script/data/metric-pools-4663.json}"
low() { tr 'A-F' 'a-f'; }
sent=0; same=0; failed=0
while read -r row; do
  t0=$(jq -r .token0 <<<"$row"); t1=$(jq -r .token1 <<<"$row")
  want=$(jq -c '[.pools[] | ascii_downcase]' <<<"$row")
  have=$(cast call "$ADAPTER" "poolsFor(address,address)(address[])" "$t0" "$t1" --rpc-url "$RPC" | low | tr -d ' []' |
    jq -Rc 'split(",") | map(select(length > 0))')
  if [ "$want" = "$have" ]; then same=$((same + 1)); continue; fi
  arr=$(jq -r '"[" + (.pools | join(",")) + "]"' <<<"$row")
  if cast send "$ADAPTER" "setPools(address,address,address[])" "$t0" "$t1" "$arr" --private-key "$PRIVATE_KEY" \
    --rpc-url "$RPC" >/dev/null 2>&1; then
    sent=$((sent + 1))
  else
    failed=$((failed + 1)); echo "::warning::setPools failed for $t0/$t1"
  fi
done < <(jq -c '.[]' "$LIST")
echo "metric pools: updated $sent pairs, unchanged $same, failed $failed"

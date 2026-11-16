#!/usr/bin/env bash
# Point the Metric adapter at the ranked Metric pools of each swap direction, from script/data/metric-pools-4663.json
# (python3 -I script/data/metric_pools.py writes it). Sends setPools only for directions whose list changed.
# Usage: RPC=... PRIVATE_KEY=<keeper> ADAPTER=0x... ./script/metric-set-pools.sh
set -uo pipefail
cd "$(dirname "$0")/.."
LIST="${LIST:-script/data/metric-pools-4663.json}"
low() { tr 'A-F' 'a-f'; }
sent=0; same=0; failed=0
while read -r row; do
  tin=$(jq -r .tokenIn <<<"$row"); tout=$(jq -r .tokenOut <<<"$row")
  want=$(jq -c '[.pools[] | ascii_downcase]' <<<"$row")
  have=$(cast call "$ADAPTER" "poolsFor(address,address)(address[])" "$tin" "$tout" --rpc-url "$RPC" | low | tr -d ' []' |
    jq -Rc 'split(",") | map(select(length > 0))')
  if [ "$want" = "$have" ]; then same=$((same + 1)); continue; fi
  arr=$(jq -r '"[" + (.pools | join(",")) + "]"' <<<"$row")
  if cast send "$ADAPTER" "setPools(address,address,address[])" "$tin" "$tout" "$arr" --private-key "$PRIVATE_KEY" \
    --rpc-url "$RPC" >/dev/null 2>&1; then
    sent=$((sent + 1))
  else
    failed=$((failed + 1)); echo "::warning::setPools failed for $tin -> $tout"
  fi
done < <(jq -c '.[]' "$LIST")
echo "metric pools: updated $sent directions, unchanged $same, failed $failed"

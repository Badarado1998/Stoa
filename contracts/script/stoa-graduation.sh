#!/usr/bin/env bash
# Watches for $STOA's Uniswap V4 pool on Robinhood Chain (created when the token graduates from its Pons bonding
# curve) and registers it on Stoa's V4 adapter right away, so $STOA routes on stoadex.com within minutes.
# Usage: RPC=... PRIVATE_KEY=... ./script/stoa-graduation.sh   (anyone may register; the key only pays gas)
set -euo pipefail
cd "$(dirname "$0")/.."
STOA=${STOA:-0x13E6993417616De724F2b337D65063f229e96718}
WETH=0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73
PM=0x8366a39CC670B4001A1121B8F6A443A643e40951
INIT=0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438
FROM=${FROM:-114276768}   # $STOA launch block
ADAPTER=$(jq -r .uniswapV4Adapter ../web/lib/deployments-4663.json)
known=$(cast call $ADAPTER "keysFor(address,address)((address,address,uint24,int24,address)[])" $WETH $STOA --rpc-url "$RPC")
[ "$known" = "[]" ] || [ -n "${DRY:-}" ] || { echo "already routable: $known"; exit 0; }
T=0x000000000000000000000000${STOA:2}
logs=$( (cast logs --address $PM $INIT "" "" $T --from-block $FROM --to-block latest --rpc-url "$RPC" --json; \
         cast logs --address $PM $INIT "" $T --from-block $FROM --to-block latest --rpc-url "$RPC" --json) | jq -s 'add')
n=$(echo "$logs" | jq length)
[ "$n" -gt 0 ] || { echo "no Uniswap V4 pool yet: still on the Pons bonding curve"; exit 0; }
echo "$logs" | jq -c '.[]' | while read -r l; do
  c0=0x$(echo "$l" | jq -r '.topics[2]' | cut -c27-); c1=0x$(echo "$l" | jq -r '.topics[3]' | cut -c27-)
  d=$(echo "$l" | jq -r .data | cut -c3-)
  fee=$((16#${d:0:64})); ts=$(cast to-dec 0x${d:64:64} 2>/dev/null || echo 0); hooks=0x${d:152:40}
  [ "$ts" -lt 8388608 ] 2>/dev/null || ts=$(cast --to-int256 0x${d:64:64} 2>/dev/null || echo "$ts")
  key="($c0,$c1,$fee,$ts,$hooks)"
  # only the pool Pons creates at graduation (ETH pair, Pons V2 hook, locked liquidity); anyone can open other
  # pools for the same token, and registering those would only add noise
  [ "${hooks,,}" = "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044" ] && [ "$c0" = "0x0000000000000000000000000000000000000000" ] \
    || { echo "skip $key: not the Pons graduation pool"; continue; }
  echo "registering $key"
  [ -z "${DRY:-}" ] || continue
  cast send $ADAPTER "register((address,address,uint24,int24,address))" "$key" --private-key "$PRIVATE_KEY" --rpc-url "$RPC" | grep -E "^(status|transactionHash) "
done
echo "now: $(cast call $ADAPTER "keysFor(address,address)((address,address,uint24,int24,address)[])" $WETH $STOA --rpc-url "$RPC")"

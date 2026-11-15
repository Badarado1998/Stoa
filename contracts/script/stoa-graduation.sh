#!/usr/bin/env bash
# Watches for $STOA's Uniswap V4 pool on Robinhood Chain (created when the token graduates from its Pons bonding
# curve) and registers it on Stoa's V4 adapter right away, so $STOA routes on stoadex.com without anyone
# having to press the button on the $STOA page. If the curve has graduated but nobody has created the pool yet (a
# plain curve buy leaves that step to the next caller; Pons' own buy helper does it in the same transaction), it
# creates it first through the Pons factory, which anyone may call.
# Usage: RPC=... PRIVATE_KEY=... ./script/stoa-graduation.sh   (anyone may register; the key only pays gas)
set -euo pipefail
cd "$(dirname "$0")/.."
STOA=${STOA:-0x13E6993417616De724F2b337D65063f229e96718}
WETH=0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73
PM=0x8366a39CC670B4001A1121B8F6A443A643e40951
INIT=0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438
FROM=${FROM:-114276768}   # $STOA launch block
CURVE=${CURVE:-0xD0b519310688e830C9aEE29Ae117eDc3fBb1C13f}
FACTORY=0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e
ADAPTER=$(jq -r .uniswapV4Adapter ../web/lib/deployments-4663.json)
known=$(cast call $ADAPTER "keysFor(address,address)((address,address,uint24,int24,address)[])" $WETH $STOA --rpc-url "$RPC")
[ "$known" = "[]" ] || [ -n "${DRY:-}" ] || { echo "already routable: $known"; exit 0; }
T=0x000000000000000000000000${STOA:2}
HOOK=0xe5e702641ea86f4ae6cc3cdaed2b886f976be044
# only the pool Pons creates at graduation (ETH pair, Pons V2 hook, locked liquidity): anyone can open other pools
# for $STOA (some exist already, with no liquidity), and registering those would only add noise
ponsKeys() {
  (cast logs --address $PM $INIT "" "" $T --from-block $FROM --to-block latest --rpc-url "$RPC" --json; \
   cast logs --address $PM $INIT "" $T --from-block $FROM --to-block latest --rpc-url "$RPC" --json) | jq -s 'add' \
  | jq -r --arg h "$HOOK" '.[] | (.data[2:]) as $d
      | select((.topics[2] | ltrimstr("0x") | test("^0+$")) and (("0x" + $d[152:192]) | ascii_downcase) == $h)
      | "\("0x" + $d[0:64]) \("0x" + $d[64:128])"'
}
keys=$(ponsKeys)
if [ -z "$keys" ]; then
  grad=$(cast call $CURVE "graduated()(bool)" --rpc-url "$RPC")
  [ "$grad" = "true" ] || { echo "no graduation pool yet: \$STOA is still on its Pons bonding curve"; exit 0; }
  echo "curve graduated, no graduation pool yet: creating it through the Pons factory"
  [ -z "${DRY:-}" ] || exit 0
  cast send $FACTORY "createGraduatedPool(address)" $STOA --private-key "$PRIVATE_KEY" --rpc-url "$RPC" \
    | grep -E "^(status|transactionHash) " || echo "  failed (someone may have created it first)"
  sleep 5
  keys=$(ponsKeys)
  [ -n "$keys" ] || { echo "still no graduation pool; the next run retries"; exit 0; }
fi
echo "$keys" | while read -r fee ts; do
  key="(0x0000000000000000000000000000000000000000,$STOA,$(cast to-dec $fee),$(cast to-dec $ts),$HOOK)"
  echo "registering $key"
  [ -z "${DRY:-}" ] || continue
  cast send $ADAPTER "register((address,address,uint24,int24,address))" "$key" --private-key "$PRIVATE_KEY" --rpc-url "$RPC" | grep -E "^(status|transactionHash) "
done
echo "now: $(cast call $ADAPTER "keysFor(address,address)((address,address,uint24,int24,address)[])" $WETH $STOA --rpc-url "$RPC")"

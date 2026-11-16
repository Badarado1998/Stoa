#!/usr/bin/env bash
# Registers the Uniswap V4 pool of every recently graduated Pons token on Stoa's V4 adapter, so those tokens route
# on stoadex.com without anyone pressing "Add pool". Only the pool Pons itself creates at graduation (Pons V2 hook,
# locked liquidity), paired with ETH or, for launches priced in USDG, with USDG; launches priced in other tokens
# (stock tokens and the like) are skipped. Only if the adapter does not know it yet. At most MAX registrations per run.
# Usage: RPC=... PRIVATE_KEY=... ./script/pons-graduations.sh   (DRY=1 to only list; anyone may register, the key pays gas)
set -euo pipefail
cd "$(dirname "$0")/.."
FACTORY=0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e
GRADUATED=0xa0a18f5bf205becee8b268d7cf69addab8548ae8ef361791464cf0e0e17c1361   # GraduationTokensPermanentlyLocked(address indexed token, uint256)
PM=0x8366a39CC670B4001A1121B8F6A443A643e40951
INIT=0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438
WETH=0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73
USDG=0x5fc5360d0400a0fd4f2af552add042d716f1d168
HOOK=0xe5e702641ea86f4ae6cc3cdaed2b886f976be044
WINDOW=${WINDOW:-1000000}   # blocks to look back (~30h on Robinhood Chain): runs can be late or skipped
MAX=${MAX:-10}             # registrations per run (a backfill can raise it)
# the router's V4 adapter, and UniswapV4AdapterV2 (keeper-only registration) until the timelock swaps them
ADAPTERS="$(jq -r .uniswapV4Adapter ../web/lib/deployments-4663.json) $(jq -r '.uniswapV4AdapterV2 // empty' deployments/4663-fixes.json 2>/dev/null || true)"
head=$(cast block-number --rpc-url "$RPC")
tokens=$(cast logs --address $FACTORY $GRADUATED --from-block $((head - WINDOW)) --to-block $head --rpc-url "$RPC" --json \
  | jq -r '.[].topics[1]' | sed 's/^0x000000000000000000000000/0x/' | awk '!seen[tolower($0)]++')
[ -n "$tokens" ] || { echo "no Pons graduations in the last $WINDOW blocks"; exit 0; }
for ADAPTER in $(echo $ADAPTERS | tr ' ' '\n' | awk '!seen[tolower($0)]++'); do
echo "adapter $ADAPTER"
done_n=0
for t in $tokens; do
  [ "$done_n" -lt "$MAX" ] || { echo "reached MAX=$MAX for this run"; break; }
  K="keysFor(address,address)((address,address,uint24,int24,address)[])"
  [ "$(cast call $ADAPTER "$K" $WETH $t --rpc-url "$RPC")" = "[]" ] || continue
  [ "$(cast call $ADAPTER "$K" $USDG $t --rpc-url "$RPC")" = "[]" ] || continue
  T=0x000000000000000000000000${t:2}
  logs=$( (cast logs --address $PM $INIT "" "" $T --from-block $((head - WINDOW)) --to-block $head --rpc-url "$RPC" --json; \
           cast logs --address $PM $INIT "" $T --from-block $((head - WINDOW)) --to-block $head --rpc-url "$RPC" --json) | jq -s 'add')
  key=$(echo "$logs" | jq -r --arg h "${HOOK,,}" --arg u "$USDG" '.[] | (.data[2:]) as $d
        | ("0x" + .topics[2][26:]) as $c0 | ("0x" + .topics[3][26:]) as $c1
        | select((("0x" + $d[152:192]) | ascii_downcase) == $h)
        | select(($c0 | test("^0x0+$")) or ($c0 | ascii_downcase) == $u or ($c1 | ascii_downcase) == $u)
        | "\($c0) \($c1) \("0x" + $d[0:64]) \("0x" + $d[64:128])"' | head -1)
  [ -n "$key" ] || { echo "skip $t: no Pons graduation pool with ETH or USDG (priced in another token)"; continue; }
  read -r c0 c1 fee ts <<< "$key"
  k="($c0,$c1,$(cast to-dec $fee),$(cast to-dec $ts),$HOOK)"
  sym=$(cast call $t "symbol()(string)" --rpc-url "$RPC" 2>/dev/null || echo "?")
  echo "registering $sym $k"
  if [ -z "${DRY:-}" ]; then
    cast send $ADAPTER "register((address,address,uint24,int24,address))" "$k" --private-key "$PRIVATE_KEY" --rpc-url "$RPC" \
      | grep -E "^(status|transactionHash) " || echo "  failed (another caller may have registered it first)"
  fi
  done_n=$((done_n + 1))
done
echo "registered this run: $done_n"
done

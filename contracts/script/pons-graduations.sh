#!/usr/bin/env bash
# Registers the Uniswap V4 pool of every recently graduated Pons token on Stoa's V4 adapter, so those tokens route
# on stoadex.com without anyone pressing "Add pool". Only the pool Pons itself creates at graduation (native ETH pair,
# Pons V2 hook, locked liquidity), and only if the adapter does not know it yet. At most MAX registrations per run.
# Usage: RPC=... PRIVATE_KEY=... ./script/pons-graduations.sh   (DRY=1 to only list; anyone may register, the key pays gas)
set -euo pipefail
cd "$(dirname "$0")/.."
FACTORY=0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e
GRADUATED=0xa0a18f5bf205becee8b268d7cf69addab8548ae8ef361791464cf0e0e17c1361   # GraduationTokensPermanentlyLocked(address indexed token, uint256)
PM=0x8366a39CC670B4001A1121B8F6A443A643e40951
INIT=0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438
WETH=0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73
HOOK=0xe5e702641ea86f4ae6cc3cdaed2b886f976be044
ZERO=0x0000000000000000000000000000000000000000000000000000000000000000
WINDOW=${WINDOW:-1000000}   # blocks to look back (~30h on Robinhood Chain): runs can be late or skipped
MAX=${MAX:-10}
ADAPTER=$(jq -r .uniswapV4Adapter ../web/lib/deployments-4663.json)
head=$(cast block-number --rpc-url "$RPC")
tokens=$(cast logs --address $FACTORY $GRADUATED --from-block $((head - WINDOW)) --to-block $head --rpc-url "$RPC" --json \
  | jq -r '.[].topics[1]' | sed 's/^0x000000000000000000000000/0x/' | awk '!seen[tolower($0)]++')
[ -n "$tokens" ] || { echo "no Pons graduations in the last $WINDOW blocks"; exit 0; }
done_n=0
for t in $tokens; do
  [ "$done_n" -lt "$MAX" ] || { echo "reached MAX=$MAX for this run"; break; }
  known=$(cast call $ADAPTER "keysFor(address,address)((address,address,uint24,int24,address)[])" $WETH $t --rpc-url "$RPC")
  [ "$known" = "[]" ] || continue
  T=0x000000000000000000000000${t:2}
  logs=$(cast logs --address $PM $INIT "" $ZERO $T --from-block $((head - WINDOW)) --to-block $head --rpc-url "$RPC" --json)
  key=$(echo "$logs" | jq -r --arg h "${HOOK,,}" '.[] | . as $l | ($l.data[2:]) as $d
        | {fee: ("0x" + $d[0:64]), ts: ("0x" + $d[64:128]), hooks: ("0x" + $d[152:192])}
        | select((.hooks | ascii_downcase) == $h) | "\(.fee) \(.ts)"' | head -1)
  [ -n "$key" ] || { echo "skip $t: no Pons graduation pool found"; continue; }
  fee=$(cast to-dec ${key%% *}); ts=$(cast to-dec ${key##* })
  k="(0x0000000000000000000000000000000000000000,$t,$fee,$ts,$HOOK)"
  sym=$(cast call $t "symbol()(string)" --rpc-url "$RPC" 2>/dev/null || echo "?")
  echo "registering $sym $k"
  if [ -z "${DRY:-}" ]; then
    cast send $ADAPTER "register((address,address,uint24,int24,address))" "$k" --private-key "$PRIVATE_KEY" --rpc-url "$RPC" \
      | grep -E "^(status|transactionHash) " || echo "  failed (another caller may have registered it first)"
  fi
  done_n=$((done_n + 1))
done
echo "registered this run: $done_n"

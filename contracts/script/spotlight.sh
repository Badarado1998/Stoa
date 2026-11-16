#!/usr/bin/env bash
# Weekly Spotlight settlement on Robinhood Chain (.github/workflows/spotlight-weekly.yml), Monday 00:07 UTC (07:07 WIB):
# 1. settle the week that just closed (finalize: anyone may call it; picks the winners, makes their ETH claimable)
# 2. as the keeper, spend the burn pot on $STOA through the Stoa router with a minimum output from a fresh quote, and
#    send it to 0x...dEaD (SpotlightMarket.burn).
# Env: RPC, PK (keeper key). Fork test: SEND="--from <keeper> --unlocked" instead of PK. SLIPPAGE_BPS (default 200), MIN_POT_WEI (default 1e15 = 0.001 ETH), DRY=1 to only print.
set -euo pipefail
D=${D:-../web/lib/deployments-4663.json}
SLIP=${SLIPPAGE_BPS:-200}
MIN_POT=${MIN_POT_WEI:-1000000000000000}
SEND=${SEND:---private-key ${PK:-}}
M=$(jq -r '.spotlightMarket // empty' $D); ROUTER=$(jq -r .router $D); STOA=$(jq -r .stoa $D)
Z=0x0000000000000000000000000000000000000000
[ -n "$M" ] || { echo "NOT CONFIGURED: no spotlightMarket in $D"; exit 0; }
[ "$(cast code $M --rpc-url $RPC)" != "0x" ] || { echo "NOT DEPLOYED yet at $M"; exit 0; }
START=$(cast call $M 'start()(uint256)' --rpc-url $RPC | cut -d' ' -f1)
NOW=$(date +%s)
[ "$NOW" -ge "$START" ] || { echo "Week 1 has not started (starts $START)"; exit 0; }
E=$(( (NOW - START) / 604800 ))
if [ "$E" -ge 1 ]; then
  P=$((E - 1))
  FIN=$(cast call $M 'epochInfo(uint256)((uint8,uint16,uint64,uint64,uint96,uint128),bool,bool,address[],address[])' $P --rpc-url $RPC | sed -n 3p)
  if [ "$FIN" = "false" ]; then
    echo "Settling week $((P + 1))"
    [ -n "${DRY:-}" ] || cast send $M 'finalize(uint256)' $P $SEND --rpc-url $RPC | grep -E "^(status|transactionHash) "
  else
    echo "Week $((P + 1)) already settled"
  fi
  cast call $M 'epochInfo(uint256)((uint8,uint16,uint64,uint64,uint96,uint128),bool,bool,address[],address[])' $P --rpc-url $RPC | sed -n 5p | sed 's/^/Winners: /'
fi
POT=$(cast call $M 'burnPot()(uint256)' --rpc-url $RPC | cut -d' ' -f1)
if python3 -c "import sys; sys.exit(0 if int('$POT') >= int('$MIN_POT') else 1)"; then
  QT='quote(address,address,uint256)((uint256,address,(address,bool),(address,bool)))'
  read -r OUT MID V1 P1 V2 P2 <<<"$(cast call $ROUTER "$QT" $Z $STOA $POT --rpc-url $RPC | sed -E 's/ \[[^]]*\]//g' | tr -d '(),')"
  [ "${OUT:-0}" != "0" ] || { echo "No route from ETH to \$STOA right now; the pot waits"; exit 0; }
  source script/route-check.sh
  MIN=$(safe_min $Z $STOA $POT $OUT $MID $V1 $V2 $SLIP)
  [ -n "$MIN" ] || { echo "The route did not pass the checks; the pot waits"; exit 0; }
  echo "Burning the pot: $POT wei ETH -> ~$OUT STOA (min $MIN)"
  [ -n "${DRY:-}" ] || cast send $M 'burn(address,(address,bool),(address,bool),uint256)' $MID "($V1,$P1)" "($V2,$P2)" $MIN $SEND --rpc-url $RPC | grep -E "^(status|transactionHash) "
else
  echo "Burn pot $POT wei is below $MIN_POT; it waits"
fi
echo "Total \$STOA burned by Spotlight: $(python3 -c "print(round(int('$(cast call $M 'totalBurned()(uint256)' --rpc-url $RPC | cut -d' ' -f1)') / 1e18, 2))")"

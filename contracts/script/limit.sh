#!/usr/bin/env bash
# Limit order keeper on Robinhood Chain (.github/workflows/limit-keeper.yml), about every 5 minutes:
# 1. for every open order whose minimum the router can pay now, fill it along the router's own best route (the router
#    pays the maker directly and reverts below the order's minimum, so a fill can never give the maker less);
# 2. return the deposit of every expired order to its maker.
# Env: RPC, PK (keeper key). Fork test: SEND="--from <keeper> --unlocked" instead of PK. DRY=1 to only print.
set -euo pipefail
D=${D:-../web/lib/deployments-4663.json}
SEND=${SEND:---private-key ${PK:-}}
L=$(jq -r '.limit // empty' $D); ROUTER=$(jq -r .router $D)
[ -n "$L" ] || { echo "NOT CONFIGURED: no limit in $D"; exit 0; }
[ "$(cast code $L --rpc-url $RPC)" != "0x" ] || { echo "NOT DEPLOYED yet at $L"; exit 0; }
QT='quote(address,address,uint256)((uint256,address,(address,bool),(address,bool)))'
OT='order(uint256)((address,uint8,uint64,address,address,address,uint256,uint256))'
clean() { sed -E 's/ \[[^]]*\]//g' | tr -d '(),'; }

# StoaLimitV2 has no cap on open orders across makers: read them in pages
IDS=""; START=0
while :; do
  PAGE=$(cast call $L 'openIds(uint256,uint256)(uint256[])' $START 500 --rpc-url $RPC | tr -d '[],')
  IDS="$IDS $PAGE"; COUNT=$(echo $PAGE | wc -w)
  [ "$COUNT" -eq 500 ] || break
  START=$((START + 500))
done
# chain time, not this machine's clock: cancel() checks block.timestamp
NOW=$(cast block latest -f timestamp --rpc-url $RPC); N=0; F=0; C=0
for ID in $IDS; do
  N=$((N + 1))
  read -r MAKER STATUS EXP TIN TOUT REF AIN MIN <<<"$(cast call $L "$OT" $ID --rpc-url $RPC | clean)"
  [ "$STATUS" = "1" ] || continue
  if [ "$NOW" -gt "$EXP" ]; then
    echo "Order $ID expired: returning its deposit to $MAKER"
    [ -n "${DRY:-}" ] || { cast send $L 'cancel(uint256)' $ID $SEND --rpc-url $RPC | grep -E "^(status|transactionHash) " && C=$((C + 1)); } || echo "  cancel failed"
    continue
  fi
  read -r OUT MID V1 P1 V2 P2 <<<"$(cast call $ROUTER "$QT" $TIN $TOUT $AIN --rpc-url $RPC 2>/dev/null | clean || echo "0")"
  if [ "${OUT:-0}" != "0" ] && python3 -c "import sys; sys.exit(0 if int('$OUT') >= int('$MIN') else 1)"; then
    echo "Order $ID: the router pays $OUT, at least the minimum $MIN: filling"
    [ -n "${DRY:-}" ] || { cast send $L 'fill(uint256,address,(address,bool),(address,bool))' $ID $MID "($V1,$P1)" "($V2,$P2)" $SEND --rpc-url $RPC | grep -E "^(status|transactionHash) " && F=$((F + 1)); } || echo "  fill failed (the price moved); next run tries again"
  fi
done
echo "Open orders checked: $N · filled: $F · expired and returned: $C"

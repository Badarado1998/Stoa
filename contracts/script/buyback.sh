#!/usr/bin/env bash
# Weekly $STOA buyback & burn on Robinhood Chain (.github/workflows/buyback-robinhood.yml).
# For every token the FeeDistributor has collected protocol fees in: if the fees are worth at least $MIN_USD and the
# router has a route to $STOA, the keeper calls StoaBuyback.buyback, which withdraws them, buys $STOA through the Stoa
# router and burns it in the same transaction. Fees already in $STOA are burned directly.
# Env: RPC, LOGS_RPC (answers eth_getLogs over the whole deployment), PK (keeper key). Fork test: SEND="--from <keeper>
# --unlocked" instead of PK. MIN_USD (default 1), SLIPPAGE_BPS (default 200), DRY=1 to only print.
set -euo pipefail
D=${D:-../web/lib/deployments-4663.json}
LOGS_RPC=${LOGS_RPC:-$RPC}
MIN_USD=${MIN_USD:-1}
SLIP=${SLIPPAGE_BPS:-200}
SEND=${SEND:---private-key ${PK:-}}
BB=$(jq -r '.stoaBuyback // empty' $D); FEES=$(jq -r .feeDistributor $D); ROUTER=$(jq -r .router $D)
STOA=$(jq -r .stoa $D); FROM=$(jq -r .block $D); USDG=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
Z=0x0000000000000000000000000000000000000000
[ -n "$BB" ] || { echo "NOT DEPLOYED: no stoaBuyback in $D"; exit 0; }
OWNER=$(cast call $FEES 'owner()(address)' --rpc-url $RPC)
[ "${OWNER,,}" = "${BB,,}" ] || { echo "NOT ACTIVE: the FeeDistributor is still owned by $OWNER (the timelock handover is pending)"; exit 0; }

source script/route-check.sh
QT='quote(address,address,uint256)((uint256,address,(address,bool),(address,bool)))'
# "(out, mid, (v1, p1), (v2, p2))" -> "out mid v1 p1 v2 p2"
route() { cast call $ROUTER "$QT" $1 $2 $3 --rpc-url $RPC 2>/dev/null | sed -E 's/ \[[^]]*\]//g' | tr -d '(),' || echo "0"; }
BURNED0=$(cast call $BB 'totalBurned()(uint256)' --rpc-url $RPC | cut -d' ' -f1)
TOPIC=$(cast keccak "FeeNotified(address,address,uint256,address,uint256)")
TOKENS=$(cast logs --from-block $FROM --address $FEES $TOPIC --rpc-url $LOGS_RPC --json | jq -r '.[].topics[2]' | sed 's/^0x000000000000000000000000/0x/' | sort -u)
[ -n "$TOKENS" ] || { echo "NO FEES yet"; exit 0; }

for T in $TOKENS; do
  T=$(cast to-check-sum-address $T)
  ACC=$(cast call $FEES 'protocolAccrued(address)(uint256)' $T --rpc-url $RPC | cut -d' ' -f1)
  SYM=$(cast call $T 'symbol()(string)' --rpc-url $RPC 2>/dev/null | tr -d '"' || echo "$T")
  [ "$ACC" != "0" ] || { echo "$SYM: no protocol fees waiting"; continue; }
  if [ "${T,,}" = "${STOA,,}" ]; then
    echo "$SYM: burning $ACC directly"
    [ -n "${DRY:-}" ] || cast send $BB 'buyback(address,uint256,address,(address,bool),(address,bool),uint256)' $T $ACC $Z "($Z,false)" "($Z,false)" 0 $SEND --rpc-url $RPC | grep -E "^(status|transactionHash) "
    continue
  fi
  # value check in USDG
  if [ "${T,,}" = "${USDG,,}" ]; then USD=$ACC; else read -r USD _ <<<"$(route $T $USDG $ACC)"; fi
  if python3 -c "import sys; sys.exit(0 if int('${USD:-0}') >= int(float('$MIN_USD') * 1e6) else 1)"; then :; else
    echo "$SYM: fees worth \$$(python3 -c "print(round(int('${USD:-0}')/1e6, 4))") < \$$MIN_USD, left to accumulate"; continue
  fi
  read -r OUT MID V1 P1 V2 P2 <<<"$(route $T $STOA $ACC)"
  [ "${OUT:-0}" != "0" ] || { echo "$SYM: no route to \$STOA yet (still on its bonding curve?), left to accumulate"; continue; }
  MIN=$(safe_min $T $STOA $ACC $OUT $MID $V1 $V2 $SLIP)
  [ -n "$MIN" ] || { echo "$SYM: the route did not pass the checks, left for the next run"; continue; }
  echo "$SYM: $ACC -> ~$OUT STOA (min $MIN) via $V1${MID:+ / $V2}"
  [ -n "${DRY:-}" ] && continue
  ARGS=($T $ACC $MID "($V1,$P1)" "($V2,$P2)" $MIN)
  FROMADDR=$( [ -n "${PK:-}" ] && cast wallet address --private-key "$PK" || echo "$SEND" | awk '{print $2}')
  G=$(cast estimate $BB 'buyback(address,uint256,address,(address,bool),(address,bool),uint256)' "${ARGS[@]}" --from $FROMADDR --rpc-url $RPC)
  cast send $BB 'buyback(address,uint256,address,(address,bool),(address,bool),uint256)' "${ARGS[@]}" --gas-limit $((G * 13 / 10 + 50000)) $SEND --rpc-url $RPC | grep -E "^(status|transactionHash) "
done
BURNED1=$(cast call $BB 'totalBurned()(uint256)' --rpc-url $RPC | cut -d' ' -f1)
echo "BURNED this run: $(python3 -c "print(round((int('$BURNED1') - int('$BURNED0')) / 1e18, 4))") STOA · total burned by buybacks: $(python3 -c "print(round(int('$BURNED1') / 1e18, 4))") STOA"

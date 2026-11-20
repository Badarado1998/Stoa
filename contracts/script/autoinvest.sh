#!/usr/bin/env bash
# Auto-invest keeper on Robinhood Chain (.github/workflows/autoinvest-keeper.yml), about every 15 minutes: runs every
# StoaAutoInvest buy that is due, for plans whose runner is this keeper. The minimum it passes is its own router quote
# less KEEP_SLIP_BPS; the contract also refuses a minimum below the on-chain quote less the plan's slippage, and the
# router refuses to pay less than the minimum, so a buy can never fill worse than the plan allows.
# Plans worth less than MIN_USDG per buy are left alone (the keeper pays the gas; this keeps spam plans unpaid).
# Env: RPC, PK (keeper key). DRY=1 to only print.
set -euo pipefail
D=${D:-../web/lib/deployments-4663.json}
SEND=${SEND:---private-key ${PK:-}}
A=$(jq -r '.autoInvest // empty' $D); ROUTER=$(jq -r .router $D); USDG=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
[ -n "$A" ] || { echo "NOT CONFIGURED: no autoInvest in $D"; exit 0; }
[ "$(cast code $A --rpc-url $RPC)" != "0x" ] || { echo "NOT DEPLOYED yet at $A"; exit 0; }
ME=$(cast wallet address $SEND 2>/dev/null || echo "")
KEEP_SLIP_BPS=${KEEP_SLIP_BPS:-50}; MIN_USDG=${MIN_USDG:-5000000}; MAX_PER_PASS=${MAX_PER_PASS:-100}
QT='quote(address,address,uint256)((uint256,address,(address,bool),(address,bool)))'
PT='plan(uint256)((address,address,address,uint96,uint32,uint16,uint16,uint64,address))'
clean() { sed -E 's/ \[[^]]*\]//g' | tr -d '(),'; }
lc() { tr 'A-F' 'a-f'; }

IDS=""; START=0
while :; do
  PAGE=$(cast call $A 'due(uint256,uint256)(uint256[])' $START 500 --rpc-url $RPC | tr -d '[],')
  IDS="$IDS $PAGE"; COUNT=$(echo $PAGE | wc -w)
  [ "$COUNT" -eq 500 ] || break
  LAST=$(echo $PAGE | awk '{print $NF}'); START=$((LAST + 1))
done
N=0; B=0
for ID in $IDS; do
  [ "$N" -lt "$MAX_PER_PASS" ] || { echo "pass cap reached ($MAX_PER_PASS)"; break; }
  read -r OWNER TIN TOUT AMT INT LEFT SLIP NEXT RUNNER <<<"$(cast call $A "$PT" $ID --rpc-url $RPC | clean)"
  [ -n "$ME" ] && [ "$(echo $RUNNER | lc)" != "$(echo $ME | lc)" ] && continue
  N=$((N + 1))
  # value of one buy in USDG
  if [ "$(echo $TIN | lc)" = "$(echo $USDG | lc)" ]; then V=$AMT; else
    read -r V _ <<<"$(cast call $ROUTER "$QT" $TIN $USDG $AMT --rpc-url $RPC 2>/dev/null | clean || echo 0)"; fi
  python3 -c "import sys; sys.exit(0 if int('${V:-0}') >= int('$MIN_USDG') else 1)" || { echo "Plan $ID: under the minimum value, skipped"; continue; }
  read -r OUT _ <<<"$(cast call $ROUTER "$QT" $TIN $TOUT $AMT --rpc-url $RPC 2>/dev/null | clean || echo 0)"
  [ "${OUT:-0}" != "0" ] || { echo "Plan $ID: no route right now"; continue; }
  MIN=$(python3 -c "print(int('$OUT') * (10000 - $KEEP_SLIP_BPS) // 10000)")
  echo "Plan $ID: buying with $AMT for at least $MIN ($LEFT left)"
  [ -n "${DRY:-}" ] || { cast send $A 'execute(uint256,uint256)' $ID $MIN $SEND --rpc-url $RPC | grep -E "^(status|transactionHash) " && B=$((B + 1)); } || echo "  buy failed (allowance, balance or price); it stays due"
done
echo "auto-invest: $N due plans for this keeper, $B bought"

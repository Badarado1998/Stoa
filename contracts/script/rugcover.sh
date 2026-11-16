#!/usr/bin/env bash
# Rug Cover keeper on Robinhood Chain (.github/workflows/rugcover-keeper.yml), about every 5 minutes:
# 1. for every token with an open cover term, breach it if its creator's balance is below the floor (anyone may; the
#    caller earns the bounty, which pays the keeper's gas), so covered buyers can claim their ETH;
# 2. as the keeper, once the burn pot reaches MIN_POT_WEI, spend it on $STOA through the Stoa router with a minimum
#    output from a fresh quote, and send it to 0x...dEaD (RugCover.burn);
# 3. withdraw the keeper's bounties once they are worth it.
# Env: RPC, PK (keeper key). Fork test: SEND="--from <keeper> --unlocked" instead of PK. SLIPPAGE_BPS (default 200),
# MIN_POT_WEI (default 1e16 = 0.01 ETH), DRY=1 to only print.
set -euo pipefail
D=${D:-../web/lib/deployments-4663.json}
SLIP=${SLIPPAGE_BPS:-200}
MIN_POT=${MIN_POT_WEI:-10000000000000000}
SEND=${SEND:---private-key ${PK:-}}
R=$(jq -r '.rugCover // empty' $D); ROUTER=$(jq -r .router $D); STOA=$(jq -r .stoa $D)
Z=0x0000000000000000000000000000000000000000
[ -n "$R" ] || { echo "NOT CONFIGURED: no rugCover in $D"; exit 0; }
[ "$(cast code $R --rpc-url $RPC)" != "0x" ] || { echo "NOT DEPLOYED yet at $R"; exit 0; }
source script/route-check.sh

TOKENS=$(cast call $R 'openTokens()(address[])' --rpc-url $RPC | tr -d '[],')
N=0
for T in $TOKENS; do
  N=$((N + 1))
  if [ "$(cast call $R 'breachable(address)(bool)' $T --rpc-url $RPC)" = "true" ]; then
    echo "Breach: the creator of $T is below its floor"
    [ -n "${DRY:-}" ] || cast send $R 'breach(address)' $T $SEND --rpc-url $RPC | grep -E "^(status|transactionHash) "
  fi
done
echo "Open cover terms checked: $N"

POT=$(cast call $R 'burnPot()(uint256)' --rpc-url $RPC | cut -d' ' -f1)
if python3 -c "import sys; sys.exit(0 if int('$POT') >= int('$MIN_POT') else 1)"; then
  QT='quote(address,address,uint256)((uint256,address,(address,bool),(address,bool)))'
  read -r OUT MID V1 P1 V2 P2 <<<"$(cast call $ROUTER "$QT" $Z $STOA $POT --rpc-url $RPC | sed -E 's/ \[[^]]*\]//g' | tr -d '(),')"
  MIN=""
  if [ "${OUT:-0}" != "0" ]; then
    MIN=$(safe_min $Z $STOA $POT $OUT $MID $V1 $V2 $SLIP)
  fi
  if [ "${OUT:-0}" = "0" ]; then
    echo "No route from ETH to \$STOA right now; the pot waits"
  elif [ -z "$MIN" ]; then
    echo "The route did not pass the checks; the pot waits"
  else
    echo "Burning the pot: $POT wei ETH -> ~$OUT STOA (min $MIN)"
    [ -n "${DRY:-}" ] || cast send $R 'burn(address,(address,bool),(address,bool),uint256)' $MID "($V1,$P1)" "($V2,$P2)" $MIN $SEND --rpc-url $RPC | grep -E "^(status|transactionHash) "
  fi
else
  echo "Burn pot $POT wei is below $MIN_POT; it waits"
fi

if [ -n "${PK:-}" ]; then
  ME=$(cast wallet address --private-key "$PK")
  C=$(cast call $R 'credits(address)(uint256)' $ME --rpc-url $RPC | cut -d' ' -f1)
  if python3 -c "import sys; sys.exit(0 if int('$C') >= 10**15 else 1)"; then
    echo "Withdrawing $C wei of breach bounties to the keeper"
    [ -n "${DRY:-}" ] || cast send $R 'withdrawCredit(address)' $ME $SEND --rpc-url $RPC | grep -E "^(status|transactionHash) "
  fi
fi
echo "Total \$STOA burned by Rug Cover: $(python3 -c "print(round(int('$(cast call $R 'totalBurned()(uint256)' --rpc-url $RPC | cut -d' ' -f1)') / 1e18, 2))")"

#!/usr/bin/env bash
# Used by .github/workflows/timelock.yml. Env: RPC, OWNER_PK, DEP_PK, MULTISEND, DELAY, UNBOND.
# For a fork test set SEND_OWNER / SEND_DEP to "--from <addr> --unlocked" instead of the keys.
set -euo pipefail
D=../web/lib/deployments.json
SAFE=$(jq -r .safe $D)
REG=$(jq -r .makerRegistry $D)
TARGETS=($(jq -r '.router, .poolWhypeUsdc, .makerRegistry, .feeDistributor, .uniswapV4Adapter' $D))
SEND_OWNER=${SEND_OWNER:---private-key $OWNER_PK}
SEND_DEP=${SEND_DEP:---private-key $DEP_PK}
OWNER=${OWNER:-$(cast wallet address --private-key "$OWNER_PK")}
DEP=${DEP:-$(cast wallet address --private-key "$DEP_PK")}
Z=0x0000000000000000000000000000000000000000
ZB=0x0000000000000000000000000000000000000000000000000000000000000000

for t in "${TARGETS[@]}"; do
  o=$(cast call $t 'owner()(address)' --rpc-url $RPC)
  [ "${o,,}" = "${SAFE,,}" ] || { echo "$t is owned by $o, expected the Safe"; exit 1; }
done

# 1. timelock: delay 0 for the handover, raised to $DELAY at the end of the same Safe transaction
TL=$(jq -r '.timelock // empty' $D)
if [ -z "$TL" ]; then
  OUT=$(forge create lib/openzeppelin-contracts/contracts/governance/TimelockController.sol:TimelockController \
    --rpc-url $RPC $SEND_DEP --broadcast --json --constructor-args 0 "[$SAFE]" "[$SAFE]" $Z)
  TL=$(echo "$OUT" | jq -r .deployedTo)
  TL=$(cast to-check-sum-address $TL)
  jq --arg t "$TL" '.timelock = $t' $D > /tmp/d.json && mv /tmp/d.json $D
fi
echo "timelock $TL"
[ "$(cast call $TL 'getMinDelay()(uint256)' --rpc-url $RPC)" = "0" ] || { echo "timelock delay already set"; exit 1; }

# 2. the operations the timelock runs: accept the five contracts, longer unbonding, then its own 48h delay
ACC=$(cast calldata 'acceptOwnership()')
OPS_T=(); OPS_D=()
for t in "${TARGETS[@]}"; do OPS_T+=($t); OPS_D+=($ACC); done
OPS_T+=($REG); OPS_D+=($(cast calldata 'setUnbondDelay(uint64)' $UNBOND))
OPS_T+=($TL); OPS_D+=($(cast calldata 'updateDelay(uint256)' $DELAY))
J() { local IFS=,; echo "[$*]"; }
VALS=$(J $(for _ in "${OPS_T[@]}"; do echo 0; done))
SALT=$(cast keccak "stoa-timelock-handover")
SCHED=$(cast calldata 'scheduleBatch(address[],uint256[],bytes[],bytes32,bytes32,uint256)' "$(J "${OPS_T[@]}")" "$VALS" "$(J "${OPS_D[@]}")" $ZB $SALT 0)
EXEC=$(cast calldata 'executeBatch(address[],uint256[],bytes[],bytes32,bytes32)' "$(J "${OPS_T[@]}")" "$VALS" "$(J "${OPS_D[@]}")" $ZB $SALT)

# 3. one Safe transaction: transferOwnership x5 -> scheduleBatch -> executeBatch
CALLS=()
for t in "${TARGETS[@]}"; do CALLS+=("$t:$(cast calldata 'transferOwnership(address)' $TL)"); done
CALLS+=("$TL:$SCHED" "$TL:$EXEC")
PACKED=$(python3 -c "
import sys
out=b''
for c in sys.argv[1:]:
    to,data=c.split(':'); d=bytes.fromhex(data[2:])
    out+=b'\x00'+bytes.fromhex(to[2:])+(0).to_bytes(32,'big')+len(d).to_bytes(32,'big')+d
print('0x'+out.hex())" "${CALLS[@]}")
DATA=$(cast calldata 'multiSend(bytes)' $PACKED)
NONCE=$(cast call $SAFE 'nonce()(uint256)' --rpc-url $RPC | cut -d' ' -f1)
H=$(cast call $SAFE 'getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256)(bytes32)' $MULTISEND 0 $DATA 1 0 0 0 $Z $Z $NONCE --rpc-url $RPC)
echo "Safe tx $H (nonce $NONCE)"
cast send $SAFE 'approveHash(bytes32)' $H $SEND_DEP --rpc-url $RPC | grep -E "^status "
SIGS=$(python3 -c "
import sys
s=sorted(sys.argv[1:], key=lambda a:int(a,16))
print('0x'+''.join(a[2:].lower().rjust(64,'0')+'0'*64+'01' for a in s))" $DEP $OWNER)
cast send $SAFE 'execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)' \
  $MULTISEND 0 $DATA 1 0 0 0 $Z $Z $SIGS $SEND_OWNER --rpc-url $RPC --gas-limit 3000000 | grep -E "^(status|transactionHash) "

# 4. check
for t in "${TARGETS[@]}"; do
  o=$(cast call $t 'owner()(address)' --rpc-url $RPC); echo "$t owner $o"
  [ "${o,,}" = "${TL,,}" ] || { echo "FAILED: $t not owned by the timelock"; exit 1; }
done
echo "timelock delay $(cast call $TL 'getMinDelay()(uint256)' --rpc-url $RPC) s"
echo "maker unbond delay $(cast call $REG 'unbondDelay()(uint64)' --rpc-url $RPC) s"
echo "Safe is proposer: $(cast call $TL 'hasRole(bytes32,address)(bool)' $(cast keccak PROPOSER_ROLE) $SAFE --rpc-url $RPC)"
echo "timelock has no admin: $(cast call $TL 'hasRole(bytes32,address)(bool)' $ZB $SAFE --rpc-url $RPC) (Safe) $(cast call $TL 'hasRole(bytes32,address)(bool)' $ZB $OWNER --rpc-url $RPC) (owner)"
echo "Done. Delete the OWNER_PRIVATE_KEY secret now."

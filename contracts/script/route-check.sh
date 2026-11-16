# Sourced by rugcover.sh, spotlight.sh and buyback.sh (run from contracts/). Before the keeper spends a pot or fees on
# $STOA it checks the router's route:
# 1. it must not use Stoa's first Uniswap V4 adapter on a pair an outsider has changed (script/v4_guard.py; that
#    adapter let anyone replace a pair's real pool, reported by Hey Research Lab, until the timelock removes it);
# 2. for ETH input, the router's quote must not be clearly below UniswapV4AdapterV2's quote, whose pool list only
#    Stoa's keeper sets (an independent price; a lower router quote means a planted pool, or a closed one).
# 3. when buying $STOA, the router's quote must not be clearly below the canonical $STOA pool (the Pons graduation
#    pool, pinned here) quoted directly through Uniswap's own V4Quoter: a reference that does not depend on any of
#    Stoa's adapters or their pool lists (GHSA-cv5f-wmmh-wcrv re-test). If that quote cannot be read, the swap waits.
# safe_min prints the minimum output to use, or nothing if the swap should wait for the next run. RPC must be set.
V4V2=$(jq -r '.uniswapV4AdapterV2 // empty' deployments/4663-fixes.json 2>/dev/null || true)
RC_WETH=0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73
RC_STOA=0x13E6993417616De724F2b337D65063f229e96718
RC_QUOTER=0x8dc178efb8111bb0973dd9d722ebeff267c98f94 # Uniswap V4Quoter on Robinhood Chain (Uniswap's deployments page)
RC_STOA_KEY="(0x0000000000000000000000000000000000000000,$RC_STOA,0,200,0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044)"
safe_min() { # tokenIn tokenOut amountIn quotedOut mid v1 v2 slippageBps
  local tin=$1 tout=$2 amt=$3 out=$4 mid=$5 v1=$6 v2=$7 slip=$8 ref
  if ! python3 -I script/v4_guard.py route "$tin" "$tout" "$mid" "$v1" "$v2" >/dev/null; then
    echo "::warning::the route uses the first Uniswap V4 adapter on a pair an outsider has changed, or the check failed; waiting" >&2
    return 0
  fi
  if [ -n "$V4V2" ] && { [ "${tin,,}" = "0x0000000000000000000000000000000000000000" ] || [ "${tin,,}" = "${RC_WETH,,}" ]; }; then
    ref=$(cast call "$V4V2" 'quote(address,address,uint256)(uint256)' $RC_WETH "$tout" "$amt" --rpc-url "$RPC" 2>/dev/null | cut -d' ' -f1 || echo 0)
    # the router charges 2 bps on adapter routes; allow 0.5% for blocks moving between the two calls
    if python3 -c "import sys; sys.exit(0 if int('${ref:-0}') * 9998 * 9950 > int('$out') * 10**8 else 1)"; then
      echo "::warning::router quote $out is below the keeper-curated V4 quote $ref; waiting" >&2
      return 0
    fi
  fi
  if [ "${tout,,}" = "${RC_STOA,,}" ] && { [ "${tin,,}" = "0x0000000000000000000000000000000000000000" ] || [ "${tin,,}" = "${RC_WETH,,}" ]; }; then
    ref=$(cast call "$RC_QUOTER" 'quoteExactInputSingle(((address,address,uint24,int24,address),bool,uint128,bytes))(uint256,uint256)' \
      "($RC_STOA_KEY,true,$amt,0x)" --rpc-url "$RPC" 2>/dev/null | head -1 | cut -d' ' -f1)
    if ! [[ "$ref" =~ ^[0-9]+$ ]] || [ "$ref" = 0 ]; then
      echo "::warning::could not quote the canonical STOA pool through Uniswap's V4Quoter; waiting" >&2
      return 0
    fi
    if python3 -c "import sys; sys.exit(0 if int('$ref') * 9998 * 9950 > int('$out') * 10**8 else 1)"; then
      echo "::warning::router quote $out is below the canonical STOA pool quote $ref; waiting" >&2
      return 0
    fi
  fi
  python3 -c "print(int('$out') * (10000 - $slip) // 10000)"
}

#!/usr/bin/env bash
# Register the most traded launchpad pools (script/data/v4-seed-pools.json) on a deployed Uniswap V4 adapter, so
# those tokens route on day one. Already-known pools are skipped.
#
# Never evicts: a pair that already holds the adapter's maximum number of pool keys is skipped. On a full pair the
# adapter replaces the key with the least in-range liquidity, and the seed list is ranked by swap count, which can be
# wash-traded: registering into a full pair could let planted pools push out a pair's real pool (Hey Research Lab,
# GHSA-cv5f-wmmh-wcrv re-test). Full pairs are changed only by hand (unregister, then register), after checking quotes.
#
# PROTECT=0xToken,0xToken skips every pool that trades one of these tokens: their pairs are set by hand only.
# PROTECT_PAIRS=0xA-0xB,... skips these pairs (0x0 for native ETH): the pairs Stoa's own flows use, set by hand only.
# Never fills a pair: it stops at MAX_PER_PAIR keys (default 4) even when the adapter holds more, so two slots stay free
# for the real pool if planted pools reach a pair first (Hey Research Lab, UniswapV4AdapterV3 review, Low 2). Every
# "skip (pair full ...)" line is also written to FULL_LOG (if set) and raised as a workflow warning, so a real pool kept
# out is seen the same day.
# Slow pools are kept out by the rankings instead (v4_top_pools.py deep(): a reference trade must cost at most
# MAX_REF_GAS to simulate), which also lets real narrow-spacing pools in (HEY Research Lab follow-up, F-4).
# MIN_HOOKLESS_SPACING=N (default 0: off) still refuses hook-less pools with a tick spacing under N.
# MAX_NEW=N stops after N registrations (0 or unset: no limit), so a long list is worked through over several runs.
# DRY=1 lists what it would register without sending.
# STRICT=1 (the Elysium V4AdapterV3 copy): a register that fails, a pair it cannot read or a full pair is an error, and the
# script exits 1 so the run is seen as unfinished (otherwise a failed send counts as "known or rejected").
# Usage: RPC=... PRIVATE_KEY=... ADAPTER=0x... [SEED=script/data/v4-seed-pools-4663.json] ./script/seed-v4.sh
set -uo pipefail
cd "$(dirname "$0")/.."
ok=0; known=0; full=0; fail=0; prot=0; narrow=0; sent_fail=0
max=$(cast call "$ADAPTER" "MAX_KEYS()(uint256)" --rpc-url "$RPC" 2>/dev/null | awk '{print $1}')
max=${max:-6}
cap=${MAX_PER_PAIR:-4}; [ "$cap" -lt "$max" ] && max=$cap
minsp=${MIN_HOOKLESS_SPACING:-0}
zero=0x0000000000000000000000000000000000000000
whype=$(cast call "$ADAPTER" "whype()(address)" --rpc-url "$RPC" 2>/dev/null)
canon() { if [ "$(echo "$1" | tr 'A-F' 'a-f')" = "0x0000000000000000000000000000000000000000" ]; then echo "$whype"; else echo "$1"; fi; }
in_pairs() { # is the canonical pair (a, b) in PROTECT_PAIRS?
  local x y p q
  x=$(echo "$1" | tr 'A-F' 'a-f'); y=$(echo "$2" | tr 'A-F' 'a-f')
  for e in $(echo "$PROTECT_PAIRS" | tr ',' ' '); do
    p=$(canon "${e%%-*}" | tr 'A-F' 'a-f'); q=$(canon "${e##*-}" | tr 'A-F' 'a-f')
    { [ "$p" = "$x" ] && [ "$q" = "$y" ]; } || { [ "$p" = "$y" ] && [ "$q" = "$x" ]; } && return 0
  done
  return 1
}
declare -A count keyset
norm() { sed 's/ \[[^]]*\]//g' | tr 'A-F' 'a-f'; } # cast prints numbers from 10,000 up as "10000 [1e4]"
while IFS=' ' read -r c0 c1 fee ts hooks; do
  k="($c0,$c1,$fee,$ts,$hooks)"
  if [ -n "${PROTECT:-}" ] && echo ",$(echo "$PROTECT" | tr 'A-F' 'a-f')," | grep -qE ",($(echo "$c0" | tr 'A-F' 'a-f')|$(echo "$c1" | tr 'A-F' 'a-f')),"; then
    prot=$((prot+1)); continue
  fi
  if [ "$minsp" -gt 0 ] && [ "$(echo "$hooks" | tr 'A-F' 'a-f')" = "$zero" ] && [ "$ts" -lt "$minsp" ]; then
    narrow=$((narrow+1)); echo "skip (hook-less, tick spacing $ts < $minsp) $k"; continue
  fi
  a=$(canon "$c0"); b=$(canon "$c1")
  pair="$(echo "$a$b" | tr 'A-F' 'a-f')"
  if [ -n "${PROTECT_PAIRS:-}" ] && in_pairs "$a" "$b"; then prot=$((prot+1)); continue; fi
  if [ -z "${count[$pair]:-}" ]; then
    keys=$(cast call "$ADAPTER" "keysFor(address,address)((address,address,uint24,int24,address)[])" "$a" "$b" --rpc-url "$RPC" 2>/dev/null) \
      || { fail=$((fail+1)); echo "skip (cannot read keys) $k"; continue; }
    count[$pair]=$(echo "$keys" | grep -o '(0x' | wc -l)
    keyset[$pair]=$(echo "$keys" | norm)
  fi
  # every pool is checked against the pair's keys, not only the first one of the pair in this run (HEY Research Lab
  # follow-up, F-2: a registered pool was otherwise reported as kept out of a full pair)
  if echo "${keyset[$pair]}" | grep -qF "$(echo "$c0, $c1, $fee, $ts, $hooks" | tr 'A-F' 'a-f')"; then known=$((known+1)); continue; fi
  if [ "${count[$pair]}" -ge "$max" ]; then
    full=$((full+1)); echo "skip (pair full, no eviction) $k"
    echo "::warning::V4 pair full ($max keys) on $ADAPTER, not registered: $k"
    [ -n "${FULL_LOG:-}" ] && echo "$ADAPTER $k" >>"$FULL_LOG"
    continue
  fi
  if [ "${MAX_NEW:-0}" -gt 0 ] && [ "$ok" -ge "${MAX_NEW}" ]; then echo "reached MAX_NEW=$MAX_NEW for this run"; break; fi
  added="${keyset[$pair]} ($(echo "$c0, $c1, $fee, $ts, $hooks" | tr 'A-F' 'a-f'))"
  if [ -n "${DRY:-}" ]; then
    echo "would register $k"; ok=$((ok+1)); count[$pair]=$(( ${count[$pair]} + 1 )); keyset[$pair]=$added; continue
  fi
  if cast send "$ADAPTER" "register((address,address,uint24,int24,address))" "$k" --private-key "$PRIVATE_KEY" --rpc-url "$RPC" >/dev/null 2>&1; then
    ok=$((ok+1)); count[$pair]=$(( ${count[$pair]} + 1 )); keyset[$pair]=$added
  elif [ -n "${STRICT:-}" ]; then
    sent_fail=$((sent_fail+1)); echo "::warning::register failed on $ADAPTER: $k"
  else
    known=$((known+1))
  fi
done < <(jq -r '.[] | "\(.currency0) \(.currency1) \(.fee) \(.tickSpacing) \(.hooks)"' "${SEED:-script/data/v4-seed-pools.json}")
echo "registered $ok pools, skipped $known known or rejected, $full on full pairs (never evicted), $fail unreadable, $prot protected, $narrow hook-less with tick spacing < $minsp (0: rule off)"
if [ -n "${STRICT:-}" ] && [ $((sent_fail + fail + full)) -gt 0 ]; then
  echo "::error::copy unfinished: $sent_fail failed sends, $fail unreadable pairs, $full full pairs"; exit 1
fi

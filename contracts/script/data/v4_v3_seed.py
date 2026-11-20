"""Seed list for UniswapV4AdapterV3: the keys UniswapV4AdapterV2 lists today that V3 should list too (writes
v4-v3-seed-4663.json). The daily job registers it on V3 with the keeper, at most MAX_NEW keys a run and never more than
4 keys a pair (seed-v4.sh), so the list is worked through over a few days.

Left out: the $STOA and ETH/USDG pairs (registered by hand right after the deploy and pinned by the timelock), and keys
whose reference trade (1 ETH or 3,000 USDG) cost more than MAX_REF_GAS (default 1,000,000) or failed in today's gas
report, v4-gas-report.json (the daily job runs it first). Without that report nothing is copied. Narrow tick spacing
alone is no reason to leave a pool out (HEY Research Lab follow-up, F-4). Pons graduation pools come first, then other
hooked pools, then hook-less ones.
Also added, first: v4-v3-extra-4663.json, keys V2 cannot list because their hooks are allowed on V3 only (QHooks:
QHOOKS/WETH on hook 0x0236…60cc, allowed by the timelock on 20 Nov 2026), and two spacing-1 USDG pools V2 routes today
whose reference trade the gas report counts as too heavy (SPEPE/USDG 0.0075%, hXMAX/USDG 8%), so they keep a route
after op B removes V2 (HEY Research Lab, V3 deployment check, 21 Nov 2026).
Run from this folder:  python3 -I v4_v3_seed.py   (public RPC, no key)
"""
import importlib.util
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("gas", os.path.join(HERE, "v4_gas_report.py"))
gas = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gas)

V2 = "0x27958279f95225b2a5517e7dd12b6fc0317e5c5d"
STOA = "0x13e6993417616de724f2b337d65063f229e96718"
PONS = "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044"
ZERO = "0x" + "0" * 40


def main():
    limit = int(os.environ.get("MAX_REF_GAS", "1000000"))
    try:
        r = json.load(open(os.path.join(HERE, "v4-gas-report.json")))
    except (OSError, ValueError):
        print("no gas report: nothing copied")
        return
    fast = {json.dumps(x["key"], sort_keys=True) for x in r["keys"] if x["gas"] is not None and x["gas"] <= limit}
    out = []
    for p in gas.pairs_of(V2):
        if STOA in p or set(p) == {gas.WETH, gas.USDG}:
            continue
        for k in gas.keys_for(V2, *p):
            if json.dumps(k, sort_keys=True) not in fast:
                continue
            out.append(k)
    out.sort(key=lambda k: (k["hooks"] != PONS, k["hooks"] == ZERO))
    try:
        extra = json.load(open(os.path.join(HERE, "v4-v3-extra-4663.json")))
    except (OSError, ValueError):
        extra = []
    seen = {json.dumps(k, sort_keys=True) for k in out}
    out = [k for k in extra if json.dumps(k, sort_keys=True) not in seen] + out
    with open(os.path.join(HERE, "v4-v3-seed-4663.json"), "w") as f:
        json.dump(out, f, indent=1)
    print("wrote", len(out), "keys")


if __name__ == "__main__":
    main()

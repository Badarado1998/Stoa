"""Seed list for UniswapV4AdapterV3: the keys UniswapV4AdapterV2 lists today that V3 should list too (writes
v4-v3-seed-4663.json). The daily job registers it on V3 with the keeper, at most MAX_NEW keys a run and never more than
4 keys a pair (seed-v4.sh), so the list is worked through over a few days.

Left out: the $STOA and ETH/USDG pairs (registered by hand right after the deploy and pinned by the timelock), hook-less
pools with a tick spacing under 10 (Hey Research Lab, L-1), and keys over the gas report's HEAVY in today's
v4-gas-report.json if it exists. Pons graduation pools come first, then other hooked pools, then hook-less ones.
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
    heavy = set()
    try:
        r = json.load(open(os.path.join(HERE, "v4-gas-report.json")))
        heavy = {json.dumps(x["key"], sort_keys=True) for x in r["keys"] if x["gas"] is None or x["gas"] > r["heavy"]}
    except (OSError, ValueError, KeyError):
        pass
    out = []
    for p in gas.pairs_of(V2):
        if STOA in p or set(p) == {gas.WETH, gas.USDG}:
            continue
        for k in gas.keys_for(V2, *p):
            if k["hooks"] == ZERO and k["tickSpacing"] < 10:
                continue
            if json.dumps(k, sort_keys=True) in heavy:
                continue
            out.append(k)
    out.sort(key=lambda k: (k["hooks"] != PONS, k["hooks"] == ZERO))
    with open(os.path.join(HERE, "v4-v3-seed-4663.json"), "w") as f:
        json.dump(out, f, indent=1)
    print("wrote", len(out), "keys")


if __name__ == "__main__":
    main()

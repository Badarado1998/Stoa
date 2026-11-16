"""List every pool key on Stoa's first Uniswap V4 adapter (Robinhood Chain) and write v4-v2-seed-4663.json, the seed
that registers the same keys on UniswapV4AdapterV2 (seed-v4.sh, keeper key). Only keys the keeper registered are
copied: a key an outsider added (script/v4_guard.py) is left out. Run from this folder: python3 -I v4_copy_keys.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import v4_guard as g  # noqa: E402

DEPLOY_BLOCK = 114_244_443
KEYS_FOR = "be93924d"  # keysFor(address,address)


def keys_for(a, b):
    r = g.call("eth_call", [{"to": g.OLD, "data": "0x" + KEYS_FOR + a[2:].rjust(64, "0") + b[2:].rjust(64, "0")},
                            "latest"])
    raw = bytes.fromhex(r[2:])
    n = int.from_bytes(raw[32:64], "big")
    out = []
    for i in range(n):
        f = [raw[64 + 160 * i + 32 * j: 64 + 160 * i + 32 * (j + 1)] for j in range(5)]
        ts = int.from_bytes(f[3], "big")
        ts = ts - (1 << 256) if ts >> 255 else ts
        out.append({"currency0": "0x" + f[0][12:].hex(), "currency1": "0x" + f[1][12:].hex(),
                    "fee": int.from_bytes(f[2], "big"), "tickSpacing": ts, "hooks": "0x" + f[4][12:].hex()})
    return out


def main():
    head = int(g.call("eth_blockNumber", []), 16)
    logs, a = [], DEPLOY_BLOCK
    while a <= head:
        z = min(a + g.SPAN - 1, head)
        logs += g.call("eth_getLogs", [{"address": g.OLD, "fromBlock": hex(a), "toBlock": hex(z)}])
        a = z + 1
    pairs = set()
    for l in logs:
        if l["topics"][0].startswith(g.REGISTERED):
            d = l["data"][2:]
            pairs.add(g.pair("0x" + d[24:64], "0x" + d[88:128]))
    bad, _ = g.poisoned()
    seed = []
    for p in sorted(pairs):
        if p in bad:
            print("skipped (an outsider changed it):", p)
            continue
        seed += keys_for(*p)
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "v4-v2-seed-4663.json"), "w") as f:
        json.dump(seed, f, indent=1)
    print("pairs", len(pairs), "keys", len(seed))


if __name__ == "__main__":
    main()

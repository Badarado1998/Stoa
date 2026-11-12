"""Rank the most traded Uniswap V4 pools on Elysium that Stoa's V4 adapter can use, and write v4-seed-pools.json.

A pool qualifies when its hooks contract is on the adapter's allowlist (script/VenuesElysium.sol), it pairs a token
with HYPE, WHYPE or USDC, and it had swaps from at least MIN_TRADERS different addresses in the last SPAN blocks.
Run from this folder:  python3 -I v4_top_pools.py   (uses Kinetiq's public RPC, no key needed)
"""
import collections
import concurrent.futures as cf
import json
import os
import time
import urllib.request

RPC = os.environ.get("ELYSIUM_RPC_URL") or "https://rpc.elysium.kinetiq.xyz"
PM = "0xe2e105d3f7209a9da11f83ccf3e7398a753823f1"
SWAP = "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f"
INIT = "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438"
SPAN = int(os.environ.get("SPAN", "300000"))  # ~8-10 hours of Elysium blocks
TOP = int(os.environ.get("TOP", "80"))
MIN_TRADERS = 5
ALLOW = {
    "0x0000000000000000000000000000000000000000", "0x6b1216a40b65c83e9c9e18a562c446697b8cf8ec",
    "0xe0def4221b9840a610d4e7d55812a79a6431a8ec", "0x3ab88ddc3cf2a012af88b60828edb4553697e5dc",
    "0xe928f2336051cbd5b9d4531c25eadd13f9a82aec", "0xbacf71bf02b8cfe171853c5ec4a060ba2ac1e0cc",
    "0x3ea9581a32a396f69b177b65b91149cf887beacc", "0x00c002cdae688f39a90cf2ad74c59421c9502acc",
    "0x0fa71294c909b11a0b805df4763ba576c69c2acc", "0x10f11002b148be522005f9b5d666bef339392aec",
    "0xb67656ce894ac93c0164d8490ad23161a77ee000",
}
BASE = {"0x0000000000000000000000000000000000000000", "0xba876237b0f021a6c6d852d6c26e107997cc5e81",
        "0xb47c4c8f73f009cc0c0d3f92b388d13e293f0b65"}


def rpc(method, params):
    req = urllib.request.Request(RPC, data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(),
                                 headers={"content-type": "application/json", "user-agent": "curl/8.5.0"})
    err = None
    for i in range(6):
        try:
            out = json.load(urllib.request.urlopen(req, timeout=120))
            if "result" in out:
                return out["result"]
            err = out.get("error")
        except Exception as e:  # rate limits and timeouts: back off and retry
            err = e
        time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"{method} failed: {err}")


def main():
    head = int(rpc("eth_blockNumber", []), 16)
    # 1) swap activity per pool id
    def swaps(b):
        return rpc("eth_getLogs", [{"fromBlock": hex(b), "toBlock": hex(min(b + 4999, head)), "address": PM, "topics": [SWAP]}])
    count, traders = collections.Counter(), collections.defaultdict(set)
    with cf.ThreadPoolExecutor(4) as ex:
        for logs in ex.map(swaps, range(head - SPAN, head, 5000)):
            for l in logs:
                count[l["topics"][1]] += 1
                traders[l["topics"][1]].add(l["topics"][2])
    active = [pid for pid, _ in count.most_common() if len(traders[pid]) >= MIN_TRADERS]
    print("swaps", sum(count.values()), "pools", len(count), "active", len(active))
    # 2) pool keys from Initialize events, looked up by pool id in batches (full range, topic-filtered)
    keys = {}
    for i in range(0, len(active), 100):
        for l in rpc("eth_getLogs", [{"fromBlock": "0x0", "toBlock": "latest", "address": PM, "topics": [INIT, active[i:i + 100]]}]):
            d = l["data"][2:]
            ts = int(d[64:128], 16)
            keys[l["topics"][1]] = {
                "currency0": "0x" + l["topics"][2][-40:], "currency1": "0x" + l["topics"][3][-40:],
                "fee": int(d[0:64], 16), "tickSpacing": ts - (1 << 256) if ts >= 1 << 255 else ts, "hooks": "0x" + d[152:192],
            }
    out = []
    for pid in active:
        k = keys.get(pid)
        if not k or k["hooks"] not in ALLOW:
            continue
        c0, c1 = k["currency0"], k["currency1"]
        if (c0 not in BASE and c1 not in BASE) or (c0 in BASE and c1 in BASE):
            continue
        out.append({**k, "swaps": count[pid], "traders": len(traders[pid])})
        if len(out) >= TOP:
            break
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "v4-seed-pools.json"), "w") as f:
        json.dump(out, f, indent=1)
    print("wrote", len(out), "pools")


if __name__ == "__main__":
    main()

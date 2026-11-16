"""Guard for Stoa's first Uniswap V4 adapter on Robinhood Chain (0x8965...7B8), until the timelock replaces it.

Anyone could register pool keys on that adapter, and a full pair's weakest key could be replaced by a pool with more
raw in-range liquidity, which a narrow position buys cheaply: an outsider could push a pair's real pool out and have the
router quote their price (reported by Hey Research Lab). Stoa's keeper is the only address that has registered keys so
far. This script lists every pair the adapter serves that an outsider has touched since CHECKPOINT (all earlier
registrations were checked one by one: every one came from the keeper).

  python3 -I v4_guard.py                          prints {"poisoned": [[a, b], ...]} and exits 0
  python3 -I v4_guard.py --fail                   same, but exits 2 if any pair is poisoned (for monitoring)
  (once the router no longer lists that adapter, every mode prints so and exits 0)
  python3 -I v4_guard.py route IN OUT MID V1 V2   exits 3 if that router route uses the old adapter on a poisoned
                                                  pair (IN/OUT may be 0x0 for ETH), 0 otherwise
Env: ROBINHOOD_RPC_URL (default: the public RPC).

The --fail mode also watches UniswapV4AdapterV2 (keeper/owner-only registration), for as long as it runs, after Hey
Research Lab's re-test showed a full pair could still lose its real pool through the keeper's daily registrations:
  - any Unregistered event on V2 whose transaction is not listed in data/v4v2-reviewed.json fails the check (the keeper
    never removes keys on its own any more; a hand change is reviewed, then its transaction hash is added there);
  - keysFor(WETH, STOA) must still hold the canonical $STOA pool (Pons graduation pool) on V2, and on the first adapter
    while the router still lists it.
"""
import json
import os
import sys
import time
import urllib.request

RPC = os.environ.get("ROBINHOOD_RPC_URL") or "https://rpc.mainnet.chain.robinhood.com"
OLD = "0x8965140fb51b2e99a0cd31a0e99eae01d36517b8"
ROUTER = "0x2f2804fad735a38015650f32f95ad5e08d6b3ee5"
KEEPER = "0xbf666e8d054935170b9f09127247905a975b3b80"
WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73"
ZERO = "0x" + "0" * 40
CHECKPOINT = 115_700_000  # every Registered/Unregistered log up to here came from the keeper (checked 16 Nov 2026)
REGISTERED = "0xbf4e56ab"  # Registered(bytes32,address,address,address) topic prefix
SPAN = 9_000_000
IS_ADAPTER = "68c18beb"  # isAdapter(address)
V2 = "0x27958279f95225b2a5517e7dd12b6fc0317e5c5d"
V2_FROM = 115_600_000  # before UniswapV4AdapterV2 was deployed (16 Nov 2026); no Unregistered event on it up to 115,951,674
UNREGISTERED = "0xe17fec26316aebe957e188549d659a89f359c49766bcc0ae2fb7ded274ffe146"  # Unregistered(bytes32)
KEYS_FOR = "be93924d"  # keysFor(address,address)
STOA = "0x13e6993417616de724f2b337d65063f229e96718"
# the canonical $STOA pool: (ETH, STOA, fee 0, tick spacing 200, Pons hook); pool id 0x3cf63de2...4180
STOA_KEY = (ZERO, STOA, 0, 200, "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044")
REVIEWED = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "v4v2-reviewed.json")


def post(payload):
    req = urllib.request.Request(RPC, data=json.dumps(payload).encode(),
                                 headers={"content-type": "application/json", "user-agent": "curl/8.5.0"})
    for i in range(8):
        try:
            return json.load(urllib.request.urlopen(req, timeout=60))
        except Exception:
            time.sleep(2 + 3 * i)
    raise RuntimeError("RPC unreachable")


def call(method, params):
    r = post({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    if "error" in r:
        raise RuntimeError(r["error"])
    return r["result"]


def canon(a):
    a = a.lower()
    return WETH if int(a, 16) == 0 else a


def pair(a, b):
    return tuple(sorted((canon(a), canon(b))))


def old_in_router():
    data = "0x" + IS_ADAPTER + OLD[2:].rjust(64, "0")
    return int(call("eth_call", [{"to": ROUTER, "data": data}, "latest"]), 16) == 1


def poisoned():
    head = int(call("eth_blockNumber", []), 16)
    logs = []
    a = CHECKPOINT + 1
    while a <= head:
        z = min(a + SPAN - 1, head)
        logs += call("eth_getLogs", [{"address": OLD, "fromBlock": hex(a), "toBlock": hex(z)}])
        a = z + 1
    hashes = sorted({l["transactionHash"] for l in logs})
    sender = {}
    for i in range(0, len(hashes), 50):
        batch = [{"jsonrpc": "2.0", "id": j, "method": "eth_getTransactionByHash", "params": [h]}
                 for j, h in enumerate(hashes[i:i + 50])]
        res = post(batch)
        res = res if isinstance(res, list) else [res]
        for r in res:
            t = r.get("result") or {}
            if t:
                sender[t["hash"]] = t["from"].lower()
        for h in hashes[i:i + 50]:  # a batch the node refused: ask one by one
            if h not in sender:
                sender[h] = call("eth_getTransactionByHash", [h])["from"].lower()
    bad = set()
    outsider_txs = {h for h, f in sender.items() if f != KEEPER}
    for l in logs:
        if l["transactionHash"] in outsider_txs and l["topics"][0].startswith(REGISTERED):
            d = l["data"][2:]
            bad.add(pair("0x" + d[24:64], "0x" + d[88:128]))
    # an outsider transaction that only removed keys (no Registered log) cannot name its pair from the log alone
    lone = [h for h in outsider_txs if not any(l["transactionHash"] == h and l["topics"][0].startswith(REGISTERED)
                                                for l in logs)]
    return sorted(bad), lone


def logs_of(address, topic, start):
    head = int(call("eth_blockNumber", []), 16)
    out, a = [], start
    while a <= head:
        z = min(a + SPAN - 1, head)
        out += call("eth_getLogs", [{"address": address, "topics": [topic], "fromBlock": hex(a), "toBlock": hex(z)}])
        a = z + 1
    return out


def keys_for(adapter, a, b):
    data = "0x" + KEYS_FOR + a[2:].rjust(64, "0") + b[2:].rjust(64, "0")
    d = call("eth_call", [{"to": adapter, "data": data}, "latest"])[2:]
    n = int(d[64:128], 16)
    keys = []
    for i in range(n):
        w = [d[128 + (5 * i + j) * 64:128 + (5 * i + j + 1) * 64] for j in range(5)]
        ts = int(w[3], 16)
        keys.append(("0x" + w[0][-40:], "0x" + w[1][-40:], int(w[2], 16), ts - (1 << 256) if ts >= 1 << 255 else ts,
                     "0x" + w[4][-40:]))
    return keys


def v2_status(old_listed):
    try:
        with open(REVIEWED) as f:
            reviewed = {h.lower() for h in json.load(f)}
    except (OSError, ValueError):
        reviewed = set()
    unreviewed = sorted({l["transactionHash"].lower() for l in logs_of(V2, UNREGISTERED, V2_FROM)} - reviewed)
    stoa = {"v2": STOA_KEY in keys_for(V2, WETH, STOA)}
    if old_listed:
        stoa["old"] = STOA_KEY in keys_for(OLD, WETH, STOA)
    return {"unreviewed_unregistered": unreviewed, "stoa_pool_present": stoa}


def main():
    args = sys.argv[1:]
    listed = old_in_router()
    if not listed:  # the timelock removed it: nothing routes through it any more
        out = {"old_adapter_in_router": False, "poisoned": []}
        if "--fail" in args:
            v2 = v2_status(False)
            out["v2"] = v2
            print(json.dumps(out))
            sys.exit(2 if v2["unreviewed_unregistered"] or not all(v2["stoa_pool_present"].values()) else 0)
        print(json.dumps(out))
        sys.exit(0)
    bad, lone = poisoned()
    if args[:1] == ["route"]:
        tin, tout, mid, v1, v2 = (x.lower() for x in args[1:6])
        legs = [(tin, tout, v1)] if int(mid, 16) == 0 else [(tin, mid, v1), (mid, tout, v2)]
        hit = any(v == OLD and (pair(x, y) in bad or lone) for x, y, v in legs)
        print(json.dumps({"route_uses_poisoned_v4_pair": hit, "poisoned": bad, "unattributed_outsider_txs": lone}))
        sys.exit(3 if hit else 0)
    out = {"poisoned": bad, "unattributed_outsider_txs": lone}
    if "--fail" in args:
        v2 = out["v2"] = v2_status(True)
        print(json.dumps(out))
        if bad or lone or v2["unreviewed_unregistered"] or not all(v2["stoa_pool_present"].values()):
            sys.exit(2)
        return
    print(json.dumps(out))


if __name__ == "__main__":
    main()

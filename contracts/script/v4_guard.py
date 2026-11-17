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
  - any Unregistered event on V2 whose transaction or pool id is not listed in data/v4v2-reviewed.json fails the check
    (the keeper never removes keys on its own any more; a hand change is reviewed and its pool ids are added there
    before it is sent, or its transaction hash after);
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
V3_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "deployments", "4663-v4v3.json")
PIN_SET = "0xdee1b9db4ca6b7f8ccddbab895c63073960ca9c385b121e69a92ab5c6f3d061a"  # PinSet(bytes32,bool)
V3_CONFIG = {  # events after the deployment that change who decides what V3 routes
    "0xd151ae3ca74502c0fcb484d76443e786331ae2d705cafec25b5b61610588f723": "HookSet",
    "0xdc3dba1d64dd67c0dc8b12621edd0c6ca4303a9073c3a8fcac38115e73d67b6b": "KeeperSet",
    "0xe6c09ffe4572dc9ceaa5ddde4ae41befa655d6fdfe8052077af0970f700e942e": "GuardianSet",
}
# the pools the rollout pins (script/V4AdapterV3Robinhood.sol pinnedKeys()): $STOA, ETH/USDG 0.05%, ETH/USDG dynamic
V3_PINS = {"0x3cf63de2530870232ec7075aec62ca539031c3c5a17dba5e016771238bf64180",
           "0x387bf619da4d3fb62bb276482693dba1b9b3520f573cabdfe033384a24125982",
           "0xa791e5169faf703c0b63fd9552c33ec1128a773a00f5dc33a640da62a022cd35"}
PINNED = "adb4f57f"  # pinned(bytes32)


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
    # an entry is either a reviewed transaction hash or the pool id of a key whose removal was reviewed beforehand
    unreviewed = sorted({l["transactionHash"].lower() for l in logs_of(V2, UNREGISTERED, V2_FROM)
                         if l["transactionHash"].lower() not in reviewed and l["topics"][1].lower() not in reviewed})
    stoa = {"v2": STOA_KEY in keys_for(V2, WETH, STOA)}
    if old_listed:
        stoa["old"] = STOA_KEY in keys_for(OLD, WETH, STOA)
    return {"unreviewed_unregistered": unreviewed, "stoa_pool_present": stoa}


def v3_status():
    """UniswapV4AdapterV3, once deployed (deployments/4663-v4v3.json): no unreviewed removal, no allowlist, keeper or
    guardian change and no pin other than the rollout's own since the deployment, and once the router lists V3 the
    $STOA pool is registered and pinned there."""
    try:
        with open(V3_FILE) as f:
            d = json.load(f)
        v3, start = d["uniswapV4AdapterV3"].lower(), int(d["block"]) + 1
    except (OSError, ValueError, KeyError):
        return None
    try:
        with open(REVIEWED) as f:
            reviewed = {h.lower() for h in json.load(f)}
    except (OSError, ValueError):
        reviewed = set()
    bad = []
    for l in logs_of(v3, UNREGISTERED, start):
        if l["transactionHash"].lower() not in reviewed and l["topics"][1].lower() not in reviewed:
            bad.append(["Unregistered", l["transactionHash"]])
    for topic, name in V3_CONFIG.items():
        for l in logs_of(v3, topic, start):
            if l["transactionHash"].lower() not in reviewed:
                bad.append([name, l["transactionHash"]])
    for l in logs_of(v3, PIN_SET, start):
        on = int(l["data"][2:66], 16) == 1
        if not (on and l["topics"][1].lower() in V3_PINS) and l["transactionHash"].lower() not in reviewed:
            bad.append(["PinSet", l["transactionHash"]])
    out = {"adapter": v3, "unreviewed": bad}
    data = "0x" + IS_ADAPTER + v3[2:].rjust(64, "0")
    if int(call("eth_call", [{"to": ROUTER, "data": data}, "latest"]), 16) == 1:
        pid = "0x3cf63de2530870232ec7075aec62ca539031c3c5a17dba5e016771238bf64180"  # the $STOA pool
        pinned = int(call("eth_call", [{"to": v3, "data": "0x" + PINNED + pid[2:]}, "latest"]), 16) == 1
        out["stoa_pool_present"] = STOA_KEY in keys_for(v3, WETH, STOA)
        out["stoa_pool_pinned"] = pinned
    return out


def v3_failed(v3):
    return bool(v3) and (bool(v3["unreviewed"]) or v3.get("stoa_pool_present") is False
                         or v3.get("stoa_pool_pinned") is False)


def main():
    args = sys.argv[1:]
    listed = old_in_router()
    if not listed:  # the timelock removed it: nothing routes through it any more
        out = {"old_adapter_in_router": False, "poisoned": []}
        if "--fail" in args:
            v2 = v2_status(False)
            out["v2"] = v2
            v3 = out["v3"] = v3_status()
            print(json.dumps(out))
            sys.exit(2 if v2["unreviewed_unregistered"] or not all(v2["stoa_pool_present"].values()) or v3_failed(v3)
                     else 0)
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
        v3 = out["v3"] = v3_status()
        print(json.dumps(out))
        if bad or lone or v2["unreviewed_unregistered"] or not all(v2["stoa_pool_present"].values()) or v3_failed(v3):
            sys.exit(2)
        return
    print(json.dumps(out))


if __name__ == "__main__":
    main()

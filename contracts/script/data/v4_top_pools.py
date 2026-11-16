"""Rank the most traded Uniswap V4 pools on Elysium (or Robinhood Chain with CHAIN=robinhood) that Stoa's V4 adapter can use, and write v4-seed-pools.json.

A pool qualifies when its hooks contract is on the adapter's allowlist (script/VenuesElysium.sol), it pairs a token
with HYPE, WHYPE or USDC (Robinhood Chain: ETH, WETH or USDG), it had swaps from at least MIN_TRADERS different
addresses in the last SPAN blocks, and its fee is at most MAX_FEE (or dynamic).
Run from this folder:  python3 -I v4_top_pools.py   (uses Kinetiq's public RPC, no key needed)

Robinhood Chain is ranked so that wash trading alone cannot get a pool in (Hey Research Lab, GHSA-cv5f-wmmh-wcrv
re-test): a Swap log's sender is the swap contract, not the trader, so pools are ranked by distinct transaction
origins (sampled from each pool's latest swaps), and a pool must also
  - be deep: a 0.05 ETH (or 100 USDG) quote through Uniswap's own V4Quoter loses at most MAX_IMPACT against a tiny one,
    which a thin or narrow position cannot pass however much raw in-range liquidity it shows;
  - be of attributable origin, or old: pools whose hook gates pool creation (launchpad graduations such as Pons, whose
    hook reverts initialize from any other sender) qualify at once; hook-less pools, which anyone can create, only once
    their Initialize event is MIN_AGE_BLOCKS old (about three days).
The keeper never registers into a full pair and never touches STOA pools or ETH/USDG (script/seed-v4.sh).
"""
import collections
import concurrent.futures as cf
import json
import os
import time
import urllib.request

CHAIN = os.environ.get("CHAIN", "elysium")
RH = CHAIN == "robinhood"
RPC = (os.environ.get("ROBINHOOD_RPC_URL") or "https://rpc.mainnet.chain.robinhood.com") if RH else (
    os.environ.get("ELYSIUM_RPC_URL") or "https://rpc.elysium.kinetiq.xyz")
PM = "0x8366a39cc670b4001a1121b8f6a443a643e40951" if RH else "0xe2e105d3f7209a9da11f83ccf3e7398a753823f1"
SWAP = "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f"
INIT = "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438"
SPAN = int(os.environ.get("SPAN", "300000"))  # ~8-10 hours of Elysium blocks (~8 hours on Robinhood Chain)
TOP = int(os.environ.get("TOP", "200" if RH else "80"))
MAX_FEE = 100_000  # 10%: static fees above it are traps (some pools charge 60%); 0x800000 marks a dynamic fee
DYNAMIC = 0x800000
MIN_TRADERS = 5
# Robinhood Chain only (see the docstring)
QUOTER = "0x8dc178efb8111bb0973dd9d722ebeff267c98f94"  # Uniswap V4Quoter, Robinhood Chain (Uniswap's deployments page)
QUOTE_SEL = "aa9d21cb"  # quoteExactInputSingle(((address,address,uint24,int24,address),bool,uint128,bytes))
MIN_ORIGINS = int(os.environ.get("MIN_ORIGINS", "5"))
SAMPLE = int(os.environ.get("SAMPLE", "25"))  # latest swap transactions per pool whose origin is looked up
MAX_IMPACT = float(os.environ.get("MAX_IMPACT", "0.10"))
MIN_AGE_BLOCKS = int(os.environ.get("MIN_AGE_BLOCKS", "2700000"))  # ~3 days of Robinhood Chain blocks
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
if RH:  # script/VenuesRobinhood.sol v4Hooks(); pools paired with ETH, WETH or USDG (ETH/USDG included)
    ALLOW = {"0x0000000000000000000000000000000000000000", "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044",
             "0x987e330f00b79864a07fe81dfac344d0078abcc0", "0x4e3468951d49f2eea976ed0d6e75ffcb44a9a544",
             "0x0af57f62982d03066ef917acad87f771c06528ec", "0xee588bcf2bd3e658f5160489f4199d1851bbf0cc"}
    BASE = {"0x0000000000000000000000000000000000000000", "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
            "0x5fc5360d0400a0fd4f2af552add042d716f1d168"}


def rpc(method, params):
    req = urllib.request.Request(RPC, data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(),
                                 headers={"content-type": "application/json", "user-agent": "curl/8.5.0"})
    err = None
    for i in range(30 if RH else 10):
        if RH:
            time.sleep(0.15)  # pace requests: the public RPC answers HTTP 429 to bursts from shared CI addresses
        try:
            out = json.load(urllib.request.urlopen(req, timeout=120))
            if "result" in out:
                return out["result"]
            err = out.get("error")
        except Exception as e:  # rate limits and timeouts: back off and retry
            err = e
        time.sleep(min(3.0 * (i + 1), 60) if RH else min(2.0 * (i + 1), 20))
    raise RuntimeError(f"{method} failed: {err}")


def key_of(l):
    d = l["data"][2:]
    ts = int(d[64:128], 16)
    return {
        "currency0": "0x" + l["topics"][2][-40:], "currency1": "0x" + l["topics"][3][-40:],
        "fee": int(d[0:64], 16), "tickSpacing": ts - (1 << 256) if ts >= 1 << 255 else ts, "hooks": "0x" + d[152:192],
        "block": int(l["blockNumber"], 16),  # pools cached before 17 Nov 2026 have no block: they predate the re-test
    }


def _w(x):
    return format(x if x >= 0 else x + (1 << 256), "064x")


def v4_quote(k, zero_for_one, amount):
    """Exact-input quote of one pool through Uniswap's V4Quoter; 0 if it reverts."""
    data = "0x" + QUOTE_SEL + _w(32) + "".join(_w(int(k[f], 16)) for f in ("currency0", "currency1")) + _w(k["fee"]) + \
        _w(k["tickSpacing"]) + _w(int(k["hooks"], 16)) + _w(1 if zero_for_one else 0) + _w(amount) + _w(256) + _w(0)
    try:
        return int(rpc1("eth_call", [{"to": QUOTER, "data": data}, "latest"])[2:66], 16)
    except RuntimeError:
        return 0


def deep(k):
    """Does a 0.05 ETH (100 USDG) sell into the pool keep within MAX_IMPACT of a tiny one's price?"""
    base0 = k["currency0"] in BASE and not (k["currency1"] == _USDG and k["currency0"] == _USDG)
    base = k["currency0"] if base0 else k["currency1"]
    small, big = (10**6, 10**8) if base == _USDG else (5 * 10**14, 5 * 10**16)
    a, b = v4_quote(k, base0, small), v4_quote(k, base0, big)
    return a > 0 and b * small >= a * big * (1 - MAX_IMPACT)


def origins(hashes):
    """Distinct transaction senders among the given swap transactions (batched lookups)."""
    seen = set()
    hashes = list(hashes)
    for i in range(0, len(hashes), 50):
        batch = [{"jsonrpc": "2.0", "id": j, "method": "eth_getTransactionByHash", "params": [h]}
                 for j, h in enumerate(hashes[i:i + 50])]
        req = urllib.request.Request(RPC, data=json.dumps(batch).encode(),
                                     headers={"content-type": "application/json", "user-agent": "curl/8.5.0"})
        res = None
        for t in range(10):
            time.sleep(0.15)
            try:
                res = json.load(urllib.request.urlopen(req, timeout=120))
                break
            except Exception:
                time.sleep(min(3 * (t + 1), 30))
        for r in res if isinstance(res, list) else []:
            tx = r.get("result") or {}
            if tx.get("from"):
                seen.add(tx["from"].lower())
    return len(seen)


def pool_id(k):
    return ETH_USDG_IDS[(k["fee"], k["hooks"])]


# Robinhood Chain: how far back Initialize events are scanned. 0 = the whole chain, so a busy pool created long ago
# (the main pools of older tokens) is found too; a 20M-block window missed over a hundred of them.
LOOKBACK = int(os.environ.get("LOOKBACK", "0"))
RECENT = int(os.environ.get("RECENT", "20000000"))  # first look for new pools' keys here (~3 weeks)
_Z = "0x0000000000000000000000000000000000000000"
_USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168"
ETH_USDG = [
    {"currency0": _Z, "currency1": _USDG, "fee": 500, "tickSpacing": 10, "hooks": _Z},
    {"currency0": _Z, "currency1": _USDG, "fee": 8388608, "tickSpacing": 1, "hooks": "0x987e330f00b79864a07fe81dfac344d0078abcc0"},
]
ETH_USDG_IDS = {
    (500, _Z): "0x387bf619da4d3fb62bb276482693dba1b9b3520f573cabdfe033384a24125982",
    (8388608, "0x987e330f00b79864a07fe81dfac344d0078abcc0"): "0xa791e5169faf703c0b63fd9552c33ec1128a773a00f5dc33a640da62a022cd35",
}


def rpc1(method, params):
    """One attempt with retries on rate limits only; RPC errors are raised so the caller can split the range."""
    req = urllib.request.Request(RPC, data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(),
                                 headers={"content-type": "application/json", "user-agent": "curl/8.5.0"})
    for i in range(30):
        time.sleep(0.15)
        try:
            out = json.load(urllib.request.urlopen(req, timeout=120))
        except Exception:  # rate limits and timeouts
            time.sleep(min(3 * (i + 1), 60))
            continue
        if "result" in out:
            return out["result"]
        raise RuntimeError(str(out.get("error")))
    raise RuntimeError(f"{method}: no answer")


def main():
    head = int(rpc("eth_blockNumber", []), 16)
    # 1) swap activity per pool id
    step = 1000 if RH else 5000  # Robinhood Chain caps a log query at 10,000 results

    def swaps(b):
        return rpc("eth_getLogs", [{"fromBlock": hex(b), "toBlock": hex(min(b + step - 1, head)), "address": PM, "topics": [SWAP]}])
    count, traders = collections.Counter(), collections.defaultdict(set)
    txs = collections.defaultdict(lambda: collections.deque(maxlen=SAMPLE * 3))  # latest swap transactions per pool
    # Robinhood Chain's public RPC rate-limits hard (HTTP 429): fewer parallel log queries there
    with cf.ThreadPoolExecutor(1 if RH else 4) as ex:
        for logs in ex.map(swaps, range(head - SPAN, head, step)):
            for l in logs:
                count[l["topics"][1]] += 1
                traders[l["topics"][1]].add(l["topics"][2])
                if not txs[l["topics"][1]] or txs[l["topics"][1]][-1] != l["transactionHash"]:
                    txs[l["topics"][1]].append(l["transactionHash"])
    active = [pid for pid, _ in count.most_common() if len(traders[pid]) >= MIN_TRADERS]
    print("swaps", sum(count.values()), "pools", len(count), "active", len(active))
    # 2) pool keys from Initialize events, looked up by pool id in batches (full range, topic-filtered)
    keys = {}
    for i in range(0, len(active), 100):
        if RH:  # topic lists are capped at 100k blocks there: scan recent Initialize events instead (below)
            break
        found = rpc("eth_getLogs", [{"fromBlock": "0x0", "toBlock": "latest", "address": PM, "topics": [INIT, active[i:i + 100]]}])
        for l in found:
            keys[l["topics"][1]] = key_of(l)
    if RH:
        # Keys of pools seen active before are cached (every launch creates a pool, over a million in all, so the
        # whole set is never kept). Unknown active pools are looked for in the last RECENT blocks first, and only if
        # some are still missing in the whole chain (LOOKBACK=0) or the last LOOKBACK blocks.
        cache_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "v4-pool-keys-4663.json")
        try:
            with open(cache_path) as f:
                cache = json.load(f)
        except (OSError, ValueError):
            cache = {}
        for pid in active:
            if pid in cache:
                keys[pid] = cache[pid]
        want = {pid for pid in active if pid not in keys}

        def inits(a, z):
            try:
                return rpc1("eth_getLogs", [{"fromBlock": hex(a), "toBlock": hex(z), "address": PM, "topics": [INIT]}])
            except RuntimeError as e:  # more than 10,000 results: split the window
                if "exceeds" in str(e) and z > a:
                    m = (a + z) // 2
                    return inits(a, m) + inits(m + 1, z)
                raise
        def scan(start):
            with cf.ThreadPoolExecutor(1) as ex:
                for logs in ex.map(lambda a: inits(a, min(a + 999_999, head)), range(start, head + 1, 1_000_000)):
                    for l in logs:
                        if l["topics"][1] in want:
                            keys[l["topics"][1]] = key_of(l)
            want.difference_update(keys)
        print("cached", len(active) - len(want), "of", len(active), "active pools")
        if want:
            scan(max(0, head - RECENT))
        if want:
            print(len(want), "active pools older than the recent window: scanning further back")
            scan(max(0, head - LOOKBACK) if LOOKBACK else 0)
        cache.update({pid: keys[pid] for pid in active if pid in keys})
        with open(cache_path, "w") as f:
            json.dump(cache, f, indent=0, sort_keys=True)
        for k in ETH_USDG:  # the main ETH/USDG pools, which predate the scan window
            keys[pool_id(k)] = k
            if pool_id(k) not in want:
                active.append(pool_id(k))
    out = []
    for pid in active:
        k = keys.get(pid)
        if not k or k["hooks"] not in ALLOW:
            continue
        c0, c1 = k["currency0"], k["currency1"]
        if c0 not in BASE and c1 not in BASE:
            continue
        if c0 in BASE and c1 in BASE and not (RH and _USDG in (c0, c1) and c0 != c1):  # ETH/USDG stays in
            continue
        if k["fee"] != DYNAMIC and k["fee"] > MAX_FEE:
            continue
        if RH:
            out.append({**k, "pid": pid, "swaps": count[pid], "traders": len(traders[pid])})
            continue
        out.append({**k, "swaps": count[pid], "traders": len(traders[pid])})
        if len(out) >= TOP:
            break
    if RH:  # wash-trading resistant selection (see the docstring)
        fixed = {pool_id(k) for k in ETH_USDG}
        kept, why, done = [], collections.Counter(), set()
        for c in out[:4 * TOP]:  # most swaps first; bounded so the daily run stays within the RPC's rate limits
            pid = c.pop("pid")
            if pid in done:  # the main ETH/USDG pools can be listed twice
                continue
            done.add(pid)
            if pid in fixed:  # the main ETH/USDG pools are set by hand; seed-v4.sh skips that pair anyway
                kept.append({**c, "origins": None})
                continue
            gated = c["hooks"] != _Z
            if not gated and c.get("block") is not None and head - c["block"] < MIN_AGE_BLOCKS:
                why["too new"] += 1
                continue
            o = origins(list(txs[pid])[-SAMPLE:])
            if o < MIN_ORIGINS:
                why["few origins"] += 1
                continue
            if not deep(c):
                why["too shallow"] += 1
                continue
            kept.append({**c, "origins": o})
        kept.sort(key=lambda c: (c["origins"] is None, c["origins"] or 0, c["swaps"]), reverse=True)
        out = [{k: v for k, v in c.items() if k != "block"} for c in kept[:TOP]]
        print("checked", len(kept) + sum(why.values()), "kept", len(kept), "dropped", dict(why))
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "v4-seed-pools-4663.json" if RH else "v4-seed-pools.json"), "w") as f:
        json.dump(out, f, indent=1)
    print("wrote", len(out), "pools")


if __name__ == "__main__":
    main()

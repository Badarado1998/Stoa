"""Uniswap V4 pools of Robinhood Stock Tokens on Robinhood Chain, for Stoa's V4 adapter (writes v4-stock-seed-4663.json).

Stock tokens trade little on-chain, so the daily ranking by distinct traders (v4_top_pools.py) never picks their
pools. Here the token list itself is the filter: only the canonical Stock Token addresses from Robinhood's public
Stock Token API (api.robinhood.com/rhj/assets) count, so nobody can get a pool in with a look-alike token.

Anyone can create a hook-less V4 pool, and thousands of empty ones exist for stock tokens, so candidates are the
Uniswap V4 pools DexScreener lists for each token with at least MIN_LIQ_USD of liquidity. DexScreener only nominates:
every check is on-chain. A pool qualifies when
  - its key comes from the PoolManager's own Initialize event for that pool id,
  - it pairs a stock token with ETH, WETH or USDG, its hooks are on the adapter's allowlist and its fee is at most 10%
    (or dynamic),
  - it is deep: the same Uniswap V4Quoter test as v4_top_pools.py (a 0.05 ETH or 100 USDG sell keeps within 10% of a
    tiny one's price),
  - and, if it has no hook (anyone can create one), its Initialize event is at least about three days old.
seed-v4.sh then registers the qualifying pools and never evicts a pool from a full pair.

Keys found are kept in v4-stock-pools-keys-4663.json (only pools DexScreener nominated), so a daily run only looks up
new ones. Run from this folder:  python3 -I v4_stock_pools.py   (public RPC, no key)
"""
import concurrent.futures as cf
import importlib.util
import json
import os
import time
import urllib.request

os.environ["CHAIN"] = "robinhood"
_spec = importlib.util.spec_from_file_location("top", os.path.join(os.path.dirname(os.path.abspath(__file__)), "v4_top_pools.py"))
top = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(top)

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "v4-stock-pools-keys-4663.json")
OUT = os.path.join(HERE, "v4-stock-seed-4663.json")
SPAN = 9_000_000  # the public RPC answers single-topic log queries over at most 10M blocks
MIN_LIQ_USD = float(os.environ.get("MIN_LIQ_USD", "2000"))
PER_PAIR = int(os.environ.get("PER_PAIR", "3"))  # the deepest pools per pair; seed-v4.sh stops at 4 keys a pair


def get(url):
    req = urllib.request.Request(url, headers={"accept": "application/json", "user-agent": "curl/8.5.0"})
    for i in range(6):
        try:
            return json.load(urllib.request.urlopen(req, timeout=60))
        except Exception:
            time.sleep(5 * (i + 1))
    raise RuntimeError(f"no answer from {url}")


def stock_tokens():
    out = {}
    for a in get("https://api.robinhood.com/rhj/assets")["assets"]:
        if a.get("status") == "ASSET_STATUS_INACTIVE":
            continue
        for d in a.get("deployments", []):
            if d.get("chainId") == 4663:
                out[d["contractAddress"].lower()] = a["tokenSymbol"]
    return out


def nominated(tokens):
    """Uniswap V4 pool ids DexScreener lists for the stock tokens, with their USD liquidity"""
    ids = {}
    addrs = sorted(tokens)
    for i in range(0, len(addrs), 30):
        for p in get("https://api.dexscreener.com/tokens/v1/robinhood/" + ",".join(addrs[i:i + 30])) or []:
            pid = str(p.get("pairAddress", "")).lower()
            liq = (p.get("liquidity") or {}).get("usd") or 0
            if p.get("dexId") == "uniswap" and "v4" in (p.get("labels") or []) and len(pid) == 66 and liq >= MIN_LIQ_USD:
                ids[pid] = max(liq, ids.get(pid, 0))
        time.sleep(1)
    return ids


def key_by_id(pid, head):
    """The pool's key from its Initialize event (topic 1 is the pool id), newest windows first"""
    for z in range(head, -1, -SPAN):
        a = max(0, z - SPAN + 1)
        logs = top.rpc1("eth_getLogs", [{"fromBlock": hex(a), "toBlock": hex(z), "address": top.PM, "topics": [top.INIT, pid]}])
        if logs:
            return top.key_of(logs[0])
    return None


def main():
    head = int(top.rpc("eth_blockNumber", []), 16)
    try:
        cache = json.load(open(CACHE))
    except (OSError, ValueError):
        cache = {}
    tokens = stock_tokens()
    ids = nominated(tokens)
    want = [pid for pid in ids if pid not in cache]
    print("stock tokens", len(tokens), "V4 pools nominated", len(ids), "keys to look up", len(want), flush=True)
    with cf.ThreadPoolExecutor(int(os.environ.get("PAR", "3"))) as ex:
        for pid, k in zip(want, ex.map(lambda p: key_by_id(p, head), want)):
            if k:
                cache[pid] = k
    with open(CACHE, "w") as f:
        json.dump(cache, f, indent=0, sort_keys=True)

    why, kept = {}, []
    for pid in sorted(ids, key=lambda p: -ids[p]):  # deepest first
        k = cache.get(pid)
        reason = None
        if not k:
            reason = "no Initialize event"
        else:
            c0, c1 = k["currency0"], k["currency1"]
            stock = c1 if c1 in tokens else c0 if c0 in tokens else None
            other = c0 if stock == c1 else c1
            if stock is None or other not in top.BASE:
                reason = "not stock/ETH/WETH/USDG"
            elif k["hooks"] not in top.ALLOW:
                reason = "hook not allowed"
            elif k["fee"] != top.DYNAMIC and k["fee"] > top.MAX_FEE:
                reason = "fee too high"
            elif k["hooks"] == "0x0000000000000000000000000000000000000000" and head - k["block"] < top.MIN_AGE_BLOCKS:
                reason = "too new"
            elif not top.deep(k):
                reason = "too shallow"
        if reason:
            why[reason] = why.get(reason, 0) + 1
            continue
        kept.append({**{x: k[x] for x in ("currency0", "currency1", "fee", "tickSpacing", "hooks")}, "symbol": tokens[stock], "liquidityUsd": round(ids[pid])})
    per, out = {}, []
    for c in kept:
        pair = (c["currency0"], c["currency1"])
        if per.get(pair, 0) >= PER_PAIR:
            why["pair has enough pools"] = why.get("pair has enough pools", 0) + 1
            continue
        per[pair] = per.get(pair, 0) + 1
        out.append(c)
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1)
    print("stock pools kept", len(out), "tokens", len({c["symbol"] for c in out}), "dropped", why)


if __name__ == "__main__":
    main()

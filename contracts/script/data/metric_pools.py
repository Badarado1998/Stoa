"""Rank Metric OMM pools on Robinhood Chain for Stoa's MetricAdapter and write metric-pools-4663.json.

Lists every pool from the Metric factory's PoolCreated events, keeps pairs with WETH or USDG on one side, quotes each
pool both ways through Metric's quoter (live oracle prices, paused pools refused) with a probe of PROBE_USD, and keeps
the MAX_POOLS pools per pair that fill the probe fully and give the most. Run from this folder:
  python3 -I metric_pools.py        (public RPC, no key)
"""
import json
import os
import time
import urllib.request

RPC = os.environ.get("ROBINHOOD_RPC_URL") or "https://rpc.mainnet.chain.robinhood.com"
FACTORY = "0x2a53833cc95548cf52c7b159110e22d3a9018f32"
QUOTER = "0x3b9ea79f482094323d06064e637a7f4528560fcb"
WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73"
USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168"
POOL_CREATED = "0x4b36a0ddce54edb36597ee7d496df06c53fe875aba9d7257534a38d5177899aa"
MAX_POOLS = 4
PROBE_USD = float(os.environ.get("PROBE_USD", "500"))
MIN_DEPTH_USD = float(os.environ.get("MIN_DEPTH_USD", "200"))  # a pool must fill this much both ways to be listed
QUOTE_SEL = "7a6efbfd"  # quoteLiveExactInSingle(address,address,bool,uint128,uint128)


def rpc(method, params):
    req = urllib.request.Request(RPC, data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(),
                                 headers={"content-type": "application/json", "user-agent": "curl/8.5.0"})
    err = None
    for i in range(30):
        time.sleep(0.1)
        try:
            out = json.load(urllib.request.urlopen(req, timeout=60))
            if "result" in out:
                return out["result"]
            err = out.get("error")
            if method == "eth_call":  # a revert is an answer, not a rate limit
                return None
        except Exception as e:
            err = e
        time.sleep(min(3 * (i + 1), 60))
    raise RuntimeError(f"{method} failed: {err}")


def logs(a, z):
    try:
        return rpc("eth_getLogs", [{"address": FACTORY, "topics": [POOL_CREATED], "fromBlock": hex(a), "toBlock": hex(z)}])
    except RuntimeError:
        if z > a:
            m = (a + z) // 2
            return logs(a, m) + logs(m + 1, z)
        raise


def word(n):
    return n.to_bytes(32, "big").hex()


def addr(a):
    return a[2:].lower().rjust(64, "0")


def quote(pool, zero_for_one, amount):
    limit = 0 if zero_for_one else (1 << 128) - 1
    data = "0x" + QUOTE_SEL + addr(pool) + word(0) + word(1 if zero_for_one else 0) + word(amount) + word(limit)
    r = rpc("eth_call", [{"to": QUOTER, "data": data}, "latest"])
    if not r or len(r) < 130:
        return 0
    used, out = int(r[2:66], 16), int(r[66:130], 16)
    return out if used == amount else 0


def decimals(t):
    r = rpc("eth_call", [{"to": t, "data": "0x313ce567"}, "latest"])
    return int(r, 16) if r else 18


def main():
    head = int(rpc("eth_blockNumber", []), 16)
    pools = []
    for a in range(0, head + 1, 9_000_000):
        pools += logs(a, min(a + 8_999_999, head))
    pairs = {}  # by sorted pair; Metric pools keep their own token order, so each pool keeps its token0
    for l in pools:
        p, t0, t1 = ("0x" + l["topics"][i][-40:] for i in (1, 2, 3))
        if WETH in (t0, t1) or USDG in (t0, t1):
            pairs.setdefault(tuple(sorted((t0, t1))), []).append((p, t0))
    print("pools", len(pools), "pairs with WETH or USDG", len(pairs))
    # the probe: PROBE_USD of the WETH or USDG side, priced from the best WETH/USDG pool
    usd_per_weth = 0
    for p, t0 in pairs.get(tuple(sorted((WETH, USDG))), []):
        usd_per_weth = max(usd_per_weth, quote(p, t0 == WETH, 10**18) / 1e6)
    print("ETH price", round(usd_per_weth, 2))
    out = []
    for (t0, t1), ps in sorted(pairs.items(), key=lambda kv: -len(kv[1])):
        base = USDG if USDG in (t0, t1) else WETH  # WETH/USDG: probe with USDG
        unit_usd = 1e6 if base == USDG else 1e18 / usd_per_weth
        probe = int(PROBE_USD * unit_usd)
        need = int(MIN_DEPTH_USD * unit_usd)
        ranked = []
        for p, p0 in ps:
            base_is_0 = base == p0
            got = quote(p, base_is_0, probe)  # base -> other token
            if not got:
                continue
            back = quote(p, not base_is_0, got * need // probe)  # the other way, about MIN_DEPTH_USD
            if not back:
                continue
            ranked.append((got, p))
        ranked.sort(reverse=True)
        if ranked:
            keep = [p for _, p in ranked[:MAX_POOLS]]
            out.append({"token0": t0, "token1": t1, "pools": keep, "probe": probe, "best": ranked[0][0]})
            print(t0[:10], t1[:10], "pools", len(ps), "quoting", len(ranked), "kept", len(keep))
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "metric-pools-4663.json"), "w") as f:
        json.dump(out, f, indent=1)
    print("wrote", len(out), "pairs")


if __name__ == "__main__":
    main()

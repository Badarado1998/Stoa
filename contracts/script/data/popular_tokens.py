"""Rebuild web/lib/popular-tokens-4663.json, the Robinhood Chain tokens listed in the token picker, Pools and Tokens.

Candidates: the tokens of the most traded Uniswap V4 pools (v4-seed-pools-4663.json, refreshed daily by
refresh-v4-pools.yml) plus the tokens already listed. For each candidate:
  - DexScreener: 24h volume and liquidity (summed / max over its Robinhood Chain pairs), symbol and logo;
  - Stoa's safety check (stoadex.com/api/safety/robinhood/<token>): dropped when its verdict is "danger" or a test
    buy through Stoa fails, so the picker never offers a token Stoa cannot buy;
  - a logo is required (DexScreener's, saved once as web/public/tokens/<address>.webp; an existing file is kept; an
    official stock token uses its stock logo from web/public/stocks).
Ranked by 24h volume, the most traded token per symbol (look-alikes drop out). A token already listed stays listed
while it passes these checks, whatever its rank, because its token page (/tokens/robinhood/<address>) exists only
while it is listed; new tokens are added, most traded first, while the list holds fewer than MAX. Official Robinhood
stock tokens (stoadex.com/api/v1/stocks) are not added (Trade lists them from that API); one already listed is marked
"stock" so the picker does not call it unverified. A new token using an official stock token's symbol is skipped.
A token already listed needs no minimum volume to stay a candidate (a new one needs NEW_MIN_VOL_USD), but every token
needs MIN_LIQ_USD of liquidity.
Run from this folder: python3 -I popular_tokens.py   (DRY=1: print, write nothing)
"""
import io
import json
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.normpath(os.path.join(HERE, "..", "..", "..", "web"))
OUT = os.path.join(WEB, "lib", "popular-tokens-4663.json")
LOGOS = os.path.join(WEB, "public", "tokens")
SEED = os.path.join(HERE, "v4-seed-pools-4663.json")
RPC = os.environ.get("ROBINHOOD_RPC_URL") or "https://rpc.mainnet.chain.robinhood.com"
SITE = "https://stoadex.com"
MAX = int(os.environ.get("MAX_TOKENS", "100"))  # new tokens are added while the list is shorter than this
MIN_LIQ_USD = float(os.environ.get("MIN_LIQ_USD", "1000"))
NEW_MIN_VOL_USD = float(os.environ.get("NEW_MIN_VOL_USD", "200"))  # a new token needs this much 24h volume
DRY = bool(os.environ.get("DRY"))
CORE = {"0x0000000000000000000000000000000000000000", "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
        "0x5fc5360d0400a0fd4f2af552add042d716f1d168"}
STOA = "0x13e6993417616de724f2b337d65063f229e96718"  # has its own place in the app
PONS_HOOK = "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044"  # Pons graduation pools
# kept out by hand, with the reason (a logo or name borrowed from a company or another project, a reported scam, ...)
EXCLUDE = {
    "0x385f4f8ae47651ce5f58f5265395a669f8281e18": "MEME: uses AMC's logo",
}


def get(url, timeout=30, raw=False):
    req = urllib.request.Request(url, headers={"accept": "application/json", "user-agent": "stoadex.com token list"})
    for i in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                b = r.read()
            return b if raw else json.loads(b)
        except Exception as e:  # noqa: BLE001
            if i == 2:
                raise
            print("retry", url[:80], e, file=sys.stderr)
            time.sleep(3 * (i + 1))


def rpc_decimals(addr):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "eth_call",
                       "params": [{"to": addr, "data": "0x313ce567"}, "latest"]}).encode()
    req = urllib.request.Request(RPC, body, {"Content-Type": "application/json", "user-agent": "stoadex.com"})
    for i in range(5):  # the public RPC rate-limits bursts
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                res = json.load(r).get("result") or "0x"
            time.sleep(0.5)
            return int(res, 16) if len(res) > 2 else None
        except Exception as e:  # noqa: BLE001
            print("rpc retry", addr, e, file=sys.stderr)
            time.sleep(5 * (i + 1))
    return None


def main():
    listed = json.load(open(OUT))
    old = {t["address"].lower(): t for t in listed}
    seed = json.load(open(SEED))
    cands, pons = [], set()
    for p in seed:
        for c in (p["currency0"].lower(), p["currency1"].lower()):
            if c in CORE or c == STOA or c in EXCLUDE:
                continue
            if c not in cands:
                cands.append(c)
            if p["hooks"].lower() == PONS_HOOK:
                pons.add(c)
    for a in old:
        if a not in cands and a not in CORE and a not in EXCLUDE:
            cands.append(a)
    st = get(f"{SITE}/api/v1/stocks")
    st = st.get("stocks", []) if isinstance(st, dict) else st
    stocks = {s["address"].lower() for s in st}
    stock_syms = {(s.get("symbol") or "").upper() for s in st}
    if not stocks:
        sys.exit("stock list empty: not rebuilding")

    # DexScreener: 30 tokens a call
    market = {}
    for i in range(0, len(cands), 30):
        chunk = cands[i:i + 30]
        for pr in get("https://api.dexscreener.com/tokens/v1/robinhood/" + ",".join(chunk)) or []:
            for side in ("baseToken", "quoteToken"):
                a = pr[side]["address"].lower()
                if a not in chunk:
                    continue
                m = market.setdefault(a, {"vol": 0.0, "liq": 0.0, "symbol": None, "logo": None})
                m["vol"] += float((pr.get("volume") or {}).get("h24") or 0) if side == "baseToken" else 0.0
                m["liq"] = max(m["liq"], float((pr.get("liquidity") or {}).get("usd") or 0))
                if side == "baseToken":
                    m["symbol"] = m["symbol"] or pr[side].get("symbol")
                    m["logo"] = m["logo"] or (pr.get("info") or {}).get("imageUrl")
        time.sleep(1)

    rows = []
    for a in cands:
        m = market.get(a)
        if not m or m["liq"] < MIN_LIQ_USD:
            if a in old:
                print("drop (no pair or under the liquidity floor):", old[a]["symbol"], a)
            continue
        if a not in old and m["vol"] < NEW_MIN_VOL_USD:
            continue
        rows.append((m["vol"], a, m))
    rows.sort(key=lambda r: -r[0])

    out, seen = [], set()
    for vol, a, m in rows:
        if a not in old and len(out) + sum(1 for _, b, _ in rows if b in old and b not in {t["address"] for t in out}) >= MAX:
            continue  # room is kept for every listed token still to come
        sym = (old.get(a, {}).get("symbol") or m["symbol"] or "").strip()
        if not sym or sym.lower() in seen:
            continue
        if a not in old and sym.upper() in stock_syms and a not in stocks:
            print("skip (uses an official stock token's symbol):", sym, a)
            continue
        if a not in old and a in stocks:
            continue  # official stock tokens are in the picker already (Trade loads /api/v1/stocks)
        logo_file = os.path.join(LOGOS, a + ".webp")
        stock_logo = os.path.join(WEB, "public", "stocks", a + ".webp")
        if a in stocks and os.path.exists(stock_logo):
            logo_file = stock_logo  # the issuer's own stock logo (DexScreener shows a generic one)
        if not os.path.exists(logo_file) and not m["logo"]:
            continue
        try:
            s = get(f"{SITE}/api/safety/robinhood/{a}", timeout=60)
        except Exception as e:  # noqa: BLE001
            print("skip (safety check unavailable):", sym, a, e)
            if a in old:
                out.append(old[a])
                seen.add(sym.lower())
            continue
        test = s.get("test") or {}
        if s.get("verdict") == "danger" or test.get("buyOk") is False:
            print("drop (safety check):", sym, a, s.get("verdict"), test.get("why"))
            continue
        if not os.path.exists(logo_file):
            try:
                from PIL import Image
                img = Image.open(io.BytesIO(get(m["logo"], raw=True))).convert("RGBA")
                img.thumbnail((128, 128))
                if not DRY:
                    img.save(logo_file, "WEBP", quality=88)
            except Exception as e:  # noqa: BLE001
                print("skip (logo failed):", sym, a, e)
                continue
        t = dict(old.get(a) or {})
        t.update({"symbol": sym, "address": a})
        if "decimals" not in t:
            d = rpc_decimals(a)
            if d is None:
                continue
            t["decimals"] = d
        if a in pons:
            t["launchpad"] = "Pons"
        if a in stocks:
            t["kind"] = "stock"
            t.pop("launchpad", None)
        t["logo"] = f"/stocks/{a}.webp" if logo_file == stock_logo else f"/tokens/{a}.webp"
        out.append({k: t[k] for k in ("symbol", "address", "decimals", "launchpad", "kind", "logo") if k in t})
        seen.add(sym.lower())
        print(f"{sym:>12} vol ${vol:,.0f} liq ${m['liq']:,.0f}" + ("" if a in old else "  NEW"))

    added = [t["symbol"] for t in out if t["address"] not in old]
    gone = [old[a]["symbol"] for a in old if a not in {t["address"] for t in out}]
    print("listed", len(out), "added", added, "removed", gone)
    if not DRY:
        with open(OUT, "w") as f:
            json.dump(out, f, indent=1)
            f.write("\n")


if __name__ == "__main__":
    main()

"""List tokens that came to Elysium through the canonical token bridge from HyperEVM and that Stoa can actually route.

Run daily by .github/workflows/refresh-v4-pools.yml, after new V4 pools are registered. Writes web/lib/bridged-tokens.json.

A token is listed when:
  * it was deposited through Elysium's standard gateway, and the gateway maps its HyperEVM address to this address;
  * the router quotes 100 USDC into it, and quoting that output back returns at least 90 USDC (enough two-way depth).

Being bridged says where a token came from, not that it is safe: anyone can bridge any HyperEVM token. The web shows
these with their address and the usual unverified-token warning. Only the hand-checked list in web/lib/tokens.ts gets
the check mark.
"""
import concurrent.futures as cf
import json
import os
import time
import urllib.request
from collections import Counter

RPC = os.environ.get("ELYSIUM_RPC_URL") or "https://rpc.elysium.kinetiq.xyz"
GATEWAY = "0x5DC84e4Cb0F9082246E92a5585C5395592B1aF1f"
USDC = "0xb47c4C8F73F009CC0C0d3f92B388d13E293F0B65"
DEPOSIT_FINALIZED = "0xc7f2e9c55c40a50fbc217dfc70cd39a222940dfa62145aa0ca49eb9535d4fcb2"
SEL_QUOTE = "b6466384"  # quote(address,address,uint256)
SEL_L2 = "a7e28d48"  # calculateL2TokenAddress(address)
SEL_L1 = "c2eeeebd"  # l1Address()
IN = 100 * 10**6
MIN_BACK = 90 * 10**6

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..", "..")
OUT = os.path.join(ROOT, "web", "lib", "bridged-tokens.json")
ROUTER = json.load(open(os.path.join(ROOT, "web", "lib", "deployments.json")))["router"]


def rpc(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    for i in range(6):
        try:
            req = urllib.request.Request(RPC, body, {"content-type": "application/json", "user-agent": "curl/8.5.0"})
            r = json.load(urllib.request.urlopen(req, timeout=90))
            if "error" in r:
                if "revert" in json.dumps(r["error"]).lower():
                    return None
                raise RuntimeError(r["error"])
            return r["result"]
        except Exception:
            if i == 5:
                raise
            time.sleep(2 * (i + 1))


def call(to, data):
    return rpc("eth_call", [{"to": to, "data": data}, "latest"])


def w(x):
    return (x if isinstance(x, str) else hex(x))[2:].lower().rjust(64, "0")


def text(res):
    if not res or len(res) < 3:
        return ""
    b = bytes.fromhex(res[2:])
    if len(b) >= 96:
        n = int.from_bytes(b[32:64], "big")
        return b[64:64 + n].decode(errors="ignore").strip()
    return b.rstrip(b"\0").decode(errors="ignore").strip()


def quote(a, b, amt):
    r = call(ROUTER, "0x" + SEL_QUOTE + w(a) + w(b) + w(amt))
    return int(r[2:66], 16) if r and len(r) >= 66 else 0


def check(l1):
    r = call(GATEWAY, "0x" + SEL_L2 + w(l1))
    if not r:
        return None
    l2 = "0x" + r[-40:]
    back = call(l2, "0x" + SEL_L1)
    if not back or back[-40:].lower() != l1[-40:].lower():
        return None  # never deployed, or not the gateway's token
    out = quote(USDC, l2, IN)
    if out == 0 or quote(l2, USDC, out) < MIN_BACK:
        return None
    dec = call(l2, "0x313ce567")
    return {
        "symbol": text(call(l2, "0x95d89b41")),
        "name": text(call(l2, "0x06fdde03")),
        "address": l2,
        "decimals": int(dec, 16) if dec else 18,
        "hyperevm": l1,
    }


def main():
    logs = rpc("eth_getLogs", [{"fromBlock": "0x0", "toBlock": "latest", "address": GATEWAY, "topics": [DEPOSIT_FINALIZED]}])
    seen = Counter("0x" + l["topics"][1][-40:] for l in logs)
    print(f"{len(seen)} bridged tokens")
    with cf.ThreadPoolExecutor(4) as ex:
        found = [t for t in ex.map(check, [a for a, _ in seen.most_common()]) if t and t["symbol"]]
    # checksum casing for the web; keep the most deposited first
    for t in found:
        t["address"] = to_checksum(t["address"])
        t["hyperevm"] = to_checksum(t["hyperevm"])
    print(f"{len(found)} routable: " + ", ".join(t["symbol"] for t in found))
    with open(OUT, "w") as f:
        json.dump(found, f, indent=1, ensure_ascii=False)
        f.write("\n")


def to_checksum(a):
    # the workflow has Foundry installed; without it the address stays lowercase, which viem also accepts
    import shutil
    import subprocess
    if shutil.which("cast"):
        return subprocess.check_output(["cast", "to-check-sum-address", a]).decode().strip()
    return a.lower()


if __name__ == "__main__":
    main()

"""List every pool key on Stoa's first Uniswap V4 adapter on Elysium and write v4-v3-seed-99901.json, the seed that
registers the same keys on Elysium's UniswapV4AdapterV3 (seed-v4.sh with the keeper key, at most MAX_PER_PAIR keys a
pair). Only keys whose registration was sent by Stoa's keeper (the Elysium deployer) are copied: a key an outsider
added through the old adapter's open register() is left out and printed. Run from this folder:
ELYSIUM_RPC_URL=... python3 -I v4_copy_keys_elysium.py
"""
import json
import os
import urllib.request

RPC = os.environ.get("ELYSIUM_RPC_URL") or "https://rpc.elysium.kinetiq.xyz"
OLD = "0xeb4bec2795ce314d1add4f8b3f2fcfbf38e892e5"  # UniswapV4Adapter (first V4 adapter) on Elysium
KEEPER = "0x056896d7d62fb4fae30f53d76cb55264f4c5c500"  # Elysium deployer: registered every key so far
DEPLOY_BLOCK = 5_216_650
SPAN = 500_000
KEYS_FOR = "be93924d"  # keysFor(address,address)
WHYPE = "0xba876237b0f021a6c6d852d6c26e107997cc5e81"
ZERO = "0x" + "0" * 40


def canon(c):
    # the adapter lists native HYPE and WHYPE pools together, under WHYPE
    return WHYPE if c == ZERO else c


def call(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(RPC, body, {"Content-Type": "application/json", "User-Agent": "stoa-v4-copy"})
    with urllib.request.urlopen(req, timeout=60) as r:
        out = json.load(r)
    if "error" in out:
        raise RuntimeError(out["error"])
    return out["result"]


def topic(sig):
    # keccak256 of the event signature, via the node (web3_sha3) so no extra package is needed
    return call("web3_sha3", ["0x" + sig.encode().hex()])


def keys_for(a, b):
    r = call("eth_call", [{"to": OLD, "data": "0x" + KEYS_FOR + a[2:].rjust(64, "0") + b[2:].rjust(64, "0")}, "latest"])
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
    reg = topic("Registered(bytes32,address,address,address)")
    head = int(call("eth_blockNumber", []), 16)
    logs, a = [], DEPLOY_BLOCK
    while a <= head:
        z = min(a + SPAN - 1, head)
        logs += call("eth_getLogs", [{"address": OLD, "fromBlock": hex(a), "toBlock": hex(z), "topics": [reg]}])
        a = z + 1
    pairs, outsiders = set(), set()
    for l in logs:
        d = l["data"][2:]
        p = tuple(sorted((canon("0x" + d[24:64]), canon("0x" + d[88:128]))))
        sender = call("eth_getTransactionByHash", [l["transactionHash"]])["from"].lower()
        (pairs if sender == KEEPER else outsiders).add(p)
    for p in sorted(outsiders - pairs):
        print("skipped (registered by an outsider):", p)
    seed = []
    for p in sorted(pairs):
        if p in outsiders:
            print("skipped (an outsider also registered on this pair):", p)
            continue
        seed += keys_for(*p)
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "v4-v3-seed-99901.json"), "w") as f:
        json.dump(seed, f, indent=1)
    print("registrations", len(logs), "pairs", len(pairs), "keys", len(seed))


if __name__ == "__main__":
    main()

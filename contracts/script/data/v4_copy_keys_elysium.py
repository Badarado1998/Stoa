"""Write v4-v3-seed-99901.json: the keys Stoa's keeper registered on the first Uniswap V4 adapter on Elysium, to be
registered on UniswapV4AdapterV3 (seed-v4.sh with the keeper key). Built as suggested in the HEY Research Lab review of
the Elysium package (F-1 and F-2). It never reads the old adapter's key list, which anyone can change. The seed is
built from the keeper's own registration transactions:
  1. One block for everything: the head is read once and the log scan ends there.
  2. Per key, not per pair: every Registered event whose transaction the keeper sent is one key, and the key is taken
     from that transaction's own argument (checked against the event's pool id). What an outsider registers on the
     same pair, before or during the run, is never read.
  3. A keeper key that was later pushed out by an outsider's registration (the old adapter replaces the weakest key
     of a full pair) is still copied, with a warning. A key the adapter's owner removed, or the keeper replaced
     itself, is left out and printed.
  4. It fails (exit 2, no seed written) if a keeper registration is not a plain register() call to the old adapter,
     or its argument does not hash to the event's pool id: that needs a person.
Run from this folder: ELYSIUM_RPC_URL=... python3 -I v4_copy_keys_elysium.py
"""
import json
import os
import sys
import urllib.request

RPC = os.environ.get("ELYSIUM_RPC_URL") or "https://rpc.elysium.kinetiq.xyz"
OLD = "0xeb4bec2795ce314d1add4f8b3f2fcfbf38e892e5"  # UniswapV4Adapter (first V4 adapter) on Elysium
KEEPER = "0x056896d7d62fb4fae30f53d76cb55264f4c5c500"  # Elysium deployer: registered every key so far
DEPLOY_BLOCK = 5_216_650
SPAN = 500_000
WHYPE = "0xba876237b0f021a6c6d852d6c26e107997cc5e81"
ZERO = "0x" + "0" * 40
OUT = os.environ.get("SEED_OUT") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "v4-v3-seed-99901.json")


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


def sha3(hexdata):
    # keccak256 via the node (web3_sha3), so no extra package is needed
    return call("web3_sha3", ["0x" + hexdata]).lower()


def stop(msg):
    print("::error::" + msg)
    sys.exit(2)


def main():
    reg = sha3("Registered(bytes32,address,address,address)".encode().hex())
    unreg = sha3("Unregistered(bytes32)".encode().hex())
    register = sha3("register((address,address,uint24,int24,address))".encode().hex())[:10]
    head = int(call("eth_blockNumber", []), 16)
    logs, a = [], DEPLOY_BLOCK
    while a <= head:
        z = min(a + SPAN - 1, head)
        logs += call("eth_getLogs", [{"address": OLD, "fromBlock": hex(a), "toBlock": hex(z), "topics": [[reg, unreg]]}])
        a = z + 1
    logs.sort(key=lambda l: (int(l["blockNumber"], 16), int(l["logIndex"], 16)))
    # the old adapter emits Unregistered and then Registered, back to back, when a registration replaces a key
    replaced = {(l["transactionHash"], int(l["logIndex"], 16) - 1) for l in logs if l["topics"][0].lower() == reg}
    txs = {}

    def tx(h):
        if h not in txs:
            txs[h] = call("eth_getTransactionByHash", [h])
        return txs[h]

    keys, outsider, evicted = {}, 0, set()  # pool id -> key, in the order the keeper registered them
    for l in logs:
        i = l["topics"][1].lower()
        t = tx(l["transactionHash"])
        sender = t["from"].lower()
        if l["topics"][0].lower() == reg:
            if sender != KEEPER:
                outsider += 1
                continue
            data = t["input"][2:]
            if (t["to"] or "").lower() != OLD or "0x" + data[:8] != register or len(data) != 8 + 5 * 64:
                stop(f"keeper registration {l['transactionHash']} is not a plain register() call to the old adapter")
            if sha3(data[8:]) != i:
                stop(f"the argument of {l['transactionHash']} does not hash to the pool id of its event")
            f = [data[8 + 64 * j: 8 + 64 * (j + 1)] for j in range(5)]
            ts = int(f[3], 16)
            ts = ts - (1 << 256) if ts >> 255 else ts
            keys.pop(i, None)
            keys[i] = {"currency0": "0x" + f[0][24:], "currency1": "0x" + f[1][24:], "fee": int(f[2], 16),
                       "tickSpacing": ts, "hooks": "0x" + f[4][24:]}
            evicted.discard(i)
        elif i in keys:
            if (l["transactionHash"], int(l["logIndex"], 16)) in replaced and sender != KEEPER:
                evicted.add(i)  # pushed out of a full pair by an outsider's registration: still the keeper's key
                print("::warning::a keeper key was pushed off the old adapter by", sender, "and is copied anyway:", keys[i])
            else:
                print("left out (removed by the adapter's owner or replaced by the keeper):", keys.pop(i))
    pair = lambda k: tuple(sorted((canon(k["currency0"]), canon(k["currency1"]))))
    seed = sorted(keys.values(), key=pair)  # stable: within a pair, the order the keeper registered them
    with open(OUT, "w") as f:
        json.dump(seed, f, indent=1)
    print("block", head, "keeper registrations copied", len(seed), "pairs", len({pair(k) for k in seed}),
          "outsider registrations not read", outsider, "keeper keys pushed off the old adapter and copied anyway", len(evicted))


if __name__ == "__main__":
    main()

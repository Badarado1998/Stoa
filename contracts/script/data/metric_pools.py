"""Rank Metric OMM pools on Robinhood Chain for Stoa's MetricAdapter and write metric-pools-4663.json.

Lists every pool from the Metric factory's PoolCreated events and keeps pairs with WETH or USDG on one side. For each
direction of a pair it runs every pool's real swap path at a few order sizes (PROBES_USD), with eth_call and a code
override of ../MetricSwapProbe.sol, which stops at the payment callback and reports what the pool would take and give.
(Metric's quoter is not enough here: some tokenized-stock oracles answer a simulated quote but refuse the pool when it
really swaps.) Then it picks the order of up to MAX_POOLS pools that loses the least against the best pool at each
size. The adapter swaps on the first pool of the list that fills the whole order, so pools that pay the most on
small orders come first and deeper pools after them. Run from this folder:
  python3 -I metric_pools.py        (public RPC, no key)
"""
import itertools
import json
import os
import time
import urllib.request

RPC = os.environ.get("ROBINHOOD_RPC_URL") or "https://rpc.mainnet.chain.robinhood.com"
FACTORY = "0x2a53833cc95548cf52c7b159110e22d3a9018f32"
WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73"
USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168"
POOL_CREATED = "0x4b36a0ddce54edb36597ee7d496df06c53fe875aba9d7257534a38d5177899aa"
MAX_POOLS = 4
PROBES_USD = [float(x) for x in os.environ.get("PROBES_USD", "50,300,1500,5000").split(",")]
SHORTLIST = 6  # pools considered for the order of a list (the best at some size, then the best at the middle size)
SKIP_BPS = 0.05  # cost charged for each pool a swap tries before the one that fills (one reverted pool swap)
KEEP_BPS = 0.5  # keep the adapter's current list unless the new order loses this much less (saves keeper gas)
POOLS_FOR_SEL = "b7949fc4"  # poolsFor(address,address)
# runtime code of ../MetricSwapProbe.sol (forge build; out/MetricSwapProbe.sol/MetricSwapProbe.json, deployedBytecode)
PROBE_CODE = "0x608060405234801561000f575f5ffd5b5060043610610034575f3560e01c8063b0ea12f914610038578063c32510751461004d575b5f5ffd5b61004b6100463660046101b2565b610060565b005b61004b61005b366004610216565b610161565b8273ffffffffffffffffffffffffffffffffffffffff1663e24f08843084848661009a576fffffffffffffffffffffffffffffffff61009c565b5f5b6040518563ffffffff1660e01b815260040161011b949392919073ffffffffffffffffffffffffffffffffffffffff9490941684529115156020840152600f0b60408301526fffffffffffffffffffffffffffffffff16606082015260c0608082018190525f90820181905260e060a083018190528201526101000190565b60408051808303815f875af1158015610136573d5f5f3e3d5ffd5b505050506040513d601f19601f8201168201806040525081019061015a9190610292565b5050505050565b6040517fe47aa50e000000000000000000000000000000000000000000000000000000008152600481018590526024810184905260440160405180910390fd5b80600f0b81146101af575f5ffd5b50565b5f5f5f606084860312156101c4575f5ffd5b833573ffffffffffffffffffffffffffffffffffffffff811681146101e7575f5ffd5b9250602084013580151581146101fb575f5ffd5b9150604084013561020b816101a1565b809150509250925092565b5f5f5f5f60608587031215610229575f5ffd5b8435935060208501359250604085013567ffffffffffffffff81111561024d575f5ffd5b8501601f8101871361025d575f5ffd5b803567ffffffffffffffff811115610273575f5ffd5b876020828401011115610284575f5ffd5b949793965060200194505050565b5f5f604083850312156102a3575f5ffd5b82516102ae816101a1565b60208401519092506102bf816101a1565b80915050925092905056fea2646970667358221220bdb178c5b0b0e72439c649654bd236acf495a21f35db1422abec7dc81fd74b2564736f6c634300081c0033"
PROBE_AT = "0x00000000000000000000000000000000005700b3"  # any empty address: the code is only put there for the call
PROBE_FROM = "0x000000000000000000000000000000000000dead"  # a sender, as in a real transaction (not a zero-origin quote)
PROBE_SEL = "b0ea12f9"  # probe(address,bool,int128)
DELTAS_SEL = "e47aa50e"  # Deltas(int256,int256)


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


def revert_data(call, overrides):
    """eth_call that is expected to revert: returns the revert data ("" if none), retrying rate limits."""
    req = urllib.request.Request(RPC, data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "eth_call",
                                                       "params": [call, "latest", overrides]}).encode(),
                                 headers={"content-type": "application/json", "user-agent": "curl/8.5.0"})
    err = None
    for i in range(30):
        time.sleep(0.1)
        try:
            out = json.load(urllib.request.urlopen(req, timeout=60))
            if "result" in out:
                return ""
            e = out.get("error") or {}
            if e.get("code") == 3 or "revert" in str(e.get("message", "")):
                return e.get("data") or ""
            err = e
        except Exception as e:
            err = e
        time.sleep(min(3 * (i + 1), 60))
    raise RuntimeError(f"eth_call failed: {err}")


def signed(word_hex):
    v = int(word_hex, 16)
    return v - (1 << 256) if v >> 255 else v


def quote(pool, zero_for_one, amount):
    """What `pool` pays for `amount` in a real swap now, if it takes all of it; else 0."""
    data = "0x" + PROBE_SEL + addr(pool) + word(1 if zero_for_one else 0) + word(amount)
    d = revert_data({"from": PROBE_FROM, "to": PROBE_AT, "data": data}, {PROBE_AT: {"code": PROBE_CODE}})
    k = d.find(DELTAS_SEL)
    if k < 0:
        return 0  # refused before asking to be paid: paused, empty, or its oracle will not serve it
    w = d[k + 8:k + 136]
    if len(w) < 128:
        return 0
    d0, d1 = signed(w[:64]), signed(w[64:])
    paid, got = (d0, d1) if zero_for_one else (d1, d0)
    return -got if paid == amount and got < 0 else 0


def decimals(t):
    r = rpc("eth_call", [{"to": t, "data": "0x313ce567"}, "latest"])
    return int(r, 16) if r else 18


def adapter_address():
    """The deployed MetricAdapter, if there is one (its lists are kept when they are still about as good)."""
    if os.environ.get("METRIC_ADAPTER"):
        return os.environ["METRIC_ADAPTER"].lower()
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(here, "..", "..", "deployments", "4663-metric.json")
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)["metricAdapter"].lower()
    return None


def current_list(adapter, tin, tout):
    if not adapter:
        return []
    r = rpc("eth_call", [{"to": adapter, "data": "0x" + POOLS_FOR_SEL + addr(tin) + addr(tout)}, "latest"])
    if not r or len(r) < 130:
        return []
    n = int(r[66:130], 16)
    return ["0x" + r[130 + 64 * i + 24: 130 + 64 * (i + 1)] for i in range(n)]


def rank(ps, tin, tout, sizes, current=()):
    """The ordered pool list for tin -> tout, or None if no pool fills the smallest size."""
    outs = {}
    for p, p0 in ps:
        row = []
        for a in sizes:  # a pool that cannot fill a size cannot fill a larger one either
            row.append(quote(p, p0 == tin, a) if not row or row[-1] else 0)
        if row[0]:
            outs[p] = row
    if not outs:
        return None
    best = [max(r[k] for r in outs.values()) for k in range(len(sizes))]
    short = []
    for k in range(len(sizes)):  # the best pool at each size, then the rest by the middle size
        for p, r in outs.items():
            if best[k] and r[k] == best[k] and p not in short:
                short.append(p)
    mid = len(sizes) // 2
    for p in sorted(outs, key=lambda p: -outs[p][mid]):
        if p not in short:
            short.append(p)
    short = short[:SHORTLIST]

    def loss(order):
        total = 0.0
        for k in range(len(sizes)):
            if not best[k]:
                continue
            for n, p in enumerate(order):
                if outs[p][k]:
                    total += (best[k] - outs[p][k]) * 1e4 / best[k] + n * SKIP_BPS
                    break
            else:
                total += 1e4  # the list cannot fill a size some pool fills
        return total + 1e-3 * len(order)  # same loss: the shorter list (fallbacks are added after)

    orders = (o for n in range(1, min(MAX_POOLS, len(short)) + 1) for o in itertools.permutations(short, n))
    order = min(orders, key=loss)
    # fallbacks: a swap only reaches them when every pool before them fails (paused, emptied), so they cost nothing
    # otherwise; most useful first
    rest = sorted((p for p in short if p not in order), key=lambda p: [-x for x in reversed(outs[p])])
    order = tuple(order) + tuple(rest[:MAX_POOLS - len(order)])
    current = tuple(current)
    if current and len(current) <= MAX_POOLS and all(p in outs for p in current):
        if loss(current) <= loss(order) + KEEP_BPS and len(current) >= min(len(order), 2):
            order = current
    got = []
    for k in range(len(sizes)):
        got.append(next((outs[p][k] for p in order if outs[p][k]), 0))
    return {"tokenIn": tin, "tokenOut": tout, "pools": list(order), "sizes": sizes, "best": best, "listed": got,
            "lossBps": round(loss(order), 3)}


# ---------------------------------------------------------------- end-to-end check through Stoa's router
# The probe above stops at the payment callback, so it never meets the payment itself, so each direction is also run
# end to end through the router and the MetricAdapter alone before it is listed.
# How (changed 20 Nov 2026): a plain eth_call of router.swap from a fresh address whose input-token balance and router
# allowance are set with a state override (the storage slots are found by trial, below). The first version ran a
# multi-call eth_simulateV1 batch that bought the input first; on this RPC that batch fails Metric swaps on and off
# while the very same swap as an eth_call, on a mainnet fork and straight against the pool succeeds, so it emptied
# directions that work. When no slot can be found the batch below is still the fallback.
ROUTER = "0x2f2804fad735a38015650f32f95ad5e08d6b3ee5"
QUOTE_SEL, SWAP_SEL, APPROVE_SEL, DEPOSIT_SEL = "b6466384", "8ccfa2ca", "095ea7b3", "d0e30db0"
BALANCE_SEL, ALLOWANCE_SEL = "70a08231", "dd62ed3e"
ZERO = "0x" + "0" * 40
MAGIC = 0x5704A1234567
# mapping roots to try: Solidity slots 0-60, and OpenZeppelin ERC20Upgradeable's ERC-7201 namespace (balances, allowances)
OZ7201 = 0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00
_slots = {}


def _keccak(hexdata):
    return rpc("web3_sha3", ["0x" + hexdata])


def _map_slot(key_hex40, root):
    """Solidity mapping slot: keccak(key . root)"""
    return _keccak(key_hex40.rjust(64, "0") + format(root, "064x"))


def _call_with(state, to, data):
    try:
        return rpc("eth_call", [{"to": to, "data": data}, "latest", state])
    except Exception:
        return None


def _find_slots(token, who):
    """(balance slot of `who`, allowance slot of who->ROUTER) for `token`, found by setting a candidate slot to MAGIC
    and reading it back through the token's own view. None when no candidate matches."""
    token = token.lower()
    if token in _slots:
        roots = _slots[token]
    else:
        roots = None
        for root in list(range(0, 61)) + [OZ7201]:
            slot = _map_slot(who[2:], root)
            r = _call_with({token: {"stateDiff": {slot: "0x" + format(MAGIC, "064x")}}}, token, "0x" + BALANCE_SEL + addr(who))
            if r and int(r, 16) == MAGIC:
                bal_root = root
                break
        else:
            _slots[token] = None
            return None
        for root in list(range(0, 61)) + [OZ7201 + 1]:
            inner = _map_slot(who[2:], root)
            slot = _keccak(ROUTER[2:].rjust(64, "0") + inner[2:])
            r = _call_with({token: {"stateDiff": {slot: "0x" + format(MAGIC, "064x")}}}, token, "0x" + ALLOWANCE_SEL + addr(who) + addr(ROUTER))
            if r and int(r, 16) == MAGIC:
                roots = (bal_root, root)
                break
        _slots[token] = roots
    if not roots:
        return None
    inner = _map_slot(who[2:], roots[1])
    return _map_slot(who[2:], roots[0]), _keccak(ROUTER[2:].rjust(64, "0") + inner[2:])


def _swap_data(tin, tout, mid, l1, l2, amount, to, deadline):
    return "0x" + SWAP_SEL + addr(tin) + addr(tout) + addr(mid) + addr(l1[0]) + word(int(l1[1])) + addr(l2[0]) + word(int(l2[1])) \
        + word(amount) + word(1) + addr(to) + word(deadline) + addr(ZERO)


def _end_to_end_call(adapter, tin, tout, amount):
    """True/False from one eth_call of the swap with the input given by a state override; None if no slots were found."""
    who = "0x" + os.urandom(20).hex()
    slots = _find_slots(tin, who)
    if not slots:
        return None
    state = {who: {"balance": hex(10**21)}, tin: {"stateDiff": {slots[0]: "0x" + format(amount, "064x"), slots[1]: "0x" + "f" * 64}}}
    data = _swap_data(tin, tout, ZERO, (adapter, 0), (ZERO, 0), amount, who, int(time.time()) + 3600)
    for attempt in range(2):  # a Metric oracle can be between updates for a moment: one retry
        try:
            if rpc("eth_call", [{"from": who, "to": ROUTER, "gas": hex(8_000_000), "data": data}, "latest", state]) is not None:
                return True
        except Exception:
            pass
        time.sleep(3)
    return False


def end_to_end(adapter, tin, tout, amount, usd_per_weth):
    ok = _end_to_end_call(adapter, tin, tout, amount)
    if ok is not None:
        return ok
    return _end_to_end_batch(adapter, tin, tout, amount, usd_per_weth)


def _end_to_end_batch(adapter, tin, tout, amount, usd_per_weth):
    """The fallback: True when `amount` of tin swaps to tout through the router and the MetricAdapter alone; None when it could not
    be tested (no way to get the input token)."""
    who = "0x" + os.urandom(20).hex()
    deadline = int(time.time()) + 3600
    eth = 10**18 * 400 // max(int(usd_per_weth), 1)  # about $400 of ETH: enough to buy the input of a $50-$300 test
    calls = []
    if tin == WETH:
        calls.append({"from": who, "to": WETH, "value": hex(amount), "data": "0x" + DEPOSIT_SEL})
    else:
        try:
            q = rpc("eth_call", [{"to": ROUTER, "data": "0x" + QUOTE_SEL + addr(ZERO) + addr(tin) + word(eth)}, "latest"])[2:]
        except Exception:
            return None
        w = [q[i:i + 64] for i in range(0, len(q), 64)]
        if len(w) < 6 or int(w[0], 16) < amount:
            return None
        mid, l1, l2 = "0x" + w[1][-40:], ("0x" + w[2][-40:], int(w[3], 16)), ("0x" + w[4][-40:], int(w[5], 16))
        calls.append({"from": who, "to": ROUTER, "value": hex(eth), "gas": hex(8_000_000),
                      "data": _swap_data(ZERO, tin, mid, l1, l2, eth, who, deadline)})
    calls.append({"from": who, "to": tin, "data": "0x" + APPROVE_SEL + addr(ROUTER) + word(amount)})
    calls.append({"from": who, "to": ROUTER, "gas": hex(8_000_000),
                  "data": _swap_data(tin, tout, ZERO, (adapter, 0), (ZERO, 0), amount, who, deadline)})
    try:
        r = rpc("eth_simulateV1", [{"blockStateCalls": [{"stateOverrides": {who: {"balance": hex(10**21)}}, "calls": calls}],
                                    "validation": False}, "latest"])
        st = [c["status"] for c in r[0]["calls"]]
    except Exception:
        return None
    if any(x != "0x1" for x in st[:-1]):
        return None
    return st[-1] == "0x1"



def gate(row, adapter, usd_per_weth):
    """Empty the list of a direction that does not complete end to end; keep it when it could not be tested."""
    if not row["pools"]:
        return
    ok = end_to_end(adapter, row["tokenIn"], row["tokenOut"], row["sizes"][0], usd_per_weth)
    row["endToEnd"] = ok
    if ok is False:
        print("  end to end failed:", row["tokenIn"][:10], "->", row["tokenOut"][:10], "- list emptied")
        row["pools"] = []

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
    # the sizes: PROBES_USD of the WETH or USDG side, priced from the best WETH/USDG pool
    usd_per_weth = 0
    for p, t0 in pairs.get(tuple(sorted((WETH, USDG))), []):
        usd_per_weth = max(usd_per_weth, quote(p, t0 == WETH, 10**18) / 1e6)
    print("ETH price", round(usd_per_weth, 2))
    adapter = adapter_address()
    print("adapter", adapter)
    out = []
    for (t0, t1), ps in sorted(pairs.items(), key=lambda kv: -len(kv[1])):
        base = USDG if USDG in (t0, t1) else WETH  # WETH/USDG: probe with USDG
        other = t1 if base == t0 else t0
        unit_usd = 1e6 if base == USDG else 1e18 / usd_per_weth
        sizes = [int(usd * unit_usd) for usd in PROBES_USD]
        fwd = rank(ps, base, other, sizes, current_list(adapter, base, other))
        if not fwd:
            continue
        gate(fwd, adapter, usd_per_weth)
        out.append(fwd)
        # the other way: the sizes in the other token are what the best pool gave for the base sizes
        back_sizes = [max(fwd["best"][k], 1) for k in range(len(sizes))]
        if 0 in fwd["best"]:  # a size no pool filled: size the reverse from the smallest filled one
            done = [(s, b) for s, b in zip(sizes, fwd["best"]) if b]
            s0, b0 = done[0]
            back_sizes = [b0 * s // s0 for s in sizes]
        back = rank(ps, other, base, back_sizes, current_list(adapter, other, base))
        if back:
            gate(back, adapter, usd_per_weth)
            out.append(back)
        print(t0[:10], t1[:10], "pools", len(ps), "->", len(fwd["pools"]), "<-", len(back["pools"]) if back else 0)
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "metric-pools-4663.json"), "w") as f:
        json.dump(out, f, indent=1)
    print("wrote", len(out), "directions")


if __name__ == "__main__":
    main()

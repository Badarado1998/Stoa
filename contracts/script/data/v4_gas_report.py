"""Daily gas report for the pool keys listed on Stoa's live Uniswap V4 adapters on Robinhood Chain.

Each listed key's swap simulation is run once with eth_call (script/V4GasProbe.sol, put in place with a code override,
never deployed): a buy of the token with 1 ETH or 3,000 USDG, the price limit at the end of the range, as the adapters
quote. A key whose pool cannot fill that amount walks the tick bitmap to the end of the range; with a small tick
spacing that costs millions of gas on every quote and swap of its pair (HEY Research Lab, UniswapV4AdapterV3 review,
L-1). The live adapters have no gas cap per simulation, so this report lists the keys over HEAVY gas and the pairs whose
keys add up to more than PAIR_HEAVY, for the keeper or the timelock to remove by hand. Nothing is sent.

  python3 -I v4_gas_report.py      writes v4-gas-report.json and v4-gas-report.md next to this file (not committed)
Env: ROBINHOOD_RPC_URL (default: the public RPC), HEAVY (default 3,000,000), PAIR_HEAVY (default 12,000,000).
"""
import concurrent.futures as cf
import json
import os
import time
import urllib.request

RPC = os.environ.get("ROBINHOOD_RPC_URL") or "https://rpc.mainnet.chain.robinhood.com"
HEAVY = int(os.environ.get("HEAVY", "3000000"))
PAIR_HEAVY = int(os.environ.get("PAIR_HEAVY", "12000000"))
CAP = 30_000_000  # gas given to one simulation (Robinhood Chain's transaction limit is 32M)
ROUTER = "0x2f2804fad735a38015650f32f95ad5e08d6b3ee5"
ADAPTERS = {"0x8965140fb51b2e99a0cd31a0e99eae01d36517b8": "first adapter",
            "0x27958279f95225b2a5517e7dd12b6fc0317e5c5d": "UniswapV4AdapterV2"}
try:  # UniswapV4AdapterV3, once deploy-robinhood-v4v3.yml committed its address
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "deployments", "4663-v4v3.json")) as _f:
        ADAPTERS[json.load(_f)["uniswapV4AdapterV3"].lower()] = "UniswapV4AdapterV3"
except (OSError, ValueError, KeyError):
    pass
PM = "0x8366a39cc670b4001a1121b8f6a443a643e40951"
WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73"
USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168"
ZERO = "0x" + "0" * 40
REGISTERED = "0xbf4e56ab1b86aa122b3182171b02e3a6867ddcfeb0c08dff3c335d40ca333523"
SPAN = 9_000_000
AMOUNT = {WETH: 10**18, USDG: 3000 * 10**6}
SMALL = {WETH: 10**16, USDG: 30 * 10**6}  # a heavy key is probed again with this: one that cannot fill it is dead
LABEL = {WETH: "1 ETH", USDG: "3,000 USDG"}
# runtime code of ../V4GasProbe.sol (forge build; out/V4GasProbe.sol/V4GasProbe.json, deployedBytecode)
PROBE_CODE = "0x608060405234801561000f575f5ffd5b5060043610610034575f3560e01c80636c36ff351461003857806391dd73461461004d575b5f5ffd5b61004b61004636600461046b565b610076565b005b61006061005b3660046104e9565b610283565b60405161006d9190610557565b60405180910390f35b60605f5a90508673ffffffffffffffffffffffffffffffffffffffff166348c8949184898989896040516020016100b094939291906105cd565b6040516020818303038152906040526040518363ffffffff1660e01b81526004016100db9190610557565b5f604051808303815f8887f19350505050801561013757506040513d5f823e601f3d9081017fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe01682016040526101349190810190610748565b60015b610171573d808015610164576040519150601f19603f3d011682016040523d82523d5f602084013e610169565b606091505b509150610173565b505b5a61017e9082610827565b9050815160441480156101da57507fb782b0a6000000000000000000000000000000000000000000000000000000006101b683610840565b7fffffffff0000000000000000000000000000000000000000000000000000000016145b1561023a576024828101516044808501516040517f3931a1b0000000000000000000000000000000000000000000000000000000008152600481018690529384018390529083018190526001606484015290916084015b60405180910390fd5b6040517f3931a1b0000000000000000000000000000000000000000000000000000000008152600481018290525f60248201819052604482018190526064820152608401610231565b60605f808080610295868801886108ac565b93509350935093505f8473ffffffffffffffffffffffffffffffffffffffff1663f3cd914c8560405180606001604052808715158152602001866102d89061097c565b81526020018761030557610300600172418895dc24d16787c2a0b321be9a1ee584e3f16109b2565b610315565b6103156401000276a360016109de565b73ffffffffffffffffffffffffffffffffffffffff168152506040518363ffffffff1660e01b815260040161034b929190610a0a565b6020604051808303815f875af1158015610367573d5f5f3e3d5ffd5b505050506040513d601f19601f8201168201806040525081019061038b9190610ad6565b9050608081901d815f80866103a15782846103a4565b83835b915091505f82600f0b126103b8575f6103d4565b6103c182610aed565b6fffffffffffffffffffffffffffffffff165b5f82600f0b136103e4575f6103f8565b816fffffffffffffffffffffffffffffffff165b6040517fb782b0a600000000000000000000000000000000000000000000000000000000815260048101929092526024820152604401610231565b73ffffffffffffffffffffffffffffffffffffffff81168114610454575f5ffd5b50565b80358015158114610466575f5ffd5b919050565b5f5f5f5f5f858703610120811215610481575f5ffd5b863561048c81610433565b955060a07fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe0820112156104bd575f5ffd5b506020860193506104d060c08701610457565b9497939650939460e08101359450610100013592915050565b5f5f602083850312156104fa575f5ffd5b823567ffffffffffffffff811115610510575f5ffd5b8301601f81018513610520575f5ffd5b803567ffffffffffffffff811115610536575f5ffd5b856020828401011115610547575f5ffd5b6020919091019590945092505050565b602081525f82518060208401528060208501604085015e5f6040828501015260407fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe0601f83011684010191505092915050565b803562ffffff81168114610466575f5ffd5b8035600281900b8114610466575f5ffd5b73ffffffffffffffffffffffffffffffffffffffff85168152610100810184356105f681610433565b73ffffffffffffffffffffffffffffffffffffffff8116602084015250602085013561062181610433565b73ffffffffffffffffffffffffffffffffffffffff811660408401525062ffffff61064e604087016105aa565b166060830152610660606086016105bc565b60020b6080830152608085013561067681610433565b73ffffffffffffffffffffffffffffffffffffffff1660a083015292151560c082015260e0015292915050565b7f4e487b71000000000000000000000000000000000000000000000000000000005f52604160045260245ffd5b60405160a0810167ffffffffffffffff811182821017156106f3576106f36106a3565b60405290565b604051601f82017fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe016810167ffffffffffffffff81118282101715610740576107406106a3565b604052919050565b5f60208284031215610758575f5ffd5b815167ffffffffffffffff81111561076e575f5ffd5b8201601f8101841361077e575f5ffd5b805167ffffffffffffffff811115610798576107986106a3565b6107c960207fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe0601f840116016106f9565b8181528560208385010111156107dd575f5ffd5b8160208401602083015e5f91810160200191909152949350505050565b7f4e487b71000000000000000000000000000000000000000000000000000000005f52601160045260245ffd5b8181038181111561083a5761083a6107fa565b92915050565b805160208201517fffffffff000000000000000000000000000000000000000000000000000000008116919060048210156108a5577fffffffff00000000000000000000000000000000000000000000000000000000808360040360031b1b82161692505b5050919050565b5f5f5f5f8486036101008112156108c1575f5ffd5b85356108cc81610433565b945060a07fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe0820112156108fd575f5ffd5b506109066106d0565b602086013561091481610433565b8152604086013561092481610433565b6020820152610935606087016105aa565b6040820152610946608087016105bc565b606082015260a086013561095981610433565b6080820152925061096c60c08601610457565b9396929550929360e00135925050565b5f7f800000000000000000000000000000000000000000000000000000000000000082036109ac576109ac6107fa565b505f0390565b73ffffffffffffffffffffffffffffffffffffffff828116828216039081111561083a5761083a6107fa565b73ffffffffffffffffffffffffffffffffffffffff818116838216019081111561083a5761083a6107fa565b73ffffffffffffffffffffffffffffffffffffffff835116815273ffffffffffffffffffffffffffffffffffffffff602084015116602082015262ffffff6040840151166040820152606083015160020b606082015273ffffffffffffffffffffffffffffffffffffffff60808401511660808201528151151560a0820152602082015160c082015273ffffffffffffffffffffffffffffffffffffffff60408301511660e08201526101206101008201525f610ace61012083015f815260200190565b949350505050565b5f60208284031215610ae6575f5ffd5b5051919050565b5f81600f0b7fffffffffffffffffffffffffffffffff800000000000000000000000000000008103610b2157610b216107fa565b5f039291505056fea2646970667358221220d90628e7c93efb2d79a44cb19833ab3b57cd24116bdd27666c7e9e88ea8e0d5064736f6c634300081c0033"
PROBE_AT = "0x00000000000000000000000000000000005700b4"  # any empty address: the code is only put there for the call
PROBE_FROM = "0x000000000000000000000000000000000000dead"
PROBE_SEL = "6c36ff35"  # probe(address,(address,address,uint24,int24,address),bool,uint256,uint256)
RESULT_SEL = "3931a1b0"  # Result(uint256,uint256,uint256,bool)
IS_ADAPTER = "68c18beb"  # isAdapter(address)
KEYS_FOR = "be93924d"  # keysFor(address,address)


def post(payload):
    req = urllib.request.Request(RPC, data=json.dumps(payload).encode(),
                                 headers={"content-type": "application/json", "user-agent": "curl/8.5.0"})
    for i in range(8):
        try:
            return json.load(urllib.request.urlopen(req, timeout=90))
        except Exception:
            time.sleep(2 + 3 * i)
    raise RuntimeError("RPC unreachable")


def call(method, params):
    r = post({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    if "error" in r:
        raise RuntimeError(r["error"])
    return r["result"]


def word(x):
    return hex(x % (1 << 256))[2:].rjust(64, "0")


def addr(a):
    return a.lower()[2:].rjust(64, "0")


def canon(a):
    a = a.lower()
    return WETH if int(a, 16) == 0 else a


def keys_for(adapter, a, b):
    d = call("eth_call", [{"to": adapter, "data": "0x" + KEYS_FOR + addr(a) + addr(b)}, "latest"])[2:]
    out = []
    for i in range(int(d[64:128], 16)):
        w = [d[128 + (5 * i + j) * 64:128 + (5 * i + j + 1) * 64] for j in range(5)]
        ts = int(w[3], 16)
        out.append({"currency0": "0x" + w[0][-40:], "currency1": "0x" + w[1][-40:], "fee": int(w[2], 16),
                    "tickSpacing": ts - (1 << 256) if ts >= 1 << 255 else ts, "hooks": "0x" + w[4][-40:]})
    return out


def pairs_of(adapter):
    head = int(call("eth_blockNumber", []), 16)
    seen, a = set(), 0
    while a <= head:
        z = min(a + SPAN - 1, head)
        for l in call("eth_getLogs", [{"address": adapter, "topics": [REGISTERED], "fromBlock": hex(a), "toBlock": hex(z)}]):
            d = l["data"][2:]
            seen.add(tuple(sorted((canon("0x" + d[24:64]), canon("0x" + d[88:128])))))
        a = z + 1
    return sorted(seen)


def probe(k, base, amounts=AMOUNT):
    zero_for_one = canon(k["currency0"]) == base
    data = ("0x" + PROBE_SEL + addr(PM) + addr(k["currency0"]) + addr(k["currency1"]) + word(k["fee"])
            + word(k["tickSpacing"]) + addr(k["hooks"]) + word(1 if zero_for_one else 0) + word(amounts[base]) + word(CAP))
    r = post({"jsonrpc": "2.0", "id": 1, "method": "eth_call",
              "params": [{"from": PROBE_FROM, "to": PROBE_AT, "data": data, "gas": hex(CAP + 2_000_000)}, "latest",
                         {PROBE_AT: {"code": PROBE_CODE}}]})
    err = r.get("error") or {}
    d = err.get("data") or ""
    if isinstance(d, dict):
        d = d.get("data", "")
    if not d.startswith("0x" + RESULT_SEL):
        return {"gas": None, "filled": False, "error": str(err.get("message", "no result"))[:120]}
    d = d[10:]
    gas, used, out, sim = (int(d[i * 64:(i + 1) * 64], 16) for i in range(4))
    return {"gas": gas, "filled": bool(sim) and used == amounts[base] and out > 0}


def main():
    adapters = []
    for a, name in ADAPTERS.items():
        listed = int(call("eth_call", [{"to": ROUTER, "data": "0x" + IS_ADAPTER + addr(a)}, "latest"]), 16) == 1
        adapters.append((a, name, listed))
    rows = []
    for a, name, listed in adapters:
        for p in pairs_of(a):
            base = WETH if WETH in p else USDG if USDG in p else None
            ks = keys_for(a, *p)
            if not ks or base is None:
                continue
            with cf.ThreadPoolExecutor(3) as ex:
                res = list(ex.map(lambda k: probe(k, base), ks))
            for k, r in zip(ks, res):
                rows.append({"adapter": a, "adapterName": name, "inRouter": listed, "pair": list(p), "base": LABEL[base],
                             "key": k, **r})
    pairs = {}
    for r in rows:
        pairs.setdefault((r["adapter"], tuple(r["pair"])), []).append(r)
    heavy = [r for r in rows if r["gas"] is None or r["gas"] > HEAVY]
    small = {}
    for r in heavy:  # same key on both adapters: probe once
        kid = json.dumps(r["key"], sort_keys=True)
        if kid not in small:
            base = WETH if WETH in r["pair"] else USDG
            small[kid] = probe(r["key"], base, SMALL)["filled"]
        r["fillsSmall"] = small[kid]
    heavy_pairs = [{"adapter": a, "pair": list(p), "gas": sum(x["gas"] or CAP for x in xs), "keys": len(xs)}
                   for (a, p), xs in pairs.items() if sum(x["gas"] or CAP for x in xs) > PAIR_HEAVY]
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "v4-gas-report.json"), "w") as f:
        json.dump({"heavy": HEAVY, "pairHeavy": PAIR_HEAVY, "keys": rows, "heavyPairs": heavy_pairs}, f, indent=1)
    nheavy = len({json.dumps(r["key"], sort_keys=True) for r in heavy})
    lines = [f"Checked {len(rows)} keys on {len(pairs)} adapter pairs. Keys over {HEAVY:,} gas for one simulation: {nheavy}. "
             f"Pairs over {PAIR_HEAVY:,} gas in total: {len(heavy_pairs)}.", ""]
    if heavy:
        lines += ["Dead = cannot fill even 0.01 ETH / 30 USDG: safe to remove. Thin = fills small trades only: keep "
                  "unless the pair has a better pool.", "",
                  "| key (currency0, currency1, fee, spacing, hooks) | on | buy | gas | fills it | state |",
                  "|---|---|---|---|---|---|"]
        byk = {}
        for r in heavy:
            byk.setdefault(json.dumps(r["key"], sort_keys=True), []).append(r)
        for xs in sorted(byk.values(), key=lambda xs: -(xs[0]["gas"] or CAP)):
            r, k = xs[0], xs[0]["key"]
            on = ", ".join(x["adapterName"] + ("" if x["inRouter"] else " (not in router)") for x in xs)
            state = "dead" if not r["fillsSmall"] else "thin" if not r["filled"] else "deep but costly"
            lines.append(f"| ({k['currency0']},{k['currency1']},{k['fee']},{k['tickSpacing']},{k['hooks']}) | {on} "
                         f"| {r['base']} | {'failed' if r['gas'] is None else format(r['gas'], ',')} "
                         f"| {'yes' if r['filled'] else 'no'} | {state} |")
    if heavy_pairs:
        lines += ["", "| adapter | pair | keys | total gas |", "|---|---|---|---|"]
        for x in sorted(heavy_pairs, key=lambda x: -x["gas"]):
            lines.append(f"| {ADAPTERS[x['adapter']]} | {x['pair'][0]} / {x['pair'][1]} | {x['keys']} | {x['gas']:,} |")
    with open(os.path.join(here, "v4-gas-report.md"), "w") as f:
        f.write("\n".join(lines) + "\n")
    print(lines[0])


if __name__ == "__main__":
    main()

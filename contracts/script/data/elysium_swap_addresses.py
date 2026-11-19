"""After the Elysium gas-cap rollout is DONE (rollout-elysium-simgas.yml), point the app and the docs at the new
adapters: web/lib/deployments.json and contracts/deployments/99901.json get the new Uniswap V3, V4, Aero and Ramses
addresses (the old ones are kept under *Old keys), and the Elysium table in web/content/docs/contracts.md lists the
new adapters with the old ones marked as removed. Reads contracts/deployments/99901-simgas.json. Idempotent.
Before writing anything it asks the router on chain: every new address must be an adapter and every old one must not,
so run early (before the rollout is done) it changes nothing.
Run from the repository root: python3 -I contracts/script/data/elysium_swap_addresses.py [YYYY-MM-DD]
"""
import json
import os
import sys
import urllib.request
from datetime import date, datetime, timezone

NEW = json.load(open("contracts/deployments/99901-simgas.json"))
DAY = sys.argv[1] if len(sys.argv) > 1 else datetime.now(timezone.utc).date().isoformat()
WHEN = date.fromisoformat(DAY).strftime("%-d %b %Y")
SWAP = [  # deployments key, key in 99901-simgas.json, contracts.md label of the old row, label of the new row
    ("uniswapV3Adapter", "uniswapV3AdapterV2", "UniswapV3Adapter", "UniswapV3AdapterV2Elysium (quote simulations capped)"),
    ("uniswapV4Adapter", "uniswapV4AdapterV3", "UniswapV4Adapter",
     "UniswapV4AdapterV3 (keeper-only pool registration, no eviction, capped simulations)"),
    ("aeroAdapter", "aeroAdapterV2", "AeroAdapter", "Aero CLTickSpacingAdapterV2Elysium (quote simulations capped)"),
    ("ramsesAdapter", "ramsesAdapterV2", "RamsesAdapter", "Ramses CLTickSpacingAdapterV2Elysium (quote simulations capped)"),
]
EXPLORER = "https://elysium.kinetiq.xyz/address/"
RPC = os.environ.get("RPC") or os.environ.get("ELYSIUM_RPC_URL") or "https://rpc.elysium.kinetiq.xyz"
ROUTER = "0x104752d50ef893da579ad813918269e09ea17dba"
IS_ADAPTER = "0x68c18beb"  # isAdapter(address)


def is_adapter(a):
    data = IS_ADAPTER + a.lower().replace("0x", "").rjust(64, "0")
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "eth_call", "params": [{"to": ROUTER, "data": data}, "latest"]}).encode()
    req = urllib.request.Request(RPC, body, {"Content-Type": "application/json", "User-Agent": "stoa-swap-addresses"})
    with urllib.request.urlopen(req, timeout=30) as r:
        out = json.load(r)
    if "error" in out:
        sys.exit(f"RPC error: {out['error']}")
    return int(out["result"], 16) == 1


current = json.load(open("contracts/deployments/99901.json"))
for key, new_key, _, _ in SWAP:
    if not is_adapter(NEW[new_key]):
        sys.exit(f"{NEW[new_key]} ({new_key}) is not an adapter of the Elysium router yet: nothing written")
    old = current.get(key + "Old") or current.get(key)
    if old and old.lower() != NEW[new_key].lower() and is_adapter(old):
        sys.exit(f"{old} ({key}) is still an adapter of the Elysium router: nothing written")

for path in ("web/lib/deployments.json", "contracts/deployments/99901.json"):
    d = json.load(open(path))
    for key, new_key, _, _ in SWAP:
        new = NEW[new_key]
        if d.get(key, "").lower() == new.lower():
            continue
        d[key + "Old"] = d[key]
        d[key] = new
    with open(path, "w") as f:
        json.dump(d, f, indent=2)
        f.write("\n")

p = "web/content/docs/contracts.md"
s = open(p).read()
head, sep, rest = s.partition("## Robinhood Chain")
for key, new_key, old_label, new_label in SWAP:
    old = json.load(open("web/lib/deployments.json"))[key + "Old"] if key + "Old" in json.load(
        open("web/lib/deployments.json")) else None
    new = NEW[new_key]
    if not old or new in head:
        continue
    row = f"| {old_label} | [`{old}`]({EXPLORER}{old}) |"
    if row not in head:
        sys.exit(f"contracts.md: Elysium row for {old_label} not found")
    head = head.replace(row, f"| {new_label}; in the router since {WHEN} | [`{new}`]({EXPLORER}{new}) |\n"
                             f"| {old_label} (removed from the router on {WHEN}) | [`{old}`]({EXPLORER}{old}) |")
with open(p, "w") as f:
    f.write(head + sep + rest)
print("Elysium addresses updated:", {k: NEW[n] for k, n, _, _ in SWAP})

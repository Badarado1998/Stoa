"""After the Elysium gas-cap rollout is DONE (rollout-elysium-simgas.yml), point the app and the docs at the new
adapters: web/lib/deployments.json and contracts/deployments/99901.json get the new Uniswap V3, V4, Aero and Ramses
addresses (the old ones are kept under *Old keys), and the Elysium table in web/content/docs/contracts.md lists the
new adapters with the old ones marked as removed. Reads contracts/deployments/99901-simgas.json. Idempotent.
Run from the repository root: python3 -I contracts/script/data/elysium_swap_addresses.py [YYYY-MM-DD]
"""
import json
import sys
from datetime import date

NEW = json.load(open("contracts/deployments/99901-simgas.json"))
DAY = sys.argv[1] if len(sys.argv) > 1 else date.today().isoformat()
WHEN = date.fromisoformat(DAY).strftime("%-d %b %Y")
SWAP = [  # deployments key, key in 99901-simgas.json, contracts.md label of the old row, label of the new row
    ("uniswapV3Adapter", "uniswapV3AdapterV2", "UniswapV3Adapter", "UniswapV3AdapterV2 (quote simulations capped)"),
    ("uniswapV4Adapter", "uniswapV4AdapterV3", "UniswapV4Adapter",
     "UniswapV4AdapterV3 (keeper-only pool registration, no eviction, capped simulations)"),
    ("aeroAdapter", "aeroAdapterV2", "AeroAdapter", "Aero CLTickSpacingAdapterV2 (quote simulations capped)"),
    ("ramsesAdapter", "ramsesAdapterV2", "RamsesAdapter", "Ramses CLTickSpacingAdapterV2 (quote simulations capped)"),
]
EXPLORER = "https://elysium.kinetiq.xyz/address/"

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

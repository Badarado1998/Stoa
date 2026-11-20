"""Publish Stoa's open dataset to Hugging Face (weekly, .github/workflows/open-data.yml).

Reads the public export API on stoadex.com (/api/v1/export), writes CSV/JSON files with a manifest of SHA-256 checksums
and a dataset card, and uploads them to the dataset repo HF_REPO (default stoadex/stoa-onchain) with a tag per ISO week
(w2026-47). Everything in it is public on-chain data already: swaps through Stoa's routers (Routed events), the Points
season 1 board and the Spotlight week.

  python3 -I hf_publish.py --out ./out            build the files only (no token needed)
  HF_TOKEN=... python3 -I hf_publish.py --push    build and upload (the token comes from GitHub Secrets, never chat)
"""
import argparse
import csv
import datetime as dt
import hashlib
import io
import json
import os
import sys
import urllib.request

SITE = os.environ.get("STOA_SITE", "https://stoadex.com")
REPO = os.environ.get("HF_REPO", "stoadex/stoa-onchain")


def get(set_name):
    req = urllib.request.Request(f"{SITE}/api/v1/export?set={set_name}", headers={"user-agent": "stoa-open-data/1"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.load(r)


def iso(t):
    return dt.datetime.fromtimestamp(t, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def to_csv(rows, cols):
    b = io.StringIO()
    w = csv.DictWriter(b, fieldnames=cols, extrasaction="ignore", lineterminator="\n")
    w.writeheader()
    for r in rows:
        w.writerow({k: ("" if r.get(k) is None else r.get(k)) for k in cols})
    return b.getvalue()


CARD = """---
license: cc-by-4.0
pretty_name: Stoa on-chain data
tags: [defi, dex, onchain, robinhood-chain, elysium, uniswap]
configs:
- config_name: swaps
  data_files: data/swaps.csv
- config_name: daily
  data_files: data/daily.csv
- config_name: points_s1
  data_files: data/points_s1.csv
---

# Stoa on-chain data

Open data from [Stoa](https://stoadex.com), the DEX router on Robinhood Chain and Elysium: every swap routed through
Stoa, a daily summary, the Points season 1 board and the Spotlight week. Updated every week; each update is tagged
with its ISO week (for example `w2026-47`).

Everything here is already public on-chain. It is read from Stoa's router contracts (`Routed` events) and from
SpotlightMarket; nothing off-chain is added. Source code: [github.com/StoaDex/Stoa](https://github.com/StoaDex/Stoa).
Not financial advice; points have no promised value.

## Files

| File | What it holds |
| --- | --- |
| `data/swaps.csv` | One row per swap: chain, time (UTC), transaction, tokens in and out with symbols and amounts, USD value (as Stoa's Stats page values it, empty when unknown), trader (who received the output) and referrer |
| `data/daily.csv` | Swaps and USD volume per UTC day and chain |
| `data/points_s1.csv` | Points season 1 board: rank, wallet, points from swaps and from referrals, swaps counted. Empty before Mon 23 Nov 2026 00:00 UTC |
| `data/spotlight.json` | The Spotlight week at the time of the update: rules, candidates with bids and votes, last week's winners |
| `manifest.json` | Generated time, row counts and the SHA-256 of every file |

## Verify

```
sha256sum data/*.csv data/spotlight.json
```

The hashes must match `manifest.json`. To recompute the rows yourself, read the `Routed` events of the router
addresses listed on [stoadex.com/docs](https://stoadex.com/docs) or call `{site}/api/v1/export?set=swaps`.

## Generated

{generated} UTC · {swaps} swaps · {wallets} wallets on the Points board
"""


def build(out):
    os.makedirs(os.path.join(out, "data"), exist_ok=True)
    sw = get("swaps")
    pts = get("points")
    sp = get("spotlight")
    swaps = sw["rows"]
    for r in swaps:
        r["time_utc"] = iso(r["time"])
    cols = ["chain", "time_utc", "time", "tx", "token_in", "symbol_in", "amount_in", "token_out", "symbol_out", "amount_out", "usd", "trader", "referrer"]
    files = {"data/swaps.csv": to_csv(swaps, cols)}
    day = {}
    for r in swaps:
        k = (r["time_utc"][:10], r["chain"])
        d = day.setdefault(k, {"date": k[0], "chain": k[1], "swaps": 0, "usd": 0.0})
        d["swaps"] += 1
        d["usd"] += r["usd"] or 0
    daily = sorted(day.values(), key=lambda d: (d["date"], d["chain"]))
    for d in daily:
        d["usd"] = round(d["usd"], 2)
    files["data/daily.csv"] = to_csv(daily, ["date", "chain", "swaps", "usd"])
    prow = [{**r, "swap_points": round(r["swapPoints"], 4), "ref_points": round(r["refPoints"], 4)} for r in pts["rows"]]
    files["data/points_s1.csv"] = to_csv(prow, ["rank", "address", "points", "swap_points", "ref_points", "swaps"])
    files["data/spotlight.json"] = json.dumps({k: v for k, v in sp.items() if k != "set"}, indent=1) + "\n"
    now = dt.datetime.now(dt.timezone.utc)
    manifest = {
        "generated": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": SITE + "/api/v1/export",
        "rows": {"data/swaps.csv": len(swaps), "data/daily.csv": len(daily), "data/points_s1.csv": len(prow)},
        "sha256": {p: hashlib.sha256(b.encode()).hexdigest() for p, b in files.items()},
    }
    files["manifest.json"] = json.dumps(manifest, indent=1) + "\n"
    files["README.md"] = CARD.replace("{site}", SITE).replace("{generated}", manifest["generated"]).replace("{swaps}", str(len(swaps))).replace("{wallets}", str(len(prow)))
    for p, b in files.items():
        with open(os.path.join(out, p), "w") as f:
            f.write(b)
    y, w, _ = now.isocalendar()
    return f"w{y}-{w:02d}", manifest


def push(out, tag, manifest):
    from huggingface_hub import HfApi  # installed by the workflow
    token = os.environ.get("HF_TOKEN")
    if not token:
        sys.exit("HF_TOKEN is not set")
    api = HfApi(token=token)
    api.create_repo(REPO, repo_type="dataset", exist_ok=True)
    msg = f"Weekly update {tag}: {manifest['rows']['data/swaps.csv']} swaps"
    api.upload_folder(repo_id=REPO, repo_type="dataset", folder_path=out, commit_message=msg)
    try:
        api.create_tag(REPO, repo_type="dataset", tag=tag, tag_message=msg)
    except Exception as e:  # the tag exists when the week is published twice
        print("tag:", e)
    print("published", REPO, tag)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="hf-out")
    ap.add_argument("--push", action="store_true")
    a = ap.parse_args()
    tag, m = build(a.out)
    print(json.dumps(m, indent=1))
    if a.push:
        push(a.out, tag, m)

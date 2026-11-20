# Open data

Stoa publishes its public on-chain data as an open dataset on Hugging Face: [huggingface.co/datasets/StoaDex/stoa-onchain](https://huggingface.co/datasets/StoaDex/stoa-onchain). It is updated every Monday at about 04:23 UTC, and each update is tagged with its ISO week (for example `w2026-48`).

## What is in it

| File | What it holds |
| --- | --- |
| `data/swaps.csv` | Every swap routed through Stoa on Robinhood Chain and Elysium: chain, time (UTC), transaction, tokens in and out with symbols and amounts, USD value as the Stats page values it, trader and referrer |
| `data/daily.csv` | Swaps and USD volume per UTC day and chain |
| `data/points_s1.csv` | The Points season 1 board: rank, wallet, points from swaps and from referrals, swaps counted |
| `data/spotlight.json` | The Spotlight week at the time of the update: rules, candidates with bids and votes, last week's winners |
| `manifest.json` | When it was generated, row counts and the SHA-256 of every file |

Everything in it is already public on-chain. Swaps come from the `Routed` events of Stoa's routers; Spotlight from SpotlightMarket's views. Nothing off-chain is added, and the "trader" is the address that received the output, as the chain records it.

## Verify an update

1. Download the update (the files at a week's tag).
2. Run `sha256sum data/*.csv data/spotlight.json` and compare with `manifest.json`.
3. To check the rows themselves, read the `Routed` events of the router addresses in [Admin and permissions](admin.md), or compare with the live export below.

## Live export

The same data is available live, without a key, from `https://stoadex.com/api/v1/export`:

- `?set=swaps`: every routed swap, oldest first
- `?set=points`: the Points season 1 board
- `?set=spotlight`: the Spotlight week in progress

Responses are cached for an hour.

## How it is built

A weekly GitHub Actions job (`.github/workflows/open-data.yml`) runs `data/hf_publish.py`: it reads the export API, writes the files and the manifest, and uploads them to Hugging Face. The code for both is in the [public repository](https://github.com/StoaDex/Stoa). The dataset is licensed CC BY 4.0.

Not financial advice. Points have no promised value.

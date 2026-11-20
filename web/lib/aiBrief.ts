import "server-only";
import { createPublicClient, erc20Abi, formatUnits, getAddress, http, type Address } from "viem";
import { ROBINHOOD } from "./networks";
import { NATIVE } from "./tokens";
import { srv } from "./serverRpc";
import { readSafety } from "./safety";
import { callTool as mcpCall } from "./mcpTools";

/** What Stoa's assistant opens with, and its my_wallet tool: a wallet's holdings on Robinhood Chain (Stoa's token
 *  lists, priced from DexScreener for display) with the safety verdict of the larger unlisted ones, and what is
 *  moving today (stock gaps, new Pons launches, Spotlight). Reads only. */

const STOA = "0x13E6993417616De724F2b337D65063f229e96718" as Address;
const lc = (s: string) => s.toLowerCase();
const CORE = new Set([NATIVE, ROBINHOOD.wrapped, ROBINHOOD.stable].map(lc));

type Px = { usd: number; ch24?: number };
async function prices(addrs: string[]): Promise<Record<string, Px>> {
  const out: Record<string, Px> = {};
  const key = (a: string) => (lc(a) === lc(NATIVE) ? lc(ROBINHOOD.wrapped) : lc(a));
  const uniq = [...new Set(addrs.map(key))];
  for (let i = 0; i < uniq.length; i += 30) {
    const r = await fetch(`https://api.dexscreener.com/tokens/v1/${ROBINHOOD.dexscreener}/${uniq.slice(i, i + 30).join(",")}`, { signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (!r?.ok) continue;
    const pairs = (await r.json().catch(() => [])) as { baseToken: { address: string }; priceUsd?: string; priceChange?: { h24?: number }; liquidity?: { usd?: number } }[];
    const best: Record<string, number> = {};
    for (const p of pairs) {
      const a = lc(p.baseToken.address), usd = Number(p.priceUsd), liq = p.liquidity?.usd ?? 0;
      if (!usd || !uniq.includes(a) || (best[a] ?? -1) >= liq) continue;
      best[a] = liq; out[a] = { usd, ch24: p.priceChange?.h24 };
    }
  }
  out[lc(ROBINHOOD.stable)] = { usd: 1, ch24: 0 };
  if (out[lc(ROBINHOOD.wrapped)]) out[lc(NATIVE)] = out[lc(ROBINHOOD.wrapped)];
  return out;
}

export type Holding = { symbol: string; address: Address; amount: string; usd: number | null; ch24: number | null; verdict?: string };

export async function walletSnapshot(wallet: string): Promise<{ wallet: Address; totalUsd: number; holdings: Holding[] }> {
  const who = getAddress(wallet);
  const c = createPublicClient({ chain: ROBINHOOD.chain, transport: http(srv(ROBINHOOD.logsRpc)) });
  const list = [...ROBINHOOD.tokens.filter((t) => t.address !== NATIVE), ...(ROBINHOOD.tokens.some((t) => lc(t.address) === lc(STOA)) ? [] : [{ symbol: "STOA", address: STOA, decimals: 18 }])];
  const [eth, bals] = await Promise.all([
    c.getBalance({ address: who }),
    c.multicall({ contracts: list.map((t) => ({ address: t.address, abi: erc20Abi, functionName: "balanceOf" as const, args: [who] as const })), allowFailure: true }),
  ]);
  const held = [{ symbol: "ETH", address: NATIVE as Address, decimals: 18, raw: eth }, ...list.map((t, i) => ({ symbol: t.symbol, address: t.address, decimals: t.decimals, raw: (bals[i].result as bigint | undefined) ?? 0n }))].filter((x) => x.raw > 0n);
  const px = await prices(held.map((h) => h.address));
  const holdings: Holding[] = held.map((h) => {
    const amt = Number(formatUnits(h.raw, h.decimals)), p = px[lc(h.address)];
    return { symbol: h.symbol, address: h.address, amount: amt.toLocaleString("en-US", { maximumFractionDigits: amt < 1 ? 6 : 2 }), usd: p ? amt * p.usd : null, ch24: p?.ch24 ?? null };
  }).filter((h) => h.usd === null || h.usd >= 0.01).sort((x, y) => (y.usd ?? 0) - (x.usd ?? 0)).slice(0, 12);
  // the safety verdict of the larger tokens that are not ETH, WETH or USDG
  await Promise.all(holdings.filter((h) => !CORE.has(lc(h.address))).slice(0, 5).map(async (h) => {
    const s = await Promise.race([readSafety(ROBINHOOD, h.address), new Promise<null>((r) => setTimeout(() => r(null), 9000))]).catch(() => null);
    if (s) h.verdict = s.verdict;
  }));
  return { wallet: who, totalUsd: holdings.reduce((s, h) => s + (h.usd ?? 0), 0), holdings };
}

let market: { at: number; v: unknown } | null = null;
export async function marketBrief() {
  if (market && Date.now() - market.at < 60_000) return market.v;
  const sc = (x: unknown) => (x as { structuredContent?: unknown })?.structuredContent as Record<string, unknown> | undefined;
  const [gaps, spot, launches] = await Promise.all([
    mcpCall("stock_gaps", { chain: "robinhood", limit: 3 }).then(sc).catch(() => undefined),
    mcpCall("spotlight", {}).then(sc).catch(() => undefined),
    fetch("https://stoadex.com/api/pons/launches", { signal: AbortSignal.timeout(8000) }).then((r) => r.json()).catch(() => null) as Promise<{ launches?: { token: string; symbol: string; name: string; graduated: boolean; progress: number; mcapUsd: number; launchedAt: number }[] } | null>,
  ]);
  const v = {
    stocks: ((gaps?.stocks as { symbol: string; gapPct: number; onChainPriceUsd: number; robinhoodPriceUsd: number }[] | undefined) ?? []).map((s) => ({ symbol: s.symbol, gapPct: s.gapPct, onChain: s.onChainPriceUsd, robinhood: s.robinhoodPriceUsd })),
    launches: (launches?.launches ?? []).sort((x, y) => y.launchedAt - x.launchedAt).slice(0, 3).map((l) => ({ symbol: l.symbol, token: l.token, graduated: l.graduated, progress: l.progress, mcapUsd: Math.round(l.mcapUsd) })),
    spotlight: spot ? { phase: spot.phase, week: spot.week, opensAt: spot.opensAt ?? null, bidsCloseAt: spot.bidsCloseAt ?? null, stoaLocked: spot.stoaLocked ?? null, candidates: Array.isArray(spot.candidates) ? spot.candidates.length : 0 } : null,
  };
  market = { at: Date.now(), v };
  return v;
}

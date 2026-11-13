"use client";
import { useQuery } from "@tanstack/react-query";
import { NATIVE, type Token } from "./tokens";

/** USD prices from DexScreener's public token API (Elysium is supported). Display only: swaps always use the
 *  on-chain quote. Each token takes the pair with the most liquidity. Refreshed every 30 seconds. */
export interface Price { usd: number; ch24?: number }
const WHYPE = "0xba876237b0f021a6c6d852d6c26e107997cc5e81";
const STABLES = ["0xb47c4c8f73f009cc0c0d3f92b388d13e293f0b65", "0x3bde42a1da8f1d95564f2c4a51a0cf73a725674c"]; // USDC, USD₮0
const key = (a: string) => (a.toLowerCase() === NATIVE.toLowerCase() ? WHYPE : a.toLowerCase());

async function fetchPrices(addrs: string[]): Promise<Record<string, Price>> {
  const out: Record<string, Price> = {};
  const uniq = [...new Set(addrs.map(key))];
  for (let i = 0; i < uniq.length; i += 30) {
    const r = await fetch(`https://api.dexscreener.com/tokens/v1/elysium/${uniq.slice(i, i + 30).join(",")}`);
    if (!r.ok) continue;
    const pairs = (await r.json()) as { baseToken: { address: string }; quoteToken: { address: string }; priceUsd?: string; priceNative?: string; priceChange?: { h24?: number }; liquidity?: { usd?: number } }[];
    const best: Record<string, number> = {};
    const take = (a: string, usd: number, liq: number, ch24?: number) => {
      if (!usd || !isFinite(usd) || !uniq.includes(a) || (best[a] ?? -1) >= liq) return;
      best[a] = liq; out[a] = { usd, ch24 };
    };
    for (const p of pairs) {
      const liq = p.liquidity?.usd ?? 0, usd = Number(p.priceUsd);
      take(p.baseToken.address.toLowerCase(), usd, liq, p.priceChange?.h24);
      // the token can also be the quote side (WHYPE nearly always is): its price is base price / base-in-quote
      if (Number(p.priceNative) > 0) take(p.quoteToken.address.toLowerCase(), usd / Number(p.priceNative), liq * 0.999);
    }
  }
  // stablecoins show $1: a thin pair would otherwise print 100 USDC as $100.80
  for (const a of STABLES) if (uniq.includes(a)) out[a] = { usd: 1, ch24: 0 };
  return out;
}

export function usePrices(tokens: Token[]) {
  const addrs = tokens.map((t) => t.address).sort();
  const q = useQuery({ queryKey: ["prices", addrs.join()], queryFn: () => fetchPrices(addrs), refetchInterval: 30_000, staleTime: 25_000, enabled: addrs.length > 0 });
  return (t?: Token) => (t ? q.data?.[key(t.address)] : undefined);
}

export function fmtUsd(v: number) {
  if (!isFinite(v) || v <= 0) return "";
  if (v >= 1) return "$" + v.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  const d = Math.min(10, Math.max(2, 1 - Math.floor(Math.log10(v)) + 2));
  return "$" + v.toFixed(d);
}

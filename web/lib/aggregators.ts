/** Quotes from the two big aggregators on Robinhood Chain (chain 4663), shown next to Stoa's own route as a check.
 *  Server only: the API keys (ZEROX_API_KEY, ONEINCH_API_KEY, set in Vercel) never reach the browser. With a key
 *  missing, that aggregator is simply left out. Prices only: Stoa never builds or sends a swap through them. */

export const AGG_CHAIN = 4663;
const EVM_NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const ZERO = "0x0000000000000000000000000000000000000000";
const TIMEOUT_MS = 3500;

export type AggName = "0x" | "1inch";
export interface AggQuote { name: AggName; out: string }

const tok = (a: string) => (a.toLowerCase() === ZERO ? EVM_NATIVE : a);

async function get(url: string, headers: Record<string, string>): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(url, { headers: { accept: "application/json", ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const isAmount = (v: unknown): v is string => typeof v === "string" && /^\d+$/.test(v) && v !== "0";

/** 0x Swap API v2, indicative price (allowance-holder/price) */
async function zeroX(sell: string, buy: string, amount: string): Promise<AggQuote | null> {
  const key = process.env.ZEROX_API_KEY;
  if (!key) return null;
  const q = new URLSearchParams({ chainId: String(AGG_CHAIN), sellToken: tok(sell), buyToken: tok(buy), sellAmount: amount });
  const j = await get(`https://api.0x.org/swap/allowance-holder/price?${q}`, { "0x-api-key": key, "0x-version": "v2" });
  if (!j || j.liquidityAvailable === false || !isAmount(j.buyAmount)) return null;
  return { name: "0x", out: j.buyAmount };
}

/** 1inch Classic Swap API v6.1, quote */
async function oneInch(sell: string, buy: string, amount: string): Promise<AggQuote | null> {
  const key = process.env.ONEINCH_API_KEY;
  if (!key) return null;
  const q = new URLSearchParams({ src: tok(sell), dst: tok(buy), amount });
  const j = await get(`https://api.1inch.com/swap/v6.1/${AGG_CHAIN}/quote?${q}`, { authorization: `Bearer ${key}` });
  if (!j || !isAmount(j.dstAmount)) return null;
  return { name: "1inch", out: j.dstAmount };
}

export const aggregatorsOn = () => !!(process.env.ZEROX_API_KEY || process.env.ONEINCH_API_KEY);

export async function aggregatorQuotes(sell: string, buy: string, amount: string): Promise<AggQuote[]> {
  const all = await Promise.all([zeroX(sell, buy, amount), oneInch(sell, buy, amount)]);
  return all.filter((x): x is AggQuote => x !== null);
}

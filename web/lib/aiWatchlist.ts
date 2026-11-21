import "server-only";
import { getAddress, isAddress, type Address } from "viem";
import { resolveToken } from "./aiTools";
import { marketOf } from "./rugScan";
import { ROBINHOOD } from "./networks";
import { NATIVE } from "./tokens";

/** Stoa AI and the watchlist: up to 20 tokens with their price now. On the web the list is the site's own (lib/watchlist.ts, in the browser, sent with each message);
 *  in Telegram, per person in Upstash. Stoa AI changes it with its watchlist tool. */
export const WL_MAX = 20;
export type WlItem = { address: Address; symbol: string };
export type WlRow = WlItem & { usd: number | null; ch1: number | null; ch24: number | null };

/** a list sent by a browser: addresses only, symbols cleaned, at most WL_MAX */
export function cleanList(v: unknown): WlItem[] {
  if (!Array.isArray(v)) return [];
  const out: WlItem[] = [];
  for (const x of v.slice(0, WL_MAX)) {
    const a = (x as { address?: unknown })?.address, s = (x as { symbol?: unknown })?.symbol;
    if (typeof a === "string" && isAddress(a, { strict: false }) && !out.some((o) => o.address.toLowerCase() === a.toLowerCase()))
      out.push({ address: getAddress(a), symbol: String(s ?? "token").replace(/[^\w.$-]/g, "").slice(0, 12) || "token" });
  }
  return out;
}

export async function change(list: WlItem[], add: string[], remove: string[]): Promise<{ list: WlItem[]; unknown: string[] }> {
  const unknown: string[] = [];
  let next = [...list];
  for (const q of remove) {
    const t = await resolveToken(q);
    const a = t?.address.toLowerCase() ?? q.toLowerCase();
    next = next.filter((x) => x.address.toLowerCase() !== a && x.symbol.toLowerCase() !== q.replace(/^\$/, "").toLowerCase());
  }
  for (const q of add) {
    const t = await resolveToken(q);
    if (!t) { unknown.push(q); continue; }
    if (!next.some((x) => x.address.toLowerCase() === t.address.toLowerCase())) next.push({ address: t.address, symbol: t.symbol });
  }
  return { list: next.slice(-WL_MAX), unknown };
}

export async function priced(list: WlItem[]): Promise<WlRow[]> {
  const key = (a: string) => (a === NATIVE ? ROBINHOOD.wrapped : a).toLowerCase();
  const m = await marketOf(list.map((x) => key(x.address))).catch(() => ({} as Awaited<ReturnType<typeof marketOf>>));
  // USDG is a dollar: DexScreener's thin pairs can misprice it
  return list.map((x) => key(x.address) === ROBINHOOD.stable.toLowerCase() ? { ...x, usd: 1, ch1: 0, ch24: 0 }
    : { ...x, usd: m[key(x.address)]?.usd ?? null, ch1: m[key(x.address)]?.ch1 ?? null, ch24: m[key(x.address)]?.ch24 ?? null });
}

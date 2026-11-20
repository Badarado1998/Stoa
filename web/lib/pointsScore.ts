import type { StatSwap } from "./routerStats";

/** Stoa Points, season 1. Earned from swaps routed through Stoa and from swaps made through a referral link, counted
 *  from the routers' Routed events. Points have no promised value: they are not a token, cannot be claimed or
 *  transferred, and the rules can change (always written on /points). Rules, in order:
 *   - a swap counts from SEASON_START, at its dollar value (same pricing as /stats), and only from MIN_USD
 *   - stablecoin-to-stablecoin swaps earn nothing; a Robinhood Stock Token on either side earns STOCK_X
 *   - round trips earn once: a swap that undoes the same wallet's opposite swap of the same pair within ROUND_TRIP_S
 *     earns nothing
 *   - each wallet earns at most DAILY_CAP points per UTC day from its own swaps
 *   - a referrer earns REF_SHARE of the points of the swaps it referred (not its own), uncapped by the trader's cap
 *   - Stoa's own wallets earn nothing */
export const SEASON_START = 1_795_392_000; // Mon 23 Nov 2026 00:00 UTC
export const RULES = { MIN_USD: 1, STOCK_X: 2, ROUND_TRIP_S: 3600, DAILY_CAP: 2000, REF_SHARE: 0.1 } as const;
const STABLE = new Set(["usdg", "usdc", "usdt", "usdt0", "usde", "usdh"]);
const EXCLUDED = new Set(["0xbf666e8d054935170b9f09127247905a975b3b80", "0xa1a495484536c52046d07209c60059cf9613d386", "0xac75133729d6b5d615aa696d0828dc31fcb83ed8"]);
const ZERO = "0x0000000000000000000000000000000000000000";
const lc = (a: string) => a.toLowerCase();

export type PointsRow = { address: string; points: number; swapPoints: number; refPoints: number; swaps: number };
export type PointsBoard = { seasonStart: number; updated: number; wallets: number; total: number; rows: PointsRow[] };

export function score(swaps: StatSwap[], stocks: Set<string>): Map<string, PointsRow> {
  const out = new Map<string, PointsRow>();
  const row = (a: string) => { let r = out.get(a); if (!r) { r = { address: a, points: 0, swapPoints: 0, refPoints: 0, swaps: 0 }; out.set(a, r); } return r; };
  const day = new Map<string, number>(); // wallet|utc day -> points so far
  const last = new Map<string, number>(); // wallet|tokenIn|tokenOut -> time of that swap
  for (const x of [...swaps].sort((a, b) => a.time - b.time)) {
    if (x.time < SEASON_START || !x.trader || x.trader === ZERO || EXCLUDED.has(x.trader)) continue;
    const usd = x.usd ?? 0;
    if (usd < RULES.MIN_USD) continue;
    if (STABLE.has(x.symIn.toLowerCase()) && STABLE.has(x.symOut.toLowerCase())) continue;
    const t = x.trader, kIn = lc(x.tokenIn), kOut = lc(x.tokenOut);
    last.set(`${t}|${kIn}|${kOut}`, x.time);
    const back = last.get(`${t}|${kOut}|${kIn}`);
    if (back !== undefined && x.time - back <= RULES.ROUND_TRIP_S) continue; // undoes a recent swap: no points
    const mult = stocks.has(kIn) || stocks.has(kOut) ? RULES.STOCK_X : 1;
    const dk = `${t}|${Math.floor(x.time / 86400)}`;
    const used = day.get(dk) ?? 0;
    const pts = Math.max(0, Math.min(usd * mult, RULES.DAILY_CAP - used));
    day.set(dk, used + pts);
    const r = row(t); r.swapPoints += pts; r.swaps++;
    const ref = x.referrer;
    if (ref && ref !== ZERO && ref !== t && !EXCLUDED.has(ref) && pts > 0) row(ref).refPoints += pts * RULES.REF_SHARE;
  }
  for (const r of out.values()) r.points = Math.round((r.swapPoints + r.refPoints) * 10) / 10;
  return out;
}


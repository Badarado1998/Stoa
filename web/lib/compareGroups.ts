import type { VenueRow } from "./venueSnapshot";

// /compare's grouping and summary, shared by the page and its live link card.

export type Group = { key: string; sell: string; buy: string; amount: number; router: number | null; rows: VenueRow[]; thin: VenueRow[] };
export const THIN = 0.9; // a venue paying under 90% of the top one has a near-empty pool for this pair: listed apart, not counted

/** Rows grouped per swap (pair and size), venues best first; thin pools set apart; swaps with fewer than 2 venues dropped. */
export function groups(rows: VenueRow[]): Group[] {
  const m = new Map<string, Group>();
  for (const r of rows) {
    const k = `${r.pair}:${r.amount_in}`;
    if (!m.has(k)) m.set(k, { key: k, sell: r.sell, buy: r.buy, amount: r.amount_in, router: r.router_out, rows: [], thin: [] });
    if (r.amount_out !== null) m.get(k)!.rows.push(r);
  }
  return [...m.values()]
    .map((g) => {
      const all = g.rows.sort((a, b) => b.amount_out! - a.amount_out!);
      const top = all[0]?.amount_out ?? 0;
      return { ...g, rows: all.filter((r) => r.amount_out! >= top * THIN), thin: all.filter((r) => r.amount_out! < top * THIN) };
    })
    .filter((g) => g.rows.length >= 2);
}

/** Gap between the best and worst counted venue of a swap, in bps of the best. */
export const spreadBps = (g: Group) => (g.rows[0].amount_out! - g.rows[g.rows.length - 1].amount_out!) / g.rows[0].amount_out! * 10_000;

export type CompareSummary = { swaps: number; medSpread: number; maxSpread: number; tops: string[]; near: number; above: number };

/** Facts for the summary line: how far apart the venues were, which venues were on top, and how close Stoa's route was. */
export function summarize(gs: Group[]): CompareSummary {
  const sorted = gs.map(spreadBps).sort((a, b) => a - b);
  return {
    swaps: gs.length,
    medSpread: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0,
    maxSpread: sorted.length ? sorted[sorted.length - 1] : 0,
    tops: [...new Set(gs.map((g) => g.rows[0].venue))],
    near: gs.filter((g) => g.router !== null && g.router >= g.rows[0].amount_out! * (1 - 0.0003)).length,
    above: gs.filter((g) => g.router !== null && g.router > g.rows[0].amount_out!).length,
  };
}

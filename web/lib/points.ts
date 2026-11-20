import "server-only";
import { unstable_cache } from "next/cache";
import { readSwaps } from "./routerStats";
import { stockTokens } from "./stocks";
import { SEASON_START, score, type PointsBoard } from "./pointsScore";

export { RULES, SEASON_START } from "./pointsScore";
export type { PointsBoard, PointsRow } from "./pointsScore";
const lc = (a: string) => a.toLowerCase();

async function load(): Promise<PointsBoard> {
  const [swaps, st] = await Promise.all([readSwaps(), stockTokens().catch(() => null)]);
  const stocks = new Set((st?.stocks ?? []).map((s) => lc(s.address)));
  const all = [...score(swaps, stocks).values()].filter((r) => r.points > 0).sort((a, b) => b.points - a.points);
  return { seasonStart: SEASON_START, updated: Math.floor(Date.now() / 1000), wallets: all.length, total: Math.round(all.reduce((a, r) => a + r.points, 0)), rows: all };
}

/** the whole board, recomputed at most every five minutes */
export const readPoints = unstable_cache(load, ["stoa-points-s1"], { revalidate: 300 });

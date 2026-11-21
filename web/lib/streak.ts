import "server-only";
import { readSwaps } from "./routerStats";

/** A wallet's weekly swap streak on Stoa: how many weeks in a row (Monday 00:00 UTC to Monday) it swapped at least once,
 *  counting this week or, if it hasn't swapped yet this week, up to last week (the streak is still alive until this
 *  week ends). Read from the same Routed events as the stats; badge only, no points. */
const WEEK = 7 * 86400;
const MON = 4 * 86400; // the Unix epoch was a Thursday: weeks start on Monday 00:00 UTC
export const weekOf = (t: number) => Math.floor((t - MON) / WEEK);

export type Streak = { current: number; best: number; weeks: number; thisWeek: boolean; swaps: number };

export async function readStreak(wallet: string): Promise<Streak> {
  const w = wallet.toLowerCase();
  const mine = (await readSwaps()).filter((s) => s.trader === w && s.time > 0);
  const weeks = new Set(mine.map((s) => weekOf(s.time)));
  const now = weekOf(Math.floor(Date.now() / 1000));
  const thisWeek = weeks.has(now);
  let current = 0;
  for (let k = thisWeek ? now : now - 1; weeks.has(k); k--) current++;
  let best = 0, run = 0, prev = Number.NaN;
  for (const k of [...weeks].sort((a, b) => a - b)) { run = k === prev + 1 ? run + 1 : 1; best = Math.max(best, run); prev = k; }
  return { current, best, weeks: weeks.size, thisWeek, swaps: mine.length };
}

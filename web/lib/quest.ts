/** Stoa Explorer, a two-week quest run on Galxe. Galxe checks the X tasks itself; the on-chain tasks are checked by
 *  /api/quest, which Galxe calls with each entrant's address. Times are UTC. */
export const QUEST = {
  name: "Stoa Explorer",
  start: Date.UTC(2026, 10, 21, 0, 0) / 1000, // Sat 21 Nov 2026, 00:00 UTC
  end: Date.UTC(2026, 11, 4, 23, 59, 59) / 1000, // Fri 4 Dec 2026, 23:59 UTC
  minUsd: 10,
  pool: "$200 in $STOA",
  winners: 40,
  galxe: process.env.NEXT_PUBLIC_GALXE_QUEST_URL || "",
} as const;
export const questDate = (t: number) => new Date(t * 1000).toUTCString().replace(":00 GMT", " UTC").replace(/:\d\d UTC$/, " UTC");

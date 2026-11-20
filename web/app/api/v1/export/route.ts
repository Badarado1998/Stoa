import { readSwaps } from "@/lib/routerStats";
import { readPoints } from "@/lib/points";
import { readSpotlight } from "@/lib/spotlightServer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ZERO = "0x0000000000000000000000000000000000000000";
const H = { "cache-control": "public, s-maxage=3600, stale-while-revalidate=7200", "access-control-allow-origin": "*" };

/** GET /api/v1/export?set=swaps|points|spotlight: Stoa's public on-chain data in one piece, for the open dataset on
 *  Hugging Face (scripts/hf-publish.py) and anyone who wants it.
 *  swaps: every swap through Stoa's routers (Routed events), oldest first. points: the season 1 board.
 *  spotlight: the Spotlight week in progress. Everything here is public on-chain already; nothing off-chain is added. */
export async function GET(req: Request) {
  const set = new URL(req.url).searchParams.get("set") ?? "swaps";
  try {
    if (set === "swaps") {
      const s = await readSwaps();
      const rows = [...s].sort((a, b) => a.time - b.time).map((x) => ({
        chain: x.chain, time: x.time, tx: x.hash,
        token_in: x.tokenIn.toLowerCase(), symbol_in: x.symIn, amount_in: x.amountIn,
        token_out: x.tokenOut.toLowerCase(), symbol_out: x.symOut, amount_out: x.amountOut,
        usd: x.usd, trader: x.trader ?? null, referrer: x.referrer && x.referrer !== ZERO ? x.referrer : null,
      }));
      return Response.json({ set, generated: Math.floor(Date.now() / 1000), rows }, { headers: H });
    }
    if (set === "points") {
      const b = await readPoints();
      return Response.json({ set, generated: Math.floor(Date.now() / 1000), seasonStart: b.seasonStart, rows: b.rows.map((r, i) => ({ rank: i + 1, ...r })) }, { headers: H });
    }
    if (set === "spotlight") return Response.json({ set, generated: Math.floor(Date.now() / 1000), ...(await readSpotlight()) }, { headers: H });
    return Response.json({ error: "set must be swaps, points or spotlight" }, { status: 400 });
  } catch {
    return Response.json({ error: "The chains did not answer, try again in a minute" }, { status: 503 });
  }
}

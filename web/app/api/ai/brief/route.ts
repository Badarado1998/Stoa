import { isAddress } from "viem";
import { limited } from "@/lib/api";
import { marketBrief, walletSnapshot } from "@/lib/aiBrief";
import { cleanList, priced } from "@/lib/aiWatchlist";

// GET /api/ai/brief[?wallet=0x…]: what Ask Stoa opens with. No AI model is called: it reads the chain and Stoa's data.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  const block = limited(req);
  if (block) return block;
  const sp = new URL(req.url).searchParams, w = sp.get("wallet") ?? "";
  // ?watch=0x…,0x…: the browser's watchlist, priced now
  const wl = cleanList((sp.get("watch") ?? "").split(",").filter(Boolean).map((a) => ({ address: a, symbol: "" })));
  const [market, wallet, watch] = await Promise.all([
    marketBrief(),
    isAddress(w, { strict: false }) ? walletSnapshot(w).catch(() => null) : Promise.resolve(null),
    wl.length ? priced(wl) : Promise.resolve([]),
  ]);
  return Response.json({ market, wallet, watch }, { headers: { "cache-control": "no-store" } });
}

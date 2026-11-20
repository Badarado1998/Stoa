import { isAddress } from "viem";
import { limited } from "@/lib/api";
import { marketBrief, walletSnapshot } from "@/lib/aiBrief";

// GET /api/ai/brief[?wallet=0x…]: what Ask Stoa opens with. No AI model is called: it reads the chain and Stoa's data.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  const block = limited(req);
  if (block) return block;
  const w = new URL(req.url).searchParams.get("wallet") ?? "";
  const [market, wallet] = await Promise.all([
    marketBrief(),
    isAddress(w, { strict: false }) ? walletSnapshot(w).catch(() => null) : Promise.resolve(null),
  ]);
  return Response.json({ market, wallet }, { headers: { "cache-control": "no-store" } });
}

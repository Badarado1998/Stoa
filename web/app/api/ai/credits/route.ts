import { limited } from "@/lib/api";
import { getAddress, isAddress, isHash, type Address } from "viem";
import { creditsOf, packOptions, PACK_MSGS, PACK_USD, redeem } from "@/lib/aiCredits";
import { kvOn } from "@/lib/kv";

// GET /api/ai/credits?wallet=0x...: the wallet's Stoa AI credits and what a pack of messages costs right now.
// POST /api/ai/credits {wallet, tx}: counts a payment made from that wallet and adds its credits (lib/aiCredits.ts).
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const slow = limited(req);
  if (slow) return slow;
  const w = new URL(req.url).searchParams.get("wallet") ?? "";
  const wallet: Address | null = isAddress(w, { strict: false }) ? getAddress(w) : null;
  if (!kvOn) return Response.json({ on: false });
  const [credits, options] = await Promise.all([wallet ? creditsOf(wallet) : Promise.resolve(null), packOptions().catch(() => [])]);
  return Response.json({ on: true, credits, pack: { messages: PACK_MSGS, usd: PACK_USD }, options }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  const slow = limited(req);
  if (slow) return slow;
  const b = (await req.json().catch(() => null)) as { wallet?: string; tx?: string } | null;
  if (!b?.wallet || !isAddress(b.wallet, { strict: false }) || !b.tx || !isHash(b.tx)) return Response.json({ error: "bad request" }, { status: 400 });
  const r = await redeem(getAddress(b.wallet), b.tx);
  return Response.json(r, { status: "error" in r ? 400 : 200 });
}

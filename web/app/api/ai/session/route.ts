import { getAddress, isAddress, isHex } from "viem";
import { newNonce, openSession } from "@/lib/aiCredits";

// GET /api/ai/session?wallet=0x...: a message for that wallet to sign (valid 10 minutes, once).
// POST /api/ai/session {wallet, nonce, signature}: checks the signature and returns a session that lets this device
// spend the wallet's Stoa AI credits for 30 days (lib/aiCredits.ts). Signing moves no funds.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const w = new URL(req.url).searchParams.get("wallet") ?? "";
  if (!isAddress(w, { strict: false })) return Response.json({ error: "bad request" }, { status: 400 });
  const n = await newNonce(getAddress(w));
  return n ? Response.json(n, { headers: { "cache-control": "no-store" } }) : Response.json({ error: "Credits are not switched on yet." }, { status: 503 });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { wallet?: string; nonce?: string; signature?: string } | null;
  if (!b?.wallet || !isAddress(b.wallet, { strict: false }) || typeof b.nonce !== "string" || !b.signature || !isHex(b.signature)) return Response.json({ error: "bad request" }, { status: 400 });
  const session = await openSession(getAddress(b.wallet), b.nonce, b.signature);
  return session ? Response.json({ session }) : Response.json({ error: "The signature did not check out. Try again." }, { status: 400 });
}

import { isAddress } from "viem";
import { readStreak } from "@/lib/streak";

/** GET /api/streak?address=0x…: a wallet's weekly swap streak on Stoa (badge only, no points) */
export async function GET(req: Request) {
  const a = new URL(req.url).searchParams.get("address") ?? "";
  if (!isAddress(a, { strict: false })) return Response.json({ error: "address must be a wallet address" }, { status: 400 });
  try {
    return Response.json(await readStreak(a), { headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=900" } });
  } catch {
    return Response.json({ error: "the chain did not answer, try again shortly" }, { status: 503 });
  }
}

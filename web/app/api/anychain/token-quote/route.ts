import { limited } from "@/lib/api";
import { isJson } from "@/lib/anychainServer";
import { anyTokenQuote } from "@/lib/anyTokenServer";

// POST /api/anychain/token-quote {chainId, token, amount, user, tokenOut}: a route from a source chain into any Robinhood
// Chain token, to the user's own address (lib/anyTokenServer.ts). /api/anychain/status and /receipt follow it as for $STOA.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const slow = limited(req);
  if (slow) return slow;
  if (!isJson(req)) return Response.json({ error: "bad request" }, { status: 415 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  let amount: bigint;
  try { amount = BigInt(String(b?.amount ?? "")); } catch { return Response.json({ error: "bad amount" }, { status: 400 }); }
  const r = await anyTokenQuote({ chainId: Number(b?.chainId), token: String(b?.token ?? ""), amount, user: String(b?.user ?? ""), tokenOut: String(b?.tokenOut ?? "") });
  if ("error" in r) return Response.json({ error: r.error }, { status: r.status });
  return Response.json(r.q, { headers: { "cache-control": "no-store" } });
}

// Preview deployments only: the same quote over GET (?chainId&token&amount&user&tokenOut), for testing with a browser.
export async function GET(req: Request) {
  if (process.env.VERCEL_ENV === "production") return Response.json({ error: "not found" }, { status: 404 });
  const u = new URL(req.url).searchParams;
  let amount: bigint;
  try { amount = BigInt(u.get("amount") ?? ""); } catch { return Response.json({ error: "bad amount" }, { status: 400 }); }
  const r = await anyTokenQuote({ chainId: Number(u.get("chainId")), token: u.get("token") ?? "", amount, user: u.get("user") ?? "", tokenOut: u.get("tokenOut") ?? "" });
  return Response.json("error" in r ? { error: r.error } : r.q, { status: "error" in r ? r.status : 200 });
}

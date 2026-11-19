import { tw } from "@/lib/trustware";
import { limited } from "@/lib/api";
import { intentOk } from "@/lib/anychainServer";

// POST /api/anychain/receipt {intentId, txHash}: tells Trustware which source transaction filled its route intent, so
// its status (and Relay's delivery) can be followed. Retrying the same hash is safe (Idempotency-Key).
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const slow = limited(req);
  if (slow) return slow;
  const b = (await req.json().catch(() => null)) as { intentId?: string; txHash?: string; sig?: string } | null;
  const intentId = String(b?.intentId ?? ""), txHash = String(b?.txHash ?? "");
  if (!UUID.test(intentId) || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) return Response.json({ error: "bad request" }, { status: 400 });
  if (!intentOk(intentId, String(b?.sig ?? ""))) return Response.json({ error: "unknown intent" }, { status: 403 });
  const r = await tw(`/route-intent/${intentId}/receipt`, { method: "POST", body: JSON.stringify({ txHash }), idem: txHash });
  return Response.json({ ok: r.ok }, { status: r.ok ? 200 : 502 });
}

import { tw } from "@/lib/trustware";
import { limited } from "@/lib/api";
import { intentOk } from "@/lib/anychainServer";

// GET /api/anychain/status?intentId=…: Trustware's status for a route intent (pending, submitted, bridging, success,
// failed, expired) and the delivery transaction on Robinhood Chain once there is one.
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  const slow = limited(req);
  if (slow) return slow;
  const u = new URL(req.url);
  const intentId = u.searchParams.get("intentId") ?? "";
  if (!UUID.test(intentId)) return Response.json({ error: "bad request" }, { status: 400 });
  if (!intentOk(intentId, u.searchParams.get("sig") ?? "")) return Response.json({ error: "unknown intent" }, { status: 403 });
  const r = await tw(`/route-intent/${intentId}/status`);
  if (!r.ok) return Response.json({ status: "unknown" }, { status: r.status === 404 ? 404 : 502 });
  const d = (r.body.data ?? {}) as Record<string, unknown>;
  const s = String(d.status ?? "unknown");
  const dest = typeof d.dest_tx_hash === "string" ? d.dest_tx_hash : typeof d.destTxHash === "string" ? d.destTxHash : null;
  return Response.json({ status: s, destTx: dest }, { headers: { "cache-control": "no-store" } });
}

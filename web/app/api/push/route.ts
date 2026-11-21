import { isAddress } from "viem";
import { dropSub, pushOn, saveSub, subId, type PushAlert } from "@/lib/push";

// POST /api/push: turn on (or refresh) notifications for this device, with its wallet (for "ETH to claim") and its
// price alerts. DELETE /api/push: turn them off. Only the subscription, the wallet address and the alerts are kept.
export const dynamic = "force-dynamic";

const okEndpoint = (u: unknown): u is string => {
  if (typeof u !== "string" || u.length > 1000) return false;
  try { return new URL(u).protocol === "https:"; } catch { return false; }
};

export async function POST(req: Request) {
  if (!pushOn) return Response.json({ error: "notifications are not switched on yet" }, { status: 503 });
  const b = (await req.json().catch(() => null)) as { subscription?: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }; wallet?: unknown; alerts?: unknown } | null;
  const s = b?.subscription;
  if (!s || !okEndpoint(s.endpoint) || typeof s.keys?.p256dh !== "string" || typeof s.keys?.auth !== "string" || s.keys.p256dh.length > 200 || s.keys.auth.length > 100)
    return Response.json({ error: "bad subscription" }, { status: 400 });
  const wallet = typeof b?.wallet === "string" && isAddress(b.wallet, { strict: false }) ? b.wallet.toLowerCase() : undefined;
  const alerts: PushAlert[] = (Array.isArray(b?.alerts) ? b!.alerts : []).slice(0, 30).flatMap((x) => {
    const a = x as Partial<PushAlert>;
    if (typeof a.id !== "string" || typeof a.address !== "string" || !isAddress(a.address, { strict: false }) || typeof a.price !== "number" || !isFinite(a.price)) return [];
    if (a.dir !== "above" && a.dir !== "below") return [];
    return [{ id: a.id.slice(0, 40), chain: String(a.chain ?? "robinhood").slice(0, 16), address: a.address.toLowerCase(), symbol: String(a.symbol ?? "").replace(/[<>]/g, "").slice(0, 16), dir: a.dir, price: a.price, kind: a.kind === "gap" ? "gap" : "price" }];
  });
  const id = await saveSub({ sub: { endpoint: s.endpoint as string, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } }, wallet, alerts, at: Math.floor(Date.now() / 1000) });
  return Response.json({ ok: true, id });
}

export async function DELETE(req: Request) {
  const b = (await req.json().catch(() => null)) as { endpoint?: unknown } | null;
  if (!okEndpoint(b?.endpoint)) return Response.json({ error: "bad endpoint" }, { status: 400 });
  await dropSub(subId(b!.endpoint as string));
  return Response.json({ ok: true });
}

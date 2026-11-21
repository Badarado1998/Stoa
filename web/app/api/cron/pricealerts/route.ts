import { kv, kvOn } from "@/lib/kv";
import { tgOn, tgSend } from "@/lib/telegram";
import { fireAlerts } from "@/lib/tgAlerts";
import { cronAllowed, cronRefused } from "@/lib/cronAuth";

// GET /api/cron/pricealerts (Vercel cron, every 5 minutes): checks the Telegram bot's price alerts and messages each
// one that fired (lib/tgAlerts.ts). A lock in storage makes extra calls do nothing, so it needs no secret.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  if (!cronAllowed(req)) return cronRefused();
  if (!tgOn || !kvOn) return Response.json({ ok: false, why: "not switched on" });
  if ((await kv("SET", "tg:pricealerts:lock", Date.now(), "NX", "EX", 240)) !== "OK") return Response.json({ ok: true, skipped: "ran recently" });
  const chats = ((await kv<string[]>("SMEMBERS", "tg:alerters")) ?? []).slice(0, 3000);
  const fired = await fireAlerts(chats);
  for (const f of fired) await tgSend(f.chat, f.text, undefined, { text: "Open Stoa ↗", url: "https://stoadex.com/trade?chain=robinhood" });
  return Response.json({ ok: true, chats: chats.length, fired: fired.length });
}

import { kv, kvOn } from "@/lib/kv";
import { tgOn, tgSend } from "@/lib/telegram";
import { reportText, weeklyText } from "@/lib/tgReport";
import { topText } from "@/lib/tgAlerts";

// GET /api/cron/tgreport (Vercel cron, 01:00 and 13:00 UTC): the market report to every group that turned it on with
// /report on. A lock in storage makes extra calls do nothing, so it needs no secret.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  if (!tgOn || !kvOn) return Response.json({ ok: false, why: "not switched on" });
  // only at the report hours, once each: a call at any other time sends nothing
  const h = new Date().getUTCHours();
  if (h !== 1 && h !== 13) return Response.json({ ok: true, skipped: "not a report hour" });
  const slot = new Date().toISOString().slice(0, 13);
  if ((await kv("SET", `tg:report:sent:${slot}`, 1, "NX", "EX", 7200)) !== "OK") return Response.json({ ok: true, skipped: "sent this hour" });
  const chats = ((await kv<string[]>("SMEMBERS", "tg:report")) ?? []).slice(0, 500);
  if (!chats.length) return Response.json({ ok: true, chats: 0 });
  const d = new Date();
  // Mondays 01:00 UTC: last week's Points top 5 too
  const monday = d.getUTCDay() === 1 && d.getUTCHours() === 1;
  const text = monday
    ? `${await weeklyText().catch(() => "")}\n\n${await topText(5).catch(() => "")}\n\n${await reportText()}`
    : await reportText();
  let sent = 0;
  for (const c of chats) if (await tgSend(c, text, undefined, { text: "Ask Stoa AI ↗", url: "https://stoadex.com/ai" })) sent++;
  return Response.json({ ok: true, chats: chats.length, sent });
}

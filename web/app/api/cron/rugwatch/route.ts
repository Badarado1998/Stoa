import { getAddress, isAddress } from "viem";
import { kv, kvOn } from "@/lib/kv";
import { rugScan } from "@/lib/rugScan";
import { tgHtml, tgOn, tgSend } from "@/lib/telegram";

// GET /api/cron/rugwatch (Vercel cron, every 10 minutes): rug scans every wallet watched with the Telegram bot's /watch
// and messages its owner about each new sign (one alert per token and sign a day). A lock in storage makes extra calls
// do nothing, so it needs no secret. Without the bot token or storage it does nothing.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  if (!tgOn || !kvOn) return Response.json({ ok: false, why: "not switched on" });
  if ((await kv("SET", "tg:rugwatch:lock", Date.now(), "NX", "EX", 480)) !== "OK") return Response.json({ ok: true, skipped: "ran recently" });
  // start where the last run stopped, so every wallet gets its turn when they do not all fit in one run
  const all = (await kv<string[]>("SMEMBERS", "tg:watchers")) ?? [];
  const from = Number((await kv<string>("GET", "tg:rugwatch:cursor")) ?? 0) % Math.max(1, all.length);
  const chats = [...all.slice(from), ...all.slice(0, from)].slice(0, 2000);
  const started = Date.now();
  let scanned = 0, sent = 0;
  for (let i = 0; i < chats.length && Date.now() - started < 240_000; i += 5) {
    await Promise.all(chats.slice(i, i + 5).map(async (chat) => {
      const w = await kv<string>("GET", `tg:watch:${chat}`);
      if (!w || !isAddress(w, { strict: false })) return;
      const s = await rugScan(getAddress(w)).catch(() => null);
      scanned++;
      if (!s) return;
      const fresh: string[] = [];
      for (const t of s.tokens) for (const f of t.flags) {
        if (f.level !== "high" && f.code !== "creator") continue;
        if ((await kv("SET", `tg:seen:${chat}:${t.address}:${f.code}`, 1, "NX", "EX", 86_400)) === "OK") fresh.push(`• <b>${tgHtml(t.symbol)}</b>: ${tgHtml(f.text)}`);
      }
      if (fresh.length) { await tgSend(chat, `🚨 <b>Rug alert</b> for <code>${w.slice(0, 6)}…${w.slice(-4)}</code>\n\n${fresh.join("\n")}\n\nA signal, not certainty. Check it on stoadex.com/ai. /unwatch to stop.`); sent++; }
    }));
  }
  await kv("SET", "tg:rugwatch:cursor", (from + scanned) % Math.max(1, all.length));
  return Response.json({ ok: true, watchers: all.length, scanned, sent });
}

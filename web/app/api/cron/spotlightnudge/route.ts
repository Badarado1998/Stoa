import { kv, kvOn } from "@/lib/kv";
import { tgHtml, tgOn, tgSend } from "@/lib/telegram";
import { readSpotlight } from "@/lib/spotlightServer";
import { BID_WINDOW, SPOT_START, WEEK, epochAt, epochStart } from "@/lib/spotlight";

// GET /api/cron/spotlightnudge (Vercel cron, hourly): tells the groups that turned on /report about Spotlight's
// moments: 12 hours before week 1, when a week opens, 3 hours before bids close, 6 hours before votes close. Each
// moment is sent once (a key in storage), so extra calls do nothing.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const H = 3600;
const when = (t: number) => `${new Date(t * 1000).toUTCString().slice(0, 22)} UTC`;

export async function GET() {
  if (!tgOn || !kvOn) return Response.json({ ok: false, why: "not switched on" });
  if ((await kv("SET", "tg:spotnudge:lock", 1, "NX", "EX", 600)) !== "OK") return Response.json({ ok: true, skipped: "ran recently" });
  const now = Math.floor(Date.now() / 1000), ep = epochAt(now);
  let key: string | null = null, text = "";
  if (ep < 0) {
    if (SPOT_START - now <= 12 * H) { key = "pre"; text = `🔦 <b>Spotlight opens in ${Math.max(1, Math.round((SPOT_START - now) / H))} hours</b> (${when(SPOT_START)}).\n\nLock $STOA now so it can vote: projects bid ETH for 3 slots, and the ETH of the winners goes to the $STOA holders who voted for them. Ask me: "Lock all my STOA for Spotlight".`; }
  } else {
    const start = epochStart(ep), s = await readSpotlight().catch(() => null);
    const live = (s?.candidates ?? []).filter((c) => !c.canceled);
    const list = live.slice(0, 5).map((c) => `• ${tgHtml(c.symbol ?? c.token.slice(0, 8))} · ${c.bidEth.toLocaleString("en-US", { maximumFractionDigits: 3 })} ETH bid`).join("\n");
    if (now - start < 2 * H) { key = `open:${ep}`; text = `🔦 <b>Spotlight week ${ep + 1} is open</b>\n\nProjects bid ETH for 3 slots until ${when(start + BID_WINDOW)}; $STOA holders vote until ${when(start + WEEK)}. Voters of the winners share their ETH.${list ? `\n\n${list}` : ""}`; }
    else if (start + BID_WINDOW - now > 0 && start + BID_WINDOW - now <= 3 * H) { key = `bids:${ep}`; text = `⏳ <b>Spotlight bids close in about 3 hours</b> (${when(start + BID_WINDOW)}).${list ? `\n\n${list}` : ""}\n\nVoting stays open until ${when(start + WEEK)}.`; }
    else if (start + WEEK - now > 0 && start + WEEK - now <= 6 * H) { key = `votes:${ep}`; text = `⏳ <b>Spotlight votes close in about 6 hours</b> (${when(start + WEEK)}).${list ? `\n\n${list}` : ""}\n\nSet your votes: ask me "Who can I vote for this week?"`; }
  }
  if (!key) return Response.json({ ok: true, nothing: true });
  if ((await kv("SET", `tg:spot:${key}`, 1, "NX", "EX", 14 * 86400)) !== "OK") return Response.json({ ok: true, skipped: key });
  const chats = ((await kv<string[]>("SMEMBERS", "tg:report")) ?? []).slice(0, 500);
  let sent = 0;
  for (const c of chats) if (await tgSend(c, `${text}\n\nNot financial advice.`, undefined, { text: "Open Spotlight ↗", url: "https://stoadex.com/spotlight" })) sent++;
  return Response.json({ ok: true, key, sent });
}

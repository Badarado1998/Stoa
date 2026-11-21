import { kv, kvOn } from "@/lib/kv";
import { tgSym, tgOn, tgSend } from "@/lib/telegram";
import { readSpotlight } from "@/lib/spotlightServer";
import { cronAllowed, cronRefused } from "@/lib/cronAuth";
import { followAlerts } from "@/lib/spotlightFollow";

// GET /api/cron/spotlightrace (Vercel cron, every 10 minutes): tells the groups that turned on /report when the race
// moves: a new token bids, a token passes the vote quorum, or the tokens that would win change. Compared with the last
// snapshot in storage. At most one message per 30 minutes: changes in between wait and go out together.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Snap = { bids: string[]; quorum: string[]; leaders: string[] };

export async function GET(req: Request) {
  if (!cronAllowed(req)) return cronRefused();
  if (!tgOn || !kvOn) return Response.json({ ok: false, why: "not switched on" });
  if ((await kv("SET", "tg:race:lock", 1, "NX", "EX", 300)) !== "OK") return Response.json({ ok: true, skipped: "ran recently" });
  const s = await readSpotlight().catch(() => null);
  if (!s || s.phase === "before_week_1" || s.paused) return Response.json({ ok: true, nothing: true });
  const live = s.candidates.filter((c) => !c.canceled);
  // opt-in alerts for followed tokens (/follow): their own snapshot, no group cooldown
  await followAlerts(s).catch(() => 0);
  const now: Snap = {
    bids: live.map((c) => c.token.toLowerCase()),
    quorum: live.filter((c) => c.reachesQuorum).map((c) => c.token.toLowerCase()),
    leaders: live.filter((c) => c.reachesQuorum).slice(0, s.rules.slots).map((c) => c.token.toLowerCase()),
  };
  const key = `tg:race:${s.week}`;
  const raw = await kv<string>("GET", key);
  // the first look at a week only records it: the "week is open" nudge already went out
  if (!raw) { await kv("SET", key, JSON.stringify(now), "EX", 21 * 86400); return Response.json({ ok: true, recorded: true }); }
  let before: Snap;
  try { before = JSON.parse(raw) as Snap; } catch { await kv("SET", key, JSON.stringify(now), "EX", 21 * 86400); return Response.json({ ok: true, reset: true }); }

  const by = new Map(live.map((c) => [c.token.toLowerCase(), c]));
  const name = (t: string) => tgSym(by.get(t)?.symbol ?? `${t.slice(0, 6)}…`);
  const eth = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 4 });
  const lines: string[] = [];
  for (const t of now.bids.filter((t) => !before.bids.includes(t))) lines.push(`🆕 <b>${name(t)}</b> bid ${eth(by.get(t)!.bidEth)} ETH`);
  for (const t of now.quorum.filter((t) => !before.quorum.includes(t))) lines.push(`✅ <b>${name(t)}</b> passed ${(s.rules.quorumStoa / 1e6).toLocaleString("en-US")}M votes`);
  const leadersChanged = now.leaders.join() !== before.leaders.join() && now.leaders.length > 0;
  if (leadersChanged) lines.push(`🏁 Winning if voting closed now: ${now.leaders.map((t) => `<b>${name(t)}</b>`).join(", ")}`);
  if (!lines.length) { await kv("SET", key, JSON.stringify(now), "EX", 21 * 86400); return Response.json({ ok: true, nothing: true }); }
  // one message per 30 minutes: without the slot, keep the old snapshot so these changes go out next time
  if ((await kv("SET", "tg:race:cool", 1, "NX", "EX", 1800)) !== "OK") return Response.json({ ok: true, waiting: lines.length });
  await kv("SET", key, JSON.stringify(now), "EX", 21 * 86400);

  const closes = s.phase === "bids_open" ? `Bids close ${new Date(s.bidsCloseAt).toUTCString().slice(0, 22)} UTC` : `Votes close ${new Date(s.votesCloseAt).toUTCString().slice(0, 22)} UTC`;
  const text = `🔦 <b>Spotlight week ${s.week}</b>\n\n${lines.slice(0, 8).join("\n")}\n\n${closes}. /spotlight for the full race. Not financial advice.`;
  const buttons = [[{ text: "Live board ↗", url: "https://stoadex.com/spotlight/live" }, { text: "Lock and vote ↗", url: "https://stoadex.com/spotlight#race" }]];
  const chats = ((await kv<string[]>("SMEMBERS", "tg:report")) ?? []).slice(0, 500);
  let sent = 0;
  for (const c of chats) if (await tgSend(c, text, undefined, buttons)) sent++;
  return Response.json({ ok: true, lines: lines.length, sent });
}

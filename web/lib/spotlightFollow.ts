import "server-only";
import { kv } from "./kv";
import { tgSend, tgSym } from "./telegram";
import type { readSpotlight } from "./spotlightServer";

/** Opt-in Spotlight alerts for one token: a project (or anyone) sends /follow <token> to the bot, and that chat hears when
 *  the token starts or stops winning, passes the vote quorum, or is outbid, with the bid that would put it back on top.
 *  Storage: tg:follow:<token> = chats, tg:follow:chat:<chat> = tokens, tg:follow:tokens = every followed token,
 *  tg:follow:snap:<week> = each followed token's last state. Only the chats that asked hear anything. */

type S = NonNullable<Awaited<ReturnType<typeof readSpotlight>>>;
type State = { win: boolean; quorum: boolean; bid: number };
const MAX_PER_CHAT = 5;
const eth = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 4 });

export async function follow(chat: number, token: string): Promise<"ok" | "full"> {
  const t = token.toLowerCase();
  const mine = (await kv<string[]>("SMEMBERS", `tg:follow:chat:${chat}`)) ?? [];
  if (!mine.includes(t) && mine.length >= MAX_PER_CHAT) return "full";
  await kv("SADD", `tg:follow:${t}`, chat);
  await kv("SADD", `tg:follow:chat:${chat}`, t);
  await kv("SADD", "tg:follow:tokens", t);
  return "ok";
}

export async function unfollow(chat: number, token?: string): Promise<number> {
  const mine = (await kv<string[]>("SMEMBERS", `tg:follow:chat:${chat}`)) ?? [];
  const drop = token ? mine.filter((t) => t === token.toLowerCase()) : mine;
  for (const t of drop) {
    await kv("SREM", `tg:follow:${t}`, chat);
    await kv("SREM", `tg:follow:chat:${chat}`, t);
    if (!(await kv<number>("SCARD", `tg:follow:${t}`))) await kv("SREM", "tg:follow:tokens", t);
  }
  return drop.length;
}

export const followed = async (chat: number) => (await kv<string[]>("SMEMBERS", `tg:follow:chat:${chat}`)) ?? [];

/** called by the race cron every 10 minutes: compares each followed token with its last state and tells its chats */
export async function followAlerts(s: S): Promise<number> {
  const tokens = (await kv<string[]>("SMEMBERS", "tg:follow:tokens")) ?? [];
  if (!tokens.length) return 0;
  const live = s.candidates.filter((c) => !c.canceled);
  const winners = live.filter((c) => c.reachesQuorum).slice(0, s.rules.slots); // candidates come sorted by bid
  const winSet = new Set(winners.map((c) => c.token.toLowerCase()));
  const lowestWin = winners.length === s.rules.slots ? winners[winners.length - 1] : null;
  const key = `tg:follow:snap:${s.week}`;
  const before = JSON.parse((await kv<string>("GET", key)) ?? "{}") as Record<string, State>;
  const now: Record<string, State> = {};
  let sent = 0;
  for (const t of tokens) {
    const c = live.find((x) => x.token.toLowerCase() === t);
    if (!c) continue; // not bidding this week: nothing to say
    const st: State = { win: winSet.has(t), quorum: c.reachesQuorum, bid: c.bidEth };
    now[t] = st;
    const was = before[t];
    if (!was) continue; // first look this week only records it
    const sym = tgSym(c.symbol ?? `${t.slice(0, 6)}…`);
    const lines: string[] = [];
    if (!was.quorum && st.quorum) lines.push(`✅ <b>${sym}</b> passed ${(s.rules.quorumStoa / 1e6).toLocaleString("en-US")}M votes.`);
    if (!was.win && st.win) lines.push(`🏁 <b>${sym}</b> is winning now (${eth(c.bidEth)} ETH).`);
    if (was.win && !st.win) {
      const above = winners.find((w) => w.bidEth > c.bidEth);
      lines.push(`⚠️ <b>${sym}</b> was outbid and is not winning right now${above ? ` (${tgSym(above.symbol ?? "another token")} bid ${eth(above.bidEth)} ETH)` : ""}.`);
    }
    if (lines.length && !st.win && st.quorum && lowestWin && s.phase === "bids_open") {
      lines.push(`To win again, the total bid needs to be above ${eth(lowestWin.bidEth)} ETH: add more than ${eth(Math.max(0, lowestWin.bidEth - c.bidEth))} ETH before ${new Date(s.bidsCloseAt).toUTCString().slice(0, 22)} UTC.`);
    } else if (lines.length && !st.quorum) {
      lines.push(`It needs ${Math.max(0, Math.ceil((s.rules.quorumStoa - c.votesStoa) / 1000)).toLocaleString("en-US")}k more votes to be able to win.`);
    }
    if (!lines.length) continue;
    const chats = ((await kv<string[]>("SMEMBERS", `tg:follow:${t}`)) ?? []).slice(0, 50);
    const text = `🔦 <b>Spotlight week ${s.week}</b>\n\n${lines.join("\n")}\n\nNot financial advice. /unfollow ${sym} to stop.`;
    const buttons = [[{ text: `${sym.replace(/<[^>]+>/g, "")} vote page ↗`, url: `https://stoadex.com/spotlight/vote/${t}` }, { text: "Bid ↗", url: "https://stoadex.com/spotlight/projects" }]];
    for (const ch of chats) if (await tgSend(ch, text, undefined, buttons)) sent++;
  }
  await kv("SET", key, JSON.stringify({ ...before, ...now }), "EX", 21 * 86400);
  return sent;
}

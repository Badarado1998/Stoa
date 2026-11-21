import "server-only";
import { kv } from "./kv";
import { resolveToken } from "./aiTools";
import { marketOf } from "./rugScan";
import { ROBINHOOD } from "./networks";
import { NATIVE } from "./tokens";
import { readPoints, readPreview, SEASON_START } from "./points";
import { tgHtml } from "./telegram";

/** The Telegram bot's price alerts (/alert, /alerts, /unalert) and the Points board (/top). Alerts live in Upstash:
 *  tg:alerts:<chat> is a hash of id -> alert, tg:alerters the chats that have any. Checked every 5 minutes by
 *  app/api/cron/pricealerts with DexScreener prices; an alert fires once and is removed. */
export type Alert = { id: string; token: string; symbol: string; kind: "below" | "above" | "up" | "down"; value: number; base: number; at: number };
const MAX = 10;
const usd = (v: number) => `$${v >= 1 ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : v.toPrecision(3)}`;
const priceKey = (a: string) => (a === NATIVE ? ROBINHOOD.wrapped : a).toLowerCase();

export const alertText = (a: Alert) => a.kind === "below" || a.kind === "above" ? `${tgHtml(a.symbol)} ${a.kind} ${usd(a.value)}` : `${tgHtml(a.symbol)} ${a.kind} ${a.value}% (from ${usd(a.base)})`;

export async function addAlert(chat: number, arg: string): Promise<string> {
  const m = /^(\S+)\s+(below|under|<|above|over|>|up|down)\s+\$?([\d.]+)\s*(%?)$/i.exec(arg.trim());
  if (!m) return "Send it like this:\n/alert NVDA below 120\n/alert STOA above 0.0001\n/alert STOA up 20%\n/alert ETH down 10%";
  const t = await resolveToken(m[1]);
  if (!t) return "I don't know that token. Use a symbol like STOA, NVDA, ETH, or a token address.";
  const w = m[2].toLowerCase(), v = Number(m[3]), isPct = m[4] === "%" || w === "up" || w === "down";
  const kind: Alert["kind"] = w === "up" ? "up" : w === "down" ? "down" : /below|under|</.test(w) ? "below" : "above";
  if (!(v > 0) || (isPct && (kind === "below" || kind === "above"))) return "Use a price for below/above (/alert NVDA below 120) and a percent for up/down (/alert STOA up 20%).";
  const px = (await marketOf([priceKey(t.address)]).catch(() => ({})) as Awaited<ReturnType<typeof marketOf>>)[priceKey(t.address)]?.usd;
  if (!px) return `No market price for ${tgHtml(t.symbol)} right now, so I can't watch it.`;
  if (kind === "below" && px <= v) return `${tgHtml(t.symbol)} is already ${usd(px)}, below ${usd(v)}.`;
  if (kind === "above" && px >= v) return `${tgHtml(t.symbol)} is already ${usd(px)}, above ${usd(v)}.`;
  const have = (await kv<number>("HLEN", `tg:alerts:${chat}`)) ?? 0;
  if (have >= MAX) return `You have ${MAX} alerts, the most. Remove one with /unalert.`;
  const a: Alert = { id: Math.random().toString(36).slice(2, 7), token: t.address, symbol: t.symbol, kind, value: v, base: px, at: Math.floor(Date.now() / 1000) };
  await kv("HSET", `tg:alerts:${chat}`, a.id, JSON.stringify(a));
  await kv("SADD", "tg:alerters", chat);
  return `🔔 Alert set: ${alertText(a)}. ${tgHtml(t.symbol)} is ${usd(px)} now. I check every 5 minutes and message you once.\n/alerts to see them, /unalert to remove.`;
}

export async function listAlerts(chat: number): Promise<Alert[]> {
  const h = (await kv<string[]>("HGETALL", `tg:alerts:${chat}`)) ?? [];
  const out: Alert[] = [];
  for (let i = 1; i < h.length; i += 2) { try { out.push(JSON.parse(h[i])); } catch { /* skip */ } }
  return out.sort((x, y) => x.at - y.at);
}

export async function removeAlert(chat: number, arg: string): Promise<string> {
  const list = await listAlerts(chat);
  if (!list.length) return "You have no alerts.";
  if (/^all$/i.test(arg)) { await kv("DEL", `tg:alerts:${chat}`); await kv("SREM", "tg:alerters", chat); return "All alerts removed."; }
  const n = Number(arg);
  const a = Number.isInteger(n) && n >= 1 ? list[n - 1] : list.find((x) => x.id === arg);
  if (!a) return "Send /unalert 1 (the number from /alerts), or /unalert all.";
  await kv("HDEL", `tg:alerts:${chat}`, a.id);
  if (list.length === 1) await kv("SREM", "tg:alerters", chat);
  return `Removed: ${alertText(a)}.`;
}

/** every alert that fired, removed from storage; for the cron */
export async function fireAlerts(chats: string[]): Promise<{ chat: string; text: string }[]> {
  const all = await Promise.all(chats.map(async (c) => ({ c, list: await listAlerts(Number(c)) })));
  const tokens = [...new Set(all.flatMap((x) => x.list.map((a) => priceKey(a.token))))];
  const px = await marketOf(tokens).catch(() => ({} as Awaited<ReturnType<typeof marketOf>>));
  const out: { chat: string; text: string }[] = [];
  for (const { c, list } of all) {
    if (!list.length) { await kv("SREM", "tg:alerters", c); continue; }
    const hit: string[] = [];
    for (const a of list) {
      const p = px[priceKey(a.token)]?.usd;
      if (!p) continue;
      const ch = ((p - a.base) / a.base) * 100;
      const yes = a.kind === "below" ? p <= a.value : a.kind === "above" ? p >= a.value : a.kind === "up" ? ch >= a.value : ch <= -a.value;
      if (!yes) continue;
      await kv("HDEL", `tg:alerts:${c}`, a.id);
      hit.push(`• <b>${tgHtml(a.symbol)}</b> is ${usd(p)} (${ch >= 0 ? "+" : ""}${ch.toFixed(1)}% since you set it): ${alertText(a)}`);
    }
    if (hit.length) out.push({ chat: c, text: `🔔 <b>Price alert</b>\n${hit.join("\n")}\n\nNot financial advice.` });
  }
  return out;
}

/** the Points board: Season 1 from its start, a 7-day preview before it */
export async function topText(n = 10): Promise<string> {
  const pre = Date.now() / 1000 < SEASON_START;
  const b = await (pre ? readPreview() : readPoints()).catch(() => null);
  if (!b || !b.rows.length) return "No one on the board yet. Swap $1 or more through Stoa to get on it.";
  const medal = ["🥇", "🥈", "🥉"];
  return `🏆 <b>${pre ? "Points preview · last 7 days" : "Points · Season 1"}</b>\n`
    + b.rows.slice(0, n).map((r, i) => `${medal[i] ?? `${i + 1}.`} <code>${r.address.slice(0, 6)}…${r.address.slice(-4)}</code> · ${Math.round(r.points).toLocaleString("en-US")} pts · ${r.swaps} swaps`).join("\n")
    + `\n\n${b.wallets} wallets${pre ? ". Season 1 starts Mon 23 Nov 00:00 UTC." : ""} Points count swaps of $1+ through Stoa; stock tokens count double.`;
}

import { after } from "next/server";
import { getAddress, isAddress, type Address } from "viem";
import { runAgent } from "@/lib/aiAgent";
import { countToday } from "@/lib/aiCredits";
import { gapsText, pnlText, priceText } from "@/lib/tgReport";
import { projectContext, PROJECT_TOOLS } from "@/lib/aiProject";
import { kv, kvOn } from "@/lib/kv";
import { rugScan, type RugToken } from "@/lib/rugScan";
import { tg, tgHtml, tgMe, tgOn, tgSecret, tgSend } from "@/lib/telegram";

// POST /api/telegram: the Stoa AI bot. Telegram calls it with every message the bot sees (webhook set by
// /api/telegram/setup, with a secret derived from the bot token). In a private chat it answers everything; in a group it
// answers /ask, a mention of the bot, or a reply to it. Read-only: it checks tokens, quotes, stock gaps and docs, and
// sends people to stoadex.com to trade. /watch <wallet> sends rug alerts in a private chat (app/api/cron/rugwatch);
// /settoken <address> makes it a project's own assistant in that group (admins only). Both need storage (lib/kv.ts).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type TgMsg = { message_id: number; text?: string; chat: { id: number; type: string; title?: string }; from?: { id: number; is_bot?: boolean; first_name?: string }; sender_chat?: { id: number }; is_automatic_forward?: boolean; reply_to_message?: { text?: string; from?: { id: number } } };

const HELP = `<b>Stoa AI</b> · early beta on Robinhood Chain

Ask in plain words, for example:
• Is STOA safe to buy?
• Quote 0.01 ETH to USDG
• Which stock tokens are furthest from Robinhood?

In a group: /ask your question, mention me, or reply to me.
/watch 0xYourWallet · rug alerts for your tokens (private chat)
/unwatch · stop the alerts
/settoken 0xToken · group admins: make me this project's assistant
/report on · group admins: a market report here at 01:00 and 13:00 UTC

Quick data, free and unlimited:
/price STOA · /gaps · /pnl 0xWallet

I only read: to trade, use stoadex.com/ai where your own wallet signs. Not financial advice. 10 questions a day each.`;

function cardText(kind: string, data: unknown): string | null {
  const d = data as Record<string, unknown>;
  if (kind === "safety") {
    const t = d.test as { buyTaxPct: number | null; sellTaxPct: number | null; sellOk: boolean } | null;
    const pc = (v: unknown) => (typeof v === "number" ? `${v.toFixed(1)}%` : "—");
    return `🛡 <b>${tgHtml(String(d.symbol ?? "Token"))}</b> · safety: <b>${tgHtml(String(d.verdict))}</b>\nTax ${pc(t?.buyTaxPct)} / ${pc(t?.sellTaxPct)} · sells ${t ? (t.sellOk ? "ok" : "FAIL") : "—"} · creator ${pc(d.creatorPct)}`;
  }
  if (kind === "quote") {
    const s = d as { sell: { amount: string; symbol: string }; buy: { about: string; atLeast: string; symbol: string }; route: string };
    return s.sell ? `💱 ${tgHtml(s.sell.amount)} ${tgHtml(s.sell.symbol)} → about <b>${tgHtml(s.buy.about)} ${tgHtml(s.buy.symbol)}</b> (at least ${tgHtml(s.buy.atLeast)}) · ${tgHtml(s.route)}` : null;
  }
  if (kind === "gaps" && Array.isArray(data)) {
    return "📈 On-chain vs Robinhood\n" + (data as { symbol: string; gapPct: number }[]).slice(0, 5).map((r) => `${tgHtml(r.symbol)} ${r.gapPct >= 0 ? "+" : ""}${r.gapPct.toFixed(2)}%`).join("\n");
  }
  return null;
}

const rugText = (toks: RugToken[], onlyFlagged = false) => {
  const bad = toks.filter((t) => t.flags.length);
  if (!bad.length) return onlyFlagged ? "" : `✅ No rug signs in ${toks.length} token${toks.length === 1 ? "" : "s"} right now.`;
  return bad.map((t) => `${t.flags.some((f) => f.level === "high") ? "🚨" : "⚠️"} <b>${tgHtml(t.symbol)}</b>\n${t.flags.map((f) => `• ${tgHtml(f.text)}`).join("\n")}`).join("\n\n");
};

async function answer(m: TgMsg, q: string, botId: number) {
  const chat = m.chat.id, uid = m.sender_chat?.id ?? m.from?.id ?? chat;
  const n = await countToday(`tg:${uid}`);
  if (n > 10) { await tgSend(chat, "That's your 10 questions for today. More after 00:00 UTC, or on stoadex.com/ai.", m.message_id); return; }
  if ((await countToday(`tgchat:${chat}`)) > 150 || (await countToday("all")) > Number(process.env.AI_DAILY_CAP || 3000)) { await tgSend(chat, "I'm very busy today. Try again later, or ask on stoadex.com/ai.", m.message_id); return; }
  const u = { left: 10 - n };
  void tg("sendChatAction", { chat_id: chat, action: "typing" });
  const proj = m.chat.type !== "private" ? await kv<string>("GET", `tg:proj:${chat}`) : null;
  const project: Address | null = proj && isAddress(proj, { strict: false }) ? getAddress(proj) : null;
  const history: { role: "user" | "assistant"; content: string }[] = [];
  if (m.reply_to_message?.from?.id === botId && m.reply_to_message.text) history.push({ role: "assistant", content: m.reply_to_message.text.slice(0, 1500) });
  history.push({ role: "user", content: q.slice(0, 1000) });
  let text = "", err = "";
  const cards: string[] = [];
  const extra = `You are answering in Telegram${m.chat.type === "private" ? " (a private chat)" : ` (the group ${String(m.chat.title ?? "").replace(/[^\w .-]/g, "").slice(0, 40)})`}. Reply in plain text, under 700 characters. You only read here: for a swap, a limit order or a payment, send them to https://stoadex.com/ai where their own wallet signs. Do not end with a NEXT line.`
    + (project ? `\n\n${await projectContext(project)}` : "")
    + "\n\nIn Telegram, do not paste links: a button under your reply opens Stoa.";
  await runAgent({
    history, wallet: null, extra, allow: (n) => PROJECT_TOOLS.has(n), maxTokens: 600,
    emit: (e) => {
      if (e.t === "text") text += e.d;
      else if (e.t === "card") { const c = cardText(e.kind, e.data); if (c) cards.push(c); }
      else if (e.t === "error") err = e.d;
    },
  });
  const body = text.split(/\n?\s*NEXT:/i)[0].trim();
  const out = [...cards, body ? tgHtml(body) : err ? tgHtml(err) : "I could not answer that. Try asking another way."].join("\n\n");
  const button = project ? { text: "Buy on Stoa ↗", url: `https://stoadex.com/trade?chain=robinhood&buy=${project}` } : { text: "Open Stoa AI ↗", url: "https://stoadex.com/ai" };
  await tgSend(chat, `${out.replace(/https?:\/\/\S+/g, (x) => (x.length > 40 ? "stoadex.com" : x))}\n\n<i>Not financial advice · ${u.left} left today</i>`, m.message_id, button);
}

async function handle(m: TgMsg) {
  const text = (m.text ?? "").trim();
  // an admin posting "anonymously" (as the group) arrives from Telegram's GroupAnonymousBot with sender_chat = the group
  const anonAdmin = m.sender_chat?.id === m.chat.id;
  if (!text || m.is_automatic_forward || (m.from?.is_bot && !anonAdmin)) return;
  const me = await tgMe();
  if (!me) return;
  const at = new RegExp(`@${me.username}\\b`, "i");
  const cmd = /^\/(\w+)(?:@(\w+))?\s*([\s\S]*)$/.exec(text);
  if (cmd && cmd[2] && cmd[2].toLowerCase() !== me.username.toLowerCase()) return; // a command for another bot
  const name = cmd?.[1].toLowerCase(), arg = (cmd?.[3] ?? "").trim();
  const priv = m.chat.type === "private";

  if (name === "start" || name === "help") { await tgSend(m.chat.id, HELP); return; }
  if (name === "watch" || name === "unwatch") {
    if (!priv) { await tgSend(m.chat.id, "Rug alerts are sent in a private chat: message me directly.", m.message_id); return; }
    if (!kvOn) { await tgSend(m.chat.id, "Rug alerts are not switched on yet. You can scan any time on stoadex.com/ai: \"Scan my tokens for rug signs\"."); return; }
    if (name === "unwatch") { await kv("DEL", `tg:watch:${m.chat.id}`); await kv("SREM", "tg:watchers", m.chat.id); await tgSend(m.chat.id, "Rug alerts stopped."); return; }
    if (!isAddress(arg, { strict: false })) { await tgSend(m.chat.id, "Send it like this: /watch 0xYourWalletAddress (the public address, never a seed phrase or private key)."); return; }
    if (((await kv<number>("SCARD", "tg:watchers")) ?? 0) >= 2000) { await tgSend(m.chat.id, "Rug alerts are full for now. Try again later."); return; }
    const w = getAddress(arg);
    await kv("SET", `tg:watch:${m.chat.id}`, w); await kv("SADD", "tg:watchers", m.chat.id);
    void tg("sendChatAction", { chat_id: m.chat.id, action: "typing" });
    const s = await rugScan(w).catch(() => null);
    await tgSend(m.chat.id, `👀 Watching <code>${w.slice(0, 6)}…${w.slice(-4)}</code>. I check every 10 minutes and message you when a token shows a new rug sign: the creator sending out supply, a crash, liquidity draining, a failing sell. Alerts are signals, not certainty. /unwatch to stop.\n\n${s ? rugText(s.tokens) : ""}`);
    return;
  }
  if (name === "settoken" || name === "cleartoken") {
    if (priv) { await tgSend(m.chat.id, "Add me to your project's group, then send /settoken 0xYourToken there."); return; }
    const st = anonAdmin ? { status: "administrator" } : await tg<{ status: string }>("getChatMember", { chat_id: m.chat.id, user_id: m.from?.id });
    if (!st || !["creator", "administrator"].includes(st.status)) { await tgSend(m.chat.id, "Only group admins can do that.", m.message_id); return; }
    if (!kvOn) { await tgSend(m.chat.id, "Project mode is not switched on yet. I still answer questions here.", m.message_id); return; }
    if (name === "cleartoken") { await kv("DEL", `tg:proj:${m.chat.id}`); await tgSend(m.chat.id, "Done: I'm back to general Robinhood Chain questions here."); return; }
    if (!isAddress(arg, { strict: false })) { await tgSend(m.chat.id, "Send it like this: /settoken 0xTokenAddress (on Robinhood Chain).", m.message_id); return; }
    const t = getAddress(arg);
    await kv("SET", `tg:proj:${m.chat.id}`, t);
    await tgSend(m.chat.id, `Done. In this group, "the token" now means <code>${t}</code>. Ask me anything about it: /ask is it safe? I answer from on-chain data only, never about the team's plans.`);
    return;
  }
  if (name === "price" || name === "gaps" || name === "pnl") {
    void tg("sendChatAction", { chat_id: m.chat.id, action: "typing" });
    let a = arg;
    if (name === "price" && !a && !priv) a = (await kv<string>("GET", `tg:proj:${m.chat.id}`)) ?? "";
    const out = name === "gaps" ? await gapsText() : name === "price" ? await priceText(a) : await pnlText(a);
    await tgSend(m.chat.id, out, m.message_id, { text: "Open Stoa ↗", url: name === "pnl" && isAddress(a, { strict: false }) ? `https://stoadex.com/pnl/robinhood/${getAddress(a)}` : name === "gaps" ? "https://stoadex.com/stocks" : "https://stoadex.com/ai" });
    return;
  }
  if (name === "report") {
    if (priv) { await tgSend(m.chat.id, "Add me to a group, then an admin sends /report on there."); return; }
    const st = anonAdmin ? { status: "administrator" } : await tg<{ status: string }>("getChatMember", { chat_id: m.chat.id, user_id: m.from?.id });
    if (!st || !["creator", "administrator"].includes(st.status)) { await tgSend(m.chat.id, "Only group admins can do that.", m.message_id); return; }
    if (!kvOn) { await tgSend(m.chat.id, "Reports are not switched on yet.", m.message_id); return; }
    if (/^off$/i.test(arg)) { await kv("SREM", "tg:report", m.chat.id); await tgSend(m.chat.id, "Market reports stopped here."); return; }
    await kv("SADD", "tg:report", m.chat.id);
    await tgSend(m.chat.id, "Done: a short market report here at 01:00 and 13:00 UTC (stock gaps, new Pons launches, $STOA). /report off to stop.");
    return;
  }
  let q: string | null = null;
  if (name === "ask" || name === "safe" || name === "quote") q = name === "safe" ? `Is ${arg || "STOA"} safe?` : name === "quote" ? `Quote ${arg}` : arg;
  else if (cmd) return; // an unknown command
  else if (priv) q = text;
  else if (at.test(text)) q = text.replace(at, "").trim();
  else if (m.reply_to_message?.from?.id === me.id) q = text;
  if (q === null) return;
  if (!q) { await tgSend(m.chat.id, "Ask me something after /ask, for example: /ask is STOA safe?", m.message_id); return; }
  await answer(m, q, me.id);
}

export async function POST(req: Request) {
  if (!tgOn) return Response.json({ error: "not switched on" }, { status: 503 });
  if (req.headers.get("x-telegram-bot-api-secret-token") !== tgSecret()) return Response.json({ error: "forbidden" }, { status: 403 });
  const u = (await req.json().catch(() => null)) as { message?: TgMsg } | null;
  // answer Telegram at once and do the work after, so a slow answer is never sent twice
  if (u?.message) after(() => handle(u.message!).catch(() => undefined));
  return Response.json({ ok: true });
}

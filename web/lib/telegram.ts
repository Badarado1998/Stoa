import "server-only";
import { createHash } from "node:crypto";

/** The Stoa AI Telegram bot (app/api/telegram). Needs TELEGRAM_BOT_TOKEN (from @BotFather), set in Vercel by the owner.
 *  The webhook's secret is derived from the token, so there is nothing else to set: Telegram sends it back on every
 *  update and app/api/telegram refuses anything without it. */
export const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
export const tgOn = !!TG_TOKEN;
export const tgSecret = () => createHash("sha256").update(`stoa-telegram-webhook:${TG_TOKEN}`).digest("hex").slice(0, 48);

export async function tg<T = unknown>(method: string, body: Record<string, unknown>): Promise<T | null> {
  if (!tgOn) return null;
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) }).catch(() => null);
  const j = (await r?.json().catch(() => null)) as { ok?: boolean; result?: T } | null;
  return j?.ok ? (j.result ?? null) : null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** the assistant's **bold** as Telegram HTML; everything else escaped */
export const tgHtml = (s: string) => esc(s.replace(/^#{1,6}\s+/gm, "")).split("**").map((p, i) => (i % 2 ? `<b>${p}</b>` : p)).join("");

export async function tgSend(chat: number | string, text: string, replyTo?: number, button?: { text: string; url: string }) {
  return tg("sendMessage", {
    chat_id: chat, text: text.slice(0, 4000), parse_mode: "HTML", link_preview_options: { is_disabled: true },
    ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
    ...(button ? { reply_markup: { inline_keyboard: [[button]] } } : {}),
  });
}

let me: { username: string; id: number } | null = null;
export async function tgMe() {
  if (!me) me = await tg<{ username: string; id: number }>("getMe", {});
  return me;
}

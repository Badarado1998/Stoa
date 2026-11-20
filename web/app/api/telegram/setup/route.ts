import { tg, tgMe, tgOn, tgSecret } from "@/lib/telegram";

// GET /api/telegram/setup: points the bot's webhook at https://stoadex.com/api/telegram (with the secret derived from
// its token) and sets its command menu. Safe to call any number of times by anyone: it always sets the same values.
export const dynamic = "force-dynamic";

export async function GET() {
  if (!tgOn) return Response.json({ ok: false, error: "TELEGRAM_BOT_TOKEN is not set in Vercel yet." }, { status: 503 });
  const hook = await tg("setWebhook", { url: "https://stoadex.com/api/telegram", secret_token: tgSecret(), allowed_updates: ["message"], drop_pending_updates: true, max_connections: 20 });
  const cmds = await tg("setMyCommands", { commands: [
    { command: "ask", description: "Ask Stoa AI anything about Robinhood Chain" },
    { command: "safe", description: "Safety check a token: /safe 0x… or a symbol" },
    { command: "quote", description: "Quote a swap: /quote 0.01 ETH to USDG" },
    { command: "watch", description: "Rug alerts for your wallet (private chat)" },
    { command: "unwatch", description: "Stop rug alerts" },
    { command: "settoken", description: "Admins: make me this project's assistant" },
    { command: "help", description: "What I can do" },
  ] });
  await tg("setMyShortDescription", { short_description: "Stoa AI (early beta): ask Robinhood Chain anything. Safety checks, quotes, stock gaps, rug alerts. Not financial advice." });
  const me = await tgMe();
  return Response.json({ ok: hook === true, webhook: hook === true, commands: cmds === true, bot: me ? `@${me.username}` : null });
}

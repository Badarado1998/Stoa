import { tg, tgMe, tgOn, tgSecret } from "@/lib/telegram";
import { cronAllowed, cronRefused } from "@/lib/cronAuth";

// GET /api/telegram/setup: points the bot's webhook at https://stoadex.com/api/telegram (with the secret derived from
// its token) and sets its command menu. Safe to call any number of times by anyone: it always sets the same values.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!cronAllowed(req)) return cronRefused();
  if (!tgOn) return Response.json({ ok: false, error: "TELEGRAM_BOT_TOKEN is not set in Vercel yet." }, { status: 503 });
  const hook = await tg("setWebhook", { url: "https://stoadex.com/api/telegram", secret_token: tgSecret(), allowed_updates: ["message"], drop_pending_updates: false, max_connections: 20 });
  const cmds = await tg("setMyCommands", { commands: [
    { command: "ask", description: "Ask Stoa AI anything about Robinhood Chain" },
    { command: "safe", description: "Safety check a token: /safe 0x… or a symbol" },
    { command: "quote", description: "Quote a swap: /quote 0.01 ETH to USDG" },
    { command: "watch", description: "Rug alerts for your wallet (private chat)" },
    { command: "unwatch", description: "Stop rug alerts" },
    { command: "price", description: "Price, 1h and 24h change: /price STOA" },
    { command: "gaps", description: "Stock tokens vs Robinhood's price" },
    { command: "pnl", description: "PnL of a wallet's swaps through Stoa: /pnl 0x…" },
    { command: "watchlist", description: "Your watchlist: /watchlist add NVDA STOA" },
    { command: "top", description: "Points leaderboard" },
    { command: "alert", description: "Price alert: /alert NVDA below 120 (private chat)" },
    { command: "alerts", description: "Your price alerts" },
    { command: "app", description: "Open Stoa inside Telegram" },
    { command: "settoken", description: "Admins: make me this project's assistant" },
    { command: "report", description: "Admins: market report here twice a day (/report on)" },
    { command: "help", description: "What I can do" },
  ] });
  // the menu button opens Stoa as a Telegram Mini App
  await tg("setChatMenuButton", { menu_button: { type: "web_app", text: "Open Stoa", web_app: { url: "https://stoadex.com/trade?chain=robinhood" } } });
  await tg("setMyName", { name: "Stoa AI" });
  await tg("setMyShortDescription", { short_description: "Ask Robinhood Chain anything: token safety checks, quotes, stock gaps, rug alerts. Early beta · stoadex.com/ai" });
  await tg("setMyDescription", { description: `Stoa AI is the assistant of Stoa, the swap router on Robinhood Chain. Early beta.

Ask in plain words, in any language:
• Is this token safe?
• Quote 0.01 ETH to USDG
• Which stock tokens are furthest from Robinhood?

/watch 0xYourWallet for rug alerts on your tokens.
Projects: add me to your group and send /settoken 0xYourToken.

I only read and never ask for keys or seed phrases. To trade, use stoadex.com/ai, where your own wallet signs. Not financial advice.` });
  const me = await tgMe();
  return Response.json({ ok: hook === true, webhook: hook === true, commands: cmds === true, bot: me ? `@${me.username}` : null });
}

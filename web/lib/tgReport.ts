import "server-only";
import { getAddress, isAddress, type Address } from "viem";
import { callTool as mcpCall } from "./mcpTools";
import { marketBrief } from "./aiBrief";
import { marketOf } from "./rugScan";
import { readPnl } from "./pnl";
import { ROBINHOOD } from "./networks";
import { resolveToken } from "./aiTools";
import { NATIVE } from "./tokens";
import { tgHtml } from "./telegram";
import { readRouterStats } from "./routerStats";
import { readSpotlight } from "./spotlightServer";

/** The Telegram bot's quick commands and its twice-daily market report: plain data, no AI, no quota. */
const STOA = "0x13E6993417616De724F2b337D65063f229e96718";
const usd = (v: number | null | undefined) => (v == null ? "—" : `$${v >= 1 ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : v.toPrecision(3)}`);
const pct = (v: number | null | undefined) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
const sc = (x: unknown) => (x as { structuredContent?: Record<string, unknown> })?.structuredContent;

export async function gapsText(n = 5): Promise<string> {
  const g = sc(await mcpCall("stock_gaps", { chain: "robinhood", limit: n }).catch(() => null));
  const rows = (g?.stocks as { symbol: string; gapPct: number; onChainPriceUsd: number; robinhoodPriceUsd: number }[] | undefined) ?? [];
  if (!rows.length) return "No stock token data right now.";
  return "📈 <b>Stock tokens vs Robinhood</b>\n" + rows.map((r) => `${tgHtml(r.symbol)} ${usd(r.onChainPriceUsd)} vs ${usd(r.robinhoodPriceUsd)} · <b>${r.gapPct >= 0 ? "+" : ""}${r.gapPct.toFixed(2)}%</b>`).join("\n")
    + "\n<i>A gap is information, not a trade signal.</i>";
}

export async function priceText(q: string): Promise<string> {
  const t = await resolveToken(q || "STOA");
  if (!t) return "I don't know that token. Send a symbol like STOA, NVDA, or a token address.";
  const a = t.address === NATIVE ? ROBINHOOD.wrapped : t.address;
  if (a.toLowerCase() === ROBINHOOD.stable.toLowerCase()) return `💲 <b>USDG</b> $1.00 (a dollar stablecoin)`;
  const m = (await marketOf([a]).catch(() => ({})) as Awaited<ReturnType<typeof marketOf>>)[a.toLowerCase()];
  if (!m) return `No market data for ${tgHtml(t.symbol)} right now.`;
  return `💲 <b>${tgHtml(t.symbol)}</b> ${usd(m.usd)}\n1h ${pct(m.ch1)} · 24h ${pct(m.ch24)} · liquidity ${usd(m.liq)}`;
}

export async function pnlText(w: string): Promise<string> {
  if (!isAddress(w, { strict: false })) return "Send it like this: /pnl 0xYourWalletAddress";
  const who = getAddress(w) as Address;
  const p = await readPnl(ROBINHOOD, who).catch(() => null);
  if (!p) return "I could not read that wallet right now. Try again in a minute.";
  if (!p.rows.length) return "No swaps through Stoa from this wallet yet. (PnL counts trades made through Stoa only.)";
  const u = (eth: number) => (p.gasUsd ? ` (${usd(eth * p.gasUsd)})` : "");
  const top = [...p.rows].sort((x, y) => Math.abs(y.realized + (y.unrealized ?? 0)) - Math.abs(x.realized + (x.unrealized ?? 0))).slice(0, 5);
  return `📊 <b>PnL</b> <code>${who.slice(0, 6)}…${who.slice(-4)}</code> · swaps through Stoa\n`
    + `Realized ${p.realized >= 0 ? "+" : ""}${p.realized.toFixed(4)} ETH${u(p.realized)}\nUnrealized ${p.unrealized >= 0 ? "+" : ""}${p.unrealized.toFixed(4)} ETH${u(p.unrealized)}\n\n`
    + top.map((r) => `${tgHtml(r.symbol)} ${(r.realized + (r.unrealized ?? 0)) >= 0 ? "+" : ""}${(r.realized + (r.unrealized ?? 0)).toFixed(4)} ETH${r.pnlPct != null ? ` (${pct(r.pnlPct)})` : ""}`).join("\n");
}

export async function reportText(): Promise<string> {
  const [b, stoa] = await Promise.all([
    marketBrief().catch(() => null) as Promise<{ stocks: { symbol: string; gapPct: number }[]; launches: { symbol: string; graduated: boolean; progress: number; mcapUsd: number }[]; spotlight: { phase: string; opensAt: string | null; candidates: number } | null } | null>,
    marketOf([STOA]).catch(() => ({} as Awaited<ReturnType<typeof marketOf>>)),
  ]);
  const s = stoa[STOA.toLowerCase()];
  const time = new Date().toISOString().slice(11, 16);
  const parts = [`☀️ <b>Robinhood Chain today</b> · ${time} UTC`];
  if (b?.stocks.length) parts.push("📈 <b>Furthest from Robinhood</b>\n" + b.stocks.map((x) => `${tgHtml(x.symbol)} ${x.gapPct >= 0 ? "+" : ""}${x.gapPct.toFixed(2)}%`).join(" · "));
  const launches = (b?.launches ?? []).filter((l, i, a) => l.mcapUsd > 0 && a.findIndex((x) => x.symbol === l.symbol) === i);
  if (launches.length) parts.push("🚀 <b>Newest on Pons</b>\n" + launches.map((l) => `${tgHtml(l.symbol)} · ${l.graduated ? "bonded" : `${Math.round(l.progress)}% curve`} · mcap ${usd(l.mcapUsd)}`).join("\n") + "\n<i>New launches are risky: /safe the address first.</i>");
  if (b?.spotlight?.opensAt && b.spotlight.phase === "before_week_1") parts.push(`🔦 <b>Spotlight</b> opens ${new Date(b.spotlight.opensAt).toUTCString().slice(0, 22)} UTC`);
  if (s) parts.push(`🏛 <b>$STOA</b> ${usd(s.usd)} · 24h ${pct(s.ch24)}`);
  parts.push("Ask me anything with /ask. Not financial advice.");
  return parts.join("\n\n");
}

/** Mondays: last week on Stoa in a few lines (swaps and volume on Robinhood Chain, the largest swap of the last day,
 *  last week's Spotlight winners) */
export async function weeklyText(): Promise<string> {
  const [st, spot] = await Promise.all([readRouterStats().catch(() => null), readSpotlight().catch(() => null)]);
  const parts = ["📅 <b>Last week on Stoa</b>"];
  if (st) {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const days = st.days.filter((d) => d.date > since);
    const swaps = days.reduce((a, d) => a + (d.chains.robinhood?.swaps ?? 0), 0);
    const vol = st.chains.find((c) => c.key === "robinhood")?.usd7d ?? days.reduce((a, d) => a + (d.chains.robinhood?.usd ?? 0), 0);
    parts.push(`Robinhood Chain: <b>${swaps.toLocaleString("en-US")} swaps</b> through Stoa, about <b>${usd(vol)}</b>`);
    const top = st.topBought24h?.filter((t) => t.chain === "robinhood").slice(0, 3) ?? [];
    if (top.length) parts.push(`Most bought (last 24h): ${top.map((t) => tgHtml(t.symbol)).join(", ")}`);
  }
  const w = (spot as { lastWeekWinners?: { symbol: string | null; token: string }[] } | null)?.lastWeekWinners ?? [];
  if (w.length) parts.push(`🔦 Spotlight winners: ${w.map((x) => tgHtml(x.symbol ?? x.token.slice(0, 8))).join(", ")}. Their voters can claim ETH on stoadex.com/spotlight`);
  return parts.join("\n");
}

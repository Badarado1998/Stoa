import "server-only";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createPublicClient, erc20Abi, formatUnits, getAddress, http, isAddress, parseUnits, type Address } from "viem";
import { apiQuote } from "./api";
import { ROBINHOOD } from "./networks";
import { NATIVE } from "./tokens";
import { srv } from "./serverRpc";
import { stockTokens } from "./stocks";
import { TOOLS as MCP_TOOLS, callTool as mcpCall } from "./mcpTools";
import { walletSnapshot } from "./aiBrief";
import { curveOf } from "./ponsLaunch";
import { rugScan } from "./rugScan";
import { LIMIT_ADDR, limitPaused } from "./limitServer";
import { prepareSpotlight } from "./aiSpotlight";
import { change, priced, WL_MAX, type WlItem } from "./aiWatchlist";

/** Tools for Stoa's AI assistant (app/api/ai/chat). Amounts are human ("0.01", "25"), tokens by symbol or address;
 *  everything resolves on Robinhood Chain. Transactions are only ever built, never signed or sent: the browser shows
 *  them on a card and the user's own wallet signs. The MCP tools that fit a chat are reused as they are. */

type Tok = { address: Address; symbol: string; decimals: number };
const STOA = "0x13E6993417616De724F2b337D65063f229e96718" as Address;
const lc = (s: string) => s.toLowerCase();
const rh = () => createPublicClient({ chain: ROBINHOOD.chain, transport: http(srv(ROBINHOOD.logsRpc)) });

export async function resolveToken(q: string): Promise<Tok | null> {
  const s = q.trim().replace(/^\$/, "");
  if (!s) return null;
  if (/^(eth|native)$/i.test(s)) return { address: NATIVE, symbol: "ETH", decimals: 18 };
  if (/^stoa$/i.test(s)) return { address: STOA, symbol: "STOA", decimals: 18 };
  if (isAddress(s, { strict: false })) {
    const a = getAddress(s);
    const known = ROBINHOOD.tokens.find((t) => lc(t.address) === lc(a));
    if (known) return { address: a, symbol: known.symbol, decimals: known.decimals };
    const c = rh();
    const [symbol, decimals] = await Promise.all([
      c.readContract({ address: a, abi: erc20Abi, functionName: "symbol" }).catch(() => null),
      c.readContract({ address: a, abi: erc20Abi, functionName: "decimals" }).catch(() => null),
    ]);
    return decimals === null ? null : { address: a, symbol: symbol ?? "token", decimals };
  }
  const core = ROBINHOOD.tokens.find((t) => lc(t.symbol) === lc(s));
  if (core) return { address: core.address, symbol: core.symbol, decimals: core.decimals };
  const { stocks } = await stockTokens().catch(() => ({ stocks: [] as { symbol: string; address: string }[] }));
  const st = stocks.find((x) => lc(x.symbol) === lc(s));
  return st ? { address: getAddress(st.address), symbol: st.symbol, decimals: 18 } : null;
}

const fmt = (v: bigint, d: number) => Number(formatUnits(v, d)).toLocaleString("en-US", { maximumFractionDigits: 6 });

async function swapLike(a: Record<string, unknown>, wallet: Address | null, build: boolean) {
  const [sell, buy] = await Promise.all([resolveToken(String(a.sell ?? "")), resolveToken(String(a.buy ?? ""))]);
  if (!sell || !buy) return { error: `Unknown token: ${!sell ? a.sell : a.buy}. Use find_token, or a token address.` };
  let amount: bigint;
  try { amount = parseUnits(String(a.amount ?? ""), sell.decimals); } catch { return { error: "amount must be a number, like 0.01" }; }
  if (amount <= 0n) return { error: "amount must be above 0" };
  if (build && !wallet) return { error: "No wallet connected. Ask the user to connect a wallet first." };
  const slip = Math.round(Math.min(5, Math.max(0.1, Number(a.slippagePct ?? 0.5))) * 100);
  const r = await apiQuote({
    chain: "robinhood", sellToken: sell.address === NATIVE ? "native" : sell.address, buyToken: buy.address === NATIVE ? "native" : buy.address,
    amount: amount.toString(), slippageBps: String(slip), taker: build ? wallet! : undefined, deadlineSeconds: build ? "600" : undefined,
  });
  const j = (await r.json()) as Record<string, unknown> & { amountOut?: string; minOut?: string; priceImpactPct?: number | null; route?: { legs: { name: string | null }[] }; error?: string };
  if (!r.ok) return { error: j.error ?? "No route right now" };
  const summary = {
    sell: { symbol: sell.symbol, address: sell.address, amount: fmt(amount, sell.decimals) },
    buy: { symbol: buy.symbol, address: buy.address, about: fmt(BigInt(j.amountOut!), buy.decimals), atLeast: fmt(BigInt(j.minOut!), buy.decimals) },
    priceImpactPct: j.priceImpactPct, route: (j.route?.legs ?? []).map((l) => l.name ?? "venue").join(" → "), slippagePct: slip / 100,
  };
  return build ? { summary, tx: j.tx, approval: j.approval ?? null, chainId: ROBINHOOD.chain.id, note: "Shown to the user as a card with a Sign button; their wallet signs it." } : { summary };
}

/** "buy NVDA if it drops 5%" / "sell STOA if it rises 20%" as a StoaLimit order: deposit `amount` of `sell`, receive at
 *  least `minOut` of `buy`, filled by Stoa's keeper once the market pays it. Only a better price than now: a limit
 *  order that fills at a worse price would fill at once, so it can never be a stop-loss. */
async function limitOrder(a: Record<string, unknown>, wallet: Address | null) {
  if (!LIMIT_ADDR) return { error: "Limit orders are not live on Robinhood Chain." };
  if (!wallet) return { error: "No wallet connected. Ask the user to connect a wallet first." };
  const [sell, buy] = await Promise.all([resolveToken(String(a.sell ?? "")), resolveToken(String(a.buy ?? ""))]);
  if (!sell || !buy) return { error: `Unknown token: ${!sell ? a.sell : a.buy}. Use find_token, or a token address.` };
  if (lc(sell.address) === lc(buy.address)) return { error: "Pick two different tokens." };
  let amount: bigint;
  try { amount = parseUnits(String(a.amount ?? ""), sell.decimals); } catch { return { error: "amount must be a number, like 100" }; }
  if (amount <= 0n) return { error: "amount must be above 0" };
  const when = String(a.when ?? ""), pct = Number(a.pct);
  if (when !== "buy_price_drops" && when !== "sell_price_rises") return { error: 'when must be "buy_price_drops" or "sell_price_rises". A stop-loss ("sell if it drops") is not possible with a limit order.' };
  if (!(pct > 0) || pct > (when === "buy_price_drops" ? 90 : 1000)) return { error: when === "buy_price_drops" ? "pct must be between 0 and 90" : "pct must be between 0 and 1000" };
  const days = [1, 7, 30].includes(Number(a.expiryDays)) ? Number(a.expiryDays) : 7;
  if (await limitPaused()) return { error: "Limit orders are paused for safety right now. Swaps still work." };
  const r = await apiQuote({ chain: "robinhood", sellToken: sell.address === NATIVE ? "native" : sell.address, buyToken: buy.address === NATIVE ? "native" : buy.address, amount: amount.toString(), slippageBps: "50" });
  const j = (await r.json()) as { amountOut?: string; error?: string };
  if (!r.ok || !j.amountOut) return { error: j.error ?? "No route right now, so there is no market price to start from." };
  const now = BigInt(j.amountOut);
  // buy_price_drops X%: the buy token costs (1 - X) as much, so the same deposit buys 1 / (1 - X) times as many
  const minOut = when === "buy_price_drops" ? (now * 1_000_000n) / BigInt(Math.round((1 - pct / 100) * 1_000_000)) : (now * BigInt(Math.round((1 + pct / 100) * 1_000_000))) / 1_000_000n;
  const price = (out: bigint) => Number(formatUnits(amount, sell.decimals)) / Number(formatUnits(out, buy.decimals));
  return {
    summary: {
      sell: { symbol: sell.symbol, address: sell.address, decimals: sell.decimals, amount: fmt(amount, sell.decimals) },
      buy: { symbol: buy.symbol, address: buy.address, decimals: buy.decimals, now: fmt(now, buy.decimals), atLeast: fmt(minOut, buy.decimals) },
      when, pct, expiryDays: days,
      // what one buy token costs in sell tokens now, and at the order's price
      priceNow: price(now), priceAt: price(minOut),
    },
    order: { limit: LIMIT_ADDR, tokenIn: sell.address, tokenOut: buy.address, amountIn: amount.toString(), minOut: minOut.toString(), expirySeconds: days * 86_400 },
    chainId: ROBINHOOD.chain.id,
    note: "Shown to the user as a card with a Place order button; their wallet signs. Stoa's keeper checks about every 5 minutes and fills it once the market pays at least minOut; it can be cancelled any time on the Trade page.",
  };
}

let DOCS: { slug: string; title: string; text: string }[] | null = null;
function docs() {
  if (DOCS) return DOCS;
  const dir = path.join(process.cwd(), "content", "docs");
  DOCS = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "SUMMARY.md").map((f) => {
    const text = readFileSync(path.join(dir, f), "utf8");
    return { slug: f.replace(/\.md$/, ""), title: (/^#\s+(.+)/m.exec(text)?.[1] ?? f).trim(), text };
  });
  return DOCS;
}
function searchDocs(q: string) {
  const words = q.toLowerCase().split(/[^a-z0-9$]+/).filter((w) => w.length > 2);
  const scored = docs().map((d) => {
    const t = d.text.toLowerCase();
    const score = words.reduce((s, w) => s + (d.title.toLowerCase().includes(w) ? 5 : 0) + Math.min(5, t.split(w).length - 1), 0);
    return { d, score };
  }).filter((x) => x.score > 0).sort((x, y) => y.score - x.score).slice(0, 3);
  return scored.map(({ d }) => {
    const t = d.text, i = Math.max(0, words.map((w) => t.toLowerCase().indexOf(w)).filter((x) => x >= 0).sort((x, y) => x - y)[0] ?? 0);
    return { title: d.title, url: `https://stoadex.com/docs/${d.slug}`, excerpt: t.slice(Math.max(0, i - 200), i + 1200) };
  });
}

const tokenArg = (d: string) => ({ type: "string", description: `${d}: a symbol like ETH, USDG, TSLA, NVDA, STOA, or a token address on Robinhood Chain.` });
const OWN = [
  { name: "find_token", description: "Look up a token on Robinhood Chain by symbol or address: its address, symbol and decimals. Listed is not reviewed; run safety_check before a buy.", parameters: { type: "object", required: ["query"], properties: { query: { type: "string" } } } },
  { name: "quote", description: "Quote a swap on Robinhood Chain through Stoa's router, which compares every venue it routes: about how much comes out, at least how much (after slippage), price impact and route. Read-only.", parameters: { type: "object", required: ["sell", "buy", "amount"], properties: { sell: tokenArg("Token to sell"), buy: tokenArg("Token to buy"), amount: { type: "string", description: "Amount to sell, in whole tokens, e.g. \"0.01\" or \"25\"." }, slippagePct: { type: "number", description: "Max slippage in percent. Default 0.5." } } } },
  { name: "prepare_swap", description: "Build the swap for the user's connected wallet, after a quote. It is shown to the user as a card with a Sign button: nothing happens until their wallet signs. Use when the user asks to swap, buy or sell.", parameters: { type: "object", required: ["sell", "buy", "amount"], properties: { sell: tokenArg("Token to sell"), buy: tokenArg("Token to buy"), amount: { type: "string", description: "Amount to sell, in whole tokens." }, slippagePct: { type: "number", description: "Max slippage in percent. Default 0.5." } } } },
  { name: "prepare_limit_order", description: "Turn a price strategy into a limit order for the connected wallet, e.g. \"buy NVDA with 100 USDG if it drops 5%\" (sell USDG, buy NVDA, when buy_price_drops, pct 5) or \"sell 1000 STOA for ETH if it goes up 20%\" (sell STOA, buy ETH, when sell_price_rises, pct 20). The deposit waits in Stoa's limit order contract; Stoa's keeper fills it once the market pays the price. It only works for a better price than now: it cannot be a stop-loss. Shown as a card the user signs.", parameters: { type: "object", required: ["sell", "buy", "amount", "when", "pct"], properties: { sell: tokenArg("Token deposited (paid)"), buy: tokenArg("Token received"), amount: { type: "string", description: "Amount of the sell token, in whole tokens." }, when: { type: "string", enum: ["buy_price_drops", "sell_price_rises"], description: "buy_price_drops: fill when the buy token gets pct% cheaper. sell_price_rises: fill when the sell token is worth pct% more." }, pct: { type: "number", description: "The move in percent, e.g. 5." }, expiryDays: { type: "number", enum: [1, 7, 30], description: "Default 7." } } } },
  { name: "prepare_spotlight", description: "Spotlight, as a card the connected wallet signs: action \"lock\" locks $STOA so it can vote (amount, or \"all\"); action \"vote\" sets this week's votes for one candidate token (token address from the spotlight tool; amount of locked $STOA, or \"all\" for everything not voting elsewhere). Earlier votes for other candidates are kept. Voters of the winning tokens share their ETH bids.", parameters: { type: "object", required: ["action"], properties: { action: { type: "string", enum: ["lock", "vote"] }, amount: { type: "string", description: "$STOA in whole tokens, or \"all\"." }, token: { type: "string", description: "For vote: the candidate's token address." } } } },
  { name: "watchlist", description: "The user's watchlist (up to 20 tokens) with prices now. action \"show\" lists it; \"add\" and \"remove\" change it (tokens: symbols or addresses). It is kept for the user and shown when they come back.", parameters: { type: "object", required: ["action"], properties: { action: { type: "string", enum: ["show", "add", "remove"] }, tokens: { type: "array", items: { type: "string" }, description: "For add or remove: symbols like NVDA, STOA, or addresses." } } } },
  { name: "rug_scan", description: "Scan the connected wallet's tokens (other than ETH, WETH, USDG and stock tokens) for signs of a rug pull right now: safety verdict, a failing test sell, the creator wallet sending out supply in the last 6 hours, a price crash in the last hour or day, very low liquidity. Read-only.", parameters: { type: "object", properties: {} } },
  { name: "my_wallet", description: "The connected wallet's holdings on Robinhood Chain: each token, amount, USD value, 24h change, and Stoa's safety verdict for the larger tokens other than ETH, WETH and USDG.", parameters: { type: "object", properties: {} } },
  { name: "search_docs", description: "Search Stoa's docs (fees, bridging, limit orders, Spotlight, Rug Cover, $STOA, Stoa Pay, API, safety). Returns excerpts with links.", parameters: { type: "object", required: ["query"], properties: { query: { type: "string" } } } },
];
const FROM_MCP = ["safety_check", "stock_tokens", "stock_gaps", "spotlight", "market_context", "create_payment_link", "pay_payment_link", "payment_status"];

export const AI_TOOLS = [
  ...OWN.map((t) => ({ type: "function" as const, function: t })),
  ...MCP_TOOLS.filter((t) => FROM_MCP.includes(t.name)).map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.inputSchema } })),
];

export type AiCtx = { watchlist?: WlItem[] };

/** Runs a tool for the assistant. `wallet` is the user's connected address: swaps and payments are built for it only.
 *  `ctx` carries what the surface keeps for the user (the web's watchlist). */
export async function runAiTool(name: string, a: Record<string, unknown>, wallet: Address | null, ctx: AiCtx = {}): Promise<unknown> {
  switch (name) {
    case "watchlist": {
      const act = String(a.action ?? "show"), toks = Array.isArray(a.tokens) ? a.tokens.map(String).slice(0, 20) : [];
      let list = ctx.watchlist ?? [], unknown: string[] = [];
      if (act === "add" || act === "remove") ({ list, unknown } = await change(list, act === "add" ? toks : [], act === "remove" ? toks : []));
      return { list: await priced(list), saved: act !== "show", unknown, max: WL_MAX };
    }
    case "find_token": { const t = await resolveToken(String(a.query ?? "")); return t ?? { error: "not found" }; }
    case "quote": return swapLike(a, wallet, false);
    case "prepare_swap": return swapLike(a, wallet, true);
    case "search_docs": return searchDocs(String(a.query ?? ""));
    case "prepare_limit_order": return limitOrder(a, wallet);
    case "prepare_spotlight": return prepareSpotlight(a, wallet);
    case "rug_scan": return wallet ? rugScan(wallet) : { error: "No wallet connected. Ask the user to connect a wallet first." };
    case "my_wallet": return wallet ? walletSnapshot(wallet) : { error: "No wallet connected. Ask the user to connect a wallet first." };
  }
  if (!FROM_MCP.includes(name)) return { error: `unknown tool ${name}` };
  const args = { ...a };
  if (name === "safety_check" || name === "stock_tokens" || name === "stock_gaps") args.chain = "robinhood";
  if (name === "pay_payment_link") {
    if (!wallet) return { error: "No wallet connected. Ask the user to connect a wallet first." };
    args.payer = wallet;
    if (typeof args.payWith === "string") { const t = await resolveToken(args.payWith); if (t) args.payWith = t.address === NATIVE ? "native" : t.address; }
  }
  if (name === "safety_check" && typeof args.token === "string" && !isAddress(args.token, { strict: false })) {
    const t = await resolveToken(args.token);
    if (!t || t.address === NATIVE) return { error: "safety_check needs a token address" };
    args.token = t.address;
  }
  const out = await mcpCall(name, args) as { structuredContent?: unknown; content?: { text: string }[]; isError?: boolean } | null;
  if (!out) return { error: "tool failed" };
  const res = out.structuredContent ?? out.content?.[0]?.text ?? null;
  // a Pons launch trades in pools that charge 2.8% on each buy and sell: a ~5.6% round trip is that fee, not thin liquidity
  if (name === "safety_check" && res && typeof res === "object" && typeof args.token === "string") {
    const curve = await curveOf(getAddress(args.token)).catch(() => null);
    if (curve) (res as Record<string, unknown>).poolFee = "Launched on Pons: its pools charge a 2.8% Pons fee on every buy and every sell, so the test round trip loses about 5.6% from that fee alone. Do not call that thin liquidity.";
  }
  return res;
}

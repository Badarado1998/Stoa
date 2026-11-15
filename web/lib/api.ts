import "server-only";
import { createPublicClient, encodeFunctionData, getAddress, http, isAddress, type Address } from "viem";
import { netByKey, type Net } from "./networks";
import { routerAbi } from "./abi";
import { NATIVE } from "./tokens";

/** Stoa's public API for bots and apps (/api/v1/*): the router's best route for an amount, the minimum the swap accepts,
 *  and ready-to-send calldata. Same router, same 2 bps fee and same referrer share as the app. No key; soft rate limit. */

const ua = { fetchOptions: { headers: { "user-agent": "curl/8.5.0" } }, timeout: 12_000 };
const lc = (a: string) => a.toLowerCase();
export const API_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "no-store",
} as const;

export function apiError(status: number, error: string, extra: Record<string, unknown> = {}) {
  return Response.json({ error, ...extra }, { status, headers: API_HEADERS });
}

/** 60 requests a minute per IP, per server instance: enough for a bot, a brake on abuse. */
const hits = new Map<string, number[]>();
export function limited(req: Request): Response | null {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
  const now = Date.now(), win = hits.get(ip)?.filter((t) => now - t < 60_000) ?? [];
  if (win.length >= 60) return apiError(429, "Too many requests: at most 60 a minute. Try again shortly.", { retryAfterSeconds: Math.ceil((60_000 - (now - win[0])) / 1000) });
  win.push(now); hits.set(ip, win);
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v[v.length - 1] > 60_000) hits.delete(k);
  return null;
}

const venueName = (net: Net, v: string) => (lc(v) === lc(NATIVE) ? null : net.contracts.pool && lc(v) === lc(net.contracts.pool) ? "Stoa maker pool" : net.venues[lc(v)] ?? "venue");

export type QuoteInput = { chain: string; sellToken: string; buyToken: string; amount: string; slippageBps?: string; taker?: string; referrer?: string; deadlineSeconds?: string };

export async function apiQuote(p: QuoteInput) {
  const net = netByKey(p.chain);
  if (!net || !net.contracts.router || !net.deployed) return apiError(400, "chain must be robinhood or elysium");
  const tok = (v: string) => (v === "native" || v === "ETH" || v === "HYPE" ? NATIVE : isAddress(v, { strict: false }) ? getAddress(v) : null);
  const sell = tok(p.sellToken ?? ""), buy = tok(p.buyToken ?? "");
  if (!sell || !buy) return apiError(400, "sellToken and buyToken must be token addresses, or native for the gas token");
  if (lc(sell) === lc(buy)) return apiError(400, "sellToken and buyToken are the same");
  const pair = [lc(sell), lc(buy)];
  if (pair.includes(lc(NATIVE)) && pair.includes(lc(net.wrapped))) return apiError(400, `Wrapping and unwrapping ${net.gas} are not swaps: call the wrapped token's deposit or withdraw directly`);
  if (!/^\d{1,78}$/.test(p.amount ?? "") || BigInt(p.amount) === 0n) return apiError(400, "amount must be a positive integer in the sell token's smallest unit (wei)");
  const amountIn = BigInt(p.amount);
  const slip = p.slippageBps === undefined ? 50 : Number(p.slippageBps);
  if (!Number.isInteger(slip) || slip < 0 || slip > 5000) return apiError(400, "slippageBps must be an integer from 0 to 5000");
  const dl = p.deadlineSeconds === undefined ? 120 : Number(p.deadlineSeconds);
  if (!Number.isInteger(dl) || dl < 15 || dl > 1800) return apiError(400, "deadlineSeconds must be from 15 to 1800");
  const taker = p.taker ? (isAddress(p.taker, { strict: false }) ? getAddress(p.taker) : null) : undefined;
  if (taker === null) return apiError(400, "taker must be an address");
  const referrer = p.referrer ? (isAddress(p.referrer, { strict: false }) ? getAddress(p.referrer) : null) : undefined;
  if (referrer === null) return apiError(400, "referrer must be an address");

  const router = net.contracts.router;
  const c = createPublicClient({ chain: net.chain, transport: http(net.logsRpc, ua) });
  const q = (a: bigint) => c.simulateContract({ address: router, abi: routerAbi, functionName: "quote", args: [sell, buy, a] });
  const small = amountIn / 1000n > 0n ? amountIn / 1000n : 1n;
  let route: { amountOut: bigint; mid: Address; leg1: { venue: Address; isPool: boolean }; leg2: { venue: Address; isPool: boolean } };
  let ref: bigint = 0n;
  try {
    const [a, b] = await Promise.all([q(amountIn), q(small).catch(() => null)]);
    route = a.result as typeof route;
    ref = (b?.result as typeof route | undefined)?.amountOut ?? 0n;
  } catch { return apiError(422, "No route for this pair and amount right now"); }
  if (!route.amountOut || lc(route.leg1.venue) === lc(NATIVE)) return apiError(422, "No route for this pair and amount right now");
  const minOut = (route.amountOut * BigInt(10_000 - slip)) / 10_000n;
  const impact = ref > 0n ? Math.max(0, (1 - (Number(route.amountOut) / Number(amountIn)) / (Number(ref) / Number(small))) * 100) : null;
  const now = Math.floor(Date.now() / 1000);
  const hop = lc(route.mid) !== lc(NATIVE);

  const body: Record<string, unknown> = {
    chain: net.key, chainId: net.chain.id, router,
    sellToken: sell, buyToken: buy, amountIn: amountIn.toString(), amountOut: route.amountOut.toString(), minOut: minOut.toString(), slippageBps: slip,
    priceImpactPct: impact === null ? null : Number(impact.toFixed(4)),
    route: {
      mid: hop ? route.mid : null,
      legs: [route.leg1, ...(hop ? [route.leg2] : [])].map((l) => ({ venue: l.venue, isPool: l.isPool, name: venueName(net, l.venue) })),
    },
    fee: { protocolBps: 2, note: "already deducted from amountOut; referrers earn 10% of it" },
    quotedAt: now,
    validForSeconds: net.makers ? 4 : 30,
  };
  if (taker) {
    const params = {
      tokenIn: sell, tokenOut: buy, mid: route.mid, leg1: route.leg1, leg2: route.leg2,
      amountIn, minOut, to: taker, deadline: BigInt(now + dl), referrer: referrer ?? NATIVE,
    };
    body.tx = {
      to: router, chainId: net.chain.id, value: lc(sell) === lc(NATIVE) ? amountIn.toString() : "0",
      data: encodeFunctionData({ abi: routerAbi, functionName: "swap", args: [params] }),
    };
    body.deadline = now + dl;
    if (lc(sell) !== lc(NATIVE)) body.approval = { token: sell, spender: router, amount: amountIn.toString() };
  }
  return Response.json(body, { headers: API_HEADERS });
}

import "server-only";
import { unstable_cache } from "next/cache";
import { createPublicClient, erc20Abi, getAddress, http, isAddress, type Address } from "viem";
import { netByKey, type Net } from "./networks";
import { NATIVE } from "./tokens";
import { findListed } from "./tokenInfo";
import { readLaunch } from "./ponsLaunch";
import { stockTokens, shortName } from "./stocks";
import { srv } from "./serverRpc";
import { readSafety } from "./safety";

/** tokens whose embed cards Stoa has switched off: they show a plain notice instead of a price or a button. Lowercase. */
export const EMBED_OFF = new Set(["0xcaeed5281bd1eeb26d5f8bd550bf5c3727ba6514"]); // $NOUNY, integration ended 18 Nov 2026

export type WidgetToken = { address: Address | "native"; symbol: string; name: string; decimals: number; logo: string | null };
export type WidgetBuy = WidgetToken & { address: Address; kind: "listed" | "stock" | "launch" | "routed" };

const lc = (a: string) => a.toLowerCase();

/** what a visitor can pay with in the swap widget: the gas token and the network's main stablecoin */
export function payOptions(net: Net): WidgetToken[] {
  const g = net.tokens.find((t) => t.address === NATIVE);
  const s = net.tokens.find((t) => lc(t.address) === lc(net.stable));
  return [
    { address: "native", symbol: g?.symbol ?? net.gas, name: net.gas, decimals: 18, logo: g?.logo ?? null },
    ...(s ? [{ address: s.address, symbol: s.symbol, name: s.name, decimals: s.decimals, logo: s.logo ?? null }] : []),
  ];
}

async function decimalsOf(net: Net, token: Address): Promise<number> {
  const c = createPublicClient({ chain: net.chain, transport: http(srv(net.chain.rpcUrls.default.http[0]), { timeout: 10_000 }) });
  return Number(await c.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }));
}

/** the tokens the swap widget may sell: a token listed on Stoa (or $STOA), a Robinhood Stock Token Stoa routes, a Pons
 *  launch Stoa routes, or (Robinhood Chain) any other token Stoa's router routes whose safety check passes: a simulated
 *  buy and sell-back that works with no hidden tax. Anything else gets no widget, so the card is never a stamp on a
 *  token nobody can trade here, or one that cannot be sold. */
async function resolve(chain: string, token: string): Promise<WidgetBuy | null> {
  const net = netByKey(chain);
  if (!net || !isAddress(token, { strict: false }) || EMBED_OFF.has(lc(token))) return null;
  const listed = findListed(chain, token);
  if (listed) {
    const t = listed.token;
    return { address: getAddress(t.address), symbol: t.symbol, name: t.name, decimals: t.decimals, logo: t.logo ?? null, kind: "listed" };
  }
  if (net.key !== "robinhood") return null;
  const stocks = (await stockTokens().catch(() => null))?.stocks ?? [];
  const s = stocks.find((x) => lc(x.address) === lc(token));
  if (s) {
    if (!s.route) return null;
    const decimals = await decimalsOf(net, getAddress(s.address)).catch(() => 18);
    return { address: getAddress(s.address), symbol: s.symbol, name: shortName(s.name), decimals, logo: s.logo, kind: "stock" };
  }
  const l = await readLaunch(getAddress(token)).catch(() => null);
  if (l) {
    if (!l.routable) return null;
    const decimals = await decimalsOf(net, getAddress(token)).catch(() => 18);
    return { address: getAddress(token), symbol: l.symbol, name: `${l.name} · Pons launch`, decimals, logo: l.logo, kind: "launch" };
  }
  // any other token: the safety check buys and sells it back through Stoa's router, so "ok" means it routes both ways
  const safe = await readSafety(net, getAddress(token)).catch(() => null);
  if (!safe || safe.verdict !== "ok" || !safe.test?.buyOk || !safe.test.sellOk) return null;
  const c = createPublicClient({ chain: net.chain, transport: http(srv(net.chain.rpcUrls.default.http[0]), { timeout: 10_000 }) });
  const [name, decimals] = await Promise.all([
    c.readContract({ address: getAddress(token), abi: erc20Abi, functionName: "name" }).catch(() => safe.symbol),
    decimalsOf(net, getAddress(token)).catch(() => 18),
  ]);
  return { address: getAddress(token), symbol: safe.symbol, name: String(name).replace(/[<>]/g, "").slice(0, 40), decimals, logo: null, kind: "routed" };
}

/** cached ten minutes per token: the list and the routes change slowly, and the widget re-quotes live anyway */
export const widgetToken = (chain: string, token: string) =>
  unstable_cache(() => resolve(chain, token), ["embed-widget-token", chain, lc(token)], { revalidate: 600 })();

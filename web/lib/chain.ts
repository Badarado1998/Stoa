import deployment from "./deployments.json";
import { defineChain, type Address } from "viem";

const id = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 99901);
/** One or more RPC URLs, comma-separated; the first is primary, the rest are fallbacks. */
export const RPCS = (process.env.NEXT_PUBLIC_RPC_URL || "").split(",").map((s) => s.trim()).filter(Boolean);
// Kinetiq's Elysium explorer (mainnet, chain 99901): /tx/<hash>, /address/<addr>
const explorer = process.env.NEXT_PUBLIC_EXPLORER_URL || (id === 99901 ? "https://elysium.kinetiq.xyz" : "");

export const elysium = defineChain({
  id,
  name: id === 99901 ? "Elysium" : `Local ${id}`,
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: RPCS } },
  blockExplorers: explorer ? { default: { name: "Explorer", url: explorer } } : undefined,
});

const addr = (v?: string) => (v && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as Address) : undefined);

// Written by the "Deploy contracts" workflow; env vars override it (local testing).
const D = deployment as Partial<
  Record<"router" | "poolWhypeUsdc" | "feeDistributor" | "uniswapV2Adapter" | "uniswapV3Adapter", string>
>;

export const CONTRACTS = {
  router: addr(process.env.NEXT_PUBLIC_ROUTER) ?? addr(D.router),
  pool: addr(process.env.NEXT_PUBLIC_POOL_WHYPE_USDC) ?? addr(D.poolWhypeUsdc),
  fees: addr(process.env.NEXT_PUBLIC_FEE_DISTRIBUTOR) ?? addr(D.feeDistributor),
};
export const deployed = Boolean(CONTRACTS.router);

/** Display names for fallback venues the router may use, keyed by lowercase adapter address. */
export const VENUE_NAMES: Record<string, string> = Object.fromEntries(
  ([
    [addr(process.env.NEXT_PUBLIC_UNIV2_ADAPTER) ?? addr(D.uniswapV2Adapter), "Uniswap V2"],
    [addr(process.env.NEXT_PUBLIC_UNIV3_ADAPTER) ?? addr(D.uniswapV3Adapter), "Uniswap V3"],
  ] as const)
    .filter(([a]) => a)
    .map(([a, n]) => [a!.toLowerCase(), n]),
);
export const CA = addr(process.env.NEXT_PUBLIC_CA);
export const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://stoa.trade";

export const txUrl = (hash: string) => (explorer ? `${explorer.replace(/\/$/, "")}/tx/${hash}` : undefined);
export const addressUrl = (a: string) => (explorer ? `${explorer.replace(/\/$/, "")}/address/${a}` : undefined);

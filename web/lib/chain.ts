import { defineChain, type Address } from "viem";

const id = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 99901);
const rpc = process.env.NEXT_PUBLIC_RPC_URL || "";
const explorer = process.env.NEXT_PUBLIC_EXPLORER_URL || "";

export const elysium = defineChain({
  id,
  name: id === 99901 ? "Elysium" : `Local ${id}`,
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: rpc ? [rpc] : [] } },
  blockExplorers: explorer ? { default: { name: "Explorer", url: explorer } } : undefined,
});

const addr = (v?: string) => (v && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as Address) : undefined);

export const CONTRACTS = {
  router: addr(process.env.NEXT_PUBLIC_ROUTER),
  pool: addr(process.env.NEXT_PUBLIC_POOL_WHYPE_USDC),
  fees: addr(process.env.NEXT_PUBLIC_FEE_DISTRIBUTOR),
};
export const deployed = Boolean(CONTRACTS.router);
export const CA = addr(process.env.NEXT_PUBLIC_CA);
export const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://stoa.trade";

export const txUrl = (hash: string) => (explorer ? `${explorer.replace(/\/$/, "")}/tx/${hash}` : undefined);

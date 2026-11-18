import { arbitrum, base, bsc, mainnet, optimism } from "viem/chains";
import type { Address, Chain } from "viem";

/** Bridge in: move ETH or stablecoins from another chain to Robinhood Chain through LI.FI, which compares bridges
 *  (Across, Relay, Stargate, Layerswap and more) and returns one ready transaction. Quotes come straight from LI.FI's
 *  public API in the browser (no key). The user signs in their own wallet on the source chain and the funds arrive in
 *  the same address on Robinhood Chain. Stoa never holds the funds and adds no fee. */

export const LIFI = "https://li.quest/v1";
/** LI.FI's contract (the same address on every chain). A quote that asks to send anywhere else is refused. */
export const LIFI_DIAMOND = "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE" as Address;
export const NATIVE_ZERO = "0x0000000000000000000000000000000000000000" as Address;
export const DST_CHAIN_ID = 4663;

export interface BridgeToken { symbol: string; address: Address; decimals: number }
export interface BridgeSource { key: string; name: string; chain: Chain; tokens: BridgeToken[] }

const ETH: BridgeToken = { symbol: "ETH", address: NATIVE_ZERO, decimals: 18 };

/** Source chains and tokens, each quoted into Robinhood Chain through LI.FI on 18 Nov 2026. */
export const SOURCES: BridgeSource[] = [
  { key: "base", name: "Base", chain: base, tokens: [ETH, { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 }] },
  { key: "arbitrum", name: "Arbitrum", chain: arbitrum, tokens: [ETH, { symbol: "USDC", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 }, { symbol: "USDT0", address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6 }] },
  { key: "ethereum", name: "Ethereum", chain: mainnet, tokens: [ETH, { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 }, { symbol: "USDT", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 }] },
  { key: "optimism", name: "Optimism", chain: optimism, tokens: [ETH, { symbol: "USDC", address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6 }] },
  { key: "bsc", name: "BNB Chain", chain: bsc, tokens: [{ symbol: "USDT", address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 }, { symbol: "USDC", address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18 }] },
];

/** What can arrive on Robinhood Chain: ETH for gas and swaps, USDG for stock tokens. */
export const DESTS: BridgeToken[] = [ETH, { symbol: "USDG", address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", decimals: 6 }];

/** Ethereum USDT needs its allowance set to 0 before a new non-zero value. */
export const USDT_MAINNET = "0xdAC17F958D2ee523a2206206994597C13D831ec7" as Address;

export const sameAddr = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** The parts of a LI.FI quote this page uses. */
export interface LifiQuote {
  tool: string;
  toolDetails?: { name?: string };
  estimate: {
    toAmount: string; toAmountMin: string; approvalAddress: Address; executionDuration?: number;
    fromAmountUSD?: string; toAmountUSD?: string;
    feeCosts?: { name: string; amountUSD?: string; included?: boolean }[];
    gasCosts?: { amountUSD?: string }[];
  };
  transactionRequest: { to: Address; data: `0x${string}`; value?: string; gasLimit?: string; chainId: number; from?: Address };
}

export type LifiStatus = "NOT_FOUND" | "INVALID" | "PENDING" | "DONE" | "FAILED";

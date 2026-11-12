import type { Address } from "viem";
import popular from "./popular-tokens.json";

export const NATIVE = "0x0000000000000000000000000000000000000000" as Address;

export interface Token {
  symbol: string;
  name: string;
  address: Address; // NATIVE for HYPE
  decimals: number;
  glyph: string;
  tone: "native" | "hype" | "usd" | "other";
  /** official icon (served from /public/tokens); letters are used when missing */
  logo?: string;
}

/** Canonical Elysium tokens (from Kinetiq's contract list). */
export const WHYPE = (process.env.NEXT_PUBLIC_WHYPE || "0xbA876237B0F021A6c6D852d6c26E107997cC5E81") as Address;
export const USDC = (process.env.NEXT_PUBLIC_USDC || "0xb47c4C8F73F009CC0C0d3f92B388d13E293F0B65") as Address;

export const TOKENS: Token[] = [
  { symbol: "HYPE", name: "Native", address: NATIVE, decimals: 18, glyph: "H", tone: "native", logo: "/tokens/hype.svg" },
  { symbol: "WHYPE", name: "Wrapped HYPE", address: WHYPE, decimals: 18, glyph: "H", tone: "hype", logo: "/tokens/hype.svg" },
  { symbol: "USDC", name: "USD Coin", address: USDC, decimals: 6, glyph: "$", tone: "usd", logo: "/tokens/usdc.svg" },
];

export const isNative = (t: Token) => t.address === NATIVE;

/** Tokens with the most traded Uniswap V4 pools on Elysium (the pools Stoa registers at launch). Not reviewed:
 *  copycats exist (same symbol, different address), so they stay "unverified" and show their address. */
export const POPULAR: Token[] = (process.env.NEXT_PUBLIC_CHAIN_ID ?? "99901") === "99901"
  ? (popular as { symbol: string; address: string; decimals: number; logo?: string }[]).map((t) => ({
      symbol: t.symbol, name: `Unverified · ${t.address.slice(0, 6)}…${t.address.slice(-4)}`, address: t.address as Address,
      decimals: t.decimals, glyph: t.symbol[0] ?? "?", tone: "other" as const, logo: t.logo,
    }))
  : [];

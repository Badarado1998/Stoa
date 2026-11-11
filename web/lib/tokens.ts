import type { Address } from "viem";

export const NATIVE = "0x0000000000000000000000000000000000000000" as Address;

export interface Token {
  symbol: string;
  name: string;
  address: Address; // NATIVE for HYPE
  decimals: number;
  glyph: string;
  tone: "native" | "hype" | "usd" | "other";
}

/** Canonical Elysium tokens (from Kinetiq's contract list). */
export const WHYPE = (process.env.NEXT_PUBLIC_WHYPE || "0xbA876237B0F021A6c6D852d6c26E107997cC5E81") as Address;
export const USDC = (process.env.NEXT_PUBLIC_USDC || "0xb47c4C8F73F009CC0C0d3f92B388d13E293F0B65") as Address;

export const TOKENS: Token[] = [
  { symbol: "HYPE", name: "Native", address: NATIVE, decimals: 18, glyph: "H", tone: "native" },
  { symbol: "WHYPE", name: "Wrapped HYPE", address: WHYPE, decimals: 18, glyph: "H", tone: "hype" },
  { symbol: "USDC", name: "USD Coin", address: USDC, decimals: 6, glyph: "$", tone: "usd" },
];

export const isNative = (t: Token) => t.address === NATIVE;

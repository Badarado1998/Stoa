import type { Address } from "viem";
import { NATIVE, WHYPE, type Token } from "./tokens";

export type SwapKind = "wrap" | "unwrap" | "hypeIn" | "hypeOut" | "erc20";

/** Which call a pair needs. HYPE<->WHYPE is a plain wrap, not a swap. */
export function swapKind(sell: Token, buy: Token): SwapKind {
  const sN = sell.address === NATIVE, bN = buy.address === NATIVE;
  if (sN && buy.address.toLowerCase() === WHYPE.toLowerCase()) return "wrap";
  if (bN && sell.address.toLowerCase() === WHYPE.toLowerCase()) return "unwrap";
  if (sN) return "hypeIn";
  if (bN) return "hypeOut";
  return "erc20";
}

/** Router-side token addresses: native HYPE is quoted as WHYPE. */
export function routeTokens(sell: Token, buy: Token): { tokenIn: Address; tokenOut: Address } {
  return {
    tokenIn: sell.address === NATIVE ? WHYPE : sell.address,
    tokenOut: buy.address === NATIVE ? WHYPE : buy.address,
  };
}

/** Minimum output after slippage, rounded down. slippage in percent, e.g. 0.5 */
export function minOut(amountOut: bigint, slippagePct: number): bigint {
  const bps = BigInt(Math.round(slippagePct * 100));
  return (amountOut * (10_000n - bps)) / 10_000n;
}

/** Parse a decimal string into raw units; returns undefined for invalid input. */
export function parseAmount(v: string, decimals: number): bigint | undefined {
  const s = v.trim();
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return undefined;
  const [i, f = ""] = s.split(".");
  if (f.length > decimals) return undefined;
  const raw = BigInt((i || "0") + f.padEnd(decimals, "0"));
  return raw > 0n ? raw : undefined;
}

/** Format raw units for display with up to `max` decimals, trimming zeros. */
export function fmt(raw: bigint, decimals: number, max = 6): string {
  const neg = raw < 0n; if (neg) raw = -raw;
  const base = 10n ** BigInt(decimals);
  const int = raw / base;
  let frac = (raw % base).toString().padStart(decimals, "0").slice(0, max).replace(/0+$/, "");
  const intS = int.toLocaleString("en-US");
  return (neg ? "-" : "") + (frac ? `${intS}.${frac}` : intS);
}

/** Effective price of a quote: buy units per sell unit. */
export function rate(amountIn: bigint, inDec: number, amountOut: bigint, outDec: number): number {
  if (amountIn === 0n) return 0;
  return Number(amountOut) / 10 ** outDec / (Number(amountIn) / 10 ** inDec);
}

/** Referral from ?ref=0x..., never the user's own address. */
export function cleanRef(ref: string | null | undefined, self?: string): Address | undefined {
  if (!ref || !/^0x[0-9a-fA-F]{40}$/.test(ref)) return undefined;
  if (self && ref.toLowerCase() === self.toLowerCase()) return undefined;
  return ref as Address;
}

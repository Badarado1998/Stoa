import { parseAbi, parseEventLogs, type Address, type Log } from "viem";
import type { AnyQuote } from "./anychain";
import { sameAddr } from "./bridge";

/** Buy any Robinhood Chain token from another chain (lib/anyTokenServer.ts builds the quote). */

/** StoaCrossBuy on Robinhood Chain (contracts/src/tools/StoaCrossBuy.sol, verified on Sourcify): no owner, no settings */
export const CROSS_BUY = "0x2F5fadfA7134a460F7abB18c3C91C1600aCB9DF8" as Address;
/** the share of the purchase's value delivered as ETH to Robinhood Chain; the rest pays the route */
export const ETH_SHARE = 0.975;
/** the swap's minimum against Stoa's quote when the route is built, in basis points (3% for the time the bridge takes) */
export const MIN_OUT_BPS = 9_700;
/** the most the purchase may move the token's price on Robinhood Chain, against a quote 1/1000 its size */
export const MAX_IMPACT_PCT = 5;
/** the most the real-size round trip (buy, then sell straight back from the buyer's own address) may lose */
export const MAX_TRIP_LOSS_PCT = 10;
/** shown until Hey Research Lab has reviewed it: only with ?preview=anytoken */
export const ANYTOKEN_PUBLIC = false;

export interface AnyTokenQuote extends AnyQuote {
  tokenOut: Address; symbol: string; decimals: number;
  /** ETH delivered on Robinhood Chain, swapped by StoaCrossBuy */
  ethFund: string;
  /** Stoa's router quote for ethFund, and the minimum the swap accepts */
  expectedOut: string; minOut: string;
  deadline: number;
  safety: { verdict: "ok" | "caution" | "danger" | "unknown"; notes: string[] };
  /** price impact of this purchase, in %; what the token bought is worth at Stoa's prices before it; the real-size
   *  round trip's loss, in % */
  impactPct: number; valueUsd: number; tripLossPct: number;
}

const events = parseAbi([
  "event Bought(address indexed to, address indexed tokenOut, uint256 ethIn, uint256 amountOut, address referrer)",
  "event Refunded(address indexed to, address indexed tokenOut, uint256 ethIn)",
]);

/** what StoaCrossBuy did for this buyer in a delivery transaction: the token bought, the ETH sent back, or nothing. A
 *  refund counts only for the whole ETH this purchase delivered: anyone can call StoaCrossBuy for any address, so a
 *  smaller Refunded event is someone else's (HEY Research Lab, any-token review, N-5). */
export function crossBuyResult(logs: Log[], buyer: string, tokenOut: string, ethFund: bigint): { kind: "bought"; amount: bigint } | { kind: "refunded"; eth: bigint } | null {
  const mine = logs.filter((l) => sameAddr(l.address, CROSS_BUY));
  for (const e of parseEventLogs({ abi: events, logs: mine })) {
    if (!sameAddr(e.args.to, buyer) || !sameAddr(e.args.tokenOut, tokenOut)) continue;
    if (e.eventName === "Bought") return { kind: "bought", amount: e.args.amountOut };
    if (e.args.ethIn === ethFund) return { kind: "refunded", eth: e.args.ethIn };
  }
  return null;
}

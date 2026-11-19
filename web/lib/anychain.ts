import { decodeFunctionData, parseAbi, type Address } from "viem";
import { NATIVE_ZERO, SOURCES, sameAddr } from "./bridge";

/** Buy $STOA from any chain: Trustware (trustware.io) routes a deposit from Base, Arbitrum, Ethereum, Optimism or BNB
 *  Chain into $STOA on Robinhood Chain. Quotes come through Stoa's server (/api/anychain/*, the Trustware key never
 *  reaches the browser). Only Relay depository routes are used: the user deposits on the source chain into Relay's
 *  canonical Depository against an order id, and Relay's solver delivers $STOA on Robinhood Chain.
 *
 *  What Stoa checks before the wallet opens: the call goes to Relay's Depository, as depositNative or depositErc20, the
 *  depositor is the user's own address, and it deposits exactly the token and amount picked; any approval is for that
 *  token, that amount and the Depository only. What it cannot check yet: the recipient, token and minimum on Robinhood
 *  Chain live in Relay's off-chain order, which Trustware does not return. Until it does (Relay's protocol.v2 order data,
 *  checked with getOrderId), each purchase is capped at MAX_USD. */

export const STOA_RH = "0x13E6993417616De724F2b337D65063f229e96718" as Address;
export const DST_CHAIN = 4663;
/** Relay's canonical Depository (the same address on every chain; api.relay.link/chains, protocol.v2.depository) */
export const RELAY_DEPOSITORY = "0x4cD00E387622C35bDDB9b4c962C136462338BC31" as Address;
/** The most one purchase may move while the delivery side cannot be checked before signing */
export const MAX_USD = 500;
/** Shown to everyone once Hey Research Lab has reviewed it; until then only with ?preview=anychain on /token */
export const ANYCHAIN_PUBLIC = false;
/** Relay Depository calls; a token deposit carries no native value */
const ABI = parseAbi([
  "function depositNative(address depositor, bytes32 id) payable",
  "function depositErc20(address depositor, address token, uint256 amount, bytes32 id)",
]);

export interface TwTx { chainId: number; to: Address; data: `0x${string}`; value?: string | number; gasLimit?: string | number }
export interface TwApproval { chainId: number; tokenAddress: Address; spender: Address; amount: string }
export interface TwEstimate { fromAmount: string; fromAmountUsd?: string; toAmount: string; toAmountMin: string; toAmountUsd?: string; etaSeconds?: number; fees?: { type: string; amountUsd?: string }[] }
/** What /api/anychain/quote returns */
export interface AnyQuote { intentId: string; expiresAt?: string; provider: string; estimate: TwEstimate; transaction: TwTx; approvals: TwApproval[] }

export interface AnyWant { user: Address; chainId: number; token: Address; amount: bigint }

/** the source chains and tokens Stoa offers (Bridge in's list) */
export function sourceOk(chainId: number, token: string) {
  const s = SOURCES.find((x) => x.chain.id === chainId);
  return !!s && s.tokens.some((t) => sameAddr(t.address, token));
}

/** null when the deposit does exactly what the user picked; otherwise why it is refused */
export function checkAnyQuote(q: AnyQuote, want: AnyWant): string | null {
  const bad = "This route looks wrong, so Stoa stopped it before your wallet. Nothing was sent. Get a new quote.";
  if (q.provider !== "relay") return bad;
  const tx = q.transaction;
  if (Number(tx.chainId) !== want.chainId || !sameAddr(tx.to, RELAY_DEPOSITORY)) return bad;
  if (!sourceOk(want.chainId, want.token)) return bad;
  if (BigInt(q.estimate.fromAmount) !== want.amount) return bad;
  if (BigInt(q.estimate.toAmountMin || "0") <= 0n) return bad;
  const value = BigInt(tx.value ?? 0);
  let call: ReturnType<typeof decodeFunctionData<typeof ABI>>;
  try { call = decodeFunctionData({ abi: ABI, data: tx.data }); } catch { return bad; }
  const native = sameAddr(want.token, NATIVE_ZERO);
  if (native) {
    if (call.functionName !== "depositNative") return bad;
    const [depositor] = call.args;
    if (!sameAddr(depositor, want.user) || value !== want.amount) return bad;
    if (q.approvals.length) return bad;
  } else {
    if (call.functionName !== "depositErc20") return bad;
    const [depositor, token, amount] = call.args;
    if (!sameAddr(depositor, want.user) || !sameAddr(token, want.token) || amount !== want.amount || value !== 0n) return bad;
    // the only approval a deposit needs: this token, this amount, to the Depository
    for (const a of q.approvals) {
      if (Number(a.chainId) !== want.chainId || !sameAddr(a.tokenAddress, want.token) || !sameAddr(a.spender, RELAY_DEPOSITORY) || BigInt(a.amount) > want.amount) return bad;
    }
  }
  const usd = Number(q.estimate.fromAmountUsd ?? NaN);
  if (!Number.isFinite(usd) || usd > MAX_USD) return `Buying $STOA from another chain is limited to $${MAX_USD} per purchase for now. Use a smaller amount.`;
  return null;
}

import { arbitrum, base, bsc, mainnet, optimism } from "viem/chains";
import { decodeAbiParameters, slice, type Address, type Chain } from "viem";

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

/* ---------- Checking a LI.FI transaction before the wallet signs it ----------
 * The LI.FI contract runs whatever its calldata says, receiver included, so checking `to` is not enough: a wrong API
 * answer (or an extension rewriting it) could pass that check and send the funds elsewhere. Every LI.FI bridge call
 * takes a BridgeData struct as its first argument and, for swapAndStartBridgeTokensVia*, the source swaps as its
 * second. Stoa decodes both and refuses the transaction unless they match what the user picked. */

const BRIDGE_DATA = { type: "tuple", components: [
  { name: "transactionId", type: "bytes32" }, { name: "bridge", type: "string" }, { name: "integrator", type: "string" },
  { name: "referrer", type: "address" }, { name: "sendingAssetId", type: "address" }, { name: "receiver", type: "address" },
  { name: "minAmount", type: "uint256" }, { name: "destinationChainId", type: "uint256" },
  { name: "hasSourceSwaps", type: "bool" }, { name: "hasDestinationCall", type: "bool" },
] } as const;
const SWAP_DATA = { type: "tuple[]", components: [
  { name: "callTo", type: "address" }, { name: "approveTo", type: "address" }, { name: "sendingAssetId", type: "address" },
  { name: "receivingAssetId", type: "address" }, { name: "fromAmount", type: "uint256" }, { name: "callData", type: "bytes" },
  { name: "requiresDeposit", type: "bool" },
] } as const;

/** Most gas-token value a token route may carry on top (some bridges charge a small native fee). */
export const MAX_NATIVE_FEE = 3_000_000_000_000_000n; // 0.003 of the source chain's gas token

export interface ExpectedTx { user: Address; chainId: number; token: Address; amount: bigint }

/** Bridge in only uses Across: its LI.FI call carries the receiver (and the refund address) in the transaction itself,
 *  so both can be checked here. Intent and deposit routes (Relay, Layerswap, LI.FI Intents) bind the recipient in an
 *  off-chain order that cannot be checked before signing, so they are left out. */
export const ALLOWED_BRIDGES = "across";
/** LI.FI's Across swap-and-bridge call (BridgeData, SwapData[], Across data): the only call accepted */
export const ACROSS_SELECTOR = "0x1794958f";

/** null when the transaction does what the user picked; otherwise why it is refused. */
export function checkLifiTx(tx: { to: Address; data: `0x${string}`; value?: string | bigint; chainId: number }, want: ExpectedTx): string | null {
  const bad = "This route looks wrong, so Stoa stopped it before your wallet. Nothing was sent. Get a new quote.";
  if (!sameAddr(tx.to, LIFI_DIAMOND) || tx.chainId !== want.chainId) return bad;
  if (tx.data.slice(0, 10).toLowerCase() !== ACROSS_SELECTOR) return bad;
  const native = sameAddr(want.token, NATIVE_ZERO);
  const value = BigInt(tx.value ?? 0);
  if (native ? value > want.amount + MAX_NATIVE_FEE : value > MAX_NATIVE_FEE) return bad;
  let bd: { sendingAssetId: Address; receiver: Address; minAmount: bigint; destinationChainId: bigint; hasSourceSwaps: boolean; hasDestinationCall: boolean };
  try { [bd] = decodeAbiParameters([BRIDGE_DATA], slice(tx.data, 4)); } catch { return bad; }
  if (!sameAddr(bd.receiver, want.user)) return bad;
  if (bd.destinationChainId !== BigInt(DST_CHAIN_ID)) return bad;
  if (bd.hasDestinationCall) return bad; // the receiver would then be a contract on Robinhood Chain, not the user
  if (!bd.hasSourceSwaps) {
    if (!sameAddr(bd.sendingAssetId, want.token) || bd.minAmount > want.amount) return bad;
    return null;
  }
  // with source swaps (LI.FI's fee collection, or a swap before the bridge) the first swap must spend exactly the
  // picked token and amount, and the last must end in the asset the bridge sends
  let swaps: readonly { sendingAssetId: Address; receivingAssetId: Address; fromAmount: bigint }[];
  try { [, swaps] = decodeAbiParameters([BRIDGE_DATA, SWAP_DATA], slice(tx.data, 4)); } catch { return bad; }
  if (!swaps.length) return bad;
  if (!sameAddr(swaps[0].sendingAssetId, want.token) || swaps[0].fromAmount !== want.amount) return bad;
  if (!sameAddr(swaps[swaps.length - 1].receivingAssetId, bd.sendingAssetId)) return bad;
  if (sameAddr(bd.sendingAssetId, want.token) && bd.minAmount > want.amount) return bad;
  return acrossAddressesOk(tx.data, want.user) ? null : bad;
}

/** The Across data (third argument) starts with the address that receives the funds on Robinhood Chain and the one
 *  that gets a refund if the fill fails: both must be the user. */
function acrossAddressesOk(data: `0x${string}`, user: Address): boolean {
  const args = data.slice(10).toLowerCase();
  const word = (i: number) => args.slice(i * 64, i * 64 + 64);
  const at = Number(BigInt("0x" + word(2)));
  if (!Number.isSafeInteger(at) || at % 32 !== 0 || at / 32 + 2 > args.length / 64) return false;
  const me = user.slice(2).toLowerCase().padStart(64, "0");
  return word(at / 32) === me && word(at / 32 + 1) === me;
}

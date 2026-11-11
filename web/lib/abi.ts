import { parseAbi } from "viem";

export const routerAbi = parseAbi([
  "struct Leg { address venue; bool isPool; }",
  "struct Quote { uint256 amountOut; address mid; Leg leg1; Leg leg2; }",
  "struct SwapParams { address tokenIn; address tokenOut; address mid; Leg leg1; Leg leg2; uint256 amountIn; uint256 minOut; address to; uint256 deadline; address referrer; }",
  "function quote(address tokenIn, address tokenOut, uint256 amountIn) returns (Quote q)",
  "function swap(SwapParams p) payable returns (uint256 amountOut)",
  "function paused() view returns (bool)",
  // errors, so wallets and the app can show a readable reason
  "error Expired()",
  "error UnknownVenue()",
  "error BadValue()",
  "error Slippage()",
  "error ZeroAmount()",
  "error IsPaused()",
  "error BadToken()",
  "error BadRecipient()",
  "error InputNotSpent()",
  "error NativeTransferFailed()",
  "error QuoteExpired()",
  "error SizeExceeded()",
  "error CapExceeded()",
  "error UnsupportedToken()",
  "error Partial()",
]);

/** Human text for contract errors (router, pools, adapters). */
export const ERROR_TEXT: Record<string, string> = {
  Expired: "The swap took too long to confirm. Try again.",
  UnknownVenue: "That route is no longer available. Refresh the quote and try again.",
  BadValue: "The HYPE amount sent does not match the swap.",
  Slippage: "The price moved past your slippage limit, so the swap was cancelled. Your funds are safe.",
  ZeroAmount: "Enter an amount.",
  IsPaused: "Swaps are paused for safety. Please try again later.",
  BadToken: "This token is not supported (for example, it charges a fee on transfer).",
  BadRecipient: "Invalid recipient.",
  InputNotSpent: "The venue did not fill the full amount, so the swap was cancelled.",
  NativeTransferFailed: "Sending HYPE to your wallet failed.",
  QuoteExpired: "The maker quote expired. Try again.",
  SizeExceeded: "Amount is larger than the maker is quoting right now.",
  CapExceeded: "Amount is above the per-swap limit of the maker pool.",
  UnsupportedToken: "This token is not supported.",
  Partial: "Not enough liquidity for the full amount.",
  HookNotAllowed: "This pool uses a hook Stoa does not route through.",
  NotInitialized: "That pool does not exist yet.",
  Known: "This pool is already added.",
  Full: "This pair already has its deepest pools added.",
};

export const routedEvent = parseAbi([
  "event Routed(address indexed sender, address indexed to, address indexed referrer, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut, address mid, address venue1, address venue2)",
])[0];

export const v4AdapterAbi = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "function keysFor(address a, address b) view returns (PoolKey[])",
  "function hookAllowed(address hooks) view returns (bool)",
  "function register(PoolKey key)",
  "error HookNotAllowed()",
  "error NotInitialized()",
  "error Known()",
  "error Full()",
  "error BadKey()",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
]);

export const whypeAbi = parseAbi(["function deposit() payable", "function withdraw(uint256)"]);

export const poolAbi = parseAbi([
  "function current() view returns (uint128 bidPx, uint128 askPx, uint96 bidSize, uint96 askSize, uint64 expiry)",
  "function maxSwapQuote() view returns (uint256)",
  "function feeBps() view returns (uint16)",
]);

export const feesAbi = parseAbi([
  "function referralOwed(address referrer, address token) view returns (uint256)",
  "function claimReferral(address[] tokens, address to)",
]);

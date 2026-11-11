import { parseAbi } from "viem";

export const routerAbi = parseAbi([
  "struct Best { address venue; bool isPool; uint256 amountOut; }",
  "function quoteBest(address tokenIn, address tokenOut, uint256 amountIn) returns (Best best)",
  "function swapExactIn(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address to, uint256 deadline, address referrer) returns (uint256)",
  "function swapExactHYPEIn(address tokenOut, uint256 minOut, address to, uint256 deadline, address referrer) payable returns (uint256)",
  "function swapExactInForHYPE(address tokenIn, uint256 amountIn, uint256 minOut, address to, uint256 deadline, address referrer) returns (uint256)",
  "function paused() view returns (bool)",
  // errors, so wallets and the app can show a readable reason
  "error Expired()",
  "error NoRoute()",
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
  NoRoute: "No route for this pair right now.",
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
};

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

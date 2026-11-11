import { parseAbi } from "viem";

export const routerAbi = parseAbi([
  "struct Best { address venue; bool isPool; uint256 amountOut; }",
  "function quoteBest(address tokenIn, address tokenOut, uint256 amountIn) returns (Best best)",
  "function swapExactIn(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address to, uint256 deadline, address referrer) returns (uint256)",
  "function swapExactHYPEIn(address tokenOut, uint256 minOut, address to, uint256 deadline, address referrer) payable returns (uint256)",
  "function swapExactInForHYPE(address tokenIn, uint256 amountIn, uint256 minOut, address to, uint256 deadline, address referrer) returns (uint256)",
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

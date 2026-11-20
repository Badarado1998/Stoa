import { getAddress, isAddress, parseAbi, type Address } from "viem";
import rh from "./deployments-4663.json";

/** Recurring buys on Robinhood Chain (contracts/src/tools/StoaAutoInvest.sol). Funds stay in the owner's wallet; each
 *  buy pulls one amount and swaps it through the Stoa router to the owner. Stoa's keeper (script/autoinvest.sh) runs
 *  due buys for plans that name it as runner. Off until the contract's address is in deployments-4663.json. */

const D = rh as unknown as Partial<Record<string, string>>;
const a = (v?: string) => (v && isAddress(v) ? getAddress(v) : undefined);
export const AUTO_INVEST: Address | undefined = a(D.autoInvest);
export const AUTO_INVEST_RUNNER: Address | undefined = a(D.autoInvestRunner);

export const FREQUENCIES = [
  { label: "Daily", secs: 86_400 },
  { label: "Weekly", secs: 7 * 86_400 },
  { label: "Every 2 weeks", secs: 14 * 86_400 },
  { label: "Every 30 days", secs: 30 * 86_400 },
] as const;
/** the most a buy may get below the router's quote, in basis points */
export const AI_SLIP_BPS = 100;
/** the keeper runs plans worth at least this much per buy (script/autoinvest.sh, MIN_USDG) */
export const AI_MIN_USD = 5;

export const autoInvestAbi = parseAbi([
  "struct Plan { address owner; address tokenIn; address tokenOut; uint96 amount; uint32 interval; uint16 left; uint16 slipBps; uint64 nextAt; address runner; }",
  "function create(address tokenIn, address tokenOut, uint96 amount, uint32 interval, uint16 buys, uint16 slipBps, uint64 firstAt, address runner) returns (uint256 id)",
  "function cancel(uint256 id)",
  "function plan(uint256 id) view returns (Plan)",
  "function plansOf(address owner) view returns (uint256[])",
  "event Created(uint256 indexed id, address indexed owner, address tokenIn, address tokenOut, uint256 amount, uint32 interval, uint16 buys, uint16 slipBps, uint64 firstAt, address runner)",
  "event Bought(uint256 indexed id, address indexed owner, uint256 amountIn, uint256 amountOut, uint16 left, address runner)",
  "event Cancelled(uint256 indexed id, address indexed owner)",
  "error BadPlan()",
  "error NotOwner()",
]);

import { createPublicClient, http, parseAbiItem, type Address } from "viem";
import { LOGS_RPC, elysium } from "./chain";
import { NATIVE, WHYPE, USDC } from "./tokens";

/** Uniswap V4 PoolManager on Elysium (official deployment). */
export const V4_POOL_MANAGER = "0xe2E105D3f7209A9da11F83ccf3E7398a753823F1" as Address;
const INIT = parseAbiItem(
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)",
);

export type PoolKey = { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };

const logsClient = () => createPublicClient({ chain: elysium, transport: http(LOGS_RPC) });
const lc = (a: string) => a.toLowerCase();

/** V4 pools pairing `token` with HYPE (native or WHYPE) or USDC, newest first. */
export async function findV4Pools(token: Address): Promise<PoolKey[]> {
  if (!LOGS_RPC) return [];
  const c = logsClient();
  const [as0, as1] = await Promise.all([
    c.getLogs({ address: V4_POOL_MANAGER, event: INIT, args: { currency0: token }, fromBlock: 0n, toBlock: "latest" }),
    c.getLogs({ address: V4_POOL_MANAGER, event: INIT, args: { currency1: token }, fromBlock: 0n, toBlock: "latest" }),
  ]);
  const bases = new Set([lc(NATIVE), lc(WHYPE), lc(USDC)]);
  return [...as0, ...as1]
    .filter((l) => bases.has(lc(lc(l.args.currency0!) === lc(token) ? l.args.currency1! : l.args.currency0!)))
    .sort((a, b) => Number(b.blockNumber - a.blockNumber))
    .map((l) => ({
      currency0: l.args.currency0!, currency1: l.args.currency1!, fee: Number(l.args.fee), tickSpacing: Number(l.args.tickSpacing), hooks: l.args.hooks!,
    }));
}

export const sameKey = (a: PoolKey, b: PoolKey) =>
  lc(a.currency0) === lc(b.currency0) && lc(a.currency1) === lc(b.currency1) && a.fee === b.fee && a.tickSpacing === b.tickSpacing && lc(a.hooks) === lc(b.hooks);

import "server-only";
import { createPublicClient, http, parseAbi, type Address } from "viem";
import { ROBINHOOD } from "./networks";
import { srv } from "./serverRpc";

/** StoaLimit on Robinhood Chain, read on the server (lib/limit.ts is the browser side). */
export const LIMIT_ADDR = ROBINHOOD.contracts.limit as Address | undefined;
const abi = parseAbi(["function paused() view returns (bool)"]);
export async function limitPaused(): Promise<boolean> {
  if (!LIMIT_ADDR) return true;
  const c = createPublicClient({ chain: ROBINHOOD.chain, transport: http(srv(ROBINHOOD.logsRpc), { timeout: 10_000 }) });
  return c.readContract({ address: LIMIT_ADDR, abi, functionName: "paused" }).catch(() => false);
}

import { createPublicClient, erc20Abi, http, parseAbi, type Address } from "viem";
import { ROBINHOOD } from "./networks";
import { CA } from "./stoaAddress";

/** $STOA's Pons bonding curve. Unsold $STOA sits here until the curve graduates to a Uniswap V4 pool. */
export const STOA_CURVE = "0xd0b519310688e830c9aee29ae117edc3fbb1c13f" as Address;
export const BURN = "0x000000000000000000000000000000000000dEaD" as Address;
export const curveAbi = parseAbi([
  "function graduationThreshold() view returns (uint256)",
  "function graduated() view returns (bool)",
]);
export const PONS_URL = `https://ponsfamily.com/launchpad/${CA}`;

export type Supply = {
  /** every $STOA ever minted (fixed at launch) */
  max: bigint;
  /** minted minus burned */
  total: bigint;
  /** total minus the unsold $STOA still on the bonding curve */
  circulating: bigint;
  burned: bigint;
  inCurve: bigint;
  curveEth: bigint;
  threshold: bigint;
  graduated: boolean;
};

/** Server side: reads straight from Robinhood Chain (dedicated RPC first, public RPC as fallback). */
export async function readSupply(): Promise<Supply> {
  const rpcs = [...(ROBINHOOD.chain.rpcUrls.default.http as readonly string[]), ROBINHOOD.logsRpc];
  let last: unknown;
  for (const url of rpcs) {
    try {
      const c = createPublicClient({ chain: ROBINHOOD.chain, transport: http(url, { fetchOptions: { headers: { "user-agent": "curl/8.5.0" } }, timeout: 8_000 }) });
      const [max, burned, inCurve, curveEth, threshold, graduated] = await Promise.all([
        c.readContract({ address: CA, abi: erc20Abi, functionName: "totalSupply" }),
        c.readContract({ address: CA, abi: erc20Abi, functionName: "balanceOf", args: [BURN] }),
        c.readContract({ address: CA, abi: erc20Abi, functionName: "balanceOf", args: [STOA_CURVE] }),
        c.getBalance({ address: STOA_CURVE }),
        c.readContract({ address: STOA_CURVE, abi: curveAbi, functionName: "graduationThreshold" }),
        c.readContract({ address: STOA_CURVE, abi: curveAbi, functionName: "graduated" }),
      ]);
      const total = max - burned;
      return { max, total, circulating: total - inCurve, burned, inCurve, curveEth, threshold, graduated };
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

/** whole-token decimal string, e.g. "657409872.69" */
export const units = (v: bigint, dp = 2) => {
  const s = (Number(v) / 1e18).toFixed(dp);
  return s.replace(/\.?0+$/, "");
};

import "server-only";
import { createPublicClient, erc20Abi, formatEther, http, type Address } from "viem";
import { ROBINHOOD } from "./networks";
import { srv } from "./serverRpc";
import { SPOT, epochAt, spotlightAbi } from "./spotlight";

export type SpotWeek = { week: number; finalized: boolean; bids: number; winners: { token: string; symbol: string; bidEth: number; toVotersEth: number; votesStoa: number }[] };

/** Every finished Spotlight week, newest first: whether it is settled, how many tokens bid, and each winner's bid and
 *  the ETH its voters got. Read from SpotlightMarket (the page that shows it is regenerated every 30 seconds). */
export async function loadSpotlightHistory(): Promise<SpotWeek[]> {
  if (!SPOT) return [];
  const spot: Address = SPOT;
  const e = epochAt(Math.floor(Date.now() / 1000));
  if (e < 1) return [];
  const net = ROBINHOOD;
  const c = createPublicClient({ chain: net.chain, transport: http(srv(net.chain.rpcUrls.default.http[0]), { timeout: 8_000 }) });
  const weeks = Array.from({ length: Math.min(e, 26) }, (_, i) => e - 1 - i);
  const infos = await c.multicall({ contracts: weeks.map((w) => ({ address: spot, abi: spotlightAbi, functionName: "epochInfo", args: [BigInt(w)] })), allowFailure: false }) as unknown as readonly [unknown, boolean, boolean, readonly Address[], readonly Address[]][];
  const pairs = weeks.flatMap((w, i) => infos[i][4].map((t) => [w, t] as const));
  const cands = pairs.length ? await c.multicall({ contracts: pairs.map(([w, t]) => ({ address: spot, abi: spotlightAbi, functionName: "candidates", args: [BigInt(w), t] })), allowFailure: false }) as unknown as readonly (readonly [bigint, bigint, bigint])[] : [];
  const toks = [...new Set(pairs.map(([, t]) => t))];
  const syms = toks.length ? await c.multicall({ contracts: toks.map((t) => ({ address: t, abi: erc20Abi, functionName: "symbol" })), allowFailure: true }) : [];
  const sym = (t: Address) => net.tokens.find((x) => x.address.toLowerCase() === t.toLowerCase())?.symbol ?? (syms[toks.indexOf(t)]?.status === "success" ? String(syms[toks.indexOf(t)].result).slice(0, 16) : `${t.slice(0, 6)}…`);
  return weeks.map((w, i) => ({
    week: w + 1, finalized: infos[i][2], bids: infos[i][3].length,
    winners: infos[i][4].map((t) => {
      const k = pairs.findIndex(([pw, pt]) => pw === w && pt === t);
      const [pot, votes, payout] = cands[k];
      return { token: t, symbol: sym(t), bidEth: Number(formatEther(pot)), toVotersEth: Number(formatEther(payout)), votesStoa: Number(formatEther(votes)) };
    }),
  }));
}


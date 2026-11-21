import "server-only";
import { createPublicClient, formatEther, http, parseAbiItem, type Address } from "viem";
import { ROBINHOOD } from "./networks";
import { srv } from "./serverRpc";
import { cachedLogs } from "./logCache";
import { SPOT, epochAt, spotlightAbi } from "./spotlight";

const net = ROBINHOOD;
const voted = parseAbiItem("event Voted(uint256 indexed epoch, address indexed voter, address[] tokens, uint256[] amounts)");

export type Leader = { address: Address; eth: number; weeks: number };
export type Leaders = { settledWeeks: number; voters: number; paidEth: number; leaders: Leader[]; updated: number };

/** Spotlight's top earners: for every settled week and every winning token, each voter's share is the winner's payout
 *  × the voter's final votes ÷ all its votes (the contract's claimable formula, claimed or not). Voters come from the
 *  Voted events, their final votes from votesOf. Nothing indexed off-chain. */
export async function readLeaders(limit = 25): Promise<Leaders> {
  const now = Math.floor(Date.now() / 1000);
  const e = epochAt(now);
  const empty: Leaders = { settledWeeks: 0, voters: 0, paidEth: 0, leaders: [], updated: now };
  if (!SPOT || e < 1) return empty;
  const spot: Address = SPOT;
  const c = createPublicClient({ chain: net.chain, transport: http(srv(net.chain.rpcUrls.default.http[0]), { timeout: 15_000, retryCount: 2 }) });

  const eps = Array.from({ length: e }, (_, i) => i);
  const infos = (await c.multicall({ allowFailure: false, contracts: eps.map((x) => ({ address: spot, abi: spotlightAbi, functionName: "epochInfo" as const, args: [BigInt(x)] as const })) })) as unknown as readonly [unknown, boolean, boolean, readonly Address[], readonly Address[]][];
  const settled = eps.filter((x) => infos[x][2]);
  const wins = settled.flatMap((x) => infos[x][4].map((t) => [x, t] as const));
  if (!wins.length) return { ...empty, settledWeeks: settled.length };

  const logs = await cachedLogs<{ epoch: bigint; voter: Address; tokens: readonly Address[] }>(net, `spotlight:${spot.toLowerCase()}:Voted`, { address: spot, event: voted, fromBlock: net.deployBlock });
  const votersOf = new Map<string, Set<Address>>(); // "epoch:token" -> voters who ever put votes on it
  const everyone = new Set<string>();
  for (const l of logs) {
    for (const t of l.args.tokens) {
      const k = `${Number(l.args.epoch)}:${t.toLowerCase()}`;
      if (!votersOf.has(k)) votersOf.set(k, new Set());
      votersOf.get(k)!.add(l.args.voter);
    }
  }

  const cands = (await c.multicall({ allowFailure: false, contracts: wins.map(([x, t]) => ({ address: spot, abi: spotlightAbi, functionName: "candidates" as const, args: [BigInt(x), t] as const })) })) as unknown as readonly [bigint, bigint, bigint, number, boolean, boolean, boolean][];
  const asks = wins.flatMap(([x, t], i) => [...(votersOf.get(`${x}:${t.toLowerCase()}`) ?? [])].map((v) => ({ i, x, t, v })));
  const mine = asks.length ? ((await c.multicall({ allowFailure: false, contracts: asks.map((a) => ({ address: spot, abi: spotlightAbi, functionName: "votesOf" as const, args: [BigInt(a.x), a.t, a.v] as const })) })) as bigint[]) : [];

  const tally = new Map<string, { address: Address; wei: bigint; weeks: Set<number> }>();
  let paid = 0n;
  wins.forEach((_, i) => { paid += cands[i][2]; });
  asks.forEach((a, j) => {
    const [, votes, payout] = cands[a.i];
    if (!votes || !mine[j]) return;
    const wei = (payout * mine[j]) / votes;
    if (!wei) return;
    const k = a.v.toLowerCase();
    everyone.add(k);
    const row = tally.get(k) ?? { address: a.v, wei: 0n, weeks: new Set<number>() };
    row.wei += wei; row.weeks.add(a.x + 1);
    tally.set(k, row);
  });
  const leaders = [...tally.values()]
    .sort((a, b) => (b.wei > a.wei ? 1 : b.wei < a.wei ? -1 : 0))
    .slice(0, limit)
    .map((r) => ({ address: r.address, eth: Number(formatEther(r.wei)), weeks: r.weeks.size }));
  return { settledWeeks: settled.length, voters: everyone.size, paidEth: Number(formatEther(paid)), leaders, updated: now };
}

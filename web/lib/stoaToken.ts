"use client";
import { useQuery } from "@tanstack/react-query";
import { createPublicClient, erc20Abi, getAddress, http, pad, type Address } from "viem";
import { CA, LOGS_RPC, elysium } from "./chain";
import type { Token } from "./tokens";

/** $STOA is found on-chain, not typed in: the web looks for a token that the dev wallet created through Montra's
 *  factory, so the contract address shows the moment the launch transaction lands, and a copycat from any other
 *  wallet can never appear here. NEXT_PUBLIC_CA, if set, wins. */
const DEV = "0x5A63C75B38e7ee42220Cc3A57702E06D1D8903c9" as Address;
const MONTRA_FACTORY = "0x38D3ef3A06D18fA3286Fb5dEAfe611be725fcD15" as Address;
/** Montra's launch event: topic1 = token, topic2 = creator, topic3 = pool id */
const LAUNCH_TOPIC = "0x4961817ce3ab7655aeb0a1693c07f08a5b793c56901461b33bb3753758244c6f" as const;
const FROM_BLOCK = 5_932_000n; // just before the watcher went live

async function find(): Promise<Token | null> {
  const client = createPublicClient({ chain: elysium, transport: http(LOGS_RPC) });
  let token = CA ?? null;
  if (!token) {
    const logs = await client.request({
      method: "eth_getLogs",
      params: [{ address: MONTRA_FACTORY, fromBlock: `0x${FROM_BLOCK.toString(16)}`, toBlock: "latest", topics: [LAUNCH_TOPIC, null, pad(DEV)] }],
    });
    const created = (logs as { topics: `0x${string}`[] }[]).map((l) => getAddress(`0x${l.topics[1].slice(26)}`));
    if (!created.length) return null;
    // prefer the one whose ticker is STOA if the dev wallet ever made more than one
    const syms = await Promise.all(created.map((a) => client.readContract({ address: a, abi: erc20Abi, functionName: "symbol" }).catch(() => "")));
    const i = syms.findIndex((s) => s.toUpperCase().replace("$", "") === "STOA");
    token = created[i >= 0 ? i : 0];
  }
  const [symbol, name, decimals] = await Promise.all([
    client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
    client.readContract({ address: token, abi: erc20Abi, functionName: "name" }),
    client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
  ]);
  return { symbol, name: "Official Stoa token", address: token, decimals, glyph: symbol[0] ?? "S", tone: "bridged", logo: "/logo.png" };
}

/** Polls every 15 s until the launch is seen, then stays put. */
export function useStoaToken() {
  const q = useQuery({
    queryKey: ["stoa-token"],
    queryFn: find,
    refetchInterval: (query) => (query.state.data ? false : 15_000),
    staleTime: (query) => (query.state.data ? Infinity : 10_000),
    enabled: elysium.id === 99901,
  });
  return q.data ?? null;
}

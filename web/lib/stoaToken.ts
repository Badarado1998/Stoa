"use client";
import { useQuery } from "@tanstack/react-query";
import { createPublicClient, erc20Abi, getAddress, http, pad, type Address } from "viem";
import type { Net } from "./networks";
import type { Token } from "./tokens";

/** $STOA lives on Robinhood Chain, launched on Pons. It is found on-chain, not typed in: the web looks for a token the
 *  dev wallet created through Pons' V2 launch factory, so it appears the moment the launch lands and a copycat from
 *  any other wallet never can. NEXT_PUBLIC_STOA_DEV overrides the dev wallet, NEXT_PUBLIC_STOA_CA the token. */
const DEV = (process.env.NEXT_PUBLIC_STOA_DEV || "0x5A63C75B38e7ee42220Cc3A57702E06D1D8903c9") as Address;
const CA = process.env.NEXT_PUBLIC_STOA_CA as Address | undefined;
const PONS_FACTORY = "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e" as Address;
/** TokenLaunched: topic1 = token, topic2 = bonding curve, topic3 = creator */
const LAUNCH_TOPIC = "0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607" as const;
const LOOKBACK = 9_000_000n; // ~10 days of Robinhood Chain blocks per query window

async function find(net: Net): Promise<Token | null> {
  const client = createPublicClient({ chain: net.chain, transport: http(net.logsRpc) });
  let token = CA ?? null;
  if (!token) {
    const head = await client.getBlockNumber();
    let created: Address[] = [];
    for (let z = head, i = 0; i < 4 && !created.length; z -= LOOKBACK, i++) {
      const from = z > LOOKBACK ? z - LOOKBACK + 1n : 0n;
      const logs = await client.request({
        method: "eth_getLogs",
        params: [{ address: PONS_FACTORY, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${z.toString(16)}`, topics: [LAUNCH_TOPIC, null, null, pad(DEV)] }],
      });
      created = (logs as { topics: `0x${string}`[] }[]).map((l) => getAddress(`0x${l.topics[1].slice(26)}`));
    }
    if (!created.length) return null;
    // prefer the one whose ticker is STOA if the dev wallet ever made more than one
    const syms = await Promise.all(created.map((a) => client.readContract({ address: a, abi: erc20Abi, functionName: "symbol" }).catch(() => "")));
    const i = syms.findIndex((s) => s.toUpperCase().replace("$", "") === "STOA");
    if (i < 0) return null;
    token = created[i];
  }
  const [symbol, decimals] = await Promise.all([
    client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
    client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
  ]);
  return { symbol, name: "Official Stoa token", address: token, decimals, glyph: symbol[0] ?? "S", tone: "bridged", logo: "/logo.png" };
}

/** On Robinhood Chain: polls every 15 s until the launch is seen, then stays put. Null elsewhere. */
export function useStoaToken(net: Net) {
  const q = useQuery({
    queryKey: ["stoa-token", net.key],
    queryFn: () => find(net),
    refetchInterval: (query) => (query.state.data ? false : 15_000),
    staleTime: (query) => (query.state.data ? Infinity : 10_000),
    enabled: net.key === "robinhood",
  });
  return net.key === "robinhood" ? q.data ?? null : null;
}

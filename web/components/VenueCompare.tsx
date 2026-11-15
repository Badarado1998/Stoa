"use client";
import { useQuery } from "@tanstack/react-query";
import { parseAbi, type Address, type PublicClient } from "viem";
import type { Net } from "@/lib/networks";
import type { Token } from "@/lib/tokens";
import { NATIVE } from "@/lib/tokens";
import { fmt, isHop, describeRoute, type Route } from "@/lib/swap";

// adapters' quote is not marked view (some venues simulate the swap), but it is only ever eth_call'ed here
const adapterAbi = parseAbi(["function quote(address tokenIn, address tokenOut, uint256 amountIn) view returns (uint256)"]);
const routerAbi = parseAbi(["function isAdapter(address) view returns (bool)"]);
const lc = (a: string) => a.toLowerCase();

/** The swap screen's proof of "best price": what each venue the router uses would give for this exact amount, direct,
 *  next to what Stoa fills. Venue quotes are the venues' own (before Stoa's 2 bps); Stoa's is what you receive.
 *  Shown only when at least two venues quote the pair directly, so there is something to compare. */
export default function VenueCompare({ net, pub, sell, buy, amt, route, out }: {
  net: Net; pub?: PublicClient; sell: Token; buy: Token; amt: bigint; route: Route; out: bigint;
}) {
  const router = net.contracts.router;
  const live = useQuery({
    queryKey: ["live-venues", net.key],
    enabled: !!pub && !!router,
    staleTime: 300_000,
    queryFn: async () => {
      const addrs = Object.keys(net.venues) as Address[];
      const res = await pub!.multicall({ contracts: addrs.map((a) => ({ address: router!, abi: routerAbi, functionName: "isAdapter" as const, args: [a] as const })), allowFailure: true });
      return addrs.filter((_, i) => res[i]?.result === true);
    },
  });
  const a = lc(sell.address) === lc(NATIVE) ? net.wrapped : sell.address;
  const b = lc(buy.address) === lc(NATIVE) ? net.wrapped : buy.address;
  const quotes = useQuery({
    queryKey: ["venue-quotes", net.key, a, b, amt.toString(), live.data?.join()],
    enabled: !!pub && !!live.data?.length && lc(a) !== lc(b),
    staleTime: 8_000,
    refetchInterval: 12_000,
    queryFn: async () => {
      const vs = live.data!;
      const res = await pub!.multicall({ contracts: vs.map((v) => ({ address: v, abi: adapterAbi, functionName: "quote" as const, args: [a, b, amt] as const })), allowFailure: true });
      return vs.map((v, i) => ({ venue: v, name: net.venues[lc(v)] ?? "Venue", out: (res[i]?.result as bigint | undefined) ?? 0n }));
    },
  });

  const all = (quotes.data ?? []).filter((r) => r.out > 0n).sort((x, y) => (y.out > x.out ? 1 : y.out < x.out ? -1 : 0));
  // a venue quoting under half of the best has almost no liquidity for this pair: not a real alternative, and it would
  // make Stoa's edge look bigger than it is
  const rows = all.filter((r) => r.out * 2n >= all[0]?.out);
  if (rows.length < 2) return null;
  const thin = all.length - rows.length;
  const used = !isHop(route) && !route.leg1.isPool ? lc(route.leg1.venue) : null;
  const worst = rows[rows.length - 1];
  const gain = out - worst.out;
  const d = buy.decimals, sym = buy.symbol;
  return (
    <div className="cmp">
      <div className="lbl">EVERY VENUE, THIS AMOUNT</div>
      <div className="det" style={{ marginTop: 6 }}>
        {(isHop(route) || route.leg1.isPool) && <>
          <span style={{ color: "var(--ink)", fontWeight: 600 }}>✓ {describeRoute(route, net.venues, net.tokens[1].symbol)}</span>
          <span style={{ color: "var(--accent)", fontWeight: 600 }}>{fmt(out, d, 6)} {sym}</span></>}
        {rows.map((r) => {
          const on = lc(r.venue) === used;
          return [
            <span key={r.venue + "n"} style={on ? { color: "var(--ink)", fontWeight: 600 } : undefined}>{on ? "✓ " : ""}{r.name}</span>,
            <span key={r.venue + "v"} style={on ? { color: "var(--accent)", fontWeight: 600 } : undefined}>{fmt(r.out, d, 6)} {sym}</span>,
          ];
        })}
      </div>
      {gain > 0n && <div className="gain">+{fmt(gain, d, 4)} {sym} on Stoa vs {worst.name}, after the 2 bps fee</div>}
      <p className="note" style={{ marginTop: 6, fontSize: 12 }}>Each venue&apos;s own quote for the whole amount, direct, before Stoa&apos;s fee. ✓ is the route Stoa fills.{thin > 0 ? ` ${thin} venue${thin === 1 ? "" : "s"} with almost no liquidity for this pair left out.` : ""}</p>
    </div>
  );
}

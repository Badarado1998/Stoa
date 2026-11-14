"use client";
import { useEffect, useState } from "react";
import { erc20Abi, type Address, type Hash } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { txUrlOn } from "@/lib/networks";
import { getLogsOn } from "@/lib/logs";
import { useNet } from "./Providers";
import { routedEvent } from "@/lib/abi";
import { NATIVE } from "@/lib/tokens";
import { fmt } from "@/lib/swap";

type Row = { hash: Hash; time: number; tokenIn: Address; tokenOut: Address; amountIn: bigint; amountOut: bigint };
type Meta = Record<string, { symbol: string; decimals: number }>;

/** The connected wallet's swaps through the Stoa router, read straight from on-chain events. */
export default function SwapHistory() {
  const net = useNet();
  const elysium = net.chain, CONTRACTS = net.contracts;
  const txUrl = (h: string) => txUrlOn(net, h);
  const KNOWN: Meta = Object.fromEntries(net.tokens.map((t) => [t.address.toLowerCase(), { symbol: t.symbol, decimals: t.decimals }]));
  const { address } = useAccount();
  const pub = usePublicClient({ chainId: elysium.id });
  const [rows, setRows] = useState<Row[] | null>(null);
  const [meta, setMeta] = useState<Meta>(KNOWN);
  useEffect(() => { setRows(null); setErr(false); setMeta(KNOWN); }, [net.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (!address || !CONTRACTS.router || !net.logsRpc) return;
    let stop = false;
    (async () => {
      let r: Row[] = [];
      try {
        const logs = await getLogsOn(net, { address: CONTRACTS.router!, event: routedEvent, args: { sender: address }, fromBlock: net.deployBlock });
        const last = logs.slice(-25).reverse();
        r = last.map((l) => ({
          hash: l.transactionHash!, time: Number((l as unknown as { blockTimestamp?: string }).blockTimestamp ?? 0),
          tokenIn: l.args.tokenIn!, tokenOut: l.args.tokenOut!, amountIn: l.args.amountIn!, amountOut: l.args.amountOut!,
        }));
        if (!stop) setRows(r);
      } catch {
        if (!stop) setErr(true);
        return;
      }
      try {
        // symbols for tokens the app does not list
        const unknown = [...new Set(r.flatMap((x) => [x.tokenIn, x.tokenOut]).map((a) => a.toLowerCase()))].filter((a) => !KNOWN[a] && a !== NATIVE.toLowerCase());
        if (pub && unknown.length) {
          const res = await pub.multicall({ contracts: unknown.flatMap((a) => [
            { address: a as Address, abi: erc20Abi, functionName: "symbol" as const },
            { address: a as Address, abi: erc20Abi, functionName: "decimals" as const },
          ]), allowFailure: true });
          const add: Meta = {};
          unknown.forEach((a, i) => {
            const sym = res[2 * i]?.result as string | undefined, dec = res[2 * i + 1]?.result as number | undefined;
            add[a] = { symbol: (sym ?? "TOKEN").replace(/[^\w.$-]/g, "").slice(0, 12), decimals: dec ?? 18 };
          });
          if (!stop) setMeta((m) => ({ ...m, ...add }));
        }
      } catch { /* symbols are cosmetic */ }
    })();
    return () => { stop = true; };
  }, [address, pub, net]); // eslint-disable-line react-hooks/exhaustive-deps

  const m = (a: Address) => meta[a.toLowerCase()] ?? (a === NATIVE ? { symbol: net.gas, decimals: 18 } : { symbol: "…", decimals: 18 });
  if (!CONTRACTS.router) return <p className="note">Your swaps on {net.name} will show here once Stoa is live there.</p>;
  if (err) return <p className="note">Could not load swap history right now.</p>;
  if (!rows) return <p className="note">Loading swaps…</p>;
  if (!rows.length) return <p className="note">No swaps on {net.name} yet from this wallet.</p>;
  return (
    <table className="tbl">
      <thead><tr><th>WHEN</th><th>SOLD</th><th>BOUGHT</th><th /></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.hash}>
            <td>{r.time ? new Date(r.time * 1000).toLocaleString() : "—"}</td>
            <td style={{ fontFamily: "var(--mono)" }}>{fmt(r.amountIn, m(r.tokenIn).decimals, 4)} {m(r.tokenIn).symbol}</td>
            <td style={{ fontFamily: "var(--mono)" }}>{fmt(r.amountOut, m(r.tokenOut).decimals, 4)} {m(r.tokenOut).symbol}</td>
            <td style={{ textAlign: "right" }}>{<a href={txUrl(r.hash)} target="_blank" rel="noopener noreferrer">View</a>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

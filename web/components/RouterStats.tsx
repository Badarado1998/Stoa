"use client";
import { useEffect, useState } from "react";
import { zeroAddress } from "viem";
import { usePublicClient } from "wagmi";
import { getLogsOn } from "@/lib/logs";
import { useNet } from "./Providers";
import { routedEvent, routerAbi } from "@/lib/abi";

type Stats = { swaps24: number; vol24: number; swapsAll: number };
const lc = (a: string) => a.toLowerCase();

/** Router activity from on-chain events on the selected network: swaps and USD volume (stablecoin and native
 *  legs) over 24 hours. */
export default function RouterStats() {
  const net = useNet();
  const elysium = net.chain, CONTRACTS = net.contracts, USDC = net.stable, WHYPE = net.wrapped;
  const sd = net.tokens[2].decimals;
  const pub = usePublicClient({ chainId: elysium.id });
  const [s, setS] = useState<Stats | null>(null);

  useEffect(() => {
    setS(null);
    if (!CONTRACTS.router || !net.logsRpc || !pub) return;
    let stop = false;
    (async () => {
      try {
        const logs = await getLogsOn(net, { address: CONTRACTS.router!, event: routedEvent, fromBlock: net.deployBlock });
        const { result } = await pub.simulateContract({ address: CONTRACTS.router!, abi: routerAbi, functionName: "quote", args: [zeroAddress, USDC, 10n ** 18n] });
        const hype = Number(result.amountOut) / 10 ** sd; // USD per native coin
        const since = Date.now() / 1000 - 86_400;
        let swaps24 = 0, vol24 = 0;
        for (const l of logs) {
          const t = Number((l as unknown as { blockTimestamp?: string }).blockTimestamp ?? 0);
          if (t < since) continue;
          swaps24++;
          const { tokenIn, tokenOut, amountIn, amountOut } = l.args;
          if (lc(tokenIn!) === lc(USDC)) vol24 += Number(amountIn) / 10 ** sd;
          else if (lc(tokenOut!) === lc(USDC)) vol24 += Number(amountOut) / 10 ** sd;
          else if (tokenIn === zeroAddress || lc(tokenIn!) === lc(WHYPE)) vol24 += (Number(amountIn) / 1e18) * hype;
          else if (tokenOut === zeroAddress || lc(tokenOut!) === lc(WHYPE)) vol24 += (Number(amountOut) / 1e18) * hype;
        }
        if (!stop) setS({ swaps24, vol24, swapsAll: logs.length });
      } catch { /* stats are optional */ }
    })();
    return () => { stop = true; };
  }, [pub, net]); // eslint-disable-line react-hooks/exhaustive-deps

  const usd = (v: number) => "$" + v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  const cell = (label: string, v: string) => (
    <div className="panel pad"><div className="lbl">{label}</div><div style={{ fontFamily: "var(--mono)", fontSize: 26, marginTop: 6 }}>{v}</div></div>
  );
  const live = !!CONTRACTS.router;
  return (
    <div className="grid3 stats" style={{ marginBottom: 20 }}>
      {cell("VOLUME · 24H", !live ? "At launch" : s ? usd(s.vol24) : "—")}
      {cell("SWAPS · 24H", !live ? "At launch" : s ? s.swaps24.toLocaleString("en-US") : "—")}
      {cell("SWAPS · ALL TIME", !live ? "At launch" : s ? s.swapsAll.toLocaleString("en-US") : "—")}
    </div>
  );
}

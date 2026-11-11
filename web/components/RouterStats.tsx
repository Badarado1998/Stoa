"use client";
import { useEffect, useState } from "react";
import { createPublicClient, http, zeroAddress } from "viem";
import { usePublicClient } from "wagmi";
import { CONTRACTS, DEPLOY_BLOCK, LOGS_RPC, elysium } from "@/lib/chain";
import { routedEvent, routerAbi } from "@/lib/abi";
import { USDC, WHYPE } from "@/lib/tokens";

type Stats = { swaps24: number; vol24: number; swapsAll: number };
const lc = (a: string) => a.toLowerCase();

/** Router activity from on-chain events: swaps and USD volume (USDC and HYPE legs) over 24 hours. */
export default function RouterStats() {
  const pub = usePublicClient({ chainId: elysium.id });
  const [s, setS] = useState<Stats | null>(null);

  useEffect(() => {
    if (!CONTRACTS.router || !LOGS_RPC || !pub) return;
    let stop = false;
    (async () => {
      try {
        const c = createPublicClient({ chain: elysium, transport: http(LOGS_RPC) });
        const logs = await c.getLogs({ address: CONTRACTS.router!, event: routedEvent, fromBlock: DEPLOY_BLOCK, toBlock: "latest" });
        const { result } = await pub.simulateContract({ address: CONTRACTS.router!, abi: routerAbi, functionName: "quote", args: [zeroAddress, USDC, 10n ** 18n] });
        const hype = Number(result.amountOut) / 1e6; // USD per HYPE
        const since = Date.now() / 1000 - 86_400;
        let swaps24 = 0, vol24 = 0;
        for (const l of logs) {
          const t = Number((l as unknown as { blockTimestamp?: string }).blockTimestamp ?? 0);
          if (t < since) continue;
          swaps24++;
          const { tokenIn, tokenOut, amountIn, amountOut } = l.args;
          if (lc(tokenIn!) === lc(USDC)) vol24 += Number(amountIn) / 1e6;
          else if (lc(tokenOut!) === lc(USDC)) vol24 += Number(amountOut) / 1e6;
          else if (tokenIn === zeroAddress || lc(tokenIn!) === lc(WHYPE)) vol24 += (Number(amountIn) / 1e18) * hype;
          else if (tokenOut === zeroAddress || lc(tokenOut!) === lc(WHYPE)) vol24 += (Number(amountOut) / 1e18) * hype;
        }
        if (!stop) setS({ swaps24, vol24, swapsAll: logs.length });
      } catch { /* stats are optional */ }
    })();
    return () => { stop = true; };
  }, [pub]);

  const usd = (v: number) => "$" + v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  const cell = (label: string, v: string) => (
    <div className="panel pad"><div className="lbl">{label}</div><div style={{ fontFamily: "var(--mono)", fontSize: 26, marginTop: 6 }}>{v}</div></div>
  );
  const live = !!CONTRACTS.router;
  return (
    <div className="grid3" style={{ marginBottom: 20 }}>
      {cell("VOLUME · 24H", !live ? "At launch" : s ? usd(s.vol24) : "—")}
      {cell("SWAPS · 24H", !live ? "At launch" : s ? s.swaps24.toLocaleString("en-US") : "—")}
      {cell("SWAPS · ALL TIME", !live ? "At launch" : s ? s.swapsAll.toLocaleString("en-US") : "—")}
    </div>
  );
}

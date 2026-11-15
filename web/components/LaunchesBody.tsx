"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useReadContract } from "wagmi";
import { zeroAddress } from "viem";
import { PageHead, Sk } from "./ui";
import { useNet } from "./Providers";
import { ROBINHOOD } from "@/lib/networks";
import { routerAbi } from "@/lib/abi";
import type { Launch } from "@/app/api/pons/launches/route";
import { CA } from "@/lib/stoaAddress";

const PONS = (a: string) => `https://ponsfamily.com/launchpad/${a}`;
const usd = (v: number | null) => (v === null ? "—" : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(0)}`);
function age(ts: number) {
  const s = Math.max(0, Date.now() / 1000 - ts);
  return s < 3600 ? `${Math.max(1, Math.round(s / 60))}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
}

/** Live Pons launches on Robinhood Chain, read from the chain by /api/pons/launches. Trade buttons go to Stoa once the
 *  Pons curve adapter is in the router (curves) or for graduated tokens (their Uniswap V4 pool); otherwise to Pons. */
export default function LaunchesBody() {
  const net = useNet();
  const [all, setAll] = useState(false);
  const q = useQuery({
    queryKey: ["pons-launches"],
    refetchInterval: 60_000,
    queryFn: async () => (await (await fetch("/api/pons/launches")).json()) as { launches: Launch[]; scanned?: number; error?: string },
  });
  const ponsLive = useReadContract({
    address: ROBINHOOD.contracts.router, abi: routerAbi, functionName: "isAdapter", args: [ROBINHOOD.pons ?? zeroAddress],
    chainId: ROBINHOOD.chain.id, query: { enabled: !!ROBINHOOD.pons, refetchInterval: 60_000 },
  }).data === true;

  const live = (q.data?.launches ?? []).filter((l) => !l.graduated);
  const grads = (q.data?.launches ?? []).filter((l) => l.graduated);
  const shown = all ? live : live.slice(0, 20);
  const trade = (l: Launch) => `/trade?chain=robinhood&buy=${l.token}`;

  return (
    <>
      <PageHead eyebrow="PONS LAUNCHES · ROBINHOOD CHAIN" title="Every live launch, one list" action={<Link className="cta" href="/trade?chain=robinhood">Trade</Link>}>
        Tokens on their Pons bonding curve that have raised at least 0.05 ETH in the last few days, by ETH raised, read straight from the curves.
        {ponsLive ? " Trade any of them on Stoa, from ETH or any token." : " Stoa's Pons curve adapter goes live on 18 Nov (48h timelock); until then the buttons open Pons."}
      </PageHead>
      {net.key !== "robinhood" && <div className="notice" style={{ marginBottom: 16 }}>Pons runs on Robinhood Chain. Swaps from this page switch you there.</div>}

      <div className="panel" style={{ overflow: "hidden", marginBottom: 20 }}>
        <table className="tbl">
          <thead><tr><th>TOKEN</th><th>CURVE</th><th className="hm">MARKET CAP</th><th className="hm">CREATOR TAX</th><th className="hm">AGE</th><th /></tr></thead>
          <tbody>
            {q.isLoading && [0, 1, 2, 3, 4].map((i) => <tr key={i}><td colSpan={6}><Sk w={260} /></td></tr>)}
            {!q.isLoading && !live.length && <tr><td colSpan={6} style={{ color: "var(--muted)" }}>{q.data?.error ?? "No curve has raised 0.05 ETH in the last few days."}</td></tr>}
            {shown.map((l) => (
              <tr key={l.token}>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span aria-hidden style={{ position: "relative", overflow: "hidden", width: 30, height: 30, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "#EAF1FB", color: "var(--accent)", fontWeight: 700, flex: "none" }}>
                      {l.symbol[0]}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {l.logo && <img src={l.logo} alt="" width={30} height={30} loading="lazy" style={{ position: "absolute", inset: 0, width: 30, height: 30, objectFit: "cover" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{l.symbol}{l.token.toLowerCase() === CA.toLowerCase() && <span className="chip live" style={{ marginLeft: 6 }}>Stoa&apos;s token</span>}</div>
                      <div style={{ fontSize: 12.5, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>{l.name}</div>
                    </div>
                  </div>
                </td>
                <td style={{ minWidth: 120 }}>
                  <div style={{ height: 8, borderRadius: 999, background: "#E6ECF5", overflow: "hidden" }}><div style={{ width: `${l.progress}%`, height: "100%", background: "var(--accent)" }} /></div>
                  <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4, fontFamily: "var(--mono)" }}>{l.progress.toFixed(1)}% · {(+l.raised).toFixed(2)}/{(+l.threshold).toFixed(1)} ETH</div>
                </td>
                <td className="hm" style={{ fontFamily: "var(--mono)" }}>{usd(l.mcapUsd)}</td>
                <td className="hm" style={{ fontFamily: "var(--mono)" }}>{(l.creatorTaxBps / 100).toFixed(1)}%</td>
                <td className="hm" style={{ fontFamily: "var(--mono)" }}>{age(l.launchedAt)}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {ponsLive
                    ? <Link href={trade(l)} className="go" style={{ margin: 0 }}>Trade</Link>
                    : <a href={PONS(l.token)} className="go" style={{ margin: 0 }} target="_blank" rel="noopener noreferrer">Pons</a>}
                </td>
              </tr>
            ))}
            {live.length > 20 && <tr><td colSpan={6}><button type="button" className="ghost" onClick={() => setAll(!all)}>{all ? "Show top 20" : `Show all ${live.length}`}</button></td></tr>}
          </tbody>
        </table>
      </div>

      {grads.length > 0 && (
        <div className="panel pad" style={{ marginBottom: 20 }}>
          <div className="lbl">RECENTLY GRADUATED · NOW ON UNISWAP V4</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
            {grads.map((l) => <Link key={l.token} href={trade(l)} className="chip" title={l.name}>{l.symbol}</Link>)}
          </div>
          <p className="note">Graduated tokens trade on their Uniswap V4 pool. If the swap screen offers to add the pool to the router, that is one small transaction anyone can send.</p>
        </div>
      )}

      <p className="note">
        Unverified launches, not reviewed by Stoa: anyone can launch a token on Pons, and most go to zero. Curve trades pay Pons&apos; 1% fee and the token&apos;s creator tax on top of Stoa&apos;s 2 bps. Data refreshes every minute{q.data?.scanned ? ` from the last ${q.data.scanned.toLocaleString()} launches` : ""}.
      </p>
    </>
  );
}

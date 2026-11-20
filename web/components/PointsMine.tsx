"use client";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { useWalletModal } from "./Providers";

type Mine = { rank: number | null; points: number; wallets: number; row: { swapPoints: number; refPoints: number; swaps: number } | null };

/** the connected wallet's season points, rank and where they came from */
export default function PointsMine() {
  const { address, isConnected } = useAccount();
  const { open } = useWalletModal();
  const q = useQuery({
    queryKey: ["points-mine", address],
    enabled: !!address,
    refetchInterval: 120_000,
    queryFn: async () => (await (await fetch(`/api/points?address=${address}`)).json()) as Mine,
  });
  const n = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return (
    <div className="panel pad">
      <div className="lbl">YOUR POINTS</div>
      {!isConnected ? (
        <>
          <p className="note">Connect a wallet to see your points and rank.</p>
          <button className="cta" type="button" onClick={open}>Connect wallet</button>
        </>
      ) : !q.data ? <p className="note">Loading…</p> : (
        <>
          <div style={{ fontFamily: "var(--num)", fontSize: 32, marginTop: 6 }}>{n(q.data.points)}<small style={{ fontSize: 14, color: "var(--muted)" }}> points{q.data.rank ? ` · rank ${q.data.rank} of ${q.data.wallets}` : ""}</small></div>
          {q.data.row ? (
            <ul className="list">
              <li>From your swaps <b>{n(q.data.row.swapPoints)} · {q.data.row.swaps} {q.data.row.swaps === 1 ? "swap" : "swaps"}</b></li>
              <li>From swaps you referred <b>{n(q.data.row.refPoints)}</b></li>
            </ul>
          ) : <p className="note">No points yet this season. Swap on Stoa, or share your referral link from Referrals.</p>}
          {q.data.row && address && (
            <p className="note" style={{ marginBottom: 0 }}>
              <a href={`https://x.com/intent/post?text=${encodeURIComponent(`${q.data.points.toLocaleString("en-US", { maximumFractionDigits: 0 })} points and rank ${q.data.rank} in @StoaDEX Points season 1. Swap, refer, climb:`)}&url=${encodeURIComponent(`https://stoadex.com/points/${address}`)}`} target="_blank" rel="noopener noreferrer">Share your rank on X ↗</a>
              {" · "}<a href={`/points/${address}`}>Your card</a>
            </p>
          )}
        </>
      )}
    </div>
  );
}

"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { useWalletModal } from "./Providers";
import { SEASON_START } from "@/lib/pointsScore";

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
  // before the season: what the same rules give this wallet's swaps over the last 7 days (shown as a preview, not points)
  const pre = typeof window !== "undefined" && Date.now() / 1000 < SEASON_START;
  const pv = useQuery({
    queryKey: ["points-preview", address],
    enabled: !!address && pre,
    refetchInterval: 300_000,
    queryFn: async () => (await (await fetch(`/api/points?address=${address}&preview=1`)).json()) as Mine,
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
      ) : pre ? (
        <>
          <div style={{ fontFamily: "var(--num)", fontSize: 32, marginTop: 6 }}>{pv.data ? n(pv.data.points) : "…"}<small style={{ fontSize: 14, color: "var(--muted)" }}> preview points{pv.data?.rank ? ` · would rank ${pv.data.rank} of ${pv.data.wallets}` : ""}</small></div>
          <p className="note">
            What your swaps of the last 7 days would have earned under the season 1 rules. A preview only: nothing counts until the season starts Mon 23 Nov, 00:00 UTC.
            {pv.data && !pv.data.row ? " No swaps through Stoa from this wallet in the last 7 days." : ""}
          </p>
          {pv.data?.row && <ul className="list"><li>From your swaps <b>{n(pv.data.row.swapPoints)} · {pv.data.row.swaps} {pv.data.row.swaps === 1 ? "swap" : "swaps"}</b></li><li>From swaps you referred <b>{n(pv.data.row.refPoints)}</b></li></ul>}
        </>
      ) : !q.data ? <p className="note">Loading…</p> : (
        <>
          <div style={{ fontFamily: "var(--num)", fontSize: 32, marginTop: 6 }}>{n(q.data.points)}<small style={{ fontSize: 14, color: "var(--muted)" }}> points{q.data.rank ? ` · rank ${q.data.rank} of ${q.data.wallets}` : ""}</small></div>
          {q.data.row ? (
            <ul className="list">
              <li>From your swaps <b>{n(q.data.row.swapPoints)} · {q.data.row.swaps} {q.data.row.swaps === 1 ? "swap" : "swaps"}</b></li>
              <li>From swaps you referred <b>{n(q.data.row.refPoints)}</b></li>
            </ul>
          ) : (
            <>
              <p className="note">No points yet this season. Swap on Stoa, or invite friends: their swaps through your link earn you referral points.</p>
              {address && <ShareRow url={`https://stoadex.com/r/${address.toLowerCase()}`} text="Swapping on Robinhood Chain? Stoa compares every route for your exact amount, stock tokens included, and swaps earn Points this season. Here's my invite:" />}
            </>
          )}
          {q.data.row && address && (
            <>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 4 }}>
              <ShareRow url={`https://stoadex.com/points/${address.toLowerCase()}`} text={`${q.data.points.toLocaleString("en-US", { maximumFractionDigits: 0 })} points, rank ${q.data.rank} of ${q.data.wallets} in @StoaDEX Points season 1. Swap through my card:`} />
              <a href={`/points/${address.toLowerCase()}`}>See your card</a>
            </div>
            <p className="note" style={{ marginBottom: 0 }}>Anyone who swaps through your card counts as your referral, so sharing it earns you referral points.</p>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** share a Points card or an invite: X, Telegram and a copy button. The link's own card image shows in the post. */
function ShareRow({ url, text }: { url: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <a className="cta" href={`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`} target="_blank" rel="noopener noreferrer">Share on X ↗</a>
      <a className="ghost" href={`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text.replace("@StoaDEX ", "Stoa "))}`} target="_blank" rel="noopener noreferrer">Telegram ↗</a>
      <button type="button" className="ghost" onClick={() => { void navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => undefined); }}>{copied ? "Copied" : "Copy link"}</button>
    </div>
  );
}

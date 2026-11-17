"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { fmtUsd } from "@/lib/prices";
import { SESSION_LABEL, session, type Session } from "@/lib/marketHours";
import { WatchStar, WatchlistPanel } from "./Watch";
import { Ticker } from "./ui";

export interface StockRow {
  symbol: string; name: string; address: string; logo: string | null;
  ref: number | null; halted: boolean; route: boolean;
  dex: { priceUsd: number; liquidityUsd: number; volume24h: number; change24h: number | null } | null;
}

const usd0 = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(0)}`);

/** the US session, recomputed every minute in the visitor's browser */
export function MarketStatus() {
  const [s, setS] = useState<Session | null>(null);
  useEffect(() => { const f = () => setS(session()); f(); const t = setInterval(f, 60_000); return () => clearInterval(t); }, []);
  if (!s) return null;
  return <span className={`mstatus ${s}`}><i aria-hidden="true" />{SESSION_LABEL[s]}</span>;
}

export default function Stocks({ rows, updated }: { rows: StockRow[]; updated: number }) {
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const routed = rows.filter((r) => r.route).length;
  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    return rows.filter((r) => (all || k || r.route) && (!k || r.symbol.toLowerCase().includes(k) || r.name.toLowerCase().includes(k) || r.address.toLowerCase() === k));
  }, [rows, q, all]);
  return (
    <>
      <WatchlistPanel chain="robinhood" />
      <div className="panel pad">
        <div className="stockbar">
          <input type="search" placeholder="Search ticker or name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search stock tokens" />
          <button className="ghost" type="button" aria-pressed={all} onClick={() => setAll((v) => !v)}>
            {all ? `Only those Stoa routes (${routed})` : `Show all ${rows.length}`}
          </button>
        </div>
        <div className="stockhead" aria-hidden="true"><span>Token</span><span>Robinhood price</span><span>On-chain price</span><span>On-chain liquidity</span><span /></div>
        <div className="stocklist">
          {shown.map((r) => {
            const diff = r.ref && r.dex ? (r.dex.priceUsd - r.ref) / r.ref * 100 : null;
            return (
              <div key={r.address} className="stock">
                <div className="sname">
                  <Ticker symbol={r.symbol} />
                  <div><b>{r.symbol}</b><small>{r.name}</small></div>
                </div>
                <div className="sval"><small>Robinhood</small>{r.halted ? <span className="dn">Halted</span> : r.ref ? fmtUsd(r.ref) : "—"}</div>
                <div className="sval"><small>On-chain</small>{r.dex ? <>{fmtUsd(r.dex.priceUsd)}{diff != null && Math.abs(diff) >= 0.05 && <em className={Math.abs(diff) >= 2 ? "far" : undefined}>{diff > 0 ? "+" : ""}{diff.toFixed(1)}%</em>}</> : <span className="muted">No pool yet</span>}</div>
                <div className="sval"><small>Liquidity</small>{r.dex ? usd0(r.dex.liquidityUsd) : "—"}</div>
                <div className="sact">
                  {r.route ? <Link className="cta" href={`/trade?chain=robinhood&sell=USDG&buy=${r.address}`}>Swap</Link> : <span className="noroute">No route yet</span>}
                  <WatchStar chain="robinhood" address={r.address} symbol={r.symbol} logo={r.logo ?? undefined} via="USDG" />
                </div>
              </div>
            );
          })}
          {!shown.length && <p className="note">No stock token matches “{q}”.</p>}
        </div>
        <p className="note" style={{ marginBottom: 0 }}>
          Robinhood price: the mid of Robinhood&apos;s bid and ask for one token, from the underlying shares (it moves only while the US market, extended hours or the overnight session is open).
          On-chain price: the deepest pool DexScreener lists; the percentage is how far it is from Robinhood&apos;s price.
          Swap appears when Stoa&apos;s router can buy the token with 100 USDG right now; Trade then quotes your exact amount across every venue.
          Updated {new Date(updated).toUTCString().slice(17, 22)} UTC.
        </p>
      </div>
    </>
  );
}

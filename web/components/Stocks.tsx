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

/** the US session: rendered on the server (so it paints with the page), then recomputed every minute in the browser */
export function MarketStatus({ initial }: { initial?: Session }) {
  const [s, setS] = useState<Session | null>(initial ?? null);
  useEffect(() => { const f = () => setS(session()); f(); const t = setInterval(f, 60_000); return () => clearInterval(t); }, []);
  if (!s) return null;
  return <span className={`mstatus ${s}`}><i aria-hidden="true" />{SESSION_LABEL[s]}</span>;
}

const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(Math.abs(v) < 10 ? 2 : 1)}%`;

/** Today's movers among stock tokens with a real on-chain market (at least MIN_LIQ of liquidity): the most traded,
 *  the biggest 24h moves on-chain, and the widest gaps from Robinhood's price. Read from the same data as the list. */
const MIN_LIQ = 10_000;
function Movers({ rows }: { rows: StockRow[] }) {
  const [tab, setTab] = useState(0); // phones show one list at a time
  const liquid = rows.filter((r) => r.dex && r.dex.liquidityUsd >= MIN_LIQ);
  if (liquid.length < 3) return null;
  const gap = (r: StockRow) => (r.ref && r.dex ? ((r.dex.priceUsd - r.ref) / r.ref) * 100 : null);
  const lists: { h: string; sub: string; items: { r: StockRow; v: string; tone?: string }[] }[] = [
    { h: "Most traded", sub: "24h on-chain volume", items: [...liquid].sort((a, b) => b.dex!.volume24h - a.dex!.volume24h).slice(0, 5).map((r) => ({ r, v: usd0(r.dex!.volume24h) })) },
    { h: "Biggest moves", sub: "24h on-chain change", items: liquid.filter((r) => r.dex!.change24h != null).sort((a, b) => Math.abs(b.dex!.change24h!) - Math.abs(a.dex!.change24h!)).slice(0, 5).map((r) => ({ r, v: pct(r.dex!.change24h!), tone: r.dex!.change24h! >= 0 ? "up" : "dn" })) },
    { h: "Widest gaps", sub: "on-chain vs Robinhood", items: liquid.filter((r) => gap(r) != null).sort((a, b) => Math.abs(gap(b)!) - Math.abs(gap(a)!)).slice(0, 5).map((r) => ({ r, v: pct(gap(r)!) })) },
  ];
  return (
    <div className="movers">
      <div className="seg mtabs show-m" role="tablist" aria-label="Movers">
        {lists.filter((l) => l.items.length).map((l, i) => (
          <button key={l.h} type="button" role="tab" aria-selected={tab === i} className={tab === i ? "on" : undefined} onClick={() => setTab(i)}>{l.h}</button>
        ))}
      </div>
      {lists.filter((l) => l.items.length).map((l, i) => (
        <div key={l.h} className={`panel pad${tab === i ? "" : " mhide"}`}>
          <div className="lbl">{l.h.toUpperCase()}</div>
          <div className="note" style={{ margin: "2px 0 8px" }}>{l.sub}</div>
          {l.items.map(({ r, v, tone }) => (
            <Link key={r.address} href={`/stocks/${r.symbol.toLowerCase()}`} className="mrow">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {r.logo ? <img src={r.logo} alt="" width={22} height={22} /> : <Ticker symbol={r.symbol} size={22} />}
              <b>{r.symbol}</b><span className={tone}>{v}</span>
            </Link>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function Stocks({ rows, updated }: { rows: StockRow[]; updated: number }) {
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const [more, setMore] = useState(false); // the first 30 rows until asked
  const routed = rows.filter((r) => r.route).length;
  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    return rows.filter((r) => (all || k || r.route) && (!k || r.symbol.toLowerCase().includes(k) || r.name.toLowerCase().includes(k) || r.address.toLowerCase() === k));
  }, [rows, q, all]);
  return (
    <>
      <WatchlistPanel chain="robinhood" />
      <Movers rows={rows} />
      <div className="panel pad">
        <div className="stockbar">
          <input type="search" placeholder="Search ticker or name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search stock tokens" />
          <button className="ghost" type="button" aria-pressed={all} onClick={() => setAll((v) => !v)}>
            {all ? `Only those Stoa routes (${routed})` : `Show all ${rows.length}`}
          </button>
        </div>
        <div className="stockhead" aria-hidden="true"><span>Token</span><span>Robinhood price</span><span>On-chain price</span><span>On-chain liquidity</span><span /></div>
        <div className="stocklist">
          {(more || q ? shown : shown.slice(0, 30)).map((r) => {
            const diff = r.ref && r.dex ? (r.dex.priceUsd - r.ref) / r.ref * 100 : null;
            return (
              <div key={r.address} className="stock">
                <div className="sname">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {r.logo ? <img src={r.logo} alt="" width={30} height={30} loading="lazy" /> : <Ticker symbol={r.symbol} />}
                  <Link href={`/stocks/${r.symbol.toLowerCase()}`} className="slink"><b>{r.symbol}</b><small>{r.name}</small></Link>
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
          {!more && !q && shown.length > 30 && <button type="button" className="ghost" style={{ alignSelf: "center", marginTop: 6 }} onClick={() => setMore(true)}>Show {shown.length - 30} more</button>}
        </div>
        <details className="note fold" style={{ marginBottom: 0 }}>
          <summary>How this page works</summary>
          Robinhood price: the mid of Robinhood&apos;s bid and ask for one token, from the underlying shares (it moves only while the US market, extended hours or the overnight session is open).
          On-chain price: the deepest pool DexScreener lists; the percentage is how far it is from Robinhood&apos;s price.
          Swap appears when Stoa&apos;s router can buy the token with 100 USDG right now; Trade then quotes your exact amount across every venue.
          Updated {new Date(updated).toUTCString().slice(17, 22)} UTC. <Link href="/docs/stocks">More in the docs</Link>
        </details>
      </div>
    </>
  );
}

"use client";
import Link from "next/link";
import { TokenIcon } from "./ui";
import { useNow, useSpotlightWinners } from "./spotlightData";
import { usePrices, fmtUsd } from "@/lib/prices";
import { ROBINHOOD } from "@/lib/networks";
import { epochAt } from "@/lib/spotlight";

/** This week's Spotlight winners as cards (Launches, Tokens, and compact beside Trade). Each card: logo, symbol, price
 *  and 24h change, a Trade button, the free safety check and the week's results page. Always marked Sponsored. Renders
 *  nothing until a week has been settled with winners. */
export default function SpotlightStrip({ compact = false }: { compact?: boolean }) {
  const ws = useSpotlightWinners();
  const price = usePrices(ROBINHOOD, ws);
  const week = epochAt(useNow(60_000)); // winners shown now are last week's: epoch e-1 is week e
  if (!ws.length) return null;
  return (
    <div className="panel pad spstrip" style={{ marginBottom: compact ? 0 : 20 }}>
      <div className="rowx">
        <div className="lbl">SPOTLIGHT · WEEK {week} WINNERS</div>
        <Link href="/spotlight" className="chip" title="Projects bid ETH for these slots; $STOA holders voted for them and earn the bids">Sponsored</Link>
      </div>
      <div className={compact ? "spgrid c" : "spgrid"}>
        {ws.map((t) => {
          const p = price(t);
          return (
            <div key={t.address} className="spcard">
              <div className="sphead">
                <TokenIcon t={t} />
                <b className="spsym">{t.symbol}</b>
                {p && <span className="sppx">{fmtUsd(p.usd)}{p.ch24 !== undefined && <small style={{ color: p.ch24 >= 0 ? "var(--accent-d)" : "#B4532A" }}> {p.ch24 >= 0 ? "+" : ""}{p.ch24.toFixed(1)}%</small>}</span>}
              </div>
              <div className="spbtns">
                <Link className="cta" href={`/trade?chain=robinhood&buy=${t.address}`}>Trade</Link>
                <Link className="ghost" href={`/check/robinhood/${t.address}`}>Safety check</Link>
              </div>
            </div>
          );
        })}
      </div>
      <p className="note">Projects bid ETH for these slots and $STOA holders voted for them. Not reviewed by Stoa: check the token before you buy. <Link href={`/spotlight/week/${week}`}>Week {week} results</Link></p>
    </div>
  );
}

/** The same winners as a row at the top of Trade's token list (Robinhood Chain only). A pick goes through the same
 *  import path as a pasted address, so an unlisted token keeps its "unverified" warning. */
export function SpotlightPicks({ onImport }: { onImport: (address: string) => void }) {
  const ws = useSpotlightWinners();
  if (!ws.length) return null;
  return (
    <div style={{ padding: "4px 8px 8px", borderBottom: "1px solid var(--line)", marginBottom: 6 }}>
      <div className="rowx" style={{ marginBottom: 6 }}>
        <small style={{ fontFamily: "var(--num)", letterSpacing: ".12em", color: "var(--muted)" }}>SPOTLIGHT</small>
        <Link href="/spotlight" style={{ fontSize: 11.5, color: "var(--muted)" }}>Sponsored</Link>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {ws.map((t) => (
          <button key={t.address} type="button" className="ghost" style={{ padding: "6px 10px", minHeight: 0 }} onClick={() => onImport(t.address)}>
            <TokenIcon t={t} />{t.symbol}
          </button>
        ))}
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/ui";
import { venueSnapshot, type VenueRow } from "@/lib/venueSnapshot";
import { THIN, groups, summarize } from "@/lib/compareGroups";

// /compare: the same swaps quoted on every venue Stoa routes, in one block, next to what Stoa's own route returns
// after its fee. Live from the chain (read-only eth_calls), refreshed every 10 minutes. The same rows feed the open
// venue-quotes dataset on Hugging Face.
export const revalidate = 600;
export const metadata: Metadata = {
  title: "Stoa vs single venues on Robinhood Chain",
  description: "The same swap quoted on Uniswap V2, V3, V4, Aero, Ramses and Pons in one block on Robinhood Chain, next to what Stoa's route returns after its 2 bps fee. Live from the chain.",
  alternates: { canonical: "/compare" },
};

const num = (v: number) => v.toLocaleString("en-US", { maximumSignificantDigits: 7 });

export default async function Page() {
  const rows = await venueSnapshot().catch(() => [] as VenueRow[]);
  const gs = groups(rows);
  const block = rows[0]?.block, time = rows[0]?.time;
  const { medSpread, maxSpread, near, above, tops } = summarize(gs);
  return (
    <section className="page">
      <PageHead eyebrow="COMPARE · ROBINHOOD CHAIN" title="One swap, every venue">
        The same swaps quoted on every venue Stoa routes, in the same block, next to what Stoa&apos;s route returns after its 2 bps fee. Which venue pays the most changes with the pair, the size and the minute: Stoa checks them all on every swap so you don&apos;t have to.
      </PageHead>
      {!gs.length ? (
        <div className="notice">Robinhood Chain did not answer just now. This page refreshes every 10 minutes.</div>
      ) : (
        <>
          <div className="grid3 sgrid" style={{ marginBottom: 20 }}>
            <div className="panel pad"><div className="lbl">GAP BETWEEN VENUES</div><div style={{ fontFamily: "var(--num)", fontSize: 24, marginTop: 6 }}>{medSpread.toFixed(0)} bps</div><p className="note" style={{ marginTop: 6 }}>Typical (median) gap between the venue that paid the most and the one that paid the least, across {gs.length} swaps; up to {maxSpread.toFixed(0)} bps</p></div>
            <div className="panel pad"><div className="lbl">VENUES ON TOP</div><div style={{ fontFamily: "var(--num)", fontSize: 24, marginTop: 6 }}>{tops.length}</div><p className="note" style={{ marginTop: 6 }}>Different venues paid the most for at least one of these swaps: {tops.join(", ")}</p></div>
            <div className="panel pad"><div className="lbl">STOA&apos;S ROUTE</div><div style={{ fontFamily: "var(--num)", fontSize: 24, marginTop: 6 }}>{near} of {gs.length}</div><p className="note" style={{ marginTop: 6 }}>Within 3 bps of the top venue after Stoa&apos;s fee{above ? `; above it in ${above}, by routing through a second venue` : ""}</p></div>
          </div>
          <div className="spgrid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", marginTop: 0 }}>
            {gs.map((g) => {
              const top = g.rows[0].amount_out!;
              const bps = (v: number) => ((v - top) / top) * 10_000;
              return (
                <div key={g.key} className="panel pad">
                  <div className="lbl">SELL {num(g.amount)} {g.sell} FOR {g.buy}</div>
                  <table className="tbl" style={{ marginTop: 8 }}>
                    <thead><tr><th>Venue</th><th style={{ textAlign: "right" }}>You get</th><th style={{ textAlign: "right" }}>vs top</th></tr></thead>
                    <tbody>
                      {g.router !== null && (
                        <tr style={{ background: "var(--accent-l, #eef7f2)" }}><td><b>Stoa route</b> <small className="note" style={{ margin: 0 }}>after 2 bps fee</small></td><td style={{ textAlign: "right", fontFamily: "var(--num)" }}><b>{num(g.router)}</b></td><td style={{ textAlign: "right", fontFamily: "var(--num)" }}>{bps(g.router) >= 0 ? "+" : ""}{bps(g.router).toFixed(1).replace("-", "−")}</td></tr>
                      )}
                      {g.rows.map((r) => (
                        <tr key={r.venue_address}><td>{r.venue}</td><td style={{ textAlign: "right", fontFamily: "var(--num)" }}>{num(r.amount_out!)}</td><td style={{ textAlign: "right", fontFamily: "var(--num)" }}>{r.amount_out === top ? "top" : bps(r.amount_out!).toFixed(1).replace("-", "−")}</td></tr>
                      ))}
                    </tbody>
                  </table>
                  {g.thin.length > 0 && <p className="note" style={{ marginTop: 6 }}>Also quoted, under {THIN * 100}% of the top (thin pool for this pair): {g.thin.map((r) => r.venue).join(", ")}</p>}
                </div>
              );
            })}
          </div>
          <p className="note" style={{ marginTop: 16 }}>
            Quoted with read-only calls at block {block} ({time ? new Date(time * 1000).toISOString().slice(0, 16).replace("T", " ") : ""} UTC); venues with no pool for a pair are left out. &quot;vs top&quot; is in basis points (1 bps = 0.01%) against the venue that paid the most. Single venues are shown before any fee; Stoa&apos;s route is what you receive after its fee. Quotes move every block and a large swap can move the price. Every snapshot is in the open <a href="https://huggingface.co/datasets/StoaDex/robinhood-chain-venue-quotes" target="_blank" rel="noopener noreferrer">venue-quotes dataset</a>. <Link href="/docs/how-stoa-works">How Stoa routes</Link>
          </p>
        </>
      )}
    </section>
  );
}

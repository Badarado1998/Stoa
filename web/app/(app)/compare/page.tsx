import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/ui";
import { venueSnapshot, type VenueRow } from "@/lib/venueSnapshot";

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
type Group = { key: string; sell: string; buy: string; amount: number; router: number | null; rows: VenueRow[]; thin: VenueRow[] };
const THIN = 0.9; // a venue paying under 90% of the top one has a near-empty pool for this pair: listed apart, not counted

function groups(rows: VenueRow[]): Group[] {
  const m = new Map<string, Group>();
  for (const r of rows) {
    const k = `${r.pair}:${r.amount_in}`;
    if (!m.has(k)) m.set(k, { key: k, sell: r.sell, buy: r.buy, amount: r.amount_in, router: r.router_out, rows: [], thin: [] });
    if (r.amount_out !== null) m.get(k)!.rows.push(r);
  }
  return [...m.values()]
    .map((g) => {
      const all = g.rows.sort((a, b) => b.amount_out! - a.amount_out!);
      const top = all[0]?.amount_out ?? 0;
      return { ...g, rows: all.filter((r) => r.amount_out! >= top * THIN), thin: all.filter((r) => r.amount_out! < top * THIN) };
    })
    .filter((g) => g.rows.length >= 2);
}

export default async function Page() {
  const rows = await venueSnapshot().catch(() => [] as VenueRow[]);
  const gs = groups(rows);
  const block = rows[0]?.block, time = rows[0]?.time;
  // facts for the summary line: how far apart the venues were, which venue was on top, and how close Stoa's route was
  const spread = gs.map((g) => (g.rows[0].amount_out! - g.rows[g.rows.length - 1].amount_out!) / g.rows[0].amount_out! * 10_000);
  const sorted = [...spread].sort((a, b) => a - b);
  const medSpread = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const maxSpread = sorted.length ? sorted[sorted.length - 1] : 0;
  const tops = new Set(gs.map((g) => g.rows[0].venue));
  const near = gs.filter((g) => g.router !== null && g.router >= g.rows[0].amount_out! * (1 - 0.0003)).length;
  const above = gs.filter((g) => g.router !== null && g.router > g.rows[0].amount_out!).length;
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
            <div className="panel pad"><div className="lbl">VENUES ON TOP</div><div style={{ fontFamily: "var(--num)", fontSize: 24, marginTop: 6 }}>{tops.size}</div><p className="note" style={{ marginTop: 6 }}>Different venues paid the most for at least one of these swaps: {[...tops].join(", ")}</p></div>
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

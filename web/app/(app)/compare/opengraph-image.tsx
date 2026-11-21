import { ImageResponse } from "next/og";
import { BLUE, MUTED, OG_SIZE, OgFrame, ogFonts } from "@/lib/og";
import { venueSnapshot, type VenueRow } from "@/lib/venueSnapshot";
import { groups, spreadBps, summarize, type Group } from "@/lib/compareGroups";

// Live card for links to /compare: one swap quoted on every venue in the same block, next to Stoa's route,
// plus the summary across the whole basket. Re-read every 10 minutes, like the page.
export const revalidate = 600;
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "The same swap quoted on every venue on Robinhood Chain in one block, next to what Stoa's route returns after its fee.";

const num = (v: number) => v.toLocaleString("en-US", { maximumSignificantDigits: 6 });
const bps = (v: number, top: number) => {
  const x = ((v - top) / top) * 10_000;
  return Math.abs(x) < 0.05 ? "top" : `${x > 0 ? "+" : "−"}${Math.abs(x).toFixed(1)} bps`;
};

/** The examples on the card: the swaps with the most venues, then the widest gap, so the difference is visible. */
function pick(gs: Group[], n: number): Group[] {
  return [...gs].sort((a, b) => b.rows.length - a.rows.length || spreadBps(b) - spreadBps(a)).slice(0, n);
}

export default async function Image() {
  const rows = await venueSnapshot().catch(() => [] as VenueRow[]);
  const gs = groups(rows);
  const s = summarize(gs);
  // one swap with up to 5 venues, or two swaps with up to 2 venues each when the first is short
  const first = pick(gs, 1)[0];
  const shown = first && first.rows.length >= 4 ? [first] : pick(gs, 2);
  const per = shown.length > 1 ? 2 : 5;
  const tiles: [string, string, string][] = gs.length
    ? [
        ["GAP BETWEEN VENUES", `${s.medSpread.toFixed(0)} bps`, `median of ${s.swaps} swaps, up to ${s.maxSpread.toFixed(0)}`],
        ["STOA'S ROUTE", `${s.near} of ${s.swaps}`, "within 3 bps of the top venue, after fee"],
      ]
    : [["LIVE QUOTES", "every venue", "refreshed every 10 minutes"]];
  return new ImageResponse(
    (
      <OgFrame url="stoadex.com/compare" foot={rows[0] ? `ONE BLOCK · #${rows[0].block} · READ-ONLY QUOTES` : "LIVE READ-ONLY QUOTES"}>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 26 }}>
          <span style={{ fontFamily: "Marcellus", fontSize: 64, lineHeight: 1 }}>One swap, every venue</span>
        </div>
        <div style={{ display: "flex", gap: 22, marginTop: 24 }}>
          <div style={{ display: "flex", flexDirection: "column", flex: 1.45, gap: 14, background: "rgba(255,255,255,.95)", borderRadius: 22, padding: "16px 24px", boxShadow: "0 16px 36px rgba(24,32,44,.10)" }}>
            {!shown.length && <span style={{ fontFamily: "Mono", fontSize: 14, letterSpacing: 3, color: MUTED }}>QUOTES LOADING</span>}
            {shown.map((g) => {
              const top = g.rows[0].amount_out!;
              return (
                <div key={g.key} style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontFamily: "Mono", fontSize: 14, letterSpacing: 3, color: MUTED }}>{`SELL ${num(g.amount)} ${g.sell} FOR ${g.buy}`}</span>
                  {g.router !== null && (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, padding: "6px 12px", borderRadius: 12, background: "#E8F0FC" }}>
                      <span style={{ fontSize: 21, fontWeight: 700, color: BLUE }}>Stoa route</span>
                      <span style={{ display: "flex", gap: 18, fontFamily: "Mono", fontSize: 19 }}><span>{num(g.router)}</span><span style={{ color: BLUE, width: 130, justifyContent: "flex-end", display: "flex" }}>{bps(g.router, top)}</span></span>
                    </div>
                  )}
                  {g.rows.slice(0, per).map((r) => (
                    <div key={r.venue_address} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 12px", borderBottom: "1px solid #EEF1F5" }}>
                      <span style={{ fontSize: 19 }}>{r.venue}</span>
                      <span style={{ display: "flex", gap: 18, fontFamily: "Mono", fontSize: 17, color: MUTED }}><span>{num(r.amount_out!)}</span><span style={{ width: 130, justifyContent: "flex-end", display: "flex" }}>{bps(r.amount_out!, top)}</span></span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 18 }}>
            {tiles.map(([k, v, sub]) => (
              <div key={k} style={{ display: "flex", flexDirection: "column", background: "rgba(255,255,255,.95)", borderRadius: 22, padding: "16px 22px", boxShadow: "0 16px 36px rgba(24,32,44,.10)" }}>
                <span style={{ fontFamily: "Mono", fontSize: 14, letterSpacing: 3, color: MUTED }}>{k}</span>
                <span style={{ fontSize: 42, fontWeight: 700, marginTop: 6, color: k === "STOA'S ROUTE" ? BLUE : undefined }}>{v}</span>
                <span style={{ fontSize: 17, color: MUTED, marginTop: 2 }}>{sub}</span>
              </div>
            ))}
          </div>
        </div>
      </OgFrame>
    ),
    { ...size, fonts: await ogFonts() },
  );
}

import { ImageResponse } from "next/og";
import { BLUE, MUTED, OG_SIZE, OgFrame, ogFonts } from "@/lib/og";
import { readLeaders, type Leaders } from "@/lib/spotlightLeaders";
import { SPOT_START, WEEK, utc } from "@/lib/spotlight";

// Live card for links to /spotlight/leaders: the top three earners and what Spotlight has paid voters, from the chain.
// Before the first week is settled it says when the first payouts land.
export const revalidate = 600;
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Stoa Spotlight top earners: the $STOA holders paid the most ETH for their votes.";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const eth = (v: number) => (v < 0.0001 ? "<0.0001" : v.toLocaleString("en-US", { maximumFractionDigits: v < 1 ? 4 : 3 }));
const card = { display: "flex", flexDirection: "column" as const, background: "rgba(255,255,255,.95)", borderRadius: 22, boxShadow: "0 16px 36px rgba(24,32,44,.10)" };
const MEDAL = ["#D9A520", "#9AA6B6", "#C07A45"];

export default async function Image() {
  const d: Leaders | null = await readLeaders(3).catch(() => null);
  const has = !!d && d.leaders.length > 0;
  return new ImageResponse(
    (
      <OgFrame url="stoadex.com/spotlight/leaders" foot={has ? `${d!.settledWeeks} WEEK${d!.settledWeeks === 1 ? "" : "S"} SETTLED · READ FROM THE CONTRACT` : "SPOTLIGHT · ROBINHOOD CHAIN"}>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 26 }}>
          <span style={{ fontFamily: "Mono", fontSize: 18, letterSpacing: 6, color: BLUE }}>SPOTLIGHT · TOP EARNERS</span>
          <span style={{ fontFamily: "Marcellus", fontSize: 64, lineHeight: 1.05, marginTop: 8 }}>Paid in ETH for voting</span>
        </div>
        {has ? (
          <div style={{ display: "flex", gap: 20, marginTop: 28 }}>
            <div style={{ ...card, flex: 1.6, padding: "12px 24px" }}>
              {d!.leaders.map((l, i) => (
                <div key={l.address} style={{ display: "flex", alignItems: "center", gap: 16, padding: "10px 0", borderBottom: i < d!.leaders.length - 1 ? "1px solid #EEF1F5" : "none" }}>
                  <span style={{ display: "flex", width: 40, height: 40, borderRadius: 999, background: MEDAL[i], color: "#fff", alignItems: "center", justifyContent: "center", fontFamily: "Mono", fontSize: 20 }}>{i + 1}</span>
                  <span style={{ fontFamily: "Mono", fontSize: 24, flexGrow: 1 }}>{short(l.address)}</span>
                  <span style={{ fontSize: 28, fontWeight: 700 }}>{eth(l.eth)} ETH</span>
                </div>
              ))}
            </div>
            <div style={{ ...card, flex: 1, padding: "18px 24px", justifyContent: "center" }}>
              <span style={{ fontFamily: "Mono", fontSize: 14, letterSpacing: 3, color: MUTED }}>PAID TO VOTERS</span>
              <span style={{ fontSize: 50, fontWeight: 700, color: BLUE, marginTop: 6 }}>{eth(d!.paidEth)} ETH</span>
              <span style={{ fontSize: 18, color: MUTED, marginTop: 4 }}>{d!.voters} voter{d!.voters === 1 ? "" : "s"} paid · 90% of winning bids</span>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 20, marginTop: 30 }}>
            <div style={{ ...card, flex: 1.4, padding: "20px 26px" }}>
              <span style={{ fontFamily: "Mono", fontSize: 14, letterSpacing: 3, color: MUTED }}>FIRST PAYOUTS</span>
              <span style={{ fontSize: 40, fontWeight: 700, marginTop: 8 }}>{utc(SPOT_START + WEEK)}</span>
              <span style={{ fontSize: 19, color: MUTED, marginTop: 6 }}>when week 1 closes and is settled</span>
            </div>
            <div style={{ ...card, flex: 1, padding: "20px 26px" }}>
              <span style={{ fontFamily: "Mono", fontSize: 14, letterSpacing: 3, color: MUTED }}>TO VOTERS</span>
              <span style={{ fontSize: 40, fontWeight: 700, color: BLUE, marginTop: 8 }}>90%</span>
              <span style={{ fontSize: 19, color: MUTED, marginTop: 6 }}>of each winning bid, in ETH</span>
            </div>
          </div>
        )}
      </OgFrame>
    ),
    { ...size, fonts: await ogFonts() },
  );
}

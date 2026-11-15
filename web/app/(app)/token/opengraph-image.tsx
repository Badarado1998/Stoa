import { ImageResponse } from "next/og";
import { BLUE, MUTED, OG_SIZE, OgFrame, ogFonts } from "@/lib/og";
import { CA } from "@/lib/stoaAddress";
import { readSupply, type Supply } from "@/lib/stoaSupply";

// Live card for links to /token: curve progress, burned and circulating $STOA, re-read every 5 minutes.
export const revalidate = 300;
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "$STOA: Stoa's protocol fees buy and burn it, makers bond it. Live curve progress and supply.";

const short = (v: bigint) => {
  const n = Number(v) / 1e18;
  if (n >= 1e9) return `${+(n / 1e9).toFixed(2)}B`;
  return n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(0);
};

export default async function Image() {
  let s: Supply | null = null;
  try { s = await readSupply(); } catch { /* card still renders without numbers */ }
  const pct = s ? (s.graduated ? 100 : Math.min(99.9, (Number(s.curveEth) / Number(s.threshold)) * 100)) : null;
  const eth = (v: bigint) => (Number(v) / 1e18).toFixed(2);
  const stats: [string, string, string][] = [
    ["PONS CURVE", s?.graduated ? "Graduated" : pct === null ? "—" : `${pct.toFixed(1)}%`, s?.graduated ? "routes on Stoa" : s ? `${eth(s.curveEth)} / ${eth(s.threshold)} ETH` : "live on stoadex.com"],
    ["BURNED", s ? short(s.burned) : "—", "sent to 0x…dEaD"],
    ["CIRCULATING", s ? short(s.circulating) : "—", s ? `of ${short(s.max)} max` : "1B max"],
  ];
  return new ImageResponse(
    (
      <OgFrame url="stoadex.com/token" foot={`CA ${CA.slice(0, 6)}…${CA.slice(-4)} · LIVE ON-CHAIN DATA`}>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 34 }}>
          <span style={{ fontFamily: "Marcellus", fontSize: 74, lineHeight: 1 }}>$STOA</span>
          <span style={{ fontFamily: "Marcellus", fontSize: 40, color: BLUE, marginTop: 14 }}>Fees buy it and burn it. Makers bond it.</span>
        </div>
        <div style={{ display: "flex", gap: 20, marginTop: 38 }}>
          {stats.map(([k, v, sub]) => (
            <div key={k} style={{ display: "flex", flexDirection: "column", flex: 1, background: "rgba(255,255,255,.95)", borderRadius: 22, padding: "20px 24px", boxShadow: "0 16px 36px rgba(24,32,44,.10)" }}>
              <span style={{ fontFamily: "Mono", fontSize: 14, letterSpacing: 3, color: MUTED }}>{k}</span>
              <span style={{ fontSize: 46, fontWeight: 700, marginTop: 8, color: k === "PONS CURVE" ? BLUE : undefined }}>{v}</span>
              <span style={{ fontSize: 17, color: MUTED, marginTop: 4 }}>{sub}</span>
            </div>
          ))}
        </div>
      </OgFrame>
    ),
    { ...size, fonts: await ogFonts() },
  );
}

import { ImageResponse } from "next/og";
import { OG_SIZE, dataUrl, ogFonts } from "@/lib/og";

// Card for /ai (X, Telegram previews): bright, with the logos of what Stoa AI reads. Static.
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Stoa AI: ask Robinhood Chain anything. Early beta.";

export default async function Image() {
  const [stoa, rh, uni, pons, usdg, nvda, eth] = await Promise.all(
    ["stoa-logo-200.png", "networks/robinhood.png", "og/uniswap.png", "og/pons.png", "og/usdg.png", "og/nvda.png", "tokens/eth.svg"].map(dataUrl),
  );
  const ring = [rh, uni, pons, usdg, nvda, eth];
  const pos = [[880, 70], [1040, 190], [1060, 380], [900, 480], [740, 400], [720, 190]];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", fontFamily: "Inter", background: "#F7F5FF", color: "#1B1F3B", position: "relative" }}>
        <div style={{ position: "absolute", left: -200, top: -260, width: 760, height: 760, borderRadius: 999, background: "#DCCBFF", display: "flex", opacity: 0.8 }} />
        <div style={{ position: "absolute", right: -220, bottom: -260, width: 760, height: 760, borderRadius: 999, background: "#C6E6FF", display: "flex", opacity: 0.9 }} />
        <div style={{ position: "absolute", left: 790, top: 205, width: 230, height: 230, borderRadius: 999, background: "radial-gradient(circle at 35% 30%,#ffffff,#e5dcff 45%,#b9a3ff 80%,#7d5cf5)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 30px 60px rgba(90,60,200,.3)" }}>
          <img src={stoa} width={130} height={130} style={{ borderRadius: 30 }} />
        </div>
        {ring.map((src, i) => (
          <div key={i} style={{ position: "absolute", left: pos[i][0], top: pos[i][1], width: 92, height: 92, borderRadius: 999, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 14px 30px rgba(50,40,130,.16)", overflow: "hidden" }}>
            <img src={src} width={i === 0 ? 92 : 64} height={i === 0 ? 92 : 64} style={{ borderRadius: i === 0 ? 0 : 999 }} />
          </div>
        ))}
        <div style={{ display: "flex", flexDirection: "column", padding: "64px 70px", width: 680 }}>
          <span style={{ display: "flex", alignSelf: "flex-start", fontFamily: "Mono", fontSize: 22, letterSpacing: 4, color: "#6A3DF0", background: "#fff", padding: "10px 20px", borderRadius: 999 }}>EARLY BETA</span>
          <span style={{ fontSize: 96, fontWeight: 700, letterSpacing: -4, marginTop: 34, lineHeight: 1 }}>Stoa AI</span>
          <span style={{ fontSize: 40, fontWeight: 700, color: "#3B48C8", marginTop: 10 }}>Ask Robinhood Chain anything</span>
          <span style={{ fontSize: 26, color: "#4B4F6E", marginTop: 26, lineHeight: 1.35 }}>Safety checks, swaps, strategies, rug alerts. You sign every swap.</span>
          <span style={{ display: "flex", alignSelf: "flex-start", marginTop: "auto", padding: "12px 22px", borderRadius: 999, background: "#1B1F3B", color: "#fff", fontFamily: "Mono", fontSize: 22 }}>stoadex.com/ai</span>
        </div>
      </div>
    ),
    { ...size, fonts: await ogFonts() },
  );
}

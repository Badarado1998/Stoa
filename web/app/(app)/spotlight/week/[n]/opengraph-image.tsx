import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { BLUE, INK, MUTED, OG_SIZE, ogFonts } from "@/lib/og";
import { loadSpotlightHistory } from "@/lib/spotlightHistory";

// The recap card for /spotlight/week/<n>: the week's winners and the ETH their voters got. Never fails: without data it
// shows a plain Spotlight card.
export const revalidate = 300;
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "A finished Stoa Spotlight week: its winners and the ETH paid to the $STOA holders who voted for them.";

const eth = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 4 });

export default async function Image({ params }: { params: Promise<{ n: string }> }) {
  const { n } = await params;
  const w = (await loadSpotlightHistory().catch(() => [])).find((x) => String(x.week) === n);
  const logo = `data:image/png;base64,${(await readFile(join(process.cwd(), "public", "logo.png"))).toString("base64")}`;
  const toVoters = w ? w.winners.reduce((a, x) => a + x.toVotersEth, 0) : 0;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: "52px 64px", fontFamily: "Inter", color: INK, background: "radial-gradient(circle at 85% 10%, #FFE9A8 0%, rgba(255,233,168,0) 40%), linear-gradient(135deg,#F4F7FF 0%,#FFFBF1 100%)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <img src={logo} width={42} height={42} style={{ objectFit: "contain" }} />
          <span style={{ fontFamily: "Marcellus", fontSize: 26, letterSpacing: 8 }}>STOA</span>
          <span style={{ marginLeft: "auto", fontFamily: "Mono", fontSize: 16, letterSpacing: 4, color: BLUE }}>{`SPOTLIGHT · WEEK ${n}`}</span>
        </div>
        <span style={{ fontFamily: "Marcellus", fontSize: 76, lineHeight: 1.05, marginTop: 40 }}>{w ? (w.winners.length ? `Week ${n} winners` : `Week ${n}: no winner`) : "Stoa Spotlight"}</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 30 }}>
          {(w?.winners ?? []).slice(0, 3).map((x, i) => (
            <div key={x.token} style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 34 }}>
              <span style={{ display: "flex", width: 46, height: 46, borderRadius: 23, background: ["#F5C542", "#C9D2DE", "#E0A26B"][i], alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 700 }}>{i + 1}</span>
              <b style={{ fontWeight: 700 }}>{`$${x.symbol}`}</b>
              <span style={{ color: MUTED, fontSize: 26 }}>{`bid ${eth(x.bidEth)} ETH`}</span>
              <span style={{ marginLeft: "auto", color: "#1F7A4D", fontSize: 30 }}>{`${eth(x.toVotersEth)} ETH to voters`}</span>
            </div>
          ))}
          {w && !w.winners.length && <span style={{ fontSize: 30, color: MUTED }}>No token reached the vote quorum. Every bid can be refunded.</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", marginTop: "auto" }}>
          <span style={{ fontSize: 22, color: MUTED }}>{w && w.winners.length ? `${eth(toVoters)} ETH to $STOA voters · ${w.bids} tokens bid` : "Projects bid ETH. $STOA holders vote and earn it."}</span>
          <span style={{ marginLeft: "auto", display: "flex", padding: "11px 20px", borderRadius: 999, background: "linear-gradient(135deg,#1F5FB0,#4C97F0)", color: "#fff", fontFamily: "Mono", fontSize: 17 }}>stoadex.com/spotlight</span>
        </div>
      </div>
    ),
    { ...size, fonts: await ogFonts(), headers: { "cache-control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600" } },
  );
}

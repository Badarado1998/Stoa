import type { Metadata } from "next";
import { isAddress } from "viem";
import { SITE } from "@/lib/chain";
import { ethTxt, readVote, stoaTxt, utcTxt } from "@/lib/spotlightVote";

// /embed/spotlight/<token>: a small "Vote for us" card a project puts on its own website (stoadex.com/stoa-spotlight.js
// or an iframe): its Spotlight bid, its votes against the quorum, whether it wins now, and a button to vote on Stoa in a
// new tab. No wallet ever connects inside the frame. Read from SpotlightMarket, kept two minutes.
export const revalidate = 120;
export const metadata: Metadata = { title: "Vote in Stoa Spotlight", robots: { index: false, follow: false } };

type P = { params: Promise<{ token: string }> };

function Foot() {
  return (
    <div className="em-foot">
      <a href={`${SITE}/spotlight`} target="_blank" rel="noopener noreferrer">Stoa <b>SPOTLIGHT</b></a>
      <span>Sponsored · not financial advice</span>
    </div>
  );
}

export default async function SpotlightEmbed({ params }: P) {
  const { token } = await params;
  const v = isAddress(token, { strict: false }) ? await readVote(token).catch(() => undefined) : null;
  if (v === undefined) return <div className="embed"><div className="em-q">Robinhood Chain did not answer.<small>This card tries again in a minute.</small></div><Foot /></div>;
  if (!v) {
    return (
      <div className="embed">
        <div className="em-q">Not in this week&apos;s Spotlight race.<small>Projects bid ETH for 3 sponsored slots on Stoa every week; $STOA holders vote.</small></div>
        <a className="em-buy" href={`${SITE}/spotlight`} target="_blank" rel="noopener noreferrer">See Stoa Spotlight ↗</a>
        <Foot />
      </div>
    );
  }
  const pct = v.quorumStoa > 0 ? Math.min(100, (v.votesStoa / v.quorumStoa) * 100) : 0;
  const status = v.canceled ? "Bid canceled" : v.winning ? "Winning now" : pct < 100 ? `Needs ${stoaTxt(v.quorumStoa - v.votesStoa)} more votes` : `Outside the top ${v.slots}`;
  return (
    <div className="embed">
      <div className="em-top">
        <span className="em-logo em-glyph" aria-hidden>🔦</span>
        <div className="em-id"><b>Vote for ${v.symbol}</b><span>Stoa Spotlight · week {v.week}</span></div>
        <div className="em-px"><b>{ethTxt(v.bidEth)} ETH</b><span>bid</span></div>
      </div>
      <div className="em-q">
        <b>{status}</b> · {stoaTxt(v.votesStoa)} / {stoaTxt(v.quorumStoa)} $STOA votes
        <div role="progressbar" aria-label="Votes toward the quorum" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} style={{ height: 8, borderRadius: 8, background: "rgba(47,111,214,.12)", marginTop: 8, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: v.winning ? "#1F9D63" : "var(--accent)" }} />
        </div>
        <small>If it wins, {v.toVotersPct}% of the bid goes to its voters in ETH · votes close {utcTxt(v.votesCloseAt)}</small>
      </div>
      <a className="em-buy" href={`${SITE}/spotlight/vote/${v.token.toLowerCase()}`} target="_blank" rel="noopener noreferrer">Lock $STOA and vote ↗</a>
      <Foot />
    </div>
  );
}

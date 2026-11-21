import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { SITE } from "@/lib/chain";
import { readSpotlight } from "@/lib/spotlightServer";
import { ethTxt, stoaTxt, utcTxt } from "@/lib/spotlightVote";

// /embed/spotlight?theme=dark&rows=5: the whole Spotlight race as a card any website can frame
// (stoadex.com/stoa-spotlight.js with no data-token, or an iframe): this week's bids, each token's votes against the
// quorum, which ones win now, and a button to vote on Stoa in a new tab. No wallet ever connects inside the frame.
// Read from SpotlightMarket, kept one minute; a failed read is not kept.
export const metadata: Metadata = { title: "Stoa Spotlight race", robots: { index: false, follow: false } };

const race = unstable_cache(readSpotlight, ["spotlight-race-embed"], { revalidate: 60 });
type SP = { searchParams: Promise<{ theme?: string; rows?: string }> };

function Foot() {
  return (
    <div className="em-foot">
      <a href={`${SITE}/spotlight`} target="_blank" rel="noopener noreferrer">Stoa <b>SPOTLIGHT</b></a>
      <span>Sponsored · not financial advice</span>
    </div>
  );
}

export default async function SpotlightRaceEmbed({ searchParams }: SP) {
  const sp = await searchParams;
  const dark = sp.theme === "dark";
  const max = Math.min(8, Math.max(3, parseInt(sp.rows ?? "5", 10) || 5));
  const cls = `embed${dark ? " em-dark" : ""}`;
  const d = await race().catch(() => null);
  if (!d) return <div className={cls}><div className="em-q">Robinhood Chain did not answer.<small>This card tries again in a minute.</small></div><Foot /></div>;

  const slots = d.rules.slots;
  const live = d.candidates.filter((c) => !c.canceled);
  // the contract's rule: the largest bids that reach the quorum win, up to the week's slots (ties keep bid order)
  const winning = new Set(live.filter((c) => c.reachesQuorum).slice(0, slots).map((c) => c.token.toLowerCase()));
  const rows = live.slice(0, max);
  const more = live.length - rows.length;
  const head = d.phase === "before_week_1"
    ? `Week 1 opens ${utcTxt(d.opensAt!)}`
    : d.phase === "bids_open" ? `Bids close ${utcTxt(d.bidsCloseAt)}` : `Bids are final · votes close ${utcTxt(d.votesCloseAt)}`;
  const q = d.rules.quorumStoa;

  return (
    <div className={cls}>
      <div className="em-top">
        <span className="em-logo em-glyph" aria-hidden>🔦</span>
        <div className="em-id"><b>Spotlight · week {d.week}</b><span>{head}</span></div>
        <div className="em-px"><b>{stoaTxt(d.stoaLocked)}</b><span>$STOA locked</span></div>
      </div>
      {rows.length === 0 ? (
        <div className="em-q">
          {d.phase === "before_week_1" ? "No bids yet: bidding opens with week 1." : "No bids yet this week."}
          <small>Projects bid ETH for {slots} sponsored slots on Stoa. $STOA holders vote, and {d.rules.toVotersPct}% of each winning bid goes to its voters in ETH.</small>
        </div>
      ) : (
        <div className="em-race" role="list">
          {rows.map((c, i) => {
            const k = c.token.toLowerCase();
            const win = winning.has(k);
            const pct = q > 0 ? Math.min(100, (c.votesStoa / q) * 100) : 0;
            const status = win ? "Winning now" : !c.reachesQuorum ? `Needs ${stoaTxt(Math.max(0, q - c.votesStoa))}` : "Outbid";
            return (
              <a key={k} role="listitem" className="em-rrow" href={`${SITE}/spotlight/vote/${k}`} target="_blank" rel="noopener noreferrer">
                <span className="em-rk">{i + 1}</span>
                <span className="em-rmain">
                  <span className="em-rtop"><b>{c.symbol ? `$${c.symbol}` : `${k.slice(0, 6)}…${k.slice(-4)}`}</b><span>{ethTxt(c.bidEth)} ETH</span></span>
                  <span className="em-rbar" aria-hidden><span style={{ width: `${pct}%`, background: win ? "#1F9D63" : undefined }} /></span>
                  <span className="em-rsub"><span>{stoaTxt(c.votesStoa)} votes</span><span className={win ? "em-win" : undefined}>{status}</span></span>
                </span>
              </a>
            );
          })}
          {more > 0 && <span className="em-dim" style={{ fontSize: 12 }}>+{more} more on stoadex.com</span>}
        </div>
      )}
      <a className="em-buy" href={`${SITE}/spotlight#race`} target="_blank" rel="noopener noreferrer">Lock $STOA and vote ↗</a>
      <Foot />
    </div>
  );
}

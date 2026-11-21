"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHead } from "@/components/ui";
import type { SpotWeek } from "@/lib/spotlightHistory";

type Snap = {
  week: number; phase: string; paused: boolean; opensAt: string | null; bidsCloseAt: string; votesCloseAt: string; stoaLocked: number;
  rules: { slots: number; quorumStoa: number; toVotersPct: number };
  candidates: { token: string; symbol: string | null; bidEth: number; votesStoa: number; reachesQuorum: boolean; canceled: boolean }[];
  totals: { ethPaidToVoters: number; stoaBurned: number };
};

const n0 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });
const mm = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : n0(v));
const eth = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 4 });
const pad = (v: number) => String(v).padStart(2, "0");
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const utc = (iso: string) => { const d = new Date(iso); return `${DAY[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`; };

/** the live board: polls /api/v1/spotlight every 15 seconds and ticks the countdown every second */
export default function SpotlightLive({ initial, history }: { initial: Snap | null; history: SpotWeek[] }) {
  const [s, setS] = useState<Snap | null>(initial);
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    const p = setInterval(() => { fetch("/api/v1/spotlight", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setS(d)).catch(() => undefined); }, 15_000);
    return () => { clearInterval(t); clearInterval(p); };
  }, []);
  if (!s) return <div className="notice">Spotlight did not answer right now. This page tries again on reload.</div>;

  const target = s.phase === "before_week_1" && s.opensAt ? s.opensAt : s.phase === "bids_open" ? s.bidsCloseAt : s.votesCloseAt;
  const what = s.phase === "before_week_1" ? "Week 1 opens" : s.phase === "bids_open" ? "Bids close" : "Votes close";
  const sec = now ? Math.max(0, Math.floor((Date.parse(target) - now) / 1000)) : null;
  const live = s.candidates.filter((c) => !c.canceled);
  const winning = new Set(live.filter((c) => c.reachesQuorum).slice(0, s.rules.slots).map((c) => c.token));
  const top = Math.max(s.rules.quorumStoa * 1.25, ...live.map((c) => c.votesStoa));
  const q = (s.rules.quorumStoa / top) * 100;
  const slotsOpen = Math.min(s.rules.slots, Math.floor(s.stoaLocked / s.rules.quorumStoa));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHead eyebrow={`SPOTLIGHT · WEEK ${s.week} · LIVE`} title="The race, as it happens">
        Every number on this board is read from SpotlightMarket on Robinhood Chain and refreshes every 15 seconds.
      </PageHead>
      {s.paused && <div className="notice">Spotlight is paused: no new bids, locks or votes. Claims and refunds still work.</div>}

      <div className="panel pad" style={{ textAlign: "center", background: "linear-gradient(135deg,#F3F7FF,#FFF7E6)" }}>
        <div className="lbl">{what.toUpperCase()}</div>
        <div aria-live="off" style={{ fontFamily: "var(--num)", fontSize: "clamp(40px, 11vw, 88px)", lineHeight: 1.05, marginTop: 6, letterSpacing: "-0.02em" }}>
          {sec === null ? "—" : `${Math.floor(sec / 86400)}d ${pad(Math.floor((sec % 86400) / 3600))}h ${pad(Math.floor((sec % 3600) / 60))}m ${pad(sec % 60)}s`}
        </div>
        <p className="note" style={{ marginBottom: 0 }}>{utc(target)}{s.phase === "bids_open" ? ` · votes close ${utc(s.votesCloseAt)}` : ""}</p>
      </div>

      <div className="grid3 sgrid">
        <div className="panel pad"><div className="lbl">$STOA LOCKED</div><div style={{ fontFamily: "var(--num)", fontSize: 30, marginTop: 6 }}>{mm(s.stoaLocked)}</div><p className="note" style={{ marginBottom: 0 }}>Enough votes for {slotsOpen} of {s.rules.slots} slots at {mm(s.rules.quorumStoa)} each</p></div>
        <div className="panel pad"><div className="lbl">ETH PAID TO VOTERS</div><div style={{ fontFamily: "var(--num)", fontSize: 30, marginTop: 6 }}>{eth(s.totals.ethPaidToVoters)} ETH</div><p className="note" style={{ marginBottom: 0 }}>All weeks, {s.rules.toVotersPct}% of winning bids</p></div>
        <div className="panel pad"><div className="lbl">$STOA BURNED</div><div style={{ fontFamily: "var(--num)", fontSize: 30, marginTop: 6 }}>{mm(s.totals.stoaBurned)}</div><p className="note" style={{ marginBottom: 0 }}>Bought with the other 10% and entry fees</p></div>
      </div>

      <div className="panel pad">
        <div className="rowx"><div className="lbl">THE RACE · WEEK {s.week}</div><span className="chip">{live.length} bid{live.length === 1 ? "" : "s"}</span></div>
        {live.length === 0 ? (
          <p className="uline" style={{ marginBottom: 0 }}>{s.phase === "before_week_1" ? "Bids open with week 1." : "No bids yet this week."} Projects bid on <Link href="/spotlight/projects">Spotlight for projects</Link>.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 12 }}>
            {live.map((c, i) => {
              const w = winning.has(c.token);
              return (
                <Link key={c.token} href={`/spotlight/vote/${c.token.toLowerCase()}`} style={{ color: "inherit", textDecoration: "none" }}>
                  <div className="rowx" style={{ gap: 8 }}>
                    <b>{i + 1}. {c.symbol ?? `${c.token.slice(0, 6)}…`}</b>
                    <span style={{ fontFamily: "var(--num)" }}>{eth(c.bidEth)} ETH{w ? " · ✓ winning now" : c.reachesQuorum ? " · outbid" : ""}</span>
                  </div>
                  <div style={{ position: "relative", height: 14, borderRadius: 8, background: "rgba(47,111,214,.10)", marginTop: 6 }} role="progressbar" aria-label={`Votes for ${c.symbol ?? c.token}`} aria-valuemin={0} aria-valuemax={Math.round(s.rules.quorumStoa)} aria-valuenow={Math.round(c.votesStoa)}>
                    <div style={{ width: `${Math.min(100, (c.votesStoa / top) * 100)}%`, height: "100%", borderRadius: 8, background: w ? "#1F9D63" : "var(--accent)", transition: "width .6s" }} />
                    <div style={{ position: "absolute", left: `${q}%`, top: -4, bottom: -4, width: 2, background: "#B45309" }} />
                  </div>
                  <p className="note" style={{ margin: "4px 0 0" }}>{mm(c.votesStoa)} votes{c.reachesQuorum ? "" : ` · needs ${mm(s.rules.quorumStoa - c.votesStoa)} more`}</p>
                </Link>
              );
            })}
            <p className="note" style={{ margin: 0 }}><span style={{ display: "inline-block", width: 10, height: 10, background: "#B45309", marginRight: 6 }} />{mm(s.rules.quorumStoa)} $STOA quorum. The {s.rules.slots} largest bids past it win.</p>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
          <Link className="cta" href="/spotlight#race">Lock and vote</Link>
          <Link className="ghost" href="/spotlight/projects">Bid as a project</Link>
        </div>
      </div>

      <div className="panel pad">
        <div className="lbl">PAST WEEKS</div>
        {history.length === 0 ? <p style={{ marginBottom: 0 }}>The first week settles {utc(s.votesCloseAt)}. Each week&apos;s winners and the ETH their voters got show here.</p> : (
          <ul className="list">
            {history.map((h) => (
              <li key={h.week}><span><Link href={`/spotlight/week/${h.week}`}>Week {h.week}</Link> · {h.bids} bid{h.bids === 1 ? "" : "s"}{h.finalized ? "" : " · settling"}</span>
                <b>{h.winners.length ? h.winners.map((w) => `${w.symbol} ${eth(w.toVotersEth)} ETH to voters`).join(" · ") : h.finalized ? "No winner (no token reached the quorum)" : "—"}</b></li>
            ))}
          </ul>
        )}
      </div>
      <p className="note">Slots are sponsored and not reviewed by Stoa. Payouts depend only on what projects bid; nothing is promised. Not financial advice.</p>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHead } from "@/components/ui";
import CopyButton from "@/components/CopyButton";
import { loadSpotlightHistory } from "@/lib/spotlightHistory";

// /spotlight/week/<n>: one finished Spotlight week, for its recap post: the winners, their bids, the ETH their voters
// got, and how many tokens bid. Read from SpotlightMarket; its share card is the recap image.
export const revalidate = 300;
// no page is built ahead: each one is rendered on its first visit and then kept (ISR), so a busy week does not
// re-render it on every request
export async function generateStaticParams() { return []; }
type P = { params: Promise<{ n: string }> };
const eth = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 4 });
const mm = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : `${Math.round(v / 1e3)}K`);

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { n } = await params;
  const w = (await loadSpotlightHistory().catch(() => [])).find((x) => String(x.week) === n);
  const title = `Stoa Spotlight week ${n} winners`;
  const description = !w ? "Stoa Spotlight: projects bid ETH, $STOA holders vote and earn it." : w.winners.length
    ? `${w.winners.map((x) => x.symbol).join(", ")} won week ${n}. ${eth(w.winners.reduce((a, x) => a + x.toVotersEth, 0))} ETH went to the $STOA holders who voted for them.`
    : `No token reached the vote quorum in week ${n}; every bid can be refunded.`;
  return { title, description, alternates: { canonical: `/spotlight/week/${n}` }, openGraph: { title, description, siteName: "Stoa" }, twitter: { card: "summary_large_image", site: "@StoaDex", title, description } };
}

export default async function WeekPage({ params }: P) {
  const { n } = await params;
  if (!/^\d{1,3}$/.test(n)) notFound();
  const all = await loadSpotlightHistory().catch(() => null);
  if (!all) return <section className="page"><div className="notice">Robinhood Chain did not answer. Try again in a minute.</div></section>;
  const w = all.find((x) => String(x.week) === n);
  if (!w) return (
    <section className="page">
      <p className="note" style={{ margin: "0 0 8px" }}><Link href="/spotlight">← Spotlight</Link></p>
      <PageHead eyebrow={`SPOTLIGHT · WEEK ${n}`} title="Not finished yet">This week has not closed. Follow it live on the board.</PageHead>
      <Link className="cta" href="/spotlight/live">Live board</Link>
    </section>
  );
  const toVoters = w.winners.reduce((a, x) => a + x.toVotersEth, 0);
  const url = `https://stoadex.com/spotlight/week/${n}`;
  const share = w.winners.length
    ? `Stoa Spotlight week ${n}: ${w.winners.map((x) => `$${x.symbol}`).join(", ")} won, and ${eth(toVoters)} ETH went to the $STOA holders who voted for them.`
    : `Stoa Spotlight week ${n}: no token reached the vote quorum, so every bid can be refunded.`;
  return (
    <section className="page">
      <p className="note" style={{ margin: "0 0 8px" }}><Link href="/spotlight">← Spotlight</Link></p>
      <PageHead eyebrow={`SPOTLIGHT · WEEK ${n}${w.finalized ? "" : " · SETTLING"}`} title={w.winners.length ? `Week ${n} winners` : `Week ${n}: no winner`}>
        {w.bids} token{w.bids === 1 ? "" : "s"} bid this week. {w.winners.length ? `${eth(toVoters)} ETH went to the $STOA holders who voted for the winners; they claim it on the Spotlight page.` : "No token reached the vote quorum, so every bid can be refunded (entry fees stay)."}
      </PageHead>
      {w.winners.length > 0 && (
        <div className="panel pad" style={{ marginBottom: 16 }}>
          <ul className="list">
            {w.winners.map((x, i) => (
              <li key={x.token}><span>{["🥇", "🥈", "🥉"][i] ?? `${i + 1}.`} <Link href={`/check/robinhood/${x.token}`}>{x.symbol}</Link> · bid {eth(x.bidEth)} ETH · {mm(x.votesStoa)} votes</span><b>{eth(x.toVotersEth)} ETH to voters</b></li>
            ))}
          </ul>
        </div>
      )}
      <div className="panel pad">
        <div className="lbl">SHARE</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
          <a className="cta" href={`https://x.com/intent/post?text=${encodeURIComponent(share)}&url=${encodeURIComponent(url)}`} target="_blank" rel="noopener noreferrer">Share on X</a>
          <a className="ghost" href={`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(share)}`} target="_blank" rel="noopener noreferrer">Share on Telegram</a>
          <CopyButton text={url} label="Copy link" />
          <Link className="ghost" href="/spotlight#race">This week&apos;s race</Link>
        </div>
        <p className="note" style={{ marginBottom: 0 }}>Winners are sponsored slots chosen by $STOA holders, not reviewed by Stoa. Check any token before you buy. Not financial advice.</p>
      </div>
    </section>
  );
}

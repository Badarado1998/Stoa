import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/ui";
import { readLeaders } from "@/lib/spotlightLeaders";
import { addressUrlOn, ROBINHOOD } from "@/lib/networks";
import { SPOT_START, WEEK, utc } from "@/lib/spotlight";

// /spotlight/leaders: the wallets Spotlight has paid the most ETH, from the chain (claimed or not).
export const revalidate = 600;
export const metadata: Metadata = {
  title: "Spotlight top earners",
  description: "The $STOA holders Stoa Spotlight has paid the most ETH for their votes, read from the SpotlightMarket contract on Robinhood Chain.",
  alternates: { canonical: "/spotlight/leaders" },
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const eth = (v: number) => (v < 0.0001 ? "<0.0001" : v.toLocaleString("en-US", { maximumFractionDigits: v < 1 ? 4 : 3 }));

export default async function Page() {
  const d = await readLeaders().catch(() => null);
  return (
    <section className="page">
      <p className="note" style={{ margin: "0 0 8px" }}><Link href="/spotlight">← Spotlight</Link></p>
      <PageHead eyebrow="SPOTLIGHT · TOP EARNERS" title="Paid in ETH for voting">
        Every week projects bid ETH for Spotlight&apos;s slots, and 90% of each winning bid goes to the $STOA holders who voted for it. These are the wallets it has paid the most, claimed or not.
      </PageHead>
      {!d ? (
        <div className="notice">Robinhood Chain did not answer just now. This page refreshes every 10 minutes.</div>
      ) : !d.leaders.length ? (
        <div className="panel pad">
          <p>No week has paid out yet. The first payouts land when week 1 closes on <b>{utc(SPOT_START + WEEK)}</b> and is settled.</p>
          <p className="note">Want to be on this list? Lock $STOA and vote on <Link href="/spotlight#race">Spotlight</Link>. <Link href="/docs/spotlight-voters">How voting works</Link></p>
        </div>
      ) : (
        <>
          <div className="grid3 sgrid" style={{ marginBottom: 20 }}>
            <div className="panel pad"><div className="lbl">PAID TO VOTERS</div><div style={{ fontFamily: "var(--num)", fontSize: 24, marginTop: 6 }}>{eth(d.paidEth)} ETH</div></div>
            <div className="panel pad"><div className="lbl">VOTERS PAID</div><div style={{ fontFamily: "var(--num)", fontSize: 24, marginTop: 6 }}>{d.voters}</div></div>
            <div className="panel pad"><div className="lbl">WEEKS SETTLED</div><div style={{ fontFamily: "var(--num)", fontSize: 24, marginTop: 6 }}>{d.settledWeeks}</div></div>
          </div>
          <div className="panel pad">
            <table className="tbl">
              <thead><tr><th>#</th><th>Wallet</th><th style={{ textAlign: "right" }}>ETH earned</th><th style={{ textAlign: "right" }}>Weeks</th></tr></thead>
              <tbody>
                {d.leaders.map((l, i) => (
                  <tr key={l.address}>
                    <td>{i + 1}</td>
                    <td><a href={addressUrlOn(ROBINHOOD, l.address)} target="_blank" rel="noopener noreferrer" style={{ fontFamily: "var(--num)" }}>{short(l.address)}</a></td>
                    <td style={{ textAlign: "right", fontFamily: "var(--num)" }}>{eth(l.eth)}</td>
                    <td style={{ textAlign: "right" }}>{l.weeks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="note">Read from SpotlightMarket on Robinhood Chain: each winner&apos;s payout split by each voter&apos;s final votes. Updated {new Date(d.updated * 1000).toISOString().slice(11, 16)} UTC. Past payouts do not predict future ones. Not financial advice.</p>
          </div>
        </>
      )}
    </section>
  );
}

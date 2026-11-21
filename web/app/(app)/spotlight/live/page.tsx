import type { Metadata } from "next";
import Link from "next/link";
import SpotlightLive from "@/components/SpotlightLive";
import CopyButton from "@/components/CopyButton";
import { readSpotlight } from "@/lib/spotlightServer";
import { loadSpotlightHistory } from "@/lib/spotlightHistory";

// /spotlight/live: the Spotlight race as a live board, for a second screen or a screenshot: the countdown to the next
// close, each bid's votes against the quorum, what is locked, and every past week's winners and ETH paid to voters.
export const revalidate = 30;
export const metadata: Metadata = {
  title: "Spotlight live board",
  description: "Stoa Spotlight as it happens: the countdown, every bid and its votes against the 1M $STOA quorum, $STOA locked, and the ETH each past week paid to its voters. Read from the chain.",
  alternates: { canonical: "/spotlight/live" },
};

const SNIPPET = `<script src="https://stoadex.com/stoa-spotlight.js" defer></script>`;

export default async function Page() {
  const [s, history] = await Promise.all([readSpotlight().catch(() => null), loadSpotlightHistory().catch(() => [])]);
  return (
    <section className="page">
      <p className="note" style={{ margin: "0 0 8px" }}><Link href="/spotlight">← Spotlight</Link></p>
      <SpotlightLive initial={s} history={history} />
      <div className="panel pad" style={{ marginTop: 20 }}>
        <div className="lbl">THE RACE ON YOUR WEBSITE</div>
        <p className="note">A live card with this week&apos;s bids, each token&apos;s votes and which ones win now, for a community page, a project site or a Robinhood Chain portal. Paste it where the card should show. It opens Stoa in a new tab and never connects a wallet. Add <code>data-theme=&quot;dark&quot;</code> for a dark card or <code>data-rows=&quot;8&quot;</code> for more tokens.</p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <code style={{ fontSize: 12, overflowWrap: "anywhere", flex: "1 1 240px" }}>{SNIPPET}</code>
          <CopyButton text={SNIPPET} label="Copy code" />
          <a className="ghost" href="/embed/spotlight" target="_blank" rel="noopener noreferrer">Preview</a>
        </div>
      </div>
    </section>
  );
}

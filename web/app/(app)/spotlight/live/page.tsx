import type { Metadata } from "next";
import Link from "next/link";
import SpotlightLive from "@/components/SpotlightLive";
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

export default async function Page() {
  const [s, history] = await Promise.all([readSpotlight().catch(() => null), loadSpotlightHistory().catch(() => [])]);
  return (
    <section className="page">
      <p className="note" style={{ margin: "0 0 8px" }}><Link href="/spotlight">← Spotlight</Link></p>
      <SpotlightLive initial={s} history={history} />
    </section>
  );
}

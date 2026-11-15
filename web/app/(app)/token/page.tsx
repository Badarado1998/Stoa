import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/ui";
import StoaCA from "@/components/StoaCA";
import TokenUtility from "@/components/TokenUtility";

const description = "Stoa's protocol fees buy and burn $STOA every week, makers bond it to quote Stoa pools, and holders vote in Spotlight to earn projects' ETH bids. Live burns and supply.";
export const metadata: Metadata = {
  alternates: { canonical: "/token" },
  title: "$STOA",
  description,
  openGraph: { title: "$STOA · Stoa", description, type: "website", siteName: "Stoa" },
  twitter: { card: "summary_large_image", site: "@StoaDex", title: "$STOA · Stoa", description },
};

export default function TokenPage() {
  return (
    <section className="page">
      <PageHead eyebrow="$STOA · ROBINHOOD CHAIN" title="What $STOA does" action={<Link className="cta" href="/trade?chain=robinhood">Trade</Link>}>
        Three jobs, all enforced by contracts: Stoa&apos;s protocol fees buy $STOA and burn it, makers bond $STOA to quote Stoa pools, and holders vote in Spotlight to earn the ETH projects bid.
      </PageHead>
      <StoaCA />
      <TokenUtility />
    </section>
  );
}

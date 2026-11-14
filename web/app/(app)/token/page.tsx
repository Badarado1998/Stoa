import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/ui";
import StoaCA from "@/components/StoaCA";
import TokenUtility from "@/components/TokenUtility";

export const metadata: Metadata = {
  title: "$STOA",
  description: "What $STOA does: Stoa's protocol fees buy and burn it every week, and makers bond it to quote Stoa pools.",
};

export default function TokenPage() {
  return (
    <section className="page">
      <PageHead eyebrow="$STOA · ROBINHOOD CHAIN" title="What $STOA does" action={<Link className="cta" href="/trade?chain=robinhood">Trade</Link>}>
        Two jobs, both enforced by contracts: Stoa&apos;s protocol fees buy $STOA and burn it, and makers bond $STOA to quote Stoa pools.
      </PageHead>
      <StoaCA />
      <TokenUtility />
    </section>
  );
}

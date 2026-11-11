import type { Metadata } from "next";
import { Suspense } from "react";
import Trade from "@/components/Trade";
import { PageHead } from "@/components/ui";

export const metadata: Metadata = { title: "Trade" };

export default function TradePage() {
  return (
    <section className="page">
      <PageHead eyebrow="I · TRADE" title="Swap at the best price">Every swap is checked across Stoa maker pools and Uniswap on Elysium, and filled where the price is best.</PageHead>
      <Suspense><Trade /></Suspense>
    </section>
  );
}

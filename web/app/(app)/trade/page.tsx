import type { Metadata } from "next";
import { Suspense } from "react";
import Trade from "@/components/Trade";
import { PageHead } from "@/components/ui";

export const metadata: Metadata = { title: "Swap at the best price on Elysium and Robinhood Chain" };

export default function TradePage() {
  return (
    <section className="page">
      <PageHead eyebrow="I · TRADE" title="Swap at the best price">Every swap is checked across every venue on the network you pick: Stoa maker pools, Uniswap, Aero, Ramses and Liquidity Book on Elysium, Uniswap V2, V3 and V4 on Robinhood Chain. It fills where the price is best.</PageHead>
      <Suspense><Trade /></Suspense>
    </section>
  );
}

import type { Metadata } from "next";
import { Suspense } from "react";
import Trade from "@/components/Trade";
import { PageHead } from "@/components/ui";

export const metadata: Metadata = {
  title: "Swap at the best price on Elysium and Robinhood Chain",
  description: "Swap any token on Robinhood Chain and Elysium at the best price: Stoa checks every venue for your exact amount and fills where you get the most.",
  alternates: { canonical: "/trade" },
};

export default function TradePage() {
  return (
    <section className="page">
      <PageHead eyebrow="I · TRADE" title="Swap at the best price">Every swap checks every venue on the network you pick and fills where you get the most.</PageHead>
      <Suspense><Trade /></Suspense>
    </section>
  );
}

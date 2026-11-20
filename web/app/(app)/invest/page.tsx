import type { Metadata } from "next";
import { PageHead } from "@/components/ui";
import AutoInvest from "@/components/AutoInvest";

export const metadata: Metadata = {
  title: "Auto-invest",
  description: "Buy Robinhood Chain stock tokens with USDG on a schedule: daily, weekly or monthly. Your USDG stays in your wallet; Stoa pays the gas.",
  alternates: { canonical: "/invest" },
};

export default function InvestPage() {
  return (
    <section className="page">
      <PageHead eyebrow="ROBINHOOD CHAIN · AUTO-INVEST" title="Buy stock tokens on a schedule">
        Pick a stock token, an amount and how often. Each buy goes through Stoa&apos;s router to your wallet, and Stoa pays the gas.
      </PageHead>
      <AutoInvest />
    </section>
  );
}

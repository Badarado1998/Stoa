import type { Metadata } from "next";
import Portfolio from "@/components/Portfolio";
import { PageHead } from "@/components/ui";
export const metadata: Metadata = { title: "Portfolio" };
export default function Page() {
  return (
    <section className="page">
      <PageHead eyebrow="PORTFOLIO" title="Your positions">Balances, referral earnings and, later, vault shares in one place.</PageHead>
      <Portfolio />
    </section>
  );
}

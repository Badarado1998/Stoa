import type { Metadata } from "next";
import Portfolio from "@/components/Portfolio";
import Link from "next/link";
import { PageHead } from "@/components/ui";
export const metadata: Metadata = { title: "Portfolio" };
export default function Page() {
  return (
    <section className="page">
      <PageHead eyebrow="PORTFOLIO" title="Your positions" action={<Link className="cta" href="/wrapped">Your Stoa Wrapped</Link>}>Balances, referral earnings and, later, vault shares in one place.</PageHead>
      <Portfolio />
    </section>
  );
}

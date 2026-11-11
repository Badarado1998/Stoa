import type { Metadata } from "next";
import Referrals from "@/components/Referrals";
import { PageHead } from "@/components/ui";
export const metadata: Metadata = { title: "Referrals" };
export default function Page() {
  return (
    <section className="page">
      <PageHead eyebrow="REFERRALS" title="Bring traders, share the fee">Share your link. You earn 10% of the protocol fee on every swap made through it.</PageHead>
      <Referrals />
    </section>
  );
}

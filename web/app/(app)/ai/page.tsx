import type { Metadata } from "next";
import AiChat from "@/components/AiChat";
import { PageHead } from "@/components/ui";

export const metadata: Metadata = {
  title: "Ask Stoa: an AI assistant for Robinhood Chain",
  description: "Ask in plain words: quote and prepare swaps, check a token, stock token prices against Robinhood, Spotlight and Stoa Pay links. You sign everything in your own wallet.",
  alternates: { canonical: "/ai" },
};

export default function AiPage() {
  return (
    <section className="page">
      <PageHead compact eyebrow="ASK STOA · BETA" title="Ask in plain words">Swaps, token checks, stock tokens and payment links on Robinhood Chain. It prepares; you sign in your own wallet.</PageHead>
      <AiChat />
    </section>
  );
}

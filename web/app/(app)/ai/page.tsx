import type { Metadata } from "next";
import AiChat from "@/components/AiChat";

export const metadata: Metadata = {
  title: "Ask Stoa: an AI assistant for Robinhood Chain",
  description: "Ask in plain words: quote and prepare swaps, check a token, stock token prices against Robinhood, Spotlight and Stoa Pay links. You sign everything in your own wallet.",
  alternates: { canonical: "/ai" },
};

export default function AiPage() {
  return (
    <section className="page" style={{ paddingTop: 12 }}>
      <h1 style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Stoa AI: ask in plain words</h1>
      <AiChat />
    </section>
  );
}

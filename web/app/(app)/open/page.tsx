import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/ui";
import CopyButton from "@/components/CopyButton";

export const metadata: Metadata = {
  title: "Open source and open data",
  description: "Stoa's code, data and reviews in the open: the source on GitHub, every routed swap as a weekly dataset on Hugging Face with checksums, a public export API, and the independent security review by HEY Research Lab.",
  alternates: { canonical: "/open" },
};

const HF = "https://huggingface.co/datasets/StoaDex/stoa-onchain";
const VERIFY = "sha256sum data/*.csv data/spotlight.json   # compare with manifest.json";

const PLACES: { name: string; href: string; what: string; tag: string }[] = [
  { name: "Source code on GitHub", href: "https://github.com/StoaDex/Stoa", what: "Contracts, the web app, the SDK, the agent tools and every automation that runs Stoa, in one public repository.", tag: "CODE" },
  { name: "Open dataset on Hugging Face", href: HF, what: "Every swap routed through Stoa, a daily summary, the Points board and the Spotlight week. Updated every Monday, each update tagged with its week, with a manifest of SHA-256 checksums.", tag: "DATA" },
  { name: "Export API", href: "/api/v1/export?set=swaps", what: "The same data live, as JSON: set=swaps, set=points or set=spotlight. No key, cached for an hour.", tag: "API" },
  { name: "Independent security review by HEY Research Lab", href: "https://heyresearch.xyz/project/stoa", what: "Reviews of Stoa's contracts and their follow-ups, by an outside lab. Findings and fixes are tracked on Security status.", tag: "REVIEW" },
];

export default function OpenPage() {
  return (
    <section className="page">
      <PageHead eyebrow="OPEN · CODE, DATA, REVIEWS" title="Check everything yourself">
        Stoa runs on public contracts, and everything around them is public too: the code, the data it produces and the outside reviews of it. Nothing here asks you to trust a screenshot.
      </PageHead>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {PLACES.map((p) => (
          <a key={p.name} className="panel pad" href={p.href} target={p.href.startsWith("http") ? "_blank" : undefined} rel={p.href.startsWith("http") ? "noopener noreferrer" : undefined} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
            <div className="rowx"><div className="lbl">{p.tag}</div><span style={{ color: "var(--accent-d)", fontWeight: 600 }}>Open →</span></div>
            <div style={{ fontSize: 18, fontWeight: 600, marginTop: 6 }}>{p.name}</div>
            <p className="note" style={{ marginBottom: 0 }}>{p.what}</p>
          </a>
        ))}

        <div className="panel pad">
          <div className="lbl">VERIFY A DATASET UPDATE</div>
          <p className="note">Download an update from Hugging Face, then hash its files. The hashes must match <code>manifest.json</code> in the same update. Every row comes from Stoa&apos;s routers&apos; <code>Routed</code> events, so you can also recount them from the chain.</p>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <code style={{ fontSize: 13, overflowWrap: "anywhere" }}>{VERIFY}</code>
            <CopyButton text="sha256sum data/*.csv data/spotlight.json" />
          </div>
        </div>

        <p className="note">
          Also open: <Link href="/status">System status</Link> · <Link href="/security">Security status</Link> · <Link href="/stats">Stats</Link> · <Link href="/docs/open-data">How the dataset is built</Link>. Nothing on this page is financial advice; points have no promised value.
        </p>
      </div>
    </section>
  );
}

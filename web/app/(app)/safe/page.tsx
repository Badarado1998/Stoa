import type { Metadata } from "next";
import Link from "next/link";
import { createPublicClient, erc20Abi, formatUnits, http, type Address } from "viem";
import { PageHead } from "@/components/ui";
import { ROBINHOOD } from "@/lib/networks";
import { srv } from "@/lib/serverRpc";
import { securityStatus } from "@/lib/securityStatus";
import { readSpotlight } from "@/lib/spotlightServer";
import { STOA } from "@/lib/aiCredits";

// /safe: "Is Stoa safe?" in plain words, for a holder who heard a rumour: what Stoa can and cannot do with their funds,
// who controls the contracts, where to check every claim themselves, what the known risks are, and how scams look.
// Live figures from Robinhood Chain, regenerated every 5 minutes. Facts only; the risks link is part of the answer.
export const revalidate = 300;
const description = "Is Stoa safe? What Stoa can and cannot do with your funds, who controls its contracts, where to check every claim yourself on-chain, the known risks, and how to spot scams that use Stoa's name.";
export const metadata: Metadata = {
  title: "Is Stoa safe?",
  description,
  alternates: { canonical: "/safe" },
  openGraph: { title: "Is Stoa safe? · Stoa", description, type: "website", siteName: "Stoa" },
  twitter: { card: "summary_large_image", site: "@StoaDex", title: "Is Stoa safe? · Stoa", description },
};

const BURN = "0x000000000000000000000000000000000000dEaD" as Address;
const mm = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v.toFixed(0));
async function cap<T>(p: Promise<T>): Promise<T | null> { try { return await p; } catch { return null; } }

function Q({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div className="panel pad">
      <h2 style={{ fontSize: 20, margin: "0 0 8px" }}>{q}</h2>
      <div className="uline" style={{ lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}

export default async function SafePage() {
  const c = createPublicClient({ chain: ROBINHOOD.chain, transport: http(srv(ROBINHOOD.chain.rpcUrls.default.http[0]), { timeout: 8_000 }) });
  const [sec, spot, burned] = await Promise.all([
    cap(securityStatus()),
    cap(readSpotlight()),
    cap(c.readContract({ address: STOA, abi: erc20Abi, functionName: "balanceOf", args: [BURN] }).then((v) => Number(formatUnits(v, 18)))),
  ]);
  const paused = sec ? sec.contracts.filter((x) => x.paused).length : null;
  return (
    <section className="page" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageHead eyebrow="TRUST · CHECK IT YOURSELF" title="Is Stoa safe?" action={<Link className="cta" href="/security">Live security status</Link>}>
        Heard a rumour? Here is what Stoa can and cannot do, and where to check every claim yourself. Don&apos;t trust us: verify.
      </PageHead>

      <div className="grid3 sgrid">
        <div className="panel pad stat"><div className="lbl">ADMIN CHANGES WAIT</div><span className="v">{sec?.timelockDelayH != null ? `${sec.timelockDelayH}h` : "—"}</span><div className="note" style={{ marginTop: 6 }}>Public timelock{sec?.safe ? `, behind a ${sec.safe.threshold}-of-${sec.safe.owners} Safe` : ""}</div></div>
        <div className="panel pad stat"><div className="lbl">$STOA IN THE BURN ADDRESS</div><span className="v">{burned != null ? mm(burned) : "—"}</span><div className="note" style={{ marginTop: 6 }}>Gone for good: 0x…dEaD</div></div>
        <div className="panel pad stat"><div className="lbl">$STOA LOCKED IN SPOTLIGHT</div><span className="v">{spot ? mm(spot.stoaLocked) : "—"}</span><div className="note" style={{ marginTop: 6 }}>Holders can unlock any time</div></div>
      </div>

      <Q q="Can Stoa take the tokens in my wallet?">
        No. Every swap is one transaction that your own wallet signs, and Stoa never holds your funds between steps: the router sends the result straight to you and reverts if you would get less than the minimum you saw. By default the app approves only the amount of each swap. Stoa never asks for your seed phrase or private key, anywhere.
      </Q>
      <Q q="Who controls the contracts?">
        Every Stoa contract is owned by a {sec?.timelockDelayH ?? 48}-hour public timelock, and the timelock takes orders from a {sec?.safe ? `${sec.safe.threshold}-of-${sec.safe.owners}` : "2-of-3"} Safe multisig. Any admin change is visible on-chain for {sec?.timelockDelayH ?? 48} hours before it can run; a new trading venue waits longer. A guardian can pause swaps in an emergency, but only the timelock can unpause. {paused != null ? `Paused contracts right now: ${paused}.` : ""} Every contract, its owner and every queued change are on the <Link href="/security">security status page</Link>, read live from the chain.
      </Q>
      <Q q="Is the code public? Has anyone reviewed it?">
        Yes. All contracts and the whole website are open source on <a href="https://github.com/StoaDex/Stoa" target="_blank" rel="noopener noreferrer">GitHub</a>, and every deployed contract is source-verified on <Link href="/docs/contracts">Sourcify</Link>, so anyone can match the code to what runs. No contract is upgradeable. Hey Research Lab is doing an independent security review; its findings so far are published with what was fixed in the <Link href="/docs/security-review">security review</Link>. It is a review, not an audit, and an external audit is still planned. Anyone can report a bug through the <Link href="/docs/bug-bounty">bug bounty</Link>.
      </Q>
      <Q q='Someone says it is "a farm" or fake volume. How do I check?'>
        Every Stoa swap is an on-chain transaction anyone can look up. The full swap list is open data on <Link href="/open">stoadex.com/open</Link> and <a href="https://huggingface.co/datasets/StoaDex/stoa-onchain" target="_blank" rel="noopener noreferrer">Hugging Face</a>, a community member built an independent <a href="https://github.com/StoaDex/Stoa/issues/9" target="_blank" rel="noopener noreferrer">public dashboard</a> from chain data alone, and Points has public anti-farming rules: a swap that undoes your own swap within an hour earns nothing, and wallets that only trade to farm can be removed. If anyone has real proof of a problem, it can be checked on-chain: please post it publicly or send it through the bug bounty.
      </Q>
      <Q q="What are the real risks?">
        Smart contracts can have bugs; the contracts are not externally audited yet, so maker pools and vaults keep beta caps. Two of the three Safe keys are kept for automated steps in Stoa&apos;s GitHub, so a GitHub compromise would expose two of them (the timelock still makes every change public for 48 hours first). Tokens you buy can lose value, and a token&apos;s safety check shows today&apos;s behaviour only. The full list, with what limits each risk, is in <Link href="/docs/risks">Risks and safeguards</Link>.
      </Q>
      <Q q="How do scams that use Stoa's name look?">
        Someone DMs you first, offers &quot;proof&quot;, support or an airdrop, and sends a link or asks you to &quot;sync&quot; or &quot;validate&quot; your wallet. Stoa&apos;s team never DMs first and never asks for a seed phrase. The only site is <b>stoadex.com</b>; official accounts are <a href="https://x.com/StoaDEX" target="_blank" rel="noopener noreferrer">@StoaDEX on X</a>, <a href="https://t.me/StoaDex" target="_blank" rel="noopener noreferrer">t.me/StoaDex</a> and <a href="https://t.me/StoaDexChat" target="_blank" rel="noopener noreferrer">t.me/StoaDexChat</a>. Check any token before you buy it with the <Link href="/check">safety check</Link>.
      </Q>
      <p className="note">Nothing here is financial advice. Figures are read from Robinhood Chain and refresh every few minutes.</p>
    </section>
  );
}

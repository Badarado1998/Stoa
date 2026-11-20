import type { Metadata } from "next";
import { erc20Abi, getAddress, isAddress } from "viem";
import { rhClient, readLaunch, logoUrl } from "@/lib/ponsLaunch";
import { EMBED_OFF } from "@/lib/embed";
import AiEmbed from "@/components/AiEmbed";

// /embed/ai?token=0x...: Stoa AI for one project, for its own website (an iframe, or /stoa-ai.js as a chat button). It
// answers about that token from on-chain data, reads only and never connects a wallet: Buy opens Stoa in a new tab.
export const metadata: Metadata = { title: "Stoa AI", robots: { index: false, follow: false } };
export const revalidate = 300;

type P = { searchParams: Promise<{ token?: string; ref?: string }> };

export default async function Page({ searchParams }: P) {
  const { token, ref } = await searchParams;
  if (!token || !isAddress(token, { strict: false }) || EMBED_OFF.has(token.toLowerCase())) {
    return <div className="embed"><div className="em-q">Stoa AI needs a token address on Robinhood Chain: /embed/ai?token=0x…<small>See stoadex.com/docs/stoa-ai-for-projects</small></div></div>;
  }
  const t = getAddress(token);
  const [sym, launch] = await Promise.all([
    rhClient().readContract({ address: t, abi: erc20Abi, functionName: "symbol" }).catch(() => null),
    readLaunch(t).catch(() => null),
  ]);
  const symbol = String(sym ?? launch?.symbol ?? "TOKEN").replace(/[^\w.$-]/g, "").slice(0, 12) || "TOKEN";
  const r = ref && isAddress(ref, { strict: false }) ? `&ref=${getAddress(ref)}` : "";
  return <AiEmbed token={t} symbol={symbol} logo={launch ? logoUrl(launch.logo, t) : null} buy={`https://stoadex.com/trade?chain=robinhood${launch?.tradeFrom === "USDG" ? "&sell=USDG" : ""}&buy=${t}${r}`} />;
}

"use client";
import { useEffect, useRef, useState } from "react";
import { useAccount, usePublicClient, useSendTransaction, useSwitchChain, useWriteContract } from "wagmi";
import { BaseError, decodeFunctionData, erc20Abi as erc20Full, zeroAddress, type Address, type Hash, type Hex } from "viem";
import { erc20Abi, routerAbi } from "@/lib/abi";
import { ROBINHOOD } from "@/lib/networks";
import { NATIVE } from "@/lib/tokens";
import { requestUrl, type PayRequest } from "@/lib/pay";
import { LIMIT, LIMIT_ERRORS, limitAbi } from "@/lib/limit";
import { SPOT, spotlightAbi } from "@/lib/spotlight";
import CopyButton from "./CopyButton";
import { useWalletModal } from "./Providers";

const RH = ROBINHOOD.chain.id;
const ROUTER = ROBINHOOD.contracts.router!;
const EXPLORER = "https://robinhoodchain.blockscout.com";
const lc = (s: string) => s.toLowerCase();
const STORE = "stoa.ai.chat.v1";

type Action = { tool: string; data: Record<string, unknown> };
type SwapData = {
  summary: { sell: { symbol: string; address: Address; amount: string }; buy: { symbol: string; address: Address; about: string; atLeast: string }; priceImpactPct: number | null; route: string; slippagePct: number };
  tx: { to: Address; data: Hex; value: string }; approval: { token: Address; spender: Address; amount: string } | null;
};

type LimitData = {
  summary: { sell: { symbol: string; address: Address; amount: string }; buy: { symbol: string; address: Address; now: string; atLeast: string }; when: string; pct: number; expiryDays: number; priceNow: number; priceAt: number };
  order: { limit: Address; tokenIn: Address; tokenOut: Address; amountIn: string; minOut: string; expirySeconds: number };
};

const GROUPS: { label: string; items: string[] }[] = [
  { label: "Trade", items: ["Swap 0.01 ETH to USDG", "Quote 10 USDG to STOA"] },
  { label: "Strategies", items: ["Buy NVDA with 50 USDG if it drops 5%", "Sell 1000 STOA for ETH if it goes up 20%"] },
  { label: "Check", items: ["Scan my tokens for rug signs", "Is STOA safe to buy?"] },
  { label: "Spotlight", items: ["Lock all my STOA for Spotlight", "Who can I vote for this week?"] },
  { label: "Stocks", items: ["How far is NVDA from Robinhood's price?", "Which stock tokens are furthest from Robinhood?"] },
  { label: "Pay", items: ["Make me a payment link for 25 USDG", "Make a link to get paid 50 USDG in NVDA"] },
  { label: "Learn", items: ["How do I bridge to Robinhood Chain?", "What is Spotlight?"] },
];

/** **bold** only; everything else stays plain text (no HTML from the model ever reaches the page) */
export function Rich({ text }: { text: string }) {
  return <>{text.replace(/^#{1,6}\s+/gm, "").split(/\*\*/).map((p, i) => (i % 2 ? <b key={i}>{p}</b> : <span key={i}>{p}</span>))}</>;
}

function explain(e: unknown): string {
  if (e instanceof BaseError) return /User rejected|denied/i.test(e.shortMessage) ? "You rejected it in your wallet." : e.shortMessage;
  return (e as Error)?.message ?? "Something went wrong.";
}

function SwapCard({ d }: { d: SwapData }) {
  const { address, isConnected, chainId } = useAccount();
  const { open } = useWalletModal();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();
  const pub = usePublicClient({ chainId: RH });
  const [st, setSt] = useState<{ k: "idle" | "busy" | "done" | "failed"; text?: string; tx?: Hash }>({ k: "idle" });
  const s = d.summary;

  /** the transaction must be exactly the swap on the card, from this wallet to this wallet, through Stoa's router */
  function check(): string | null {
    if (!address) return "Connect your wallet first.";
    if (lc(d.tx.to) !== lc(ROUTER)) return "This is not a swap through Stoa's router.";
    try {
      const x = decodeFunctionData({ abi: routerAbi, data: d.tx.data });
      if (x.functionName !== "swap") return "Unexpected call.";
      const p = (x.args as readonly [{ tokenIn: Address; tokenOut: Address; amountIn: bigint; to: Address }])[0];
      if (lc(p.to) !== lc(address)) return "This swap was built for another wallet. Ask again with this wallet connected.";
      if (lc(p.tokenIn) !== lc(s.sell.address) || lc(p.tokenOut) !== lc(s.buy.address)) return "The swap does not match the card.";
      if (s.sell.address === NATIVE ? BigInt(d.tx.value) !== p.amountIn : BigInt(d.tx.value) !== 0n) return "The ETH sent does not match.";
    } catch { return "Stoa could not read this swap."; }
    return null;
  }

  async function sign() {
    const why = check();
    if (why) { setSt({ k: "failed", text: why }); return; }
    try {
      if (chainId !== RH) { setSt({ k: "busy", text: "Switch to Robinhood Chain…" }); await switchChainAsync({ chainId: RH }); }
      if (d.approval && pub) {
        const have = await pub.readContract({ address: d.approval.token, abi: erc20Abi, functionName: "allowance", args: [address!, ROUTER] }) as bigint;
        if (have < BigInt(d.approval.amount)) {
          setSt({ k: "busy", text: `Approve ${s.sell.symbol} in your wallet…` });
          const a = await writeContractAsync({ address: d.approval.token, abi: erc20Abi, functionName: "approve", args: [ROUTER, BigInt(d.approval.amount)], chainId: RH });
          await pub.waitForTransactionReceipt({ hash: a });
        }
      }
      setSt({ k: "busy", text: "Confirm the swap in your wallet…" });
      const tx = await sendTransactionAsync({ chainId: RH, to: d.tx.to, data: d.tx.data, value: BigInt(d.tx.value) });
      setSt({ k: "busy", text: "Waiting for Robinhood Chain…" });
      const rc = await pub!.waitForTransactionReceipt({ hash: tx });
      setSt(rc.status === "success" ? { k: "done", tx } : { k: "failed", text: "The swap did not go through (the price likely moved). Ask for a fresh quote." });
    } catch (e) { setSt({ k: "failed", text: explain(e) }); }
  }

  return (
    <div className="box" style={{ marginTop: 8 }}>
      <div className="lbl">SWAP · ROBINHOOD CHAIN</div>
      <div style={{ fontSize: 18, fontWeight: 600, margin: "6px 0" }}>{s.sell.amount} {s.sell.symbol} → about {s.buy.about} {s.buy.symbol}</div>
      <div className="note">At least {s.buy.atLeast} {s.buy.symbol} · {s.slippagePct}% slippage{s.priceImpactPct !== null ? ` · ${s.priceImpactPct.toFixed(2)}% impact` : ""}{s.route ? ` · ${s.route}` : ""}</div>
      {st.k === "done" ? (
        <p style={{ marginTop: 8 }}>Swapped. <a href={`${EXPLORER}/tx/${st.tx}`} target="_blank" rel="noopener noreferrer">See it on Robinhood Chain ↗</a></p>
      ) : (
        <>
          {st.k === "failed" && <div className="notice" style={{ marginTop: 8 }}>{st.text}</div>}
          <button type="button" className="pri" style={{ marginTop: 10, width: "100%" }} disabled={st.k === "busy"} onClick={() => (isConnected ? sign() : open())}>
            {!isConnected ? "Connect wallet" : st.k === "busy" ? st.text : "Sign swap"}
          </button>
          <div className="note" style={{ marginTop: 6 }}>Quotes move: if it fails, ask for a fresh one. Nothing happens until your wallet signs.</div>
        </>
      )}
    </div>
  );
}

/** a strategy as a StoaLimit order: the deposit waits in the contract until the market pays the price */
function LimitCard({ d }: { d: LimitData }) {
  const { address, isConnected, chainId } = useAccount();
  const { open } = useWalletModal();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const pub = usePublicClient({ chainId: RH });
  const [st, setSt] = useState<{ k: "idle" | "busy" | "done" | "failed"; text?: string; tx?: Hash }>({ k: "idle" });
  const s = d.summary, o = d.order;
  const native = lc(o.tokenIn) === lc(NATIVE);
  const px = (v: number) => v.toLocaleString("en-US", { maximumSignificantDigits: 6 });
  const what = s.when === "buy_price_drops" ? `when ${s.buy.symbol} is ${s.pct}% cheaper` : `when ${s.sell.symbol} is worth ${s.pct}% more`;

  function check(): string | null {
    if (!address) return "Connect your wallet first.";
    if (!LIMIT || lc(o.limit) !== lc(LIMIT)) return "This is not Stoa's limit order contract.";
    if (lc(o.tokenIn) !== lc(s.sell.address) || lc(o.tokenOut) !== lc(s.buy.address)) return "The order does not match the card.";
    if (BigInt(o.amountIn) <= 0n || BigInt(o.minOut) <= 0n || ![86_400, 7 * 86_400, 30 * 86_400].includes(o.expirySeconds)) return "This order is not valid.";
    return null;
  }

  async function place() {
    const why = check();
    if (why) { setSt({ k: "failed", text: why }); return; }
    try {
      if (chainId !== RH) { setSt({ k: "busy", text: "Switch to Robinhood Chain…" }); await switchChainAsync({ chainId: RH }); }
      const amt = BigInt(o.amountIn);
      if (!native) {
        const have = await pub!.readContract({ address: o.tokenIn, abi: erc20Abi, functionName: "allowance", args: [address!, LIMIT!] }) as bigint;
        if (have < amt) {
          setSt({ k: "busy", text: `Approve ${s.sell.symbol} in your wallet…` });
          const a = await writeContractAsync({ address: o.tokenIn, abi: erc20Abi, functionName: "approve", args: [LIMIT!, amt], chainId: RH });
          await pub!.waitForTransactionReceipt({ hash: a });
        }
      }
      setSt({ k: "busy", text: "Confirm the order in your wallet…" });
      // from the chain's clock, a little short so "30 days" stays inside the contract's maximum
      const now = (await pub!.getBlock()).timestamp;
      const tx = await writeContractAsync({ address: LIMIT!, abi: limitAbi, functionName: "create", args: [o.tokenIn, o.tokenOut, amt, BigInt(o.minOut), now + BigInt(o.expirySeconds - 300), zeroAddress], value: native ? amt : 0n, chainId: RH });
      setSt({ k: "busy", text: "Waiting for Robinhood Chain…" });
      const rc = await pub!.waitForTransactionReceipt({ hash: tx });
      setSt(rc.status === "success" ? { k: "done", tx } : { k: "failed", text: "The order did not go through." });
    } catch (e) {
      const name = e instanceof BaseError ? (e.walk() as { data?: { errorName?: string } })?.data?.errorName : undefined;
      setSt({ k: "failed", text: (name && LIMIT_ERRORS[name]) || explain(e) });
    }
  }

  return (
    <div className="box" style={{ marginTop: 8 }}>
      <div className="lbl">LIMIT ORDER · ROBINHOOD CHAIN</div>
      <div style={{ fontSize: 17, fontWeight: 600, margin: "6px 0" }}>{s.sell.amount} {s.sell.symbol} → at least {s.buy.atLeast} {s.buy.symbol}</div>
      <div className="note">Fills {what}: {s.when === "buy_price_drops" ? `1 ${s.buy.symbol} = ${px(s.priceAt)} ${s.sell.symbol} (now ${px(s.priceNow)})` : `1 ${s.sell.symbol} = ${px(1 / s.priceAt)} ${s.buy.symbol} (now ${px(1 / s.priceNow)})`}. Expires in {s.expiryDays} day{s.expiryDays > 1 ? "s" : ""}.</div>
      {st.k === "done" ? (
        <p style={{ marginTop: 8 }}>Order placed. <a href={`${EXPLORER}/tx/${st.tx}`} target="_blank" rel="noopener noreferrer">See it ↗</a> · <a href="/trade?chain=robinhood&mode=limit">Track or cancel</a></p>
      ) : (
        <>
          {st.k === "failed" && <div className="notice" style={{ marginTop: 8 }}>{st.text}</div>}
          <button type="button" className="pri" style={{ marginTop: 10, width: "100%" }} disabled={st.k === "busy"} onClick={() => (isConnected ? place() : open())}>
            {!isConnected ? "Connect wallet" : st.k === "busy" ? st.text : "Place limit order"}
          </button>
          <div className="note" style={{ marginTop: 6 }}>Your {s.sell.symbol} waits in Stoa&apos;s limit order contract. Stoa&apos;s keeper fills it once the market pays this price, about every 5 minutes. Cancel any time.</div>
        </>
      )}
    </div>
  );
}

const BURN = "0x000000000000000000000000000000000000dEaD";
const STOA_T = "0x13E6993417616De724F2b337D65063f229e96718";
type PayOpt = { asset: "USDG" | "ETH" | "STOA"; token: Address; to: Address; amount: string; display: string; burned: boolean };

/** more messages: a pack paid from the connected wallet, checked on-chain by /api/ai/credits */
function BuyCredits({ onDone }: { onDone: (credits: number) => void }) {
  const { address, isConnected, chainId } = useAccount();
  const { open } = useWalletModal();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();
  const pub = usePublicClient({ chainId: RH });
  const [info, setInfo] = useState<{ on: boolean; pack?: { messages: number; usd: number }; options?: PayOpt[] } | null>(null);
  const [st, setSt] = useState<{ k: "idle" | "busy" | "done" | "failed"; text?: string }>({ k: "idle" });
  useEffect(() => { fetch(`/api/ai/credits${address ? `?wallet=${address}` : ""}`).then((r) => r.json()).then(setInfo).catch(() => setInfo({ on: false })); }, [address]);
  if (!info) return null;
  if (!info.on) return null;

  /** the payment must go where Stoa says: USDG and ETH to Stoa's Safe, $STOA to the burn address */
  const valid = (o: PayOpt) =>
    (o.asset === "USDG" && lc(o.token) === lc(ROBINHOOD.stable) && lc(o.to) === lc(ROBINHOOD.contracts.safe ?? "")) ||
    (o.asset === "ETH" && o.token === NATIVE && lc(o.to) === lc(ROBINHOOD.contracts.safe ?? "")) ||
    (o.asset === "STOA" && lc(o.token) === lc(STOA_T) && lc(o.to) === lc(BURN));

  async function pay(o: PayOpt) {
    if (!address) return open();
    if (!valid(o)) { setSt({ k: "failed", text: "This payment address is not Stoa's." }); return; }
    try {
      if (chainId !== RH) { setSt({ k: "busy", text: "Switch to Robinhood Chain…" }); await switchChainAsync({ chainId: RH }); }
      setSt({ k: "busy", text: `Confirm ${o.display} in your wallet…` });
      const tx = o.asset === "ETH"
        ? await sendTransactionAsync({ chainId: RH, to: o.to, value: BigInt(o.amount) })
        : await writeContractAsync({ address: o.token, abi: erc20Full, functionName: "transfer", args: [o.to, BigInt(o.amount)], chainId: RH });
      setSt({ k: "busy", text: "Waiting for Robinhood Chain…" });
      await pub!.waitForTransactionReceipt({ hash: tx });
      for (let i = 0; i < 4; i++) {
        const r = await fetch("/api/ai/credits", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet: address, tx }) });
        const j = await r.json().catch(() => ({}));
        if (r.ok) { setSt({ k: "done", text: `Added ${j.credited} messages. You have ${j.credits}.` }); onDone(j.credits); return; }
        if (!/does not show/.test(j.error ?? "")) { setSt({ k: "failed", text: j.error ?? "Could not add the credits." }); return; }
        await new Promise((res) => setTimeout(res, 3000));
      }
      setSt({ k: "failed", text: "Paid, but not counted yet. Ask again in a minute: it is counted once Robinhood Chain shows it." });
    } catch (e) { setSt({ k: "failed", text: explain(e) }); }
  }

  return (
    <div className="box" style={{ marginTop: 8 }}>
      <div className="lbl">MORE MESSAGES</div>
      <div style={{ margin: "6px 0" }}><b>{info.pack?.messages} messages</b> for ${info.pack?.usd}, paid from your wallet on Robinhood Chain. Credits never expire.</div>
      {st.k === "done" ? <div className="ok">{st.text}</div> : !isConnected ? (
        <button type="button" className="pri" style={{ width: "100%" }} onClick={() => open()}>Connect wallet</button>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {(info.options ?? []).map((o) => (
            <button key={o.asset} type="button" className={o.asset === "STOA" ? "pri" : "ghost"} disabled={st.k === "busy"} onClick={() => void pay(o)} style={{ width: "100%" }}>
              Pay {o.display}{o.burned ? " · burned 🔥" : ""}
            </button>
          ))}
        </div>
      )}
      {st.k === "busy" && <div className="note" style={{ marginTop: 6 }}>{st.text}</div>}
      {st.k === "failed" && <div className="notice" style={{ marginTop: 8 }}>{st.text}</div>}
      <div className="note" style={{ marginTop: 6 }}>USDG and ETH go to Stoa&apos;s Safe. $STOA is sent to the burn address and gone for good.</div>
    </div>
  );
}

type SpotData = {
  summary: { action: "lock" | "vote"; amount: string; lockedAfter?: string; opensAt?: string; week?: number; votes?: { token: Address; amount: string }[]; votesCloseAt?: string };
  call: { spotlight: Address; stoa?: Address; action: "lock" | "vote"; amount?: string; tokens?: Address[]; amounts?: string[] };
};

/** Spotlight: lock $STOA, or save this week's votes, signed by the user's wallet */
function SpotCard({ d }: { d: SpotData }) {
  const { address, isConnected, chainId } = useAccount();
  const { open } = useWalletModal();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const pub = usePublicClient({ chainId: RH });
  const [st, setSt] = useState<{ k: "idle" | "busy" | "done" | "failed"; text?: string; tx?: Hash }>({ k: "idle" });
  const s = d.summary, c = d.call;
  const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

  async function go() {
    if (!address) return open();
    if (!SPOT || lc(c.spotlight) !== lc(SPOT)) { setSt({ k: "failed", text: "This is not Stoa's Spotlight contract." }); return; }
    if (c.action === "lock" && lc(c.stoa ?? "") !== lc(STOA_T)) { setSt({ k: "failed", text: "This is not $STOA." }); return; }
    try {
      if (chainId !== RH) { setSt({ k: "busy", text: "Switch to Robinhood Chain…" }); await switchChainAsync({ chainId: RH }); }
      let tx: Hash;
      if (c.action === "lock") {
        const amt = BigInt(c.amount!);
        const have = await pub!.readContract({ address: STOA_T, abi: erc20Abi, functionName: "allowance", args: [address, SPOT] }) as bigint;
        if (have < amt) {
          setSt({ k: "busy", text: "Approve $STOA in your wallet…" });
          const a = await writeContractAsync({ address: STOA_T, abi: erc20Abi, functionName: "approve", args: [SPOT, amt], chainId: RH });
          await pub!.waitForTransactionReceipt({ hash: a });
        }
        setSt({ k: "busy", text: "Confirm the lock in your wallet…" });
        tx = await writeContractAsync({ address: SPOT, abi: spotlightAbi, functionName: "lock", args: [amt], chainId: RH });
      } else {
        setSt({ k: "busy", text: "Confirm your votes in your wallet…" });
        tx = await writeContractAsync({ address: SPOT, abi: spotlightAbi, functionName: "vote", args: [c.tokens!, c.amounts!.map((x) => BigInt(x))], chainId: RH });
      }
      setSt({ k: "busy", text: "Waiting for Robinhood Chain…" });
      const rc = await pub!.waitForTransactionReceipt({ hash: tx });
      setSt(rc.status === "success" ? { k: "done", tx } : { k: "failed", text: "It did not go through. Ask again for a fresh card." });
    } catch (e) { setSt({ k: "failed", text: explain(e) }); }
  }

  return (
    <div className="box" style={{ marginTop: 8 }}>
      <div className="lbl">SPOTLIGHT · {s.action === "lock" ? "LOCK $STOA" : `WEEK ${s.week} VOTES`}</div>
      {s.action === "lock" ? (
        <>
          <div style={{ fontSize: 17, fontWeight: 600, margin: "6px 0" }}>Lock {s.amount} $STOA</div>
          <div className="note">Locked after: {s.lockedAfter} $STOA. It votes every week; unlock any time (it stops voting, then can be withdrawn after the wait).</div>
        </>
      ) : (
        <>
          {(s.votes ?? []).map((v) => <div key={v.token} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderTop: "1px solid #eef1f5" }}><span className="mono">{short(v.token)}</span><b>{v.amount} $STOA</b></div>)}
          {s.votesCloseAt && <div className="note">Votes close {new Date(s.votesCloseAt).toUTCString().slice(0, 22)} UTC.</div>}
        </>
      )}
      {st.k === "done" ? (
        <p style={{ marginTop: 8 }}>{s.action === "lock" ? "Locked." : "Votes saved."} <a href={`${EXPLORER}/tx/${st.tx}`} target="_blank" rel="noopener noreferrer">See it ↗</a> · <a href="/spotlight">Spotlight</a></p>
      ) : (
        <>
          {st.k === "failed" && <div className="notice" style={{ marginTop: 8 }}>{st.text}</div>}
          <button type="button" className="pri" style={{ marginTop: 10, width: "100%" }} disabled={st.k === "busy"} onClick={() => (isConnected ? go() : open())}>
            {!isConnected ? "Connect wallet" : st.k === "busy" ? st.text : s.action === "lock" ? "Lock $STOA" : "Save votes"}
          </button>
        </>
      )}
    </div>
  );
}

function LinkCard({ url, title }: { url: string; title: string }) {
  return (
    <div className="box" style={{ marginTop: 8 }}>
      <div className="lbl">{title}</div>
      <div className="mono" style={{ wordBreak: "break-all", fontSize: 13, margin: "6px 0 8px" }}>{url}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><CopyButton text={url} label="Copy link" /><a className="ghost btn" href={url} target="_blank" rel="noopener noreferrer">Open</a></div>
    </div>
  );
}

function ActionView({ a }: { a: Action }) {
  if (a.tool === "prepare_swap") return <SwapCard d={a.data as unknown as SwapData} />;
  if (a.tool === "prepare_limit_order") return <LimitCard d={a.data as unknown as LimitData} />;
  if (a.tool === "prepare_spotlight") return <SpotCard d={a.data as unknown as SpotData} />;
  if (a.tool === "create_payment_link" && typeof a.data.url === "string" && a.data.url.startsWith("https://stoadex.com/pay?")) return <LinkCard url={a.data.url} title="PAYMENT LINK" />;
  if (a.tool === "pay_payment_link" && a.data.request) {
    const url = requestUrl("https://stoadex.com", a.data.request as PayRequest);
    return <LinkCard url={url} title="PAY ON THE PAYMENT PAGE (CHECKED THERE BEFORE YOU SIGN)" />;
  }
  return null;
}

type Card = { kind: string; data: Record<string, unknown> | unknown[] };
type AMsg = { role: "assistant"; content: string; cards: Card[]; actions: Action[]; status?: string; suggest?: string[]; streaming?: boolean; error?: string; buy?: boolean };
type UMsg = { role: "user"; content: string };
type ChatMsg = AMsg | UMsg;
type Brief = {
  market: { stocks: { symbol: string; gapPct: number }[]; launches: { symbol: string; token: string; graduated: boolean; progress: number; mcapUsd: number }[]; spotlight: { phase: string; opensAt: string | null; stoaLocked: string | number | null; candidates: number } | null } | null;
  wallet: { totalUsd: number; holdings: { symbol: string; address: string; amount: string; usd: number | null; ch24: number | null; verdict?: string }[] } | null;
};

const usd = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `$${v.toLocaleString("en-US", { maximumFractionDigits: v < 10 ? 2 : 0 })}`);
const shortA = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const VERDICT: Record<string, { bg: string; fg: string; label: string }> = {
  ok: { bg: "#e7f6ee", fg: "#15803d", label: "Safety: ok" },
  caution: { bg: "#fff4e0", fg: "#b45309", label: "Caution" },
  danger: { bg: "#fde8e6", fg: "#c2412d", label: "Danger" },
  unknown: { bg: "#eef1f5", fg: "#5e6775", label: "Unknown" },
};
const Badge = ({ v }: { v?: string }) => { const s = VERDICT[v ?? ""] ?? null; return s ? <span style={{ background: s.bg, color: s.fg, borderRadius: 999, padding: "2px 8px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>{s.label}</span> : null; };

export function Avatar({ size = 30 }: { size?: number }) {
  return (
    <div aria-hidden style={{ width: size, height: size, borderRadius: "50%", flex: "none", padding: 2, background: "conic-gradient(from 200deg,#2F6FD6,#7cc4ff,#c9b6ff,#2F6FD6)" }}>
      <div style={{ width: "100%", height: "100%", borderRadius: "50%", background: "#fff", display: "grid", placeItems: "center" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/stoa-logo-200.png" alt="" style={{ width: "70%", height: "70%", borderRadius: "30%" }} />
      </div>
    </div>
  );
}

export function CardView({ c, ask }: { c: Card; ask: (q: string) => void }) {
  const box: React.CSSProperties = { background: "#fff", border: "1px solid var(--line)", borderRadius: 14, padding: "12px 14px", marginTop: 8 };
  if (c.kind === "safety") {
    const d = c.data as { symbol?: string; token?: string; verdict?: string; test?: { buyOk: boolean; sellOk: boolean; buyTaxPct: number | null; sellTaxPct: number | null; roundTripPct: number | null } | null; creatorPct?: number | null; top10Pct?: number | null };
    const pc = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v.toFixed(v < 1 ? 2 : 1)}%`);
    return (
      <div style={box}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}><b>{d.symbol}</b><Badge v={d.verdict} /></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px", marginTop: 8, fontSize: 14 }}>
          <span className="note" style={{ margin: 0 }}>Test buy / sell</span><span>{d.test ? `${d.test.buyOk ? "ok" : "fails"} / ${d.test.sellOk ? "ok" : "fails"}` : "—"}</span>
          <span className="note" style={{ margin: 0 }}>Tax buy / sell</span><span>{pc(d.test?.buyTaxPct)} / {pc(d.test?.sellTaxPct)}</span>
          <span className="note" style={{ margin: 0 }}>Creator holds</span><span>{pc(d.creatorPct)}</span>
          <span className="note" style={{ margin: 0 }}>Top 10 hold</span><span>{pc(d.top10Pct)}</span>
        </div>
        {d.token && <a className="note" href={`/check?token=${d.token}`} style={{ display: "inline-block", marginTop: 6 }}>Full check →</a>}
      </div>
    );
  }
  if (c.kind === "quote") {
    const s = c.data as SwapData["summary"];
    if (!s?.sell) return null;
    return (
      <div style={box}>
        <div className="lbl">QUOTE</div>
        <div style={{ fontSize: 17, fontWeight: 600, marginTop: 4 }}>{s.sell.amount} {s.sell.symbol} → {s.buy.about} {s.buy.symbol}</div>
        <div className="note" style={{ margin: "4px 0 0" }}>At least {s.buy.atLeast} · {s.priceImpactPct !== null ? `${s.priceImpactPct.toFixed(2)}% impact · ` : ""}{s.route}</div>
      </div>
    );
  }
  if (c.kind === "wallet") {
    const w = c.data as NonNullable<Brief["wallet"]>;
    return (
      <div style={box}>
        <div style={{ display: "flex", justifyContent: "space-between" }}><span className="lbl">YOUR WALLET</span><b>{usd(w.totalUsd)}</b></div>
        {w.holdings.slice(0, 6).map((h) => (
          <button key={h.address} type="button" onClick={() => ask(`Tell me about my ${h.symbol}`)} style={{ all: "unset", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, width: "100%", padding: "8px 0", borderTop: "1px solid #eef1f5" }}>
            <span><b>{h.symbol}</b> <span className="note" style={{ margin: 0 }}>{h.amount}</span></span>
            <span style={{ display: "flex", gap: 6, alignItems: "center" }}>{h.verdict && h.verdict !== "ok" && <Badge v={h.verdict} />}<span>{usd(h.usd)}</span>{h.ch24 !== null && <span style={{ fontSize: 12, color: h.ch24 >= 0 ? "#15803d" : "#c2412d" }}>{h.ch24 >= 0 ? "+" : ""}{h.ch24.toFixed(1)}%</span>}</span>
          </button>
        ))}
      </div>
    );
  }
  if (c.kind === "rug") {
    const d = c.data as { scanned: number; tokens: { symbol: string; address: string; usd: number | null; flags: { level: string; text: string }[] }[] };
    const bad = d.tokens.filter((t) => t.flags.length);
    return (
      <div style={box}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span className="lbl">RUG SCAN</span><span className="note" style={{ margin: 0 }}>{d.scanned} token{d.scanned === 1 ? "" : "s"} checked</span></div>
        {!bad.length && <div style={{ marginTop: 6 }}>No rug signs right now.</div>}
        {bad.map((t) => (
          <div key={t.address} style={{ padding: "8px 0", borderTop: "1px solid #eef1f5" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><b>{t.symbol}</b><span>{usd(t.usd)}</span></div>
            {t.flags.map((f, k) => <div key={k} style={{ fontSize: 13.5, color: f.level === "high" ? "#c2412d" : "#b45309", marginTop: 3 }}>{f.level === "high" ? "● " : "○ "}{f.text}</div>)}
          </div>
        ))}
      </div>
    );
  }
  if (c.kind === "gaps" || c.kind === "stock") {
    const rows = (c.kind === "stock" ? [c.data] : c.data) as { symbol: string; gapPct?: number | null; robinhoodPriceUsd?: number | null; robinhoodPrice?: number; onChainPriceUsd?: number; onChain?: { priceUsd?: number } | null }[];
    return (
      <div style={box}>
        <div className="lbl">ON-CHAIN VS ROBINHOOD</div>
        {rows.map((r) => {
          const rh = r.robinhoodPriceUsd ?? null, oc = r.onChainPriceUsd ?? r.onChain?.priceUsd ?? null, g = r.gapPct ?? (rh && oc ? ((oc - rh) / rh) * 100 : null);
          return (
            <div key={r.symbol} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderTop: "1px solid #eef1f5", fontSize: 14 }}>
              <b>{r.symbol}</b><span>{usd(oc)} <span className="note" style={{ margin: 0 }}>vs {usd(rh)}</span> {g !== null && <span style={{ color: Math.abs(g) >= 1 ? "#b45309" : "var(--muted)", fontWeight: 600 }}>{g >= 0 ? "+" : ""}{g.toFixed(2)}%</span>}</span>
            </div>
          );
        })}
      </div>
    );
  }
  return null;
}

function Welcome({ brief, ask, connected, connect }: { brief: Brief | null; ask: (q: string) => void; connected: boolean; connect: () => void }) {
  const chip: React.CSSProperties = { flex: "none", border: "1px solid var(--line)", background: "#fff", borderRadius: 999, padding: "8px 12px", fontSize: 14, cursor: "pointer", color: "var(--ink)" };
  const m = brief?.market;
  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <Avatar />
        <div style={{ background: "#f3f6fb", borderRadius: "4px 16px 16px 16px", padding: "10px 14px", lineHeight: 1.5 }}>
          Hi! I&apos;m Stoa AI. I can quote and prepare swaps, check any token, compare stock tokens with Robinhood, and make payment links. You always sign in your own wallet.
          {!connected && <> <button type="button" onClick={connect} style={{ all: "unset", color: "var(--accent)", fontWeight: 600, cursor: "pointer" }}>Connect a wallet</button> and I&apos;ll look at your tokens too.</>}
        </div>
      </div>
      {brief?.wallet && brief.wallet.holdings.length > 0 && <div style={{ marginLeft: 40 }}><CardView c={{ kind: "wallet", data: brief.wallet as unknown as Record<string, unknown> }} ask={ask} /></div>}
      {m && (
        <div style={{ marginLeft: 40, marginTop: 10, display: "grid", gap: 8 }}>
          {m.stocks.length > 0 && (
            <div style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 14, padding: "10px 14px" }}>
              <div className="lbl">STOCKS FURTHEST FROM ROBINHOOD</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>{m.stocks.map((s) => <button key={s.symbol} type="button" style={chip} onClick={() => ask(`How far is ${s.symbol} from Robinhood's price?`)}>{s.symbol} {s.gapPct >= 0 ? "+" : ""}{s.gapPct.toFixed(2)}%</button>)}</div>
            </div>
          )}
          {m.launches.length > 0 && (
            <div style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 14, padding: "10px 14px" }}>
              <div className="lbl">NEWEST ON PONS</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>{m.launches.map((l) => <button key={l.token} type="button" style={chip} onClick={() => ask(`Is ${l.symbol} (${l.token}) safe?`)}>{l.symbol} · {l.graduated ? "bonded" : `${Math.round(l.progress)}%`}</button>)}</div>
            </div>
          )}
          {m.spotlight && m.spotlight.phase === "before_week_1" && m.spotlight.opensAt && (
            <button type="button" onClick={() => ask("What is Spotlight and how do I vote?")} style={{ all: "unset", cursor: "pointer", background: "#fff", border: "1px solid var(--line)", borderRadius: 14, padding: "10px 14px" }}>
              <div className="lbl">SPOTLIGHT</div><div style={{ marginTop: 4 }}>Opens {new Date(m.spotlight.opensAt).toUTCString().slice(0, 22)} UTC. Lock $STOA and vote →</div>
            </button>
          )}
        </div>
      )}
      <div style={{ marginTop: 16 }}>
        {GROUPS.map((g) => (
          <div key={g.label} style={{ marginBottom: 8 }}>
            <div className="lbl" style={{ marginBottom: 6 }}>{g.label.toUpperCase()}</div>
            <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2, scrollbarWidth: "none" }}>{g.items.map((q) => <button key={q} type="button" style={chip} onClick={() => ask(q)}>{q}</button>)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export const Dots = () => (
  <span aria-label="Thinking" style={{ display: "inline-flex", gap: 4, padding: "4px 0" }}>
    {[0, 1, 2].map((i) => <span key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: "#9aa6bb", animation: `stoaDot 1.2s ${i * 0.15}s infinite ease-in-out` }} />)}
  </span>
);

export type ChatEv = { t: string; d?: string; kind?: string; data?: unknown; tool?: string; items?: string[]; left?: number; credits?: number | null; buy?: boolean };
/** POST /api/ai/chat and hand each streamed event to `on`; a refused request arrives as one error event */
export async function streamChat(body: object, on: (ev: ChatEv) => void) {
  const r = await fetch("/api/ai/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok || !r.body) {
    const j = await r.json().catch(() => ({}));
    on({ t: "error", d: j.error ?? "The assistant could not answer right now.", left: j.left, credits: j.credits, buy: j.buy });
    return;
  }
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      try { on(JSON.parse(line)); } catch { /* skip */ }
    }
  }
}

export default function AiChat() {
  const { address, isConnected } = useAccount();
  const { open: connect } = useWalletModal();
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { try { const v = sessionStorage.getItem(STORE); if (v) setMsgs((JSON.parse(v) as ChatMsg[]).map((m) => (m.role === "assistant" ? { ...m, streaming: false, status: undefined } : m))); } catch { /* blocked */ } }, []);
  useEffect(() => { try { sessionStorage.setItem(STORE, JSON.stringify(msgs.slice(-30))); } catch { /* blocked */ } }, [msgs]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [msgs.length, busy]);
  useEffect(() => {
    let live = true;
    fetch(`/api/ai/brief${address ? `?wallet=${address}` : ""}`).then((r) => r.json()).then((j) => { if (live) setBrief(j); }).catch(() => {});
    return () => { live = false; };
  }, [address]);

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    setInput("");
    const history = [...msgs, { role: "user", content: t } as UMsg];
    const idx = history.length;
    setMsgs([...history, { role: "assistant", content: "", cards: [], actions: [], streaming: true }]);
    setBusy(true);
    const patch = (f: (m: AMsg) => AMsg) => setMsgs((cur) => cur.map((m, i) => (i === idx && m.role === "assistant" ? f(m) : m)));
    try {
      await streamChat({ wallet: address, messages: history.map((m) => ({ role: m.role, content: m.content })) }, (ev) => {
        if (ev.t === "text") patch((m) => ({ ...m, content: m.content + (ev.d ?? ""), status: undefined }));
        else if (ev.t === "status") patch((m) => ({ ...m, status: ev.d }));
        else if (ev.t === "card") patch((m) => ({ ...m, cards: [...m.cards, { kind: ev.kind!, data: ev.data as Card["data"] }] }));
        else if (ev.t === "action") patch((m) => ({ ...m, actions: [...m.actions, { tool: ev.tool!, data: ev.data as Record<string, unknown> }] }));
        else if (ev.t === "suggest") patch((m) => ({ ...m, suggest: ev.items }));
        else if (ev.t === "error") { patch((m) => ({ ...m, error: ev.d, buy: !!ev.buy })); if (typeof ev.left === "number") setLeft(ev.left); }
        else if (ev.t === "done" && typeof ev.left === "number") setLeft(ev.left);
        if ((ev.t === "done" || ev.t === "error") && typeof ev.credits === "number") setCredits(ev.credits);
      });
    } catch { patch((m) => ({ ...m, error: "The assistant could not answer right now." })); }
    finally { patch((m) => ({ ...m, streaming: false, status: undefined })); setBusy(false); }
  }

  const shown = (s: string) => s.split(/\n?\s*NEXT:/i)[0].trim();
  const last = msgs.length - 1;

  return (
    <div className="aichat">
      <style>{`
        @keyframes stoaDot{0%,80%,100%{transform:scale(.6);opacity:.4}40%{transform:scale(1);opacity:1}}
        .aichat{max-width:720px;background:#fff;border:1px solid var(--line);border-radius:22px;box-shadow:0 10px 40px rgba(30,38,51,.06);display:flex;flex-direction:column;min-height:70vh}
        .aichat .ah{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #eef1f5;position:sticky;top:0;background:rgba(255,255,255,.95);backdrop-filter:blur(6px);border-radius:22px 22px 0 0;z-index:2}
        .aichat .ab{flex:1;padding:16px;display:flex;flex-direction:column;gap:14px}
        .aichat .ai-in{position:sticky;bottom:0;padding:10px 12px calc(10px + env(safe-area-inset-bottom));background:rgba(255,255,255,.96);backdrop-filter:blur(6px);border-top:1px solid #eef1f5;border-radius:0 0 22px 22px}
        @media (max-width:860px){.aichat .ai-in{bottom:calc(64px + env(safe-area-inset-bottom));padding-bottom:10px;border-radius:0}}
        .aichat .sugg{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;margin-top:8px}
        .aichat .sugg button{flex:none;border:1px solid #cfdcf3;background:#f4f8ff;color:#1f4fa8;border-radius:999px;padding:7px 12px;font-size:13.5px;cursor:pointer}
      `}</style>
      <div className="ah">
        <Avatar size={34} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: "var(--ink)" }}>Stoa AI <span style={{ fontSize: 11, fontWeight: 700, color: "#1f4fa8", background: "#eaf1ff", borderRadius: 6, padding: "1px 6px", marginLeft: 4 }}>BETA</span></div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e" }} />Online · Robinhood Chain</div>
        </div>
        {isConnected && address
          ? <span className="mono" style={{ fontSize: 12.5, background: "#f3f6fb", borderRadius: 999, padding: "5px 10px" }}>{shortA(address)}</span>
          : null}
      </div>
      <div className="ab">
        {!msgs.length && <Welcome brief={brief} ask={(q) => void send(q)} connected={isConnected} connect={() => connect()} />}
        {msgs.map((m, i) => m.role === "user" ? (
          <div key={i} style={{ alignSelf: "flex-end", maxWidth: "85%", background: "linear-gradient(135deg,#2F6FD6,#4C97F0)", color: "#fff", padding: "10px 14px", borderRadius: "16px 16px 4px 16px", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{m.content}</div>
        ) : (
          <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <Avatar />
            <div style={{ flex: 1, minWidth: 0 }}>
              {m.status && <div className="note" style={{ margin: "4px 0", display: "flex", alignItems: "center", gap: 8 }}><Dots /> {m.status}</div>}
              {m.cards.map((c, k) => <CardView key={k} c={c} ask={(q) => void send(q)} />)}
              {(m.content || (m.streaming && !m.status)) && (
                <div style={{ background: "#f3f6fb", borderRadius: "4px 16px 16px 16px", padding: "10px 14px", lineHeight: 1.55, whiteSpace: "pre-wrap", marginTop: m.cards.length ? 8 : 0 }}>
                  {shown(m.content) ? <Rich text={shown(m.content)} /> : <Dots />}
                </div>
              )}
              {m.actions.map((a, k) => <ActionView key={k} a={a} />)}
              {m.error && <div className="notice" style={{ marginTop: 8 }}>{m.error}</div>}
              {m.buy && <BuyCredits onDone={(c) => setCredits(c)} />}
              {i === last && !busy && m.suggest && m.suggest.length > 0 && (
                <div className="sugg">{m.suggest.map((q) => <button key={q} type="button" onClick={() => void send(q)}>{q}</button>)}</div>
              )}
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form className="ai-in" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", background: "#f3f6fb", borderRadius: 999, padding: "4px 4px 4px 16px" }}>
          <input type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask Stoa AI anything…" maxLength={1000} disabled={busy} aria-label="Message"
            style={{ flex: 1, fontSize: 16, border: 0, background: "transparent", outline: "none", minWidth: 0, padding: "8px 0" }} />
          <button type="submit" aria-label="Send" disabled={busy || !input.trim()} style={{ width: 40, height: 40, borderRadius: "50%", border: 0, background: busy || !input.trim() ? "#c9d3e3" : "var(--accent)", color: "#fff", display: "grid", placeItems: "center", cursor: "pointer", flex: "none" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
          </button>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11.5, color: "var(--muted)", marginTop: 6, padding: "0 6px", flexWrap: "wrap" }}>
          <span>Not financial advice · you sign every swap</span>
          <span>{left !== null ? `${left} free left today` : ""}{credits ? ` · ${credits} credits` : ""}{msgs.length > 0 && !busy && <> · <button type="button" onClick={() => setMsgs([])} style={{ all: "unset", cursor: "pointer", color: "var(--accent)" }}>New chat</button></>}</span>
        </div>
      </form>
    </div>
  );
}

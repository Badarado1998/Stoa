"use client";
import { useEffect, useRef, useState } from "react";
import { useAccount, usePublicClient, useSendTransaction, useSwitchChain, useWriteContract } from "wagmi";
import { BaseError, decodeFunctionData, type Address, type Hash, type Hex } from "viem";
import { erc20Abi, routerAbi } from "@/lib/abi";
import { ROBINHOOD } from "@/lib/networks";
import { NATIVE } from "@/lib/tokens";
import { requestUrl, type PayRequest } from "@/lib/pay";
import CopyButton from "./CopyButton";
import { useWalletModal } from "./Providers";

const RH = ROBINHOOD.chain.id;
const ROUTER = ROBINHOOD.contracts.router!;
const EXPLORER = "https://robinhoodchain.blockscout.com";
const lc = (s: string) => s.toLowerCase();
const STORE = "stoa.ai.chat.v1";

type Action = { tool: string; data: Record<string, unknown> };
type Msg = { role: "user" | "assistant"; content: string; actions?: Action[] };
type SwapData = {
  summary: { sell: { symbol: string; address: Address; amount: string }; buy: { symbol: string; address: Address; about: string; atLeast: string }; priceImpactPct: number | null; route: string; slippagePct: number };
  tx: { to: Address; data: Hex; value: string }; approval: { token: Address; spender: Address; amount: string } | null;
};

const PROMPTS = [
  "Swap 0.01 ETH to USDG",
  "Is STOA safe to buy?",
  "How far is NVDA from Robinhood's price?",
  "Who is in Spotlight this week?",
  "Make me a payment link for 25 USDG",
  "How do I bridge to Robinhood Chain?",
];

/** **bold** only; everything else stays plain text (no HTML from the model ever reaches the page) */
function Rich({ text }: { text: string }) {
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
  if (a.tool === "create_payment_link" && typeof a.data.url === "string" && a.data.url.startsWith("https://stoadex.com/pay?")) return <LinkCard url={a.data.url} title="PAYMENT LINK" />;
  if (a.tool === "pay_payment_link" && a.data.request) {
    const url = requestUrl("https://stoadex.com", a.data.request as PayRequest);
    return <LinkCard url={url} title="PAY ON THE PAYMENT PAGE (CHECKED THERE BEFORE YOU SIGN)" />;
  }
  return null;
}

export default function AiChat() {
  const { address } = useAccount();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { try { const v = sessionStorage.getItem(STORE); if (v) setMsgs(JSON.parse(v)); } catch { /* blocked */ } }, []);
  useEffect(() => { try { sessionStorage.setItem(STORE, JSON.stringify(msgs.slice(-30))); } catch { /* blocked */ } end.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [msgs]);

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    setErr(null); setInput("");
    const next: Msg[] = [...msgs, { role: "user", content: t }];
    setMsgs(next); setBusy(true);
    try {
      const r = await fetch("/api/ai/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet: address, messages: next.map((m) => ({ role: m.role, content: m.content })) }) });
      const j = await r.json().catch(() => ({}));
      if (typeof j.left === "number") setLeft(j.left);
      if (!r.ok) { setErr(j.error ?? "The assistant could not answer right now."); return; }
      setMsgs([...next, { role: "assistant", content: j.reply || "…", actions: j.actions }]);
    } catch { setErr("The assistant could not answer right now."); }
    finally { setBusy(false); }
  }

  return (
    <div className="panel pad" style={{ maxWidth: 720 }}>
      {!msgs.length && (
        <div>
          <div className="lbl">TRY ASKING</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
            {PROMPTS.map((p) => <button key={p} type="button" className="ghost" style={{ padding: "8px 12px", fontSize: 14 }} onClick={() => send(p)}>{p}</button>)}
          </div>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: msgs.length ? 0 : 16 }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "stretch", maxWidth: m.role === "user" ? "85%" : "100%" }}>
            <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5, padding: "10px 14px", borderRadius: 16, background: m.role === "user" ? "#2f6fdc" : "var(--card2, #f3f5f9)", color: m.role === "user" ? "#fff" : "inherit" }}>{m.role === "assistant" ? <Rich text={m.content} /> : m.content}</div>
            {m.actions?.map((a, k) => <ActionView key={k} a={a} />)}
          </div>
        ))}
        {busy && <div className="note">Thinking…</div>}
        <div ref={end} />
      </div>
      {err && <div className="notice" style={{ marginTop: 10 }}>{err}</div>}
      <form onSubmit={(e) => { e.preventDefault(); void send(input); }} style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <input type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about a token, a swap, a stock…" maxLength={1000} disabled={busy}
          style={{ flex: 1, fontSize: 16, padding: "12px 14px", borderRadius: 14, border: "1px solid var(--line, #d9dee8)" }} />
        <button type="submit" className="pri" disabled={busy || !input.trim()} style={{ padding: "0 18px" }}>Send</button>
      </form>
      <div className="note" style={{ marginTop: 8, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
        <span>Not financial advice. It never signs for you: you sign every swap in your wallet.</span>
        {left !== null && <span>{left} free {left === 1 ? "message" : "messages"} left today</span>}
      </div>
      {msgs.length > 0 && <button type="button" className="ghost" style={{ marginTop: 8, padding: "4px 10px", fontSize: 13 }} onClick={() => { setMsgs([]); setErr(null); }}>New chat</button>}
    </div>
  );
}

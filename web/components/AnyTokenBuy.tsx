"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useBalance, usePublicClient, useReadContract, useSendTransaction, useSwitchChain, useWriteContract } from "wagmi";
import { erc20Abi, isAddress, parseUnits, zeroAddress, type Hash } from "viem";
import { NATIVE_ZERO, SOURCES, USDT_MAINNET, sameAddr } from "@/lib/bridge";
import { DST_CHAIN, MAX_USD, RELAY_DEPOSITORY, checkAnyQuote, usdOf } from "@/lib/anychain";
import { ANYTOKEN_PUBLIC, crossBuyResult, type AnyTokenQuote } from "@/lib/anyToken";
import { fmt } from "@/lib/swap";
import { useWalletModal } from "./Providers";
import { explain, markDelivered, sendReceipt, ticketOf, usedDeliveries, type Ticket } from "./AnyChainBuy";

type Phase =
  | { k: "idle" }
  | { k: "signing"; what: string }
  | { k: "moving"; tx: Hash; t: Ticket; q: AnyTokenQuote; since: number; slow?: boolean; unseen?: boolean }
  | { k: "done"; destTx: string; bought?: bigint; refunded?: bigint; q: AnyTokenQuote }
  | { k: "failed"; text: string };

const RH_EXPLORER = "https://robinhoodchain.blockscout.com";
const QUOTE_TTL = 45_000;
const gasReserve = (chainId: number) => (chainId === 1 ? 10n ** 16n : 3n * 10n ** 15n);
const usd = (v?: number | null) => (v !== undefined && v !== null && Number.isFinite(v) && v > 0 ? `$${v.toFixed(v < 1 ? 3 : 2)}` : null);
const VERDICT: Record<string, string> = { ok: "Passed", caution: "Caution", unknown: "Not tested", danger: "Flagged" };

/** Buy any Robinhood Chain token from another chain in one signature: the route delivers ETH to StoaCrossBuy, which
 *  swaps it through the Stoa router into the token for the buyer, or sends the ETH to the buyer if the swap fails. */
export default function AnyTokenBuy() {
  const [show, setShow] = useState(ANYTOKEN_PUBLIC);
  useEffect(() => { if (!ANYTOKEN_PUBLIC && new URLSearchParams(location.search).get("preview") === "anytoken") setShow(true); }, []);
  if (!show) return null;
  return <Panel />;
}

function Panel() {
  const { address, isConnected, chainId } = useAccount();
  const { open: openWallet } = useWalletModal();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();

  const [srcKey, setSrcKey] = useState(SOURCES[0].key);
  const src = SOURCES.find((s) => s.key === srcKey) ?? SOURCES[0];
  const [sTokAddr, setSTokAddr] = useState(src.tokens[0].address);
  const sTok = src.tokens.find((t) => sameAddr(t.address, sTokAddr)) ?? src.tokens[0];
  const [amount, setAmount] = useState("");
  const [out, setOut] = useState("");
  useEffect(() => { const o = new URLSearchParams(location.search).get("out"); if (o && isAddress(o)) setOut(o); }, []);
  const [quote, setQuote] = useState<(AnyTokenQuote & { at: number }) | null>(null);
  const [qErr, setQErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const busy = phase.k === "signing" || phase.k === "moving";
  const pub = usePublicClient({ chainId: src.chain.id });
  const rh = usePublicClient({ chainId: DST_CHAIN });
  const going = useRef(false);

  const native = sameAddr(sTok.address, NATIVE_ZERO);
  const nBal = useBalance({ address, chainId: src.chain.id, query: { enabled: !!address && native } });
  const tBal = useReadContract({ address: sTok.address, abi: erc20Abi, functionName: "balanceOf", args: [address ?? zeroAddress], chainId: src.chain.id, query: { enabled: !!address && !native } });
  const bal = native ? nBal.data?.value : (tBal.data as bigint | undefined);
  const amt = useMemo(() => { try { return amount && Number(amount) > 0 ? parseUnits(amount, sTok.decimals) : undefined; } catch { return undefined; } }, [amount, sTok.decimals]);
  const tooMuch = amt !== undefined && bal !== undefined && amt > bal;
  const outOk = isAddress(out);

  async function fetchQuote(): Promise<AnyTokenQuote & { at: number }> {
    const r = await fetch("/api/anychain/token-quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chainId: src.chain.id, token: sTok.address, amount: amt!.toString(), user: address, tokenOut: out }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(typeof j.error === "string" && j.error !== "busy" && j.error !== "no checkable route" ? j.error : r.status === 429 || j.error === "busy" ? "Busy right now. Try again in a few seconds." : "No route Stoa can check for this right now.");
    const q = j as AnyTokenQuote;
    const paid = BigInt(q.estimate.fromAmount);
    // checked again here: the deposit is exactly what the route asks for, never more than was typed, from this wallet
    if (paid > amt! || !sameAddr(q.tokenOut, out)) throw new Error("This route looks wrong, so Stoa stopped it before your wallet. Nothing was sent.");
    const why = checkAnyQuote(q, { user: address!, chainId: src.chain.id, token: sTok.address, amount: paid });
    if (why) throw new Error(why);
    return { ...q, at: Date.now() };
  }

  const seq = useRef(0);
  useEffect(() => {
    setQuote(null); setQErr(null);
    if (!amt || !address || !outOk || busy) { setLoading(false); return; }
    const my = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try { const q = await fetchQuote(); if (my === seq.current) setQuote(q); }
      catch (e) { if (my === seq.current) setQErr((e as Error).message); }
      finally { if (my === seq.current) setLoading(false); }
    }, 700);
    return () => clearTimeout(t);
  }, [amt, address, src.key, sTok.address, out]); // eslint-disable-line react-hooks/exhaustive-deps

  // follow the delivery: done once Robinhood Chain shows StoaCrossBuy buying for this buyer, or sending the ETH back
  useEffect(() => {
    if (phase.k !== "moving") return;
    let stop = false;
    const { t, q, since } = phase;
    let receiptAt = Date.now();
    const tick = async () => {
      if (stop) return;
      try {
        const qs = new URLSearchParams({ intentId: t.intentId, user: t.user, chainId: String(t.chainId), depositId: t.depositId, sig: t.sig });
        const j = await (await fetch(`/api/anychain/status?${qs}`)).json();
        if (stop) return;
        if ((j.status === "pending" || j.status === "unknown") && Date.now() - receiptAt > 30_000) {
          receiptAt = Date.now();
          setPhase((p) => { if (p.k === "moving") void sendReceipt(p.t, p.tx, [0]); return p; });
        }
        if (j.status === "success" && typeof j.destTx === "string" && /^0x[0-9a-fA-F]{64}$/.test(j.destTx) && rh) {
          const rc = await rh.getTransactionReceipt({ hash: j.destTx as Hash }).catch(() => null);
          const blk = rc ? await rh.getBlock({ blockNumber: rc.blockNumber }).catch(() => null) : null;
          const fresh = !!blk && Number(blk.timestamp) * 1000 >= since - 120_000 && !usedDeliveries().includes(j.destTx.toLowerCase());
          const res = rc && fresh ? crossBuyResult(rc.logs, t.user, q.tokenOut) : null;
          if (res?.kind === "bought" && res.amount >= BigInt(q.minOut)) { markDelivered(j.destTx); return setPhase({ k: "done", destTx: j.destTx, bought: res.amount, q }); }
          if (res?.kind === "refunded") { markDelivered(j.destTx); return setPhase({ k: "done", destTx: j.destTx, refunded: res.eth, q }); }
          if (rc) setPhase((p) => (p.k === "moving" && !p.unseen ? { ...p, unseen: true } : p));
        }
        if (j.status === "failed" || j.status === "expired") return setPhase({ k: "failed", text: "The route reports this purchase failed. Check the source transaction and your wallet there; if nothing comes back, contact Stoa with the source transaction hash." });
      } catch { /* next tick */ }
      if (Date.now() - since > 45 * 60_000) return setPhase({ k: "failed", text: "Still not confirmed after 45 minutes. Check your wallet on Robinhood Chain before trying again." });
      setTimeout(tick, 4000);
    };
    const timer = setTimeout(tick, 4000);
    return () => { stop = true; clearTimeout(timer); };
  }, [phase.k === "moving" ? phase.t.intentId : null, rh]); // eslint-disable-line react-hooks/exhaustive-deps

  async function go() {
    if (!quote || !address || !amt || going.current) return;
    going.current = true;
    try {
      if (chainId !== src.chain.id) { setPhase({ k: "signing", what: `Switch your wallet to ${src.name}` }); await switchChainAsync({ chainId: src.chain.id }); }
      const code = await pub!.getCode({ address });
      if (code && code !== "0x" && !code.toLowerCase().startsWith("0xef0100")) throw new Error("This wallet is a smart contract. The token arrives at the same address on Robinhood Chain, which a smart wallet may not control there, so this only works with a regular wallet.");
      let q = quote;
      if (Date.now() - quote.at > QUOTE_TTL || (quote.expiresAt && Date.parse(quote.expiresAt) - Date.now() < 60_000)) {
        q = await fetchQuote();
        setQuote(q);
        if (BigInt(q.minOut) * 10_000n < BigInt(quote.minOut) * 9_950n) { setPhase({ k: "idle" }); setQErr(`The price moved since you looked: you'd now receive at least ${fmt(BigInt(q.minOut), q.decimals, 4)} ${q.symbol}. Check the new quote and tap again.`); return; }
      }
      const paid = BigInt(q.estimate.fromAmount);
      const why = checkAnyQuote(q, { user: address, chainId: src.chain.id, token: sTok.address, amount: paid });
      if (why || paid > amt) throw new Error(why ?? "This route looks wrong, so Stoa stopped it before your wallet. Nothing was sent.");
      if (!native) {
        const allowance = await pub!.readContract({ address: sTok.address, abi: erc20Abi, functionName: "allowance", args: [address, RELAY_DEPOSITORY] });
        if (allowance < paid) {
          if (allowance > 0n && sameAddr(sTok.address, USDT_MAINNET)) {
            setPhase({ k: "signing", what: "Reset the USDT allowance (USDT needs this first)" });
            await pub!.waitForTransactionReceipt({ hash: await writeContractAsync({ address: sTok.address, abi: erc20Abi, functionName: "approve", args: [RELAY_DEPOSITORY, 0n], chainId: src.chain.id }) });
          }
          setPhase({ k: "signing", what: `Approve ${fmt(paid, sTok.decimals, 4)} ${sTok.symbol}` });
          const ar = await pub!.waitForTransactionReceipt({ hash: await writeContractAsync({ address: sTok.address, abi: erc20Abi, functionName: "approve", args: [RELAY_DEPOSITORY, paid], chainId: src.chain.id }) });
          if (ar.status !== "success") throw new Error("The approval failed. Nothing was sent.");
        }
      }
      const t = q.transaction;
      setPhase({ k: "signing", what: `Buy ${q.symbol} with ${fmt(paid, sTok.decimals, 4)} ${sTok.symbol}` });
      const tx = await sendTransactionAsync({ to: t.to, data: t.data, value: t.value ? BigInt(t.value) : 0n, chainId: Number(t.chainId), gas: t.gasLimit ? (BigInt(t.gasLimit) * 13n) / 10n : undefined });
      const ticket = ticketOf(q, address, src.chain.id);
      void sendReceipt(ticket, tx);
      const moving = { k: "moving" as const, tx, t: ticket, q, since: Date.now() };
      let cancelled = false;
      const rc = await pub!.waitForTransactionReceipt({ hash: tx, timeout: 180_000, onReplaced: (r) => { if (r.reason === "cancelled") cancelled = true; else void sendReceipt(ticket, r.transaction.hash); } }).catch(() => null);
      if (cancelled) throw new Error("You cancelled the deposit in your wallet. Nothing was bought.");
      if (rc && rc.status !== "success") throw new Error(`The transaction failed on ${src.name}. Nothing was sent.`);
      setPhase(rc ? { ...moving, tx: rc.transactionHash } : { ...moving, slow: true });
    } catch (e) { setPhase({ k: "failed", text: explain(e) }); } finally { going.current = false; }
  }

  const reset = () => { setPhase({ k: "idle" }); setAmount(""); setQuote(null); };
  const paid = quote ? BigInt(quote.estimate.fromAmount) : null;
  const ours = amt && address ? usdOf({ user: address, chainId: src.chain.id, token: sTok.address, amount: paid ?? amt }, quote?.ethUsd) : null;
  const fees = quote ? (quote.estimate.fees ?? []).reduce((a, f) => a + Number(f.amountUsd ?? 0), 0) : 0;

  let label = quote ? `Buy ${quote.symbol}` : "Buy";
  if (!isConnected) label = "Connect wallet";
  else if (!outOk) label = "Paste a token address";
  else if (!amt) label = "Enter an amount";
  else if (tooMuch) label = `Not enough ${sTok.symbol} on ${src.name}`;
  else if (loading) label = "Finding a route…";
  else if (!quote) label = qErr ? "No route" : "Buy";
  else if (chainId !== src.chain.id) label = `Switch to ${src.name} and buy`;
  const disabled = isConnected && (!quote || tooMuch || loading || busy);

  return (
    <div className="panel pad" style={{ marginTop: 16 }} id="anytoken">
      <div className="rowx"><div className="lbl">BUY ANY TOKEN FROM ANOTHER CHAIN</div><span className="chip">Preview</span></div>
      {phase.k === "done" ? (
        <div>
          {phase.bought !== undefined
            ? <p style={{ fontSize: 20, margin: "10px 0 4px" }}>{fmt(phase.bought, phase.q.decimals, 4)} {phase.q.symbol} arrived on Robinhood Chain.</p>
            : <p style={{ fontSize: 20, margin: "10px 0 4px" }}>The swap did not go through, so {fmt(phase.refunded ?? 0n, 18, 6)} ETH was sent to your wallet on Robinhood Chain instead.</p>}
          <p className="note" style={{ marginTop: 0 }}>Same wallet address. <a href={`${RH_EXPLORER}/tx/${phase.destTx}`} target="_blank" rel="noopener noreferrer">Delivery on Robinhood Chain ↗</a></p>
          <button type="button" className="ghost" style={{ marginTop: 8 }} onClick={reset}>Buy more</button>
        </div>
      ) : (
        <>
          <p className="note" style={{ marginTop: 6 }}>Pay on another chain, get any Robinhood Chain token in the same wallet, in one signature.</p>
          <div className="seg" role="tablist" style={{ marginTop: 8, flexWrap: "wrap" }}>
            {SOURCES.map((s) => <button key={s.key} type="button" className={s.key === src.key ? "on" : undefined} disabled={busy} onClick={() => { setSrcKey(s.key); setSTokAddr(s.tokens[0].address); }}>{s.name}</button>)}
          </div>
          <div className="box" style={{ marginTop: 12 }}>
            <div className="row"><label className="lbl" htmlFor="tamt">YOU PAY</label>
              <button type="button" className="lbl" style={{ border: 0, background: "none", cursor: bal ? "pointer" : "default" }} disabled={busy}
                onClick={() => { const r = gasReserve(src.chain.id); if (bal) setAmount(fmt(native ? (bal > r ? bal - r : 0n) : bal, sTok.decimals, 8).replace(/,/g, "")); }}>
                BALANCE {bal !== undefined ? fmt(bal, sTok.decimals, 4) : "—"}
              </button></div>
            <div className="row">
              <input id="tamt" type="text" inputMode="decimal" placeholder="0.00" autoComplete="off" value={amount} readOnly={busy}
                onChange={(e) => { setPhase({ k: "idle" }); setAmount(e.target.value.replace(/,/g, ".").replace(/[^0-9.]/g, "")); }} />
              <div className="seg">{src.tokens.map((t) => <button key={t.address} type="button" className={sameAddr(t.address, sTok.address) ? "on" : undefined} disabled={busy} onClick={() => setSTokAddr(t.address)}>{t.symbol}</button>)}</div>
            </div>
            {ours !== null && <div className="usd">≈ {usd(ours)}</div>}
          </div>
          <label className="lbl" htmlFor="tout" style={{ display: "block", marginTop: 16 }}>TOKEN ON ROBINHOOD CHAIN</label>
          <input id="tout" className="box" style={{ marginTop: 8, width: "100%", fontFamily: "var(--mono)", fontSize: 14 }} placeholder="0x… token address" autoComplete="off" spellCheck={false}
            value={out} readOnly={busy} onChange={(e) => { setPhase({ k: "idle" }); setOut(e.target.value.trim()); }} />
          {quote && (
            <div className="det">
              <span>You get about</span><span>{fmt(BigInt(quote.expectedOut), quote.decimals, 4)} {quote.symbol}</span>
              <span>At least</span><span>{fmt(BigInt(quote.minOut), quote.decimals, 4)} {quote.symbol}</span>
              <span>You pay</span><span>{fmt(paid!, sTok.decimals, 6)} {sTok.symbol}</span>
              <span>Safety check</span><span style={quote.safety.verdict === "caution" ? { color: "#B4442E", fontWeight: 600 } : undefined}>{VERDICT[quote.safety.verdict] ?? quote.safety.verdict}</span>
              <span>Route fees</span><span>{usd(fees) ?? "none"}</span>
              <span>Stoa swap fee</span><span>0.02%</span>
              <span>Route</span><span>Relay via Trustware, then Stoa</span>
            </div>
          )}
          {quote && quote.safety.verdict !== "ok" && quote.safety.notes.length > 0 && <div className="notice" style={{ marginTop: 12 }}>{quote.safety.notes.join(" ")}</div>}
          {qErr && !loading && <div className="notice" style={{ marginTop: 12 }}>{qErr}</div>}
          {phase.k === "failed" && <div className="notice" style={{ marginTop: 12 }}>{phase.text}</div>}
          {phase.k === "signing" && <div className="notice" style={{ marginTop: 12 }}>{phase.what}. Confirm it in your wallet.</div>}
          {phase.k === "moving" && (
            <div className="notice" style={{ marginTop: 12 }}>
              {phase.unseen
                ? "The route reports delivery, but Stoa does not see the purchase at your address on Robinhood Chain yet. This page keeps checking. "
                : phase.slow ? `Your deposit was sent, but ${src.name} has not confirmed it yet. Do not buy again: this page keeps following it. ` : `Sent. ${phase.q.symbol} is on its way to Robinhood Chain, to the same address. `}
              <a href={`${src.chain.blockExplorers?.default.url}/tx/${phase.tx}`} target="_blank" rel="noopener noreferrer">Source tx ↗</a>
            </div>
          )}
          <button type="button" className="big pri" style={{ width: "100%", marginTop: 14 }} disabled={disabled}
            onClick={() => (!isConnected ? openWallet() : go())}>{phase.k === "signing" ? "Confirm in your wallet…" : phase.k === "moving" ? "Delivering…" : label}</button>
          <p className="note">
            Your deposit on {src.name} goes to Relay&apos;s Depository, from your own address, for exactly the amount shown; Stoa checks that before your wallet opens.
            Relay delivers ETH on Robinhood Chain to StoaCrossBuy, which swaps it through the Stoa router into the token for you. If the swap can&apos;t be done
            (the price moved past the minimum, the route is gone, or it is late), the ETH is sent to your wallet on Robinhood Chain instead.
            Every token gets Stoa&apos;s safety check first, and a flagged token is refused. Purchases are limited to ${MAX_USD} for now. Use a regular wallet.
          </p>
        </>
      )}
    </div>
  );
}

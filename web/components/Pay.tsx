"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAccount, useBalance, usePublicClient, useReadContract, useSendTransaction, useSwitchChain, useWriteContract } from "wagmi";
import { BaseError, decodeFunctionData, erc20Abi as viemErc20, isAddress, parseUnits, type Address, type Hash, type Hex } from "viem";
import { erc20Abi, routerAbi } from "@/lib/abi";
import { ROBINHOOD } from "@/lib/networks";
import { NATIVE, type Token } from "@/lib/tokens";
import { NOTE_MAX, PAY_MAX_USDG, newId, readRequest, requestUrl, tagIn, type PayRequest } from "@/lib/pay";
import { fmt } from "@/lib/swap";
import { SOURCES } from "@/lib/bridge";
import { PAY_CROSS_MAX_USDG, PAY_SOURCES, checkPayCross, type PayCrossQuote } from "@/lib/payAnychain";
import CopyButton from "./CopyButton";
import { useWalletModal } from "./Providers";

const EXPLORER = "https://robinhoodchain.blockscout.com";
const USDG = ROBINHOOD.stable;
const ROUTER = ROBINHOOD.contracts.router!;
const RH = ROBINHOOD.chain.id;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const lc = (a: string) => a.toLowerCase();
const PAY_WITH: Token[] = ROBINHOOD.tokens.filter((t) => lc(t.address) !== lc(ROBINHOOD.wrapped));
type StockRow = { symbol: string; address: Address; halted: boolean; routeOnStoa?: boolean };
let stockCache: StockRow[] | null = null;
/** every Robinhood stock token (/api/v1/stocks), for payout choices and names */
function useStocks(): StockRow[] {
  const [list, setList] = useState<StockRow[]>(stockCache ?? []);
  useEffect(() => {
    if (stockCache) return;
    fetch("/api/v1/stocks").then((r) => r.json()).then((j: { stocks: StockRow[] }) => { stockCache = j.stocks; setList(j.stocks); }).catch(() => {});
  }, []);
  return list;
}
const symbolOf = (a?: Address) => (!a ? "USDG" : (stockCache ?? []).find((t) => lc(t.address) === lc(a))?.symbol ?? ROBINHOOD.tokens.find((t) => lc(t.address) === lc(a))?.symbol ?? short(a));

type Quote = {
  transfer?: boolean; amountIn: string; amountOut: string; tx: { to: Address; data: Hex; value: string };
  approval?: { token: Address; spender: Address; amount: string };
  payment: { amount: string; to: Address; get: Address; minOut: string };
};
type Phase = { k: "idle" } | { k: "busy"; text: string } | { k: "done"; tx: Hash } | { k: "failed"; text: string };
type Status = { paid: boolean; via?: "stoa" | "relay"; tx?: Hash; at?: number | null };

function explain(e: unknown): string {
  if (e instanceof BaseError) {
    if (/User rejected|denied/i.test(e.shortMessage)) return "You rejected the request in your wallet.";
    if (/insufficient funds/i.test(e.shortMessage)) return "Not enough ETH for this payment and the gas.";
    return e.shortMessage;
  }
  return (e as Error)?.message ?? "Something went wrong.";
}

/** The transaction Stoa built must be exactly this payment: this token in, the payout token out to the requester, with
 *  the minimum the request needs, and the request's id at the end. Checked here, whatever the server said. For a stock
 *  payout the minimum is checked against a USDG quote this browser fetches itself. */
async function checkQuote(q: Quote, req: PayRequest, token: Token, raw: bigint): Promise<string | null> {
  const out = req.get ?? USDG;
  const min = BigInt(q.payment?.minOut ?? "0");
  if (!req.get) { if (min !== raw) return "The payment does not guarantee the requested amount."; }
  else {
    const r = await fetch(`/api/v1/quote?chain=robinhood&sellToken=${USDG}&buyToken=${out}&amount=${raw}`).then((x) => x.json()).catch(() => null) as { amountOut?: string } | null;
    if (!r?.amountOut || min * 100n < BigInt(r.amountOut) * 98n) return `The payment does not guarantee about ${req.amount} USDG worth of ${symbolOf(req.get)}.`;
  }
  if (req.id && tagIn(q.tx.data) !== req.id) return "The payment does not carry this request's id.";
  try {
    if (q.transfer) {
      if (lc(q.tx.to) !== lc(out) || lc(token.address) !== lc(out)) return "Unexpected transfer.";
      const d = decodeFunctionData({ abi: viemErc20, data: q.tx.data });
      if (d.functionName !== "transfer" || lc(d.args[0]) !== lc(req.to) || d.args[1] !== min || BigInt(q.tx.value) !== 0n) return "The transfer is not this payment.";
      return null;
    }
    if (lc(q.tx.to) !== lc(ROUTER)) return "The payment is not going through Stoa's router.";
    const d = decodeFunctionData({ abi: routerAbi, data: q.tx.data });
    if (d.functionName !== "swap") return "Unexpected call.";
    const p = (d.args as readonly [{ tokenIn: Address; tokenOut: Address; amountIn: bigint; minOut: bigint; to: Address }])[0];
    if (lc(p.tokenIn) !== lc(token.address) || lc(p.tokenOut) !== lc(out)) return "The swap is not for the tokens of this payment.";
    if (lc(p.to) !== lc(req.to)) return "The swap does not pay the address in this request.";
    if (p.minOut !== min) return "The swap does not guarantee the requested amount.";
    if (p.amountIn !== BigInt(q.amountIn)) return "The amount does not match.";
    if (token.address === NATIVE ? BigInt(q.tx.value) !== p.amountIn : BigInt(q.tx.value) !== 0n) return "The ETH sent does not match.";
  } catch { return "Stoa could not read the payment it built."; }
  return null;
}

export default function Pay() {
  const sp = useSearchParams();
  const req = useMemo(() => readRequest({ to: sp.get("to"), amount: sp.get("amount"), note: sp.get("note"), get: sp.get("get"), id: sp.get("id"), b: sp.get("b") }), [sp]);
  const malformed = !req && (sp.get("to") || sp.get("amount"));
  return req ? <PayRequestView req={req} /> : <CreateRequest malformed={!!malformed} />;
}

function Qr({ text }: { text: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    import("qrcode").then((Q) => Q.toString(text, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#111827", light: "#ffffff" } }))
      .then((v) => { if (live) setSvg(v); }).catch(() => setSvg(null));
    return () => { live = false; };
  }, [text]);
  if (!svg) return null;
  // the SVG is generated locally from the link Stoa just built
  return <div aria-label="QR code of the payment link" role="img" style={{ width: 200, height: 200, background: "#fff", borderRadius: 12, padding: 8, border: "1px solid var(--line, #e5e7eb)" }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

function CreateRequest({ malformed }: { malformed: boolean }) {
  const { address } = useAccount();
  const { open: openWallet } = useWalletModal();
  const pub = usePublicClient({ chainId: RH });
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [get, setGet] = useState<string>("");
  const [id] = useState(newId);
  const [b, setB] = useState<number | null>(null);
  const stocks = useStocks().filter((x) => x.routeOnStoa && !x.halted).sort((x, y) => x.symbol.localeCompare(y.symbol));
  useEffect(() => { if (address && !to) setTo(address); }, [address]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { pub?.getBlockNumber().then((n) => setB(Number(n))).catch(() => {}); }, [pub]);
  const r = readRequest({ to, amount, note, get: get || null, id, b: b ? String(b) : null });
  const url = r && typeof window !== "undefined" ? requestUrl(window.location.origin, r) : null;
  const share = async () => { if (url && navigator.share) { try { await navigator.share({ title: `Pay ${r!.amount} USDG`, url }); } catch { /* closed */ } } };
  return (
    <div className="panel pad" style={{ maxWidth: 560 }}>
      {malformed && <div className="notice" style={{ marginBottom: 12 }}>That payment link is not valid. Ask the sender for a new one.</div>}
      <div className="lbl">CREATE A PAYMENT LINK</div>
      <p className="note" style={{ marginTop: 6 }}>Ask to be paid on Robinhood Chain. Whoever opens the link can pay with ETH, USDG, a stock token or any token Stoa routes, or ETH from another chain. You receive USDG, or a stock token if you pick one.</p>
      <div className="box" style={{ marginTop: 12 }}>
        <div className="row"><label className="lbl" htmlFor="pay-to">YOUR WALLET</label>{!address && <button type="button" className="ghost" style={{ padding: "2px 10px", fontSize: 13 }} onClick={() => openWallet()}>Use my wallet</button>}</div>
        <input id="pay-to" type="text" placeholder="0x…" autoComplete="off" spellCheck={false} value={to} onChange={(e) => setTo(e.target.value.trim())} style={{ fontSize: 16, width: "100%" }} />
        {to && !isAddress(to, { strict: false }) && <div className="note" style={{ color: "#c2412d" }}>Not an address.</div>}
      </div>
      <div className="box" style={{ marginTop: 10 }}>
        <div className="row"><label className="lbl" htmlFor="pay-amt">AMOUNT</label><span className="lbl">MAX {PAY_MAX_USDG.toLocaleString("en-US")}</span></div>
        <div className="row">
          <input id="pay-amt" type="text" inputMode="decimal" placeholder="0.00" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value.replace(/,/g, ".").replace(/[^0-9.]/g, ""))} />
          <b>USDG</b>
        </div>
      </div>
      <div className="box" style={{ marginTop: 10 }}>
        <div className="row"><label className="lbl" htmlFor="pay-get">RECEIVE AS</label></div>
        <select id="pay-get" value={get} onChange={(e) => setGet(e.target.value)} style={{ fontSize: 16, width: "100%", padding: "6px 4px", borderRadius: 10 }}>
          <option value="">USDG</option>
          {stocks.map((t) => <option key={t.address} value={t.address}>{t.symbol} (stock token)</option>)}
        </select>
        {get && <div className="note" style={{ marginTop: 6 }}>You get what {amount || "the amount"} USDG buys of {symbolOf(get as Address)} when they pay (at least 99.5% of it). Stock Tokens are issued by Robinhood and not offered in every country. Paying from another chain works for USDG payouts only.</div>}
      </div>
      <div className="box" style={{ marginTop: 10 }}>
        <div className="row"><label className="lbl" htmlFor="pay-note">NOTE (OPTIONAL)</label><span className="lbl">{note.length}/{NOTE_MAX}</span></div>
        <input id="pay-note" type="text" maxLength={NOTE_MAX} placeholder="Logo design, invoice #12…" value={note} onChange={(e) => setNote(e.target.value)} style={{ fontSize: 16, width: "100%" }} />
      </div>
      {url ? (
        <div style={{ marginTop: 14 }}>
          <div className="lbl">YOUR LINK</div>
          <div className="mono" style={{ wordBreak: "break-all", fontSize: 13, margin: "6px 0 10px" }}>{url}</div>
          <div style={{ margin: "4px 0 12px" }}><Qr text={url} /></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <CopyButton text={url} label="Copy link" />
            {typeof navigator !== "undefined" && "share" in navigator && <button type="button" className="ghost" onClick={share}>Share</button>}
            <a className="ghost btn" href={url} target="_blank" rel="noopener noreferrer">Open</a>
          </div>
          <p className="note" style={{ marginTop: 10 }}>Nothing is stored: the link itself is the request. Open it to see when it is paid. Anyone with it can pay you; it never lets anyone take funds.</p>
        </div>
      ) : (
        <p className="note" style={{ marginTop: 12 }}>Enter your wallet and an amount to get the link.</p>
      )}
    </div>
  );
}

function usePaid(req: PayRequest) {
  const [st, setSt] = useState<Status | null>(null);
  useEffect(() => {
    if (!req.id || !req.b) return;
    let stop = false;
    const u = new URLSearchParams({ to: req.to, get: req.get ?? USDG, amount: parseUnits(req.amount, 6).toString(), id: req.id, b: String(req.b) });
    const tick = async () => {
      if (stop) return;
      const s = await fetch(`/api/pay/status?${u}`).then((r) => (r.ok ? r.json() : null)).catch(() => null) as Status | null;
      if (s) setSt(s);
      if (!s?.paid) setTimeout(tick, 12_000);
    };
    void tick();
    return () => { stop = true; };
  }, [req]);
  return st;
}

function PaidCard({ req, st }: { req: PayRequest; st: Status }) {
  useStocks();
  return (
    <div className="panel pad" style={{ maxWidth: 560 }}>
      <div className="lbl" style={{ color: "#15803d" }}>✓ PAID</div>
      <p style={{ fontSize: 22, margin: "8px 0" }}>{req.get ? `${req.amount} USDG worth of ${symbolOf(req.get)}` : `${req.amount} USDG`} to {short(req.to)}{req.note ? ` for "${req.note}"` : ""}{st.at ? `, ${new Date(st.at * 1000).toUTCString().replace("GMT", "UTC")}` : ""}.</p>
      {st.tx && (st.via === "stoa"
        ? <a href={`/pay/receipt?tx=${st.tx}`}>See the receipt</a>
        : <a href={`${EXPLORER}/tx/${st.tx}`} target="_blank" rel="noopener noreferrer">Delivered by Relay: see it on Robinhood Chain ↗</a>)}
      <p className="note" style={{ marginTop: 12 }}>Need to ask for a payment yourself? <a href="/pay">Create a link</a>.</p>
    </div>
  );
}

function PayRequestView({ req }: { req: PayRequest }) {
  const { address, isConnected, chainId } = useAccount();
  const { open: openWallet } = useWalletModal();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();
  const pub = usePublicClient({ chainId: RH });
  const st = usePaid(req);
  useStocks();
  const [tokenAddr, setTokenAddr] = useState<string>(USDG);
  const [src, setSrc] = useState<number>(RH);
  const token = PAY_WITH.find((t) => lc(t.address) === lc(tokenAddr)) ?? PAY_WITH.find((t) => lc(t.address) === lc(USDG))!;
  const raw = parseUnits(req.amount, 6);
  const outSym = symbolOf(req.get);
  const [quote, setQuote] = useState<(Quote & { at: number }) | null>(null);
  const [qErr, setQErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const ref = useRef<string | null>(null);
  useEffect(() => { try { ref.current = localStorage.getItem("stoa.ref"); } catch { /* blocked */ } }, []);
  const self = !!address && lc(address) === lc(req.to);

  const bal = useReadContract({
    address: token.address === NATIVE ? undefined : token.address, abi: erc20Abi, functionName: "balanceOf",
    args: address ? [address] : undefined, chainId: RH, query: { enabled: !!address && token.address !== NATIVE },
  });
  const [ethBal, setEthBal] = useState<bigint | undefined>();
  useEffect(() => { if (address && pub) pub.getBalance({ address }).then(setEthBal).catch(() => {}); }, [address, pub, phase.k]);
  const balance = token.address === NATIVE ? ethBal : (bal.data as bigint | undefined);

  async function fetchQuote(): Promise<Quote & { at: number }> {
    const u = new URLSearchParams({ token: token.address === NATIVE ? "native" : token.address, amount: raw.toString(), payer: address!, to: req.to });
    if (req.get) u.set("get", req.get);
    if (req.id) u.set("id", req.id);
    if (ref.current && isAddress(ref.current, { strict: false })) u.set("referrer", ref.current);
    const r = await fetch(`/api/pay/quote?${u}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(typeof j.error === "string" ? j.error : "No route for this token right now.");
    const why = await checkQuote(j as Quote, req, token, raw);
    if (why) throw new Error(why);
    return { ...(j as Quote), at: Date.now() };
  }

  const seq = useRef(0);
  useEffect(() => {
    setQuote(null); setQErr(null);
    if (!address || src !== RH || st?.paid || phase.k === "busy" || phase.k === "done") { setLoading(false); return; }
    const my = ++seq.current;
    setLoading(true);
    fetchQuote().then((q) => { if (my === seq.current) setQuote(q); }).catch((e) => { if (my === seq.current) setQErr((e as Error).message); }).finally(() => { if (my === seq.current) setLoading(false); });
  }, [tokenAddr, address, src]); // eslint-disable-line react-hooks/exhaustive-deps

  const need = quote ? BigInt(quote.amountIn) : undefined;
  const short_ = need !== undefined && balance !== undefined && need > balance;

  async function pay() {
    if (!address || !pub || !quote) return;
    try {
      if (chainId !== RH) { setPhase({ k: "busy", text: "Switch to Robinhood Chain in your wallet…" }); await switchChainAsync({ chainId: RH }); }
      let q = quote;
      if (Date.now() - q.at > 30_000) { setPhase({ k: "busy", text: "Refreshing the price…" }); q = await fetchQuote(); setQuote(q); }
      if (q.approval) {
        const allowance = await pub.readContract({ address: token.address, abi: erc20Abi, functionName: "allowance", args: [address, ROUTER] }) as bigint;
        if (allowance < BigInt(q.amountIn)) {
          setPhase({ k: "busy", text: `Approve ${token.symbol} in your wallet…` });
          const a = await writeContractAsync({ address: token.address, abi: erc20Abi, functionName: "approve", args: [ROUTER, BigInt(q.amountIn)], chainId: RH });
          await pub.waitForTransactionReceipt({ hash: a });
        }
      }
      setPhase({ k: "busy", text: "Confirm the payment in your wallet…" });
      const tx = await sendTransactionAsync({ chainId: RH, to: q.tx.to, data: q.tx.data, value: BigInt(q.tx.value) });
      setPhase({ k: "busy", text: "Waiting for Robinhood Chain…" });
      const rc = await pub.waitForTransactionReceipt({ hash: tx });
      if (rc.status !== "success") throw new Error("The payment did not go through. Nothing was taken except gas; try again.");
      setPhase({ k: "done", tx });
    } catch (e) {
      setPhase({ k: "failed", text: explain(e) });
    }
  }

  if (st?.paid && phase.k !== "done") return <PaidCard req={req} st={st} />;
  if (phase.k === "done") {
    return (
      <div className="panel pad" style={{ maxWidth: 560 }}>
        <div className="lbl" style={{ color: "#15803d" }}>✓ PAID</div>
        <p style={{ fontSize: 22, margin: "8px 0" }}>{req.get ? `${req.amount} USDG worth of ${outSym}` : `${req.amount} USDG`} sent to {short(req.to)}{req.note ? ` for "${req.note}"` : ""}.</p>
        {req.id ? <a href={`/pay/receipt?tx=${phase.tx}`}>See the receipt</a> : <a className="note" href={`${EXPLORER}/tx/${phase.tx}`} target="_blank" rel="noopener noreferrer">See the payment on Robinhood Chain ↗</a>}
        <p className="note" style={{ marginTop: 12 }}>Need to ask for a payment yourself? <a href="/pay">Create a link</a>.</p>
      </div>
    );
  }

  let label = `Pay ${req.amount} USDG${req.get ? ` in ${outSym}` : ""}`;
  if (!isConnected) label = "Connect wallet";
  else if (self) label = "This is your own request";
  else if (loading) label = "Finding the route…";
  else if (qErr) label = "No route";
  else if (short_) label = `Not enough ${token.symbol}`;
  else if (phase.k === "busy") label = phase.text;
  const disabled = isConnected && (self || phase.k === "busy" || short_ || !quote || loading);
  const sources = req.get ? [RH] : [RH, ...PAY_SOURCES];

  return (
    <div className="panel pad" style={{ maxWidth: 560 }}>
      <div className="lbl">PAYMENT REQUEST · ROBINHOOD CHAIN</div>
      <div style={{ fontSize: 40, fontWeight: 700, margin: "8px 0 2px" }}>{Number(req.amount).toLocaleString("en-US", { maximumFractionDigits: 2 })} <span style={{ fontSize: 22 }}>USDG{req.get ? ` in ${outSym}` : ""}</span></div>
      {req.note && <p style={{ fontSize: 17, margin: "4px 0" }}>“{req.note}”</p>}
      <div className="note" style={{ marginTop: 6 }}>To <span className="mono" style={{ wordBreak: "break-all" }}>{req.to}</span> <CopyButton text={req.to} label="Copy" /></div>
      <p className="note" style={{ marginTop: 6 }}>Check this address with the person who sent you the link. Stoa does not know who it belongs to.{st && !st.paid ? " Not paid yet." : ""}</p>

      {sources.length > 1 && <>
        <div className="lbl" style={{ marginTop: 14 }}>PAY FROM</div>
        <div className="seg" role="tablist" aria-label="Pay from" style={{ marginTop: 6, flexWrap: "wrap" }}>
          {sources.map((id) => (
            <button key={id} type="button" role="tab" aria-selected={src === id} className={src === id ? "on" : undefined} disabled={phase.k === "busy"}
              onClick={() => { setPhase({ k: "idle" }); setSrc(id); }}>{id === RH ? "Robinhood Chain" : SOURCES.find((x) => x.chain.id === id)?.name}</button>
          ))}
        </div>
      </>}
      {src === RH ? (<>
        <div className="lbl" style={{ marginTop: 14 }}>PAY WITH</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
          {PAY_WITH.slice(0, 2).map((t) => (
            <button key={t.address} type="button" className={lc(t.address) === lc(token.address) ? "pri" : "ghost"} style={{ padding: "6px 14px" }} disabled={phase.k === "busy"} onClick={() => { setPhase({ k: "idle" }); setTokenAddr(t.address); }}>{t.symbol}</button>
          ))}
          <select aria-label="Another token" value={PAY_WITH.slice(0, 2).some((t) => lc(t.address) === lc(token.address)) ? "" : token.address} disabled={phase.k === "busy"}
            onChange={(e) => { if (e.target.value) { setPhase({ k: "idle" }); setTokenAddr(e.target.value); } }} style={{ fontSize: 15, padding: "6px 8px", borderRadius: 10 }}>
            <option value="">Another token…</option>
            {PAY_WITH.slice(2).map((t) => <option key={t.address} value={t.address}>{t.symbol}</option>)}
          </select>
        </div>
        <div className="det" style={{ marginTop: 12 }}>
          <span>You pay</span><span>{quote ? `${fmt(BigInt(quote.amountIn), token.decimals, 6)} ${token.symbol}` : "…"}</span>
          <span>They receive</span><span>{req.get ? (quote ? `at least ${fmt(BigInt(quote.payment.minOut), 18, 6)} ${outSym}` : `about ${req.amount} USDG of ${outSym}`) : `${quote?.transfer ? "" : "at least "}${req.amount} USDG`}</span>
          {balance !== undefined && <><span>Your {token.symbol}</span><span>{fmt(balance, token.decimals, 4)}</span></>}
          {quote && !quote.transfer && <><span>How</span><span>one swap through Stoa, paid straight to them</span></>}
        </div>
        {qErr && <div className="notice" style={{ marginTop: 10 }}>{qErr}</div>}
        {phase.k === "failed" && <div className="notice" style={{ marginTop: 10 }}>{phase.text}</div>}
        <button type="button" className="big pri" style={{ marginTop: 12, width: "100%" }} disabled={disabled} onClick={() => (isConnected ? pay() : openWallet())}>{label}</button>
        <p className="note" style={{ marginTop: 8 }}>{quote?.transfer ? "A plain transfer." : `If the price moves before it lands so that they would get less than the minimum, the swap does not go through and you keep your ${token.symbol}. Any extra goes to them.`} Payments on-chain cannot be reversed.</p>
      </>) : <PayCross req={req} chainId={src} />}
    </div>
  );
}

type CrossPhase = { k: "idle" } | { k: "busy"; text: string } | { k: "moving"; tx: Hash; id: string; since: number } | { k: "done"; id: string } | { k: "failed"; text: string };

/** Pay the same request with ETH on another chain; Relay pays the USDG on Robinhood Chain (lib/payAnychain.ts). */
function PayCross({ req, chainId }: { req: PayRequest; chainId: number }) {
  const { address, isConnected, chainId: walletChain } = useAccount();
  const { open: openWallet } = useWalletModal();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const srcInfo = SOURCES.find((x) => x.chain.id === chainId)!;
  const raw = parseUnits(req.amount, 6);
  const over = Number(req.amount) > PAY_CROSS_MAX_USDG;
  const bal = useBalance({ address, chainId, query: { enabled: !!address } });
  const [quote, setQuote] = useState<(PayCrossQuote & { at: number }) | null>(null);
  const [qErr, setQErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<CrossPhase>({ k: "idle" });
  const self = !!address && lc(address) === lc(req.to);

  async function fetchQuote() {
    const r = await fetch("/api/pay/crosschain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chainId, payer: address, to: req.to, amount: raw.toString() }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(typeof j.error === "string" ? j.error : "No route from this chain right now.");
    const why = checkPayCross(j as PayCrossQuote, { chainId, payer: address!, to: req.to, amount: raw });
    if (why) throw new Error(why);
    return { ...(j as PayCrossQuote), at: Date.now() };
  }

  const seq = useRef(0);
  useEffect(() => {
    setQuote(null); setQErr(null);
    if (!address || over || self) { setLoading(false); return; }
    const my = ++seq.current;
    setLoading(true);
    fetchQuote().then((q) => { if (my === seq.current) setQuote(q); }).catch((e) => { if (my === seq.current) setQErr((e as Error).message); }).finally(() => { if (my === seq.current) setLoading(false); });
  }, [address, chainId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase.k !== "moving") return;
    let stop = false;
    const { id, since } = phase;
    const tick = async () => {
      if (stop) return;
      const s = await fetch(`https://api.relay.link/intents/status/v3?requestId=${id}`).then((r) => r.json()).catch(() => null) as { status?: string } | null;
      if (s?.status === "success") { setPhase({ k: "done", id }); return; }
      if (s?.status === "refund" || s?.status === "failure") { setPhase({ k: "failed", text: "Relay could not deliver this payment, so it refunds your ETH. Nothing reached the requester." }); return; }
      if (Date.now() - since > 45 * 60_000) { setPhase({ k: "failed", text: "This is taking much longer than usual. Follow it on relay.link with your transaction." }); return; }
      setTimeout(tick, 4000);
    };
    void tick();
    return () => { stop = true; };
  }, [phase]);

  async function go() {
    if (!quote || !address) return;
    try {
      let q = quote;
      if (Date.now() - q.at > 30_000) { setPhase({ k: "busy", text: "Refreshing the price…" }); q = await fetchQuote(); setQuote(q); }
      if (walletChain !== chainId) { setPhase({ k: "busy", text: `Switch to ${srcInfo.name} in your wallet…` }); await switchChainAsync({ chainId }); }
      setPhase({ k: "busy", text: "Confirm the payment in your wallet…" });
      const tx = await sendTransactionAsync({ chainId, to: q.tx.to, data: q.tx.data, value: BigInt(q.tx.value) });
      setPhase({ k: "moving", tx, id: q.requestId, since: Date.now() });
    } catch (e) { setPhase({ k: "failed", text: explain(e) }); }
  }

  if (phase.k === "done") {
    return (
      <div style={{ marginTop: 12 }}>
        <p style={{ fontSize: 20, margin: "6px 0" }}>Paid: {req.amount} USDG reached {short(req.to)} on Robinhood Chain.</p>
        <a className="note" href={`https://relay.link/transaction/${phase.id}`} target="_blank" rel="noopener noreferrer">See it on Relay ↗</a>
      </div>
    );
  }
  const pay = quote ? BigInt(quote.tx.value) : undefined;
  const short_ = pay !== undefined && bal.data !== undefined && pay > bal.data.value;
  let label = `Pay ${req.amount} USDG`;
  if (!isConnected) label = "Connect wallet";
  else if (self) label = "This is your own request";
  else if (over) label = `Up to ${PAY_CROSS_MAX_USDG} USDG from another chain`;
  else if (loading) label = "Finding the route…";
  else if (qErr) label = "No route";
  else if (short_) label = `Not enough ETH on ${srcInfo.name}`;
  else if (phase.k === "busy") label = phase.text;
  else if (phase.k === "moving") label = "On its way…";
  return (
    <>
      <div className="det" style={{ marginTop: 12 }}>
        <span>You pay on {srcInfo.name}</span><span>{quote ? `${fmt(BigInt(quote.tx.value), 18, 6)} ETH${quote.inUsd ? ` (~$${quote.inUsd.toFixed(2)})` : ""}` : "…"}</span>
        <span>They receive</span><span>{req.amount} USDG on Robinhood Chain</span>
        {bal.data && <><span>Your ETH on {srcInfo.name}</span><span>{fmt(bal.data.value, 18, 5)}</span></>}
        <span>Delivery</span><span>{quote?.etaSeconds && quote.etaSeconds < 120 ? "usually under a minute, via Relay" : "a few minutes, via Relay"}</span>
      </div>
      {qErr && <div className="notice" style={{ marginTop: 10 }}>{qErr}</div>}
      {phase.k === "failed" && <div className="notice" style={{ marginTop: 10 }}>{phase.text}</div>}
      {phase.k === "moving" && <p className="note" style={{ marginTop: 10 }}>Sent. Relay is paying {req.amount} USDG to {short(req.to)} on Robinhood Chain. <a href={`https://relay.link/transaction/${phase.id}`} target="_blank" rel="noopener noreferrer">Follow it on Relay ↗</a></p>}
      <button type="button" className="big pri" style={{ marginTop: 12, width: "100%" }} disabled={isConnected && (self || over || !quote || loading || short_ || phase.k === "busy" || phase.k === "moving")} onClick={() => (isConnected ? go() : openWallet())}>{label}</button>
      <p className="note" style={{ marginTop: 8 }}>Stoa checks Relay&apos;s order before your wallet opens: it pays exactly this address at least {req.amount} USDG on Robinhood Chain, and if Relay cannot deliver, your ETH comes back to you. Up to {PAY_CROSS_MAX_USDG} USDG from another chain for now. Payments cannot be reversed.</p>
    </>
  );
}

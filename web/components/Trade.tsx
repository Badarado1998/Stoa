"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useBalance, usePublicClient, useReadContract, useSwitchChain, useWriteContract } from "wagmi";
import { erc20Abi as viemErc20, isAddress, maxUint256, zeroAddress, type Address, type Hash } from "viem";
import { CONTRACTS, deployed, elysium, txUrl } from "@/lib/chain";
import { TOKENS, NATIVE, WHYPE, isNative, type Token } from "@/lib/tokens";
import { cleanRef, fmt, minOut, parseAmount, rate, routeTokens, swapKind } from "@/lib/swap";
import { erc20Abi, routerAbi, whypeAbi } from "@/lib/abi";
import { useWalletModal } from "./Providers";
import { TokenIcon } from "./ui";
import PoolDepth from "./PoolDepth";

type Quote = { out: bigint; venue: Address; isPool: boolean; at: number } | null;
const SLIPS = [0.1, 0.5, 1];
const DEADLINE_S = 120;

function useReferrer(self?: string) {
  const [ref, setRef] = useState<Address | undefined>();
  useEffect(() => {
    let r: string | null = new URLSearchParams(location.search).get("ref");
    try { if (r) localStorage.setItem("stoa.ref", r); else r = localStorage.getItem("stoa.ref"); } catch { /* storage blocked */ }
    setRef(cleanRef(r, self));
  }, [self]);
  return ref;
}

export default function Trade() {
  const { address, isConnected, chainId } = useAccount();
  const pub = usePublicClient({ chainId: elysium.id });
  const { switchChain } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const { open: openWallet } = useWalletModal();
  const referrer = useReferrer(address);

  const [tokens, setTokens] = useState<Token[]>(TOKENS);
  const [sell, setSell] = useState<Token>(TOKENS[2]);
  const [buy, setBuy] = useState<Token>(TOKENS[0]);
  const [amount, setAmount] = useState("");
  const [slip, setSlip] = useState(0.5);
  const [showSet, setShowSet] = useState(false);
  const [menu, setMenu] = useState<"sell" | "buy" | null>(null);
  const [quote, setQuote] = useState<Quote>(null);
  const [quoting, setQuoting] = useState(false);
  const [noRoute, setNoRoute] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; hash?: Hash } | null>(null);

  const kind = swapKind(sell, buy);
  const amt = parseAmount(amount, sell.decimals);
  const wrongChain = isConnected && chainId !== elysium.id;

  // balances
  const native = useBalance({ address, chainId: elysium.id, query: { enabled: !!address, refetchInterval: 10_000 } });
  const sellBal = useReadContract({ address: sell.address, abi: viemErc20, functionName: "balanceOf", args: [address ?? zeroAddress], chainId: elysium.id, query: { enabled: !!address && !isNative(sell), refetchInterval: 10_000 } });
  const buyBal = useReadContract({ address: buy.address, abi: viemErc20, functionName: "balanceOf", args: [address ?? zeroAddress], chainId: elysium.id, query: { enabled: !!address && !isNative(buy), refetchInterval: 10_000 } });
  const balOf = (t: Token, r: typeof sellBal) => (isNative(t) ? native.data?.value : (r.data as bigint | undefined));
  const sBal = balOf(sell, sellBal), bBal = balOf(buy, buyBal);

  // allowance: ERC-20 sells through the router (or nothing for wrap/unwrap)
  const needsAllowance = deployed && !isNative(sell) && kind !== "unwrap";
  const allowance = useReadContract({ address: sell.address, abi: erc20Abi, functionName: "allowance", args: [address ?? zeroAddress, CONTRACTS.router ?? zeroAddress], chainId: elysium.id, query: { enabled: !!address && needsAllowance } });
  const needApprove = needsAllowance && amt !== undefined && (allowance.data as bigint | undefined ?? 0n) < amt;

  const getQuote = useCallback(async (): Promise<Quote> => {
    if (!amt) return null;
    if (kind === "wrap" || kind === "unwrap") return { out: amt, venue: WHYPE, isPool: false, at: Date.now() };
    if (!deployed || !pub) return null;
    const { tokenIn, tokenOut } = routeTokens(sell, buy);
    const { result } = await pub.simulateContract({ address: CONTRACTS.router!, abi: routerAbi, functionName: "quoteBest", args: [tokenIn, tokenOut, amt] });
    if (result.venue === zeroAddress || result.amountOut === 0n) return null;
    return { out: result.amountOut, venue: result.venue, isPool: result.isPool, at: Date.now() };
  }, [amt, kind, pub, sell, buy]);

  // debounce + refresh every 4s (maker quotes expire after 2 blocks)
  const seq = useRef(0);
  useEffect(() => {
    if (!amt) { setQuote(null); setNoRoute(false); return; }
    const id = ++seq.current;
    let timer: number;
    const run = async () => {
      setQuoting(true);
      try {
        const q = await getQuote();
        if (id !== seq.current) return;
        setQuote(q); setNoRoute(!q && (deployed || kind === "wrap" || kind === "unwrap"));
      } catch {
        if (id === seq.current) { setQuote(null); setNoRoute(true); }
      } finally {
        if (id === seq.current) setQuoting(false);
      }
      timer = window.setTimeout(run, 4000);
    };
    timer = window.setTimeout(run, 350);
    return () => clearTimeout(timer);
  }, [getQuote, amt, kind]);

  const pick = (side: "sell" | "buy", t: Token) => {
    if (side === "sell") { if (t.address === buy.address) setBuy(sell); setSell(t); }
    else { if (t.address === sell.address) setSell(buy); setBuy(t); }
    setMenu(null); setQuote(null); setMsg(null);
  };
  const flip = () => { setSell(buy); setBuy(sell); setQuote(null); };

  async function addCustom(addr: string, side: "sell" | "buy") {
    if (!isAddress(addr) || !pub) return;
    const known = tokens.find((t) => t.address.toLowerCase() === addr.toLowerCase());
    if (known) return pick(side, known);
    try {
      const [symbol, decimals] = await Promise.all([
        pub.readContract({ address: addr, abi: erc20Abi, functionName: "symbol" }),
        pub.readContract({ address: addr, abi: erc20Abi, functionName: "decimals" }),
      ]);
      const t: Token = { symbol: String(symbol).slice(0, 12), name: "Imported", address: addr, decimals: Number(decimals), glyph: String(symbol)[0] ?? "?", tone: "other" };
      setTokens((ts) => [...ts, t]);
      pick(side, t);
    } catch {
      setMsg({ ok: false, text: "That address is not an ERC-20 token on Elysium." });
    }
  }

  async function run(label: string, fn: () => Promise<Hash>) {
    if (!pub) return;
    setBusy(label); setMsg(null);
    try {
      const hash = await fn();
      const r = await pub.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error("Transaction reverted");
      setMsg({ ok: true, text: `${label} confirmed`, hash });
      void native.refetch(); void sellBal.refetch(); void buyBal.refetch(); void allowance.refetch();
      return true;
    } catch (e) {
      const m = (e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message;
      setMsg({ ok: false, text: /User rejected|denied/i.test(m) ? "You rejected the request in your wallet." : m });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function onAction() {
    if (!isConnected) return openWallet();
    if (wrongChain) return switchChain({ chainId: elysium.id });
    if (!amt) return;
    if (needApprove) {
      return run(`Approve ${sell.symbol}`, () => writeContractAsync({ address: sell.address, abi: erc20Abi, functionName: "approve", args: [CONTRACTS.router!, maxUint256], chainId: elysium.id }));
    }
    if (kind === "wrap") return run("Wrap", () => writeContractAsync({ address: WHYPE, abi: whypeAbi, functionName: "deposit", value: amt, chainId: elysium.id }));
    if (kind === "unwrap") return run("Unwrap", () => writeContractAsync({ address: WHYPE, abi: whypeAbi, functionName: "withdraw", args: [amt], chainId: elysium.id }));

    const ok = await run("Swap", async () => {
      const fresh = await getQuote(); // re-quote right before signing
      if (!fresh) throw new Error("No route for this swap right now.");
      setQuote(fresh);
      const min = minOut(fresh.out, slip);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_S);
      const ref = referrer ?? zeroAddress;
      const router = CONTRACTS.router!;
      if (kind === "hypeIn") return writeContractAsync({ address: router, abi: routerAbi, functionName: "swapExactHYPEIn", args: [buy.address, min, address!, deadline, ref], value: amt, chainId: elysium.id });
      if (kind === "hypeOut") return writeContractAsync({ address: router, abi: routerAbi, functionName: "swapExactInForHYPE", args: [sell.address, amt, min, address!, deadline, ref], chainId: elysium.id });
      return writeContractAsync({ address: router, abi: routerAbi, functionName: "swapExactIn", args: [sell.address, buy.address, amt, min, address!, deadline, ref], chainId: elysium.id });
    });
    if (ok) setAmount("");
  }

  // button
  let label = "Swap", disabled = false;
  if (!amt) { label = amount ? "Enter a valid amount" : "Enter an amount"; disabled = true; }
  else if (!isConnected) label = "Connect wallet";
  else if (wrongChain) label = `Switch to ${elysium.name}`;
  else if (!deployed && kind !== "wrap" && kind !== "unwrap") { label = "Opens at launch"; disabled = true; }
  else if (sBal !== undefined && amt > sBal) { label = `Not enough ${sell.symbol}`; disabled = true; }
  else if (quoting && !quote) { label = "Finding the best price…"; disabled = true; }
  else if (noRoute || !quote) { label = "No route for this pair"; disabled = true; }
  else if (needApprove) label = `Approve ${sell.symbol}`;
  else if (kind === "wrap") label = "Wrap HYPE";
  else if (kind === "unwrap") label = "Unwrap WHYPE";
  if (busy) { label = `${busy}…`; disabled = true; }

  const venueName = !quote ? "—" : kind === "wrap" || kind === "unwrap" ? "WHYPE contract" : quote.isPool ? "Stoa maker pool" : "Uniswap on Elysium";
  const px = quote && amt ? rate(amt, sell.decimals, quote.out, buy.decimals) : 0;

  return (
    <div className="grid2">
      <div className="panel pad" style={{ position: "relative" }}>
        {!deployed && <div className="notice">Stoa contracts are not deployed yet. Wrapping HYPE works; swaps open at launch.</div>}
        <div className="rowx" style={{ marginBottom: 12 }}>
          <div className="seg" role="tablist"><button className="on" type="button">Swap</button></div>
          <button className="ghost" type="button" style={{ borderColor: "var(--line)", background: "#fff" }} aria-label="Swap settings" aria-expanded={showSet} onClick={() => setShowSet((s) => !s)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg>{slip}%
          </button>
          <div className={`panel pop${showSet ? " open" : ""}`}>
            <div className="lbl">MAX SLIPPAGE</div>
            <div className="seg" style={{ marginTop: 10 }}>{SLIPS.map((s) => <button key={s} type="button" className={s === slip ? "on" : undefined} onClick={() => setSlip(s)}>{s}%</button>)}</div>
            <p className="note">If the price moves past your slippage before your swap lands, it reverts and you keep your funds.</p>
          </div>
        </div>

        <div className="box">
          <div className="row"><label className="lbl" htmlFor="sellv">SELL</label>
            <button type="button" className="lbl" style={{ border: 0, background: "none", cursor: sBal ? "pointer" : "default" }} onClick={() => sBal && setAmount(fmt(isNative(sell) ? (sBal > 10n ** 16n ? sBal - 10n ** 16n : 0n) : sBal, sell.decimals, sell.decimals).replace(/,/g, ""))}>
              BALANCE {sBal !== undefined ? fmt(sBal, sell.decimals, 4) : "—"}
            </button></div>
          <div className="row" style={{ position: "relative" }}>
            <input id="sellv" type="text" inputMode="decimal" placeholder="0.00" autoComplete="off" value={amount} onChange={(e) => { setMsg(null); setAmount(e.target.value.replace(/,/g, ".").replace(/[^0-9.]/g, "")); }} />
            <TokenBtn t={sell} onClick={() => setMenu(menu === "sell" ? null : "sell")} />
            {menu === "sell" && <TokenMenu tokens={tokens} onPick={(t) => pick("sell", t)} onImport={(a) => addCustom(a, "sell")} />}
          </div>
        </div>
        <div className="flip"><button type="button" aria-label="Switch tokens" onClick={flip}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" /></svg></button></div>
        <div className="box">
          <div className="row"><span className="lbl">BUY</span><span className="lbl">BALANCE {bBal !== undefined ? fmt(bBal, buy.decimals, 4) : "—"}</span></div>
          <div className="row" style={{ position: "relative" }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 28, color: quote ? "var(--ink)" : "#AAB2BE" }}>
              {quote ? fmt(quote.out, buy.decimals, 6) : quoting && amt ? <i className="sk" style={{ width: 120, height: 22 }} /> : "0.00"}
            </span>
            <TokenBtn t={buy} onClick={() => setMenu(menu === "buy" ? null : "buy")} />
            {menu === "buy" && <TokenMenu tokens={tokens} onPick={(t) => pick("buy", t)} onImport={(a) => addCustom(a, "buy")} />}
          </div>
        </div>

        {amt && quote && (
          <div className="det">
            <span>Rate</span><span>1 {sell.symbol} = {px.toPrecision(6)} {buy.symbol}</span>
            <span>Filled by</span><span>{venueName}</span>
            {kind !== "wrap" && kind !== "unwrap" && <><span>Protocol fee</span><span>2 bps</span>
              <span>Minimum received</span><span>{fmt(minOut(quote.out, slip), buy.decimals, 6)} {buy.symbol}</span></>}
            {referrer && <><span>Referred by</span><span>{referrer.slice(0, 6)}…{referrer.slice(-4)}</span></>}
          </div>
        )}
        <button className="big pri" type="button" disabled={disabled} onClick={onAction}>{label}</button>
        {msg && <div className={msg.ok ? "ok" : "err"}>{msg.text}{msg.hash && txUrl(msg.hash) && <> · <a href={txUrl(msg.hash)} target="_blank" rel="noopener noreferrer">View</a></>}</div>}
        <p className="note">Native HYPE works directly. Maker pools cap each fill at $500 while they ramp up.</p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <PoolDepth />
        <div className="panel pad">
          <div className="lbl">EVERY SWAP CHECKS</div>
          <div className="src"><div>Uniswap on Elysium <em>{deployed ? "LIVE" : "AT LAUNCH"}</em></div><div>Stoa maker pools <em>{CONTRACTS.pool ? "IN ROUTER" : "OPENING SOON"}</em></div><div>Nest <em>PLANNED</em></div></div>
          <p className="note">At launch, swaps fill on Uniswap while maker pools come online. When a maker quotes a better price, the router uses it automatically.</p>
        </div>
      </div>
    </div>
  );
}

function TokenBtn({ t, onClick }: { t: Token; onClick: () => void }) {
  return <button className="tok" type="button" aria-haspopup="listbox" onClick={onClick}><TokenIcon t={t} />{t.symbol}</button>;
}

function TokenMenu({ tokens, onPick, onImport }: { tokens: Token[]; onPick: (t: Token) => void; onImport: (a: string) => void }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => tokens.filter((t) => (t.symbol + t.name + t.address).toLowerCase().includes(q.toLowerCase())), [tokens, q]);
  return (
    <div className="panel tokm open" role="listbox">
      <input placeholder="Search or paste address" value={q} onChange={(e) => setQ(e.target.value.trim())} aria-label="Search token" autoFocus />
      {list.map((t) => <button key={t.address} type="button" role="option" aria-selected="false" onClick={() => onPick(t)}><TokenIcon t={t} />{t.symbol}<small>{t.address === NATIVE ? "Native" : t.name}</small></button>)}
      {list.length === 0 && isAddress(q) && <button type="button" onClick={() => onImport(q)}>Import {q.slice(0, 6)}…{q.slice(-4)}</button>}
      {list.length === 0 && !isAddress(q) && <p className="note" style={{ padding: "0 8px" }}>Paste a token address to import it.</p>}
    </div>
  );
}

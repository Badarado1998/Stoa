"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount, useBalance, usePublicClient, useReadContract, useSwitchChain, useWriteContract } from "wagmi";
import { BaseError, ContractFunctionRevertedError, erc20Abi as viemErc20, isAddress, maxUint256, zeroAddress, type Address, type Hash } from "viem";
import { CONTRACTS, VENUE_NAMES, deployed, elysium, txUrl } from "@/lib/chain";
import { TOKENS, POPULAR, NATIVE, WHYPE, USDC, isNative, type Token } from "@/lib/tokens";
import { cleanRef, describeRoute, fmt, hasRoute, minOut, parseAmount, rate, swapKind, swapParams, type Route } from "@/lib/swap";
import { ERROR_TEXT, erc20Abi, routerAbi, v4AdapterAbi, whypeAbi } from "@/lib/abi";
import { findV4Pools, sameKey, type PoolKey } from "@/lib/v4";
import { useWalletModal } from "./Providers";
import { TokenIcon } from "./ui";
import PoolDepth from "./PoolDepth";

type Quote = { out: bigint; route: Route | null; at: number; impact: number } | null;
const IMPACT_WARN = 3; // %
const IMPACT_BLOCK = 15; // % — needs an explicit confirmation
const SLIPS = [0.1, 0.5, 1];
const DEADLINE_S = 120;

/** Readable message for wallet and contract errors. */
function explain(e: unknown): string {
  if (e instanceof BaseError) {
    const rev = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (rev instanceof ContractFunctionRevertedError && rev.data?.errorName && ERROR_TEXT[rev.data.errorName]) return ERROR_TEXT[rev.data.errorName];
    if (/User rejected|denied/i.test(e.shortMessage)) return "You rejected the request in your wallet.";
    if (/insufficient funds/i.test(e.shortMessage)) return "Not enough HYPE to pay for gas.";
    return e.shortMessage;
  }
  return (e as Error)?.message ?? "Something went wrong.";
}

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

  const [tokens, setTokens] = useState<Token[]>([...TOKENS, ...POPULAR]);
  const [sell, setSell] = useState<Token>(TOKENS[2]);
  const [buy, setBuy] = useState<Token>(TOKENS[0]);
  const [amount, setAmount] = useState("");
  const [slip, setSlip] = useState(0.5);
  const [showSet, setShowSet] = useState(false);
  const [menu, setMenu] = useState<"sell" | "buy" | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const [quote, setQuote] = useState<Quote>(null);
  const [quoting, setQuoting] = useState(false);
  const [noRoute, setNoRoute] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; hash?: Hash } | null>(null);
  const [unlimited, setUnlimited] = useState(false); // approve only the swap amount unless the user opts in
  const [ackToken, setAckToken] = useState(false);
  const [ackImpact, setAckImpact] = useState(false);

  const [v4Key, setV4Key] = useState<PoolKey | null>(null); // a V4 pool the router could use once registered

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
  const routerPaused = useReadContract({ address: CONTRACTS.router, abi: routerAbi, functionName: "paused", chainId: elysium.id, query: { enabled: deployed, refetchInterval: 15_000 } });
  const isPaused = routerPaused.data === true;
  const risky = (sell.tone === "other" || buy.tone === "other") && kind !== "wrap" && kind !== "unwrap";

  const getQuote = useCallback(async (): Promise<Quote> => {
    if (!amt) return null;
    if (kind === "wrap" || kind === "unwrap") return { out: amt, route: null, at: Date.now(), impact: 0 };
    if (!deployed || !pub) return null;
    // the router finds the best route (direct or through WHYPE, best venue per leg); the swap then follows it
    const small = amt / 1000n > 0n ? amt / 1000n : 1n; // price impact: compare against 1/1000 of the amount
    const q = (a: bigint) => pub.simulateContract({ address: CONTRACTS.router!, abi: routerAbi, functionName: "quote", args: [sell.address, buy.address, a] });
    const [{ result }, ref] = await Promise.all([q(amt), q(small).catch(() => null)]);
    const route = result as Route;
    if (!hasRoute(route)) return null;
    let impact = 0;
    const r0 = ref?.result.amountOut ?? 0n;
    if (r0 > 0n) impact = Math.max(0, (1 - (Number(route.amountOut) / Number(amt)) / (Number(r0) / Number(small))) * 100);
    return { out: route.amountOut, route, at: Date.now(), impact };
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

  // No route for an imported token: look for its Uniswap V4 pool, which anyone can add to the router once.
  const longTail = [sell, buy].find((t) => t.tone === "other");
  useEffect(() => {
    setV4Key(null);
    if (!noRoute || !longTail || !CONTRACTS.v4 || !pub) return;
    let stop = false;
    (async () => {
      try {
        const keys = await findV4Pools(longTail.address);
        const known = [
          ...((await pub.readContract({ address: CONTRACTS.v4!, abi: v4AdapterAbi, functionName: "keysFor", args: [WHYPE, longTail.address] })) as PoolKey[]),
          ...((await pub.readContract({ address: CONTRACTS.v4!, abi: v4AdapterAbi, functionName: "keysFor", args: [USDC, longTail.address] })) as PoolKey[]),
        ];
        for (const k of keys) {
          if (stop) return;
          if (known.some((x) => sameKey(x, k))) continue;
          const ok = await pub.readContract({ address: CONTRACTS.v4!, abi: v4AdapterAbi, functionName: "hookAllowed", args: [k.hooks] });
          if (ok) { if (!stop) setV4Key(k); return; }
        }
      } catch { /* lookup is best effort */ }
    })();
    return () => { stop = true; };
  }, [noRoute, longTail, pub]);

  const pick = (side: "sell" | "buy", t: Token) => {
    if (side === "sell") { if (t.address === buy.address) setBuy(sell); setSell(t); }
    else { if (t.address === sell.address) setSell(buy); setBuy(t); }
    setMenu(null); setQuote(null); setMsg(null); setAckToken(false); setAckImpact(false);
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
      const sym = String(symbol).replace(/[^\w.$-]/g, "").slice(0, 12) || "TOKEN";
      const t: Token = { symbol: sym, name: "Unverified", address: addr, decimals: Number(decimals), glyph: sym[0] ?? "?", tone: "other" };
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
      setMsg({ ok: false, text: explain(e) });
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
      return run(`Approve ${sell.symbol}`, () => writeContractAsync({ address: sell.address, abi: erc20Abi, functionName: "approve", args: [CONTRACTS.router!, unlimited ? maxUint256 : amt], chainId: elysium.id }));
    }
    if (kind === "wrap") return run("Wrap", () => writeContractAsync({ address: WHYPE, abi: whypeAbi, functionName: "deposit", value: amt, chainId: elysium.id }));
    if (kind === "unwrap") return run("Unwrap", () => writeContractAsync({ address: WHYPE, abi: whypeAbi, functionName: "withdraw", args: [amt], chainId: elysium.id }));

    const ok = await run("Swap", async () => {
      const fresh = await getQuote(); // re-quote right before signing
      if (!fresh?.route) throw new Error("No route for this swap right now.");
      if (fresh.impact >= IMPACT_BLOCK && !ackImpact) throw new Error(`Price impact is now ${fresh.impact.toFixed(1)}%. Confirm the high price impact to continue.`);
      setQuote(fresh);
      const min = minOut(fresh.out, slip);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_S);
      const p = swapParams(sell, buy, fresh.route, amt, min, address!, deadline, referrer ?? zeroAddress);
      return writeContractAsync({ address: CONTRACTS.router!, abi: routerAbi, functionName: "swap", args: [p], value: kind === "hypeIn" ? amt : undefined, chainId: elysium.id });
    });
    if (ok) { setAmount(""); setAckImpact(false); }
  }

  // button
  let label = "Swap", disabled = false;
  if (!amt) { label = amount ? "Enter a valid amount" : "Enter an amount"; disabled = true; }
  else if (!isConnected) label = "Connect wallet";
  else if (wrongChain) label = `Switch to ${elysium.name}`;
  else if (!deployed && kind !== "wrap" && kind !== "unwrap") { label = "Opens at launch"; disabled = true; }
  else if (isPaused && kind !== "wrap" && kind !== "unwrap") { label = "Swaps paused"; disabled = true; }
  else if (sBal !== undefined && amt > sBal) { label = `Not enough ${sell.symbol}`; disabled = true; }
  else if (quoting && !quote) { label = "Finding the best price…"; disabled = true; }
  else if (noRoute || !quote) { label = "No route for this pair"; disabled = true; }
  else if (risky && !ackToken) { label = "Confirm the token warning"; disabled = true; }
  else if (quote.impact >= IMPACT_BLOCK && !ackImpact) { label = "Confirm high price impact"; disabled = true; }
  else if (needApprove) label = unlimited ? `Approve ${sell.symbol}` : `Approve ${fmt(amt, sell.decimals, 4)} ${sell.symbol}`;
  else if (kind === "wrap") label = "Wrap HYPE";
  else if (kind === "unwrap") label = "Unwrap WHYPE";
  if (busy) { label = `${busy}…`; disabled = true; }

  const venueName = !quote ? "—" : !quote.route ? "WHYPE contract" : describeRoute(quote.route, VENUE_NAMES);
  const px = quote && amt ? rate(amt, sell.decimals, quote.out, buy.decimals) : 0;

  return (
    <div className="grid2">
      <div className="panel pad" style={{ position: "relative" }}>
        {!deployed && <div className="notice">Stoa contracts are not deployed yet. Wrapping HYPE works; swaps open at launch.</div>}
        {deployed && isPaused && <div className="notice">Swaps are paused for safety. Your funds are not affected; wrapping HYPE still works.</div>}
        <div className="rowx" style={{ marginBottom: 12 }}>
          <div className="seg" role="tablist"><button className="on" type="button">Swap</button></div>
          <button className="ghost" type="button" style={{ borderColor: "var(--line)", background: "#fff" }} aria-label="Swap settings" aria-expanded={showSet} onClick={() => setShowSet((s) => !s)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg>{slip}%
          </button>
          <div className={`panel pop${showSet ? " open" : ""}`}>
            <div className="lbl">MAX SLIPPAGE</div>
            <div className="seg" style={{ marginTop: 10 }}>{SLIPS.map((s) => <button key={s} type="button" className={s === slip ? "on" : undefined} onClick={() => setSlip(s)}>{s}%</button>)}</div>
            <p className="note">If the price moves past your slippage before your swap lands, it reverts and you keep your funds.</p>
            <div className="lbl" style={{ marginTop: 14 }}>TOKEN APPROVAL</div>
            <label className="chk"><input type="checkbox" checked={unlimited} onChange={(e) => setUnlimited(e.target.checked)} /> Approve unlimited (fewer transactions, more exposure)</label>
            <p className="note">By default Stoa asks to approve only the amount of each swap.</p>
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
            {menu === "sell" && <TokenMenu tokens={tokens} onPick={(t) => pick("sell", t)} onImport={(a) => addCustom(a, "sell")} onClose={closeMenu} />}
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
            {menu === "buy" && <TokenMenu tokens={tokens} onPick={(t) => pick("buy", t)} onImport={(a) => addCustom(a, "buy")} onClose={closeMenu} />}
          </div>
        </div>

        {amt && quote && (
          <div className="det">
            <span>Rate</span><span>1 {sell.symbol} = {px.toPrecision(6)} {buy.symbol}</span>
            <span>Filled by</span><span>{venueName}</span>
            {kind !== "wrap" && kind !== "unwrap" && <><span>Protocol fee</span><span>2 bps</span>
              <span>Price impact</span><span style={{ color: quote.impact >= IMPACT_WARN ? "#B4532A" : undefined }}>{quote.impact < 0.01 ? "< 0.01" : quote.impact.toFixed(2)}%</span>
              <span>Minimum received</span><span>{fmt(minOut(quote.out, slip), buy.decimals, 6)} {buy.symbol}</span></>}
            {referrer && <><span>Referred by</span><span>{referrer.slice(0, 6)}…{referrer.slice(-4)}</span></>}
          </div>
        )}
        {amt && quote && quote.impact >= IMPACT_WARN && (
          <div className={quote.impact >= IMPACT_BLOCK ? "err" : "notice"} style={{ marginTop: 12, marginBottom: 0 }}>
            Price impact is {quote.impact.toFixed(1)}%: this trade moves the price a lot because the pool is thin.
            {quote.impact >= IMPACT_BLOCK && <label className="chk"><input type="checkbox" checked={ackImpact} onChange={(e) => setAckImpact(e.target.checked)} /> I understand and want to swap anyway</label>}
          </div>
        )}
        {v4Key && longTail && (
          <div className="notice" style={{ marginTop: 12, marginBottom: 0 }}>
            {longTail.symbol} trades on a Uniswap V4 pool that Stoa&apos;s router does not use yet. Add it once (a small transaction anyone can send), then swap.
            <button className="ghost" type="button" style={{ marginTop: 10 }} disabled={!!busy || !isConnected || wrongChain}
              onClick={() => run("Add pool", () => writeContractAsync({ address: CONTRACTS.v4!, abi: v4AdapterAbi, functionName: "register", args: [{ ...v4Key, fee: v4Key.fee, tickSpacing: v4Key.tickSpacing }], chainId: elysium.id })).then((ok) => ok && setV4Key(null))}>
              Add Uniswap V4 pool
            </button>
          </div>
        )}
        {risky && (
          <div className="notice" style={{ marginTop: 12, marginBottom: 0 }}>
            This token was imported by address and is not verified by Stoa. Anyone can create a token with any name. Check the address before you trade.
            <label className="chk"><input type="checkbox" checked={ackToken} onChange={(e) => setAckToken(e.target.checked)} /> I checked the token address</label>
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
          <div className="src">
            <div>Stoa maker pools <em>{CONTRACTS.pool ? "IN ROUTER" : "OPENING SOON"}</em></div>
            <div>Uniswap V2 · V3 · V4 <em>{deployed ? "LIVE" : "AT LAUNCH"}</em></div>
            <div>Aero · Ramses <em>{deployed ? "LIVE" : "AT LAUNCH"}</em></div>
            <div>Liquidity Book <em>{deployed ? "LIVE" : "AT LAUNCH"}</em></div>
          </div>
          <p className="note">Every swap compares these venues, directly and through WHYPE, and takes the best price. When a maker quotes better, the router uses it automatically.</p>
        </div>
      </div>
    </div>
  );
}

function TokenBtn({ t, onClick }: { t: Token; onClick: () => void }) {
  return <button className="tok" type="button" aria-haspopup="listbox" onClick={onClick}><TokenIcon t={t} />{t.symbol}</button>;
}

function TokenMenu({ tokens, onPick, onImport, onClose }: { tokens: Token[]; onPick: (t: Token) => void; onImport: (a: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [sheet, setSheet] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const list = useMemo(() => tokens.filter((t) => (t.symbol + t.name + t.address).toLowerCase().includes(q.toLowerCase())), [tokens, q]);
  useEffect(() => {
    setSheet(matchMedia("(max-width:560px)").matches);
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const down = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (ref.current && !ref.current.contains(el) && !el.closest(".tok")) onClose();
    };
    addEventListener("keydown", key); addEventListener("mousedown", down);
    return () => { removeEventListener("keydown", key); removeEventListener("mousedown", down); };
  }, [onClose]);
  const body = (
    <div ref={ref} className={`panel tokm open${sheet ? " sheet" : ""}`} role="listbox" aria-label="Select a token">
      {sheet && <div className="rowx tokh"><b>Select a token</b><button className="x" type="button" onClick={onClose} aria-label="Close">×</button></div>}
      <input placeholder="Search or paste address" value={q} onChange={(e) => setQ(e.target.value.trim())} aria-label="Search token" autoFocus={!sheet} />
      <div className="tokl">
        {list.map((t) => <button key={t.address} type="button" role="option" aria-selected="false" onClick={() => onPick(t)}><TokenIcon t={t} /><span className="tokn"><b>{t.symbol}</b><small>{t.address === NATIVE ? "Native" : t.name}</small></span></button>)}
        {list.length === 0 && isAddress(q) && <button type="button" onClick={() => onImport(q)}>Import {q.slice(0, 6)}…{q.slice(-4)}</button>}
        {list.length === 0 && !isAddress(q) && <p className="note" style={{ padding: "0 8px" }}>Paste a token address to import it.</p>}
      </div>
    </div>
  );
  return sheet ? createPortal(<div className="tokbg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>{body}</div>, document.body) : body;
}

"use client";
import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain, useBalance } from "wagmi";
import { elysium, txUrl } from "@/lib/chain";
import { fmt } from "@/lib/swap";

export const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

export default function WalletModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { address, chainId, isConnected, connector } = useAccount();
  const { connectors, connect, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const { data: bal } = useBalance({ address, chainId: elysium.id, query: { enabled: !!address } });
  const [copied, setCopied] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [open, onClose]);

  useEffect(() => { if (isConnected && open && chainId === elysium.id && !error) { /* stay open to show account */ } }, [isConnected, open, chainId, error]);

  if (!open) return null;
  // EIP-6963 wallets announce themselves; hide the generic "Injected" entry when a named one exists
  const list = connectors.filter((c, i, a) => !(c.id === "injected" && a.some((x) => x.type === "injected" && x.id !== "injected")));
  const wrongChain = isConnected && chainId !== elysium.id;

  return (
    <div className="modal open" role="dialog" aria-modal="true" aria-labelledby="wmt" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel">
        <div className="rowx">
          <h2 id="wmt" style={{ margin: 0, fontFamily: "var(--serif)", fontWeight: 400, fontSize: 24, color: "var(--ink)" }}>
            {isConnected ? "Your wallet" : "Connect a wallet"}
          </h2>
          <button ref={closeRef} className="x" type="button" onClick={onClose} aria-label="Close">×</button>
        </div>

        {isConnected ? (
          <div className="acct">
            <div className="box">
              <div className="row"><span className="lbl">ACCOUNT</span><span className="lbl">{connector?.name}</span></div>
              <div className="row"><span className="addrchip">{short(address)}</span>
                <button className="cp" type="button" onClick={async () => { try { await navigator.clipboard.writeText(address!); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} }}>{copied ? "Copied" : "Copy"}</button></div>
              <div className="row"><span className="lbl">BALANCE</span><span className="addrchip">{bal ? `${fmt(bal.value, 18, 4)} HYPE` : "—"}</span></div>
            </div>
            {wrongChain && <button className="big pri" type="button" onClick={() => switchChain({ chainId: elysium.id })}>Switch to {elysium.name}</button>}
            <button className="ghost" style={{ borderColor: "var(--line)", background: "#fff", justifyContent: "center" }} type="button" onClick={() => { disconnect(); onClose(); }}>Disconnect</button>
          </div>
        ) : (
          <>
            <div className="wl">
              {list.map((c) => (
                <button key={c.uid} type="button" disabled={isPending} onClick={() => connect({ connector: c, chainId: elysium.id })}>
                  {c.icon ? <img src={c.icon} alt="" /> : <i>{c.name[0]}</i>}
                  {c.id === "injected" ? "Browser wallet" : c.name}
                  {c.type === "walletConnect" && <small>QR / mobile</small>}
                </button>
              ))}
            </div>
            {list.length === 0 && <p className="note">No wallet found. Install MetaMask, Rabby or OKX Wallet.</p>}
            {error && <div className="err">{error.message.split("\n")[0]}</div>}
            <p className="note">Stoa runs on {elysium.name} (chain {elysium.id}).</p>
          </>
        )}
      </div>
    </div>
  );
}
export { txUrl };

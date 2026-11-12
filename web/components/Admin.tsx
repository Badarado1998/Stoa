"use client";
import { useState } from "react";
import { useAccount, usePublicClient, useReadContracts, useWriteContract } from "wagmi";
import { BaseError, isAddress, zeroAddress, type Address, type Hash } from "viem";
import { CONTRACTS, VENUE_NAMES, addressUrl, elysium, txUrl } from "@/lib/chain";
import { adminAbi } from "@/lib/abi";
import { USDC, WHYPE } from "@/lib/tokens";
import { fmt } from "@/lib/swap";
import { useWalletModal } from "./Providers";

const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");
const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** Owner and guardian console. The contracts enforce every permission; this page only sends the calls. */
export default function Admin() {
  const { address, isConnected } = useAccount();
  const { open } = useWalletModal();
  const pub = usePublicClient({ chainId: elysium.id });
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; hash?: Hash } | null>(null);
  const [venue, setVenue] = useState("");
  const [venueIsPool, setVenueIsPool] = useState(false);
  const [maker, setMaker] = useState("");
  const [to, setTo] = useState("");

  const R = CONTRACTS.router, F = CONTRACTS.fees, G = CONTRACTS.registry, P = CONTRACTS.pool, V = CONTRACTS.v4;
  const owned = [
    ["StoaRouter", R], ["MakerRegistry", G], ["FeeDistributor", F], ["StoaPool (WHYPE/USDC)", P], ["UniswapV4Adapter", V],
  ].filter(([, a]) => a) as [string, Address][];

  const reads = useReadContracts({
    contracts: [
      ...owned.flatMap(([, a]) => [
        { address: a, abi: adminAbi, functionName: "owner" as const, chainId: elysium.id },
        { address: a, abi: adminAbi, functionName: "pendingOwner" as const, chainId: elysium.id },
      ]),
      { address: R!, abi: adminAbi, functionName: "guardian" as const, chainId: elysium.id },
      { address: R!, abi: adminAbi, functionName: "paused" as const, chainId: elysium.id },
      { address: R!, abi: adminAbi, functionName: "setupLocked" as const, chainId: elysium.id },
      { address: R!, abi: adminAbi, functionName: "delay" as const, chainId: elysium.id },
      { address: F!, abi: adminAbi, functionName: "protocolAccrued" as const, args: [WHYPE], chainId: elysium.id },
      { address: F!, abi: adminAbi, functionName: "protocolAccrued" as const, args: [USDC], chainId: elysium.id },
      { address: P!, abi: adminAbi, functionName: "paused" as const, chainId: elysium.id },
    ],
    query: { enabled: !!R && !!F && !!P, refetchInterval: 15_000 },
  });
  const r = (i: number) => reads.data?.[i]?.result;
  const n = owned.length * 2;
  const guardian = r(n) as Address | undefined, paused = r(n + 1) as boolean | undefined;
  const locked = r(n + 2) as boolean | undefined, delay = r(n + 3) as bigint | undefined;
  const accW = (r(n + 4) as bigint | undefined) ?? 0n, accU = (r(n + 5) as bigint | undefined) ?? 0n;
  const poolPaused = r(n + 6) as boolean | undefined;
  const routerOwner = r(0) as Address | undefined;
  const isOwner = same(address, routerOwner), isGuardian = same(address, guardian);

  async function send(label: string, fn: () => Promise<Hash>) {
    if (!pub) return;
    setBusy(label); setMsg(null);
    try {
      const hash = await fn();
      const rc = await pub.waitForTransactionReceipt({ hash });
      if (rc.status !== "success") throw new Error("Transaction reverted");
      setMsg({ ok: true, text: `${label}: confirmed`, hash });
      void reads.refetch();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof BaseError ? e.shortMessage : (e as Error).message });
    } finally {
      setBusy(null);
    }
  }
  const call = (label: string, address: Address, functionName: string, args: readonly unknown[] = []) =>
    send(label, () => writeContractAsync({ address, abi: adminAbi, functionName: functionName as never, args: args as never, chainId: elysium.id }));

  if (!R) return <div className="panel pad"><p className="note">Contracts are not deployed yet. This page manages them after the deploy.</p></div>;
  if (!isConnected) return <div className="panel pad"><p className="note">Connect the owner or guardian wallet.</p><button className="cta" type="button" onClick={open}>Connect wallet</button></div>;

  const b = (label: string, on: () => void, disabled = false) => (
    <button key={label} className="ghost" type="button" disabled={!!busy || disabled} onClick={on} style={{ marginRight: 8, marginTop: 8 }}>{busy === label ? `${label}…` : label}</button>
  );
  const recipient = (isAddress(to) ? to : address) as Address;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {msg && <div className={msg.ok ? "ok" : "err"}>{msg.text}{msg.hash && txUrl(msg.hash) && <> · <a href={txUrl(msg.hash)} target="_blank" rel="noopener noreferrer">View</a></>}</div>}

      <div className="panel pad">
        <div className="lbl">YOU ARE</div>
        <p style={{ marginTop: 8 }}><code>{address}</code> · {isOwner ? "router owner" : isGuardian ? "guardian" : "not owner or guardian (calls will revert)"}</p>
      </div>

      <div className="panel" style={{ overflowX: "auto" }}>
        <table className="tbl">
          <thead><tr><th>CONTRACT</th><th>OWNER</th><th>PENDING OWNER</th><th /></tr></thead>
          <tbody>
            {owned.map(([name, a], i) => {
              const o = r(2 * i) as Address | undefined, p = r(2 * i + 1) as Address | undefined;
              return (
                <tr key={name}>
                  <td><a href={addressUrl(a)} target="_blank" rel="noopener noreferrer">{name}</a></td>
                  <td><code>{short(o)}</code></td>
                  <td><code>{p && p !== zeroAddress ? short(p) : "—"}</code></td>
                  <td style={{ textAlign: "right" }}>{same(p, address) && b(`Accept ${name}`, () => call(`Accept ${name}`, a, "acceptOwnership"))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid2 eq">
        <div className="panel pad">
          <div className="lbl">EMERGENCY</div>
          <p className="note">Router swaps: <b>{paused === undefined ? "—" : paused ? "PAUSED" : "running"}</b> · Maker pool: <b>{poolPaused === undefined ? "—" : poolPaused ? "PAUSED" : "running"}</b> · Guardian <code>{short(guardian)}</code></p>
          {b("Pause router", () => call("Pause router", R, "pause"), paused === true)}
          {b("Unpause router", () => call("Unpause router", R, "unpause"), paused === false)}
          {P && b(poolPaused ? "Unpause pool" : "Pause pool", () => call(poolPaused ? "Unpause pool" : "Pause pool", P, "setPaused", [!poolPaused]))}
          {P && b("Pull maker quote", () => call("Pull maker quote", P, "cancelQuote"))}
          <p className="note">Owner or guardian can pause; only the owner unpauses the router.</p>
        </div>

        <div className="panel pad">
          <div className="lbl">PROTOCOL FEES</div>
          <ul className="list"><li>WHYPE <b>{fmt(accW, 18, 6)}</b></li><li>USDC <b>{fmt(accU, 6, 2)}</b></li></ul>
          <input className="inp" placeholder={`Send to (default ${short(address)})`} value={to} onChange={(e) => setTo(e.target.value.trim())} />
          {b("Withdraw WHYPE", () => call("Withdraw WHYPE", F!, "withdrawProtocol", [WHYPE, accW, recipient]), accW === 0n)}
          {b("Withdraw USDC", () => call("Withdraw USDC", F!, "withdrawProtocol", [USDC, accU, recipient]), accU === 0n)}
        </div>

        <div className="panel pad">
          <div className="lbl">MAKERS (WHYPE/USDC POOL)</div>
          <input className="inp" placeholder="Maker address 0x…" value={maker} onChange={(e) => setMaker(e.target.value.trim())} />
          {b("Approve maker", () => call("Approve maker", G!, "setMakerApproval", [P, maker, true]), !isAddress(maker) || !G || !P)}
          {b("Revoke maker", () => call("Revoke maker", G!, "setMakerApproval", [P, maker, false]), !isAddress(maker) || !G || !P)}
          <p className="note">A maker also needs a HYPE bond of at least the pool minimum before it can quote.</p>
        </div>

        <div className="panel pad">
          <div className="lbl">VENUES</div>
          <ul className="list">{Object.entries(VENUE_NAMES).map(([a, nme]) => <li key={a}>{nme} <code>{short(a)}</code></li>)}</ul>
          <input className="inp" placeholder="Venue address 0x…" value={venue} onChange={(e) => setVenue(e.target.value.trim())} />
          <label className="chk"><input type="checkbox" checked={venueIsPool} onChange={(e) => setVenueIsPool(e.target.checked)} /> It is a Stoa pool (not an adapter)</label>
          {b("Propose", () => call("Propose", R, "propose", [venueIsPool, venue]), !isAddress(venue))}
          {b("Execute", () => call("Execute", R, "execute", [venueIsPool, venue]), !isAddress(venue))}
          {b("Cancel", () => call("Cancel", R, "cancel", [venueIsPool, venue]), !isAddress(venue))}
          {b("Remove now", () => call("Remove now", R, venueIsPool ? "removePool" : "removeAdapter", [venue]), !isAddress(venue))}
          <p className="note">{locked ? `New venues wait ${delay ? Number(delay) / 3600 : "—"} h after Propose before Execute works.` : "Setup is not locked yet."} Removing is instant.</p>
        </div>
      </div>
      <p className="note">Amounts above are read on-chain every 15 s. Fees withdraw in full; partial withdrawals can be sent from the contract directly.</p>
    </div>
  );
}

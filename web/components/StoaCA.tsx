"use client";
import { useState } from "react";
import { ROBINHOOD, addressUrlOn } from "@/lib/networks";
import { CA } from "@/lib/stoaAddress";

/** "$STOA · CA" line. The address is pinned since the launch (lib/stoaAddress.ts), so this needs no wallet or query code
 *  and can sit in the footer of every page. */
export default function StoaCA({ short = false }: { short?: boolean }) {
  const t = { symbol: "STOA", address: CA };
  const [copied, setCopied] = useState(false);
  if (!t) return null;
  return (
    <p className="note stoaca">
      <b>${t.symbol}</b>{" "}
      <a href={addressUrlOn(ROBINHOOD, t.address)} target="_blank" rel="noopener noreferrer"><span className="addrchip">{short ? `${t.address.slice(0, 8)}…${t.address.slice(-6)}` : t.address}</span></a>{" "}
      <button type="button" className="cp" onClick={() => { navigator.clipboard?.writeText(t.address); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied" : "Copy"}</button>
    </p>
  );
}

"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

// The header's network switch and wallet button need the wallet code (wagmi, about 75 KB). Pages that do not use a
// wallet no longer ship it in their first load: the button loads once the page is idle, or at once when tapped.
const Island = dynamic(() => import("./HeaderWalletIsland"), { ssr: false, loading: () => <Placeholder /> });

function Placeholder({ onTap }: { onTap?: () => void }) {
  return <button type="button" className="cta" onClick={onTap}>Connect</button>;
}

export default function HeaderWallet() {
  const [load, setLoad] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(() => setLoad(true), { timeout: 2500 });
    else { const t = setTimeout(() => setLoad(true), 1200); return () => clearTimeout(t); }
  }, []);
  if (!load) return <Placeholder onTap={() => { setOpen(true); setLoad(true); }} />;
  return <Island openOnMount={open} />;
}

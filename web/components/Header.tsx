"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import WalletButton from "./WalletButton";
import NetSwitch from "./NetSwitch";

const TABS = [["/trade", "Trade"], ["/pools", "Pools"], ["/launches", "Launches"], ["/earn", "Earn"], ["/curators", "Curators"], ["/token", "$STOA"], ["/build", "Build"]] as const;
const MENU = [["/", "Walk the Stoa", ""], ["/trade", "Trade", "I"], ["/pools", "Pools", ""], ["/launches", "Launches", ""], ["/earn", "Earn", "II"], ["/curators", "Curators", "III"], ["/build", "Build", "IV"], ["/token", "$STOA", ""], ["/referrals", "Referrals", ""], ["/portfolio", "Portfolio", ""], ["/docs", "Docs", ""]] as const;

export default function Header({ extra }: { extra?: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const [solid, setSolid] = useState(false);
  useEffect(() => {
    const f = () => setSolid(scrollY > 8);
    f(); addEventListener("scroll", f, { passive: true });
    return () => removeEventListener("scroll", f);
  }, [path]);
  // a section is active on its own path and below it (/launches/<token>), not on look-alikes (/tokens is not /token)
  const on = (h: string) => (h === "/" ? path === "/" : path === h || path.startsWith(`${h}/`));
  return (
    <>
      <header className={`hdr${solid && path !== "/" ? " solid" : ""}`}>
        <Link className="brand" href="/"><img src="/logo.png" alt="" /><span>STOA</span></Link>
        <nav className="tabs" aria-label="Main">
          {TABS.map(([h, l]) => <Link key={h} href={h} className={on(h) ? "on" : undefined}>{l}</Link>)}
        </nav>
        <div className="right">
          <Link className="ghost hide-m" href="/docs">Docs</Link>
          <a className="ghost hide-m" href="https://x.com/StoaDEX" target="_blank" rel="noopener noreferrer" aria-label="Stoa on X">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.2 2.3h3.4l-7.4 8.4 8.7 11.5h-6.8l-5.3-6.9-6.1 6.9H1.3l7.9-9L.9 2.3h7l4.8 6.3 5.5-6.3zm-1.2 17.9h1.9L7.1 4.2H5.1l11.9 16z" /></svg>
          </a>
          {extra}
          <NetSwitch />
          <WalletButton />
          <button className="ghost menu-btn" type="button" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
        </div>
      </header>
      <nav className={`menu${open ? " open" : ""}`} aria-label="Menu">
        {MENU.map(([h, l, n]) => <Link key={h} href={h} className={on(h) ? "on" : undefined}>{l} {n && <small>{n}</small>}</Link>)}
        <a href="https://x.com/StoaDEX" target="_blank" rel="noopener noreferrer">X · @StoaDEX</a>
      </nav>
    </>
  );
}

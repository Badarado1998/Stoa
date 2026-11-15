import Link from "next/link";
import StoaCA from "./StoaCA";

export default function Footer() {
  return (
    <footer className="foot">
      <div>
        <Link className="brand" href="/"><img src="/logo.png" alt="" /><span>STOA</span></Link>
        <p className="note" style={{ maxWidth: 260 }}>The best-price swap router on Elysium and Robinhood Chain. Every venue, checked on every swap.</p>
        <StoaCA />
        {/* HEY Research Lab badge (HEY looks for it on our site; one-line pill variant of their snippet) */}
        <a href="https://heyresearch.xyz/project/stoadex-stoa?utm_source=badge&utm_medium=html" target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", marginTop: 14 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="https://heyresearch.xyz/api/badge/stoadex-stoa?style=pill" alt="Stoa on HEY Research Lab" width={439} height={36} loading="lazy" style={{ maxWidth: "100%", height: "auto" }} />
        </a>
      </div>
      <div className="cols">
        <div><h4>PRODUCT</h4><Link href="/trade">Trade</Link><Link href="/pools">Pools</Link><Link href="/earn">Earn</Link><Link href="/token">$STOA</Link><Link href="/spotlight">Spotlight</Link><Link href="/tokens">Tokens</Link><Link href="/portfolio">Portfolio</Link><Link href="/wrapped">Wrapped</Link></div>
        <div><h4>BUILDERS</h4><Link href="/curators">Curators</Link><Link href="/build">Build</Link><Link href="/referrals">Referrals</Link><Link href="/docs">Docs</Link><Link href="/stats">Stats</Link><Link href="/changelog">Changelog</Link></div>
        <div><h4>COMMUNITY</h4><a href="https://x.com/StoaDEX" target="_blank" rel="noopener noreferrer">X · @StoaDEX</a><a href="https://github.com/StoaDex/Stoa" target="_blank" rel="noopener noreferrer">GitHub · source code</a><Link href="/">Walk the Stoa</Link><Link href="/docs/admin">Admin &amp; security</Link><Link href="/docs/terms-privacy">Terms &amp; privacy</Link></div>
      </div>
    </footer>
  );
}

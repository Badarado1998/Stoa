import Link from "next/link";
import StoaCA from "./StoaCA";
import AppInstall from "./AppInstall";

export default function Footer() {
  return (
    <footer className="foot">
      <div>
        <Link className="brand" href="/"><img src="/logo.png" alt="" /><span>STOA</span></Link>
        <p className="note" style={{ maxWidth: 260 }}>A swap router on Robinhood Chain and Elysium. Every venue it uses, compared on every swap.</p>
        <StoaCA />
      </div>
      <div className="cols">
        <div><p className="fh">TRADE</p><Link href="/trade">Trade</Link><Link href="/bridge">Bridge in</Link><Link href="/stocks">Stocks</Link><Link href="/tokens">Tokens</Link><Link href="/launches">Launches</Link><Link href="/pools">Pools</Link><Link href="/cover">Rug Cover</Link></div>
        <div><p className="fh">$STOA &amp; YOU</p><Link href="/token">$STOA</Link><Link href="/spotlight">Spotlight</Link><Link href="/spotlight/projects">Spotlight for projects</Link><Link href="/earn">Earn</Link><Link href="/portfolio">Portfolio</Link><Link href="/wrapped">Wrapped</Link><Link href="/referrals">Referrals</Link></div>
        <div><p className="fh">LEARN</p><Link href="/docs">Docs</Link><Link href="/guides">Community guides</Link><Link href="/stats">Stats</Link><Link href="/weekly">This week</Link><Link href="/changelog">Changelog</Link><Link href="/">Walk the Stoa</Link><Link href="/build">Integrate</Link><Link href="/curators">Curators</Link></div>
        <div><p className="fh">TRUST &amp; COMMUNITY</p><Link href="/security">Security status</Link><Link href="/status">System status</Link><Link href="/check">Token safety check</Link><Link href="/docs/admin">Admin &amp; security</Link><Link href="/docs/bug-bounty">Security reports</Link><Link href="/docs/terms-privacy">Terms &amp; privacy</Link><a href="https://x.com/StoaDEX" target="_blank" rel="noopener noreferrer">X · @StoaDEX</a><a href="https://t.me/StoaDex" target="_blank" rel="noopener noreferrer">Telegram · announcements</a><a href="https://t.me/StoaDexChat" target="_blank" rel="noopener noreferrer">Telegram · community chat</a><a href="https://github.com/StoaDex/Stoa" target="_blank" rel="noopener noreferrer">GitHub · source code</a><a href="https://www.coingecko.com/en/coins/stoa" target="_blank" rel="noopener noreferrer">CoinGecko · $STOA</a><AppInstall /></div>
      </div>
      <div className="badge">
        {/* HEY Research Lab badge (HEY looks for it on our site; one-line pill variant of their snippet) */}
        <a href="https://heyresearch.xyz/project/stoadex-stoa?utm_source=badge&utm_medium=html" target="_blank" rel="noopener noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="https://heyresearch.xyz/api/badge/stoadex-stoa?style=pill" alt="Stoa on HEY Research Lab" width={439} height={36} decoding="async" fetchPriority="high" />
        </a>
      </div>
    </footer>
  );
}

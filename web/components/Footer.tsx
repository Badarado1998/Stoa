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
        <div><p className="fh">TRADE</p><Link prefetch={false} href="/trade">Trade</Link><Link prefetch={false} href="/bridge">Bridge in</Link><Link prefetch={false} href="/stocks">Stocks</Link><Link prefetch={false} href="/tokens">Tokens</Link><Link prefetch={false} href="/launches">Launches</Link><Link prefetch={false} href="/pools">Pools</Link><Link prefetch={false} href="/cover">Rug Cover</Link></div>
        <div><p className="fh">$STOA &amp; YOU</p><Link prefetch={false} href="/token">$STOA</Link><Link prefetch={false} href="/spotlight">Spotlight</Link><Link prefetch={false} href="/spotlight/projects">Spotlight for projects</Link><Link prefetch={false} href="/earn">Earn</Link><Link prefetch={false} href="/points">Points</Link><Link prefetch={false} href="/portfolio">Portfolio</Link><Link prefetch={false} href="/wrapped">Wrapped</Link><Link prefetch={false} href="/referrals">Referrals</Link></div>
        <div><p className="fh">LEARN</p><Link prefetch={false} href="/docs">Docs</Link><Link prefetch={false} href="/guides">Community guides</Link><Link prefetch={false} href="/stats">Stats</Link><Link prefetch={false} href="/weekly">This week</Link><Link prefetch={false} href="/changelog">Changelog</Link><Link prefetch={false} href="/">Walk the Stoa</Link><Link prefetch={false} href="/build">Integrate</Link><Link prefetch={false} href="/curators">Curators</Link></div>
        <div><p className="fh">TRUST &amp; COMMUNITY</p><Link prefetch={false} href="/security">Security status</Link><Link prefetch={false} href="/status">System status</Link><Link prefetch={false} href="/open">Open source &amp; data</Link><Link prefetch={false} href="/check">Token safety check</Link><Link prefetch={false} href="/docs/admin">Admin &amp; security</Link><Link prefetch={false} href="/docs/bug-bounty">Security reports</Link><Link prefetch={false} href="/docs/terms-privacy">Terms &amp; privacy</Link><a href="https://x.com/StoaDEX" target="_blank" rel="noopener noreferrer">X · @StoaDEX</a><a href="https://t.me/StoaDex" target="_blank" rel="noopener noreferrer">Telegram · announcements</a><a href="https://t.me/StoaDexChat" target="_blank" rel="noopener noreferrer">Telegram · community chat</a><a href="https://github.com/StoaDex/Stoa" target="_blank" rel="noopener noreferrer">GitHub · source code</a><a href="https://huggingface.co/datasets/StoaDex/stoa-onchain" target="_blank" rel="noopener noreferrer">Hugging Face · open data</a><a href="https://www.coingecko.com/en/coins/stoa" target="_blank" rel="noopener noreferrer">CoinGecko · $STOA</a><AppInstall /></div>
      </div>
      <div className="badge">
        {/* HEY Research Lab badge (HEY looks for it on our site; one-line pill variant of their snippet) */}
        <a href="https://heyresearch.xyz/project/stoa?utm_source=badge&utm_medium=html" target="_blank" rel="noopener noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="https://heyresearch.xyz/api/badge/stoa?style=pill" alt="Stoa on HEY Research Lab" width={439} height={36} decoding="async" />
        </a>
      </div>
    </footer>
  );
}

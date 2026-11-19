/** Every page in four groups: the header menu, the More page and the footer read the same list. */
export const NAV_GROUPS: { h: string; items: [string, string][] }[] = [
  { h: "Trade", items: [["/trade", "Trade"], ["/bridge", "Bridge in"], ["/stocks", "Stocks"], ["/tokens", "Tokens"], ["/launches", "Launches"], ["/pools", "Pools"], ["/cover", "Rug Cover"], ["/check", "Token check"]] },
  { h: "$STOA & you", items: [["/token", "$STOA"], ["/spotlight", "Spotlight"], ["/spotlight/projects", "Spotlight for projects"], ["/earn", "Earn"], ["/portfolio", "Portfolio"], ["/wrapped", "Wrapped"], ["/referrals", "Referrals"]] },
  { h: "Learn", items: [["/docs", "Docs"], ["/guides", "Community guides"], ["/stats", "Stats"], ["/weekly", "This week"], ["/changelog", "Changelog"], ["/", "Walk the Stoa"], ["/build", "Integrate"], ["/curators", "Curators"]] },
  { h: "Trust", items: [["/security", "Security status"], ["/docs/admin", "Admin & security"], ["/docs/bug-bounty", "Security reports"], ["/docs/terms-privacy", "Terms & privacy"]] },
];

export const SOCIALS: [string, string][] = [
  ["https://x.com/StoaDEX", "X · @StoaDEX"],
  ["https://t.me/StoaDex", "Telegram · announcements"],
  ["https://t.me/StoaDexChat", "Telegram · community chat"],
  ["https://github.com/StoaDex/Stoa", "GitHub · source code"],
  ["https://www.coingecko.com/en/coins/stoa", "CoinGecko · $STOA"],
];

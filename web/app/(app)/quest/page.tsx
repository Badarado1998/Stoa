import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/ui";
import QuestCheck from "@/components/QuestCheck";
import { QUEST, questDate } from "@/lib/quest";

export const metadata: Metadata = {
  title: "Stoa Explorer quest",
  description: `Swap on Stoa on Robinhood Chain, follow and share, and enter the draw for ${QUEST.pool}. ${QUEST.winners} winners.`,
  alternates: { canonical: "/quest" },
};

export default function QuestPage() {
  const steps: [string, string, React.ReactNode][] = [
    ["1", "Follow @StoaDex on X", <>Checked by Galxe.</>],
    ["2", "Quote the quest post on X", <>Add a line of your own. Checked by Galxe.</>],
    ["3", `Swap $${QUEST.minUsd} or more on Stoa`, <>Any pair on Robinhood Chain, through <Link href="/trade">stoadex.com/trade</Link>. Checked on-chain.</>],
    ["+1", "Bonus: share a real result", <>Post a <Link href="/check">safety check</Link> result or your <Link href="/wrapped">Wrapped</Link> card on X and mention @StoaDex. One more ticket.</>],
    ["+1", "Bonus: lock any $STOA", <>In <Link href="/spotlight#lock">Spotlight</Link>, where it votes and earns the ETH projects bid. One more ticket. Checked on-chain.</>],
  ];
  return (
    <section className="page" style={{ maxWidth: 760 }}>
      <PageHead eyebrow="QUEST · ROBINHOOD CHAIN" title={QUEST.name}>
        Three tasks and two bonuses. {QUEST.winners} winners share {QUEST.pool}, drawn on Galxe.
      </PageHead>
      <div className="panel pad">
        <div className="rowx"><div className="lbl">THE TASKS</div><span className="chip">{questDate(QUEST.start)} – {questDate(QUEST.end)}</span></div>
        <ol className="qsteps">
          {steps.map(([n, t, d]) => <li key={t}><span className="qn">{n}</span><span><b>{t}</b><small>{d}</small></span></li>)}
        </ol>
        {QUEST.galxe
          ? <a className="big pri" href={QUEST.galxe} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>Open the quest on Galxe ↗</a>
          : <p className="note">The Galxe page opens with the quest on {questDate(QUEST.start)}.</p>}
      </div>
      <div style={{ marginTop: 16 }}><QuestCheck /></div>
      <details className="panel pad fold-panel" style={{ marginTop: 16 }}>
        <summary className="lbl">RULES</summary>
        <ul className="qrules">
          <li>{QUEST.winners} winners × $5 in $STOA ({QUEST.pool}), drawn with Galxe&apos;s raffle after the quest closes. Tasks 1 to 3 give one ticket; each bonus adds one.</li>
          <li>Only swaps through Stoa&apos;s router on Robinhood Chain between {questDate(QUEST.start)} and {questDate(QUEST.end)}, worth ${QUEST.minUsd} or more, count. Any pair.</li>
          <li>One entry per person. Wash trading, bot wallets and copies of one person are removed before the draw.</li>
          <li>Prizes are sent in $STOA on Robinhood Chain to the winning wallet within 7 days of the close. Stoa will never DM you or ask for a key or a payment.</li>
          <li>Swaps carry the usual risks; nothing here is investment advice.</li>
        </ul>
      </details>
    </section>
  );
}

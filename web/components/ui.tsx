import type { ReactNode } from "react";
import type { Token } from "@/lib/tokens";

export function PageHead({ eyebrow, title, children, action }: { eyebrow: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="ph">
      <div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{children && <p>{children}</p>}</div>
      {action}
    </div>
  );
}

export function TokenIcon({ t }: { t: Pick<Token, "glyph" | "tone"> }) {
  const cls = t.tone === "native" ? "n" : t.tone === "hype" ? "h" : t.tone === "usd" ? "u" : "";
  return <span className={`ti ${cls}`} style={t.tone === "other" ? { background: "linear-gradient(135deg,#6B7482,#A9B2C0)" } : undefined}>{t.glyph}</span>;
}

export function Pair() {
  return <div className="pair"><span className="ti h">H</span><span className="ti u">$</span>WHYPE / USDC</div>;
}

export const Sk = ({ w = 80 }: { w?: number }) => <i className="sk" style={{ width: w }} />;

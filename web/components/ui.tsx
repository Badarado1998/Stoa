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

export function TokenIcon({ t }: { t: Pick<Token, "glyph" | "tone" | "logo"> }) {
  const cls = t.tone === "native" ? "n" : t.tone === "hype" ? "h" : t.tone === "usd" ? "u" : "";
  // eslint-disable-next-line @next/next/no-img-element
  if (t.logo) return <img className="ti img" src={t.logo} alt="" width={26} height={26} loading="lazy" />;
  return <span className={`ti ${cls}`} style={t.tone === "other" ? { background: "linear-gradient(135deg,#6B7482,#A9B2C0)" } : undefined}>{t.glyph}</span>;
}

export function Pair() {
  // eslint-disable-next-line @next/next/no-img-element
  return <div className="pair"><img className="ti img" src="/tokens/hype.svg" alt="" width={26} height={26} /><img className="ti img" src="/tokens/usdc.svg" alt="" width={26} height={26} />WHYPE / USDC</div>;
}

export const Sk = ({ w = 80 }: { w?: number }) => <i className="sk" style={{ width: w }} />;

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { docPage, docsIndex, flatDocs } from "@/lib/docs";
import DocsNav from "@/components/DocsNav";

export const dynamicParams = false;
export function generateStaticParams() {
  return flatDocs().map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const d = docPage(slug);
  return d ? { title: `${d.title} · Docs`, description: d.lead.replace(/<[^>]+>/g, "") } : {};
}

export default async function DocPageView({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const d = docPage(slug);
  if (!d) notFound();
  const flat = flatDocs();
  const i = flat.findIndex((x) => x.slug === slug);
  const prev = flat[i - 1], next = flat[i + 1];
  // search corpus (titles + plain text), small enough to ship to the client
  const corpus = flat.map((x) => {
    const p = docPage(x.slug)!;
    return { slug: x.slug, title: x.title, group: x.group, text: (p.lead + " " + p.html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 2000) };
  });
  return (
    <section className="page docs-page">
      <div className="dl">
        <DocsNav index={docsIndex()} current={slug} title={d.title} corpus={corpus} />
        <article className="dmain">
          <div className="crumb">{d.group}</div>
          <h1>{d.title}</h1>
          <p className="lead" dangerouslySetInnerHTML={{ __html: d.lead }} />
          <div dangerouslySetInnerHTML={{ __html: d.html }} />
          <div className="pn">
            {prev && <Link href={`/docs/${prev.slug}`}><small>Previous</small>{prev.title}</Link>}
            {next && <Link className="nx" href={`/docs/${next.slug}`}><small>Next</small>{next.title}</Link>}
          </div>
          <div className="dmeta">Source: content/docs/{slug}.md · also published at docs.stoa.trade</div>
        </article>
        <aside className="dtoc">
          {d.toc.length > 0 && <><h5>ON THIS PAGE</h5>{d.toc.map((t) => <a key={t.id} href={`#${t.id}`}>{t.text}</a>)}</>}
        </aside>
      </div>
    </section>
  );
}

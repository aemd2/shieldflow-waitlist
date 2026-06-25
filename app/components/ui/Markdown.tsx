import { Fragment } from "react";

// Minimal, XSS-safe Markdown renderer. It builds React elements directly from text,
// so model output is treated as data — never as HTML. Supports headings, bullet and
// numbered lists, bold, and paragraphs (enough for policies + co-pilot answers).

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g);
  parts.forEach((part, i) => {
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      nodes.push(<strong key={`${keyPrefix}-b-${i}`}>{part.slice(2, -2)}</strong>);
    } else if (/^`[^`]+`$/.test(part)) {
      nodes.push(
        <code key={`${keyPrefix}-c-${i}`} className="rounded bg-secondary px-1 py-0.5 text-xs">
          {part.slice(1, -1)}
        </code>,
      );
    } else if (link && /^https?:\/\//i.test(link[2])) {
      // Only http(s) becomes an anchor — javascript:/data:/etc. stays plain text,
      // preserving the "model output is data, never code" guarantee.
      nodes.push(
        <a
          key={`${keyPrefix}-a-${i}`}
          href={link[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-[var(--brand-emerald)] underline-offset-2 hover:text-[var(--brand-emerald)]"
        >
          {link[1]}
        </a>,
      );
    } else if (part) {
      nodes.push(<Fragment key={`${keyPrefix}-t-${i}`}>{part}</Fragment>);
    }
  });
  return nodes;
}

export function Markdown({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushList = (key: string) => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={`${key}-li-${i}`}>{renderInline(it, `${key}-${i}`)}</li>);
    blocks.push(
      list.ordered ? (
        <ol key={key} className="ml-5 list-decimal space-y-1">{items}</ol>
      ) : (
        <ul key={key} className="ml-5 list-disc space-y-1">{items}</ul>
      ),
    );
    list = null;
  };

  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    const key = `blk-${idx}`;

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const ul = /^[-*]\s+(.*)$/.exec(line);
    const ol = /^\d+\.\s+(.*)$/.exec(line);

    if (h) {
      flushList(`${key}-l`);
      const level = h[1].length;
      const cls =
        level <= 1 ? "text-xl font-bold" : level === 2 ? "text-lg font-semibold" : "text-base font-semibold";
      blocks.push(<p key={key} className={`${cls} mt-4 text-foreground`}>{renderInline(h[2], key)}</p>);
    } else if (ul) {
      if (!list || list.ordered) flushList(`${key}-l`);
      list = list ?? { ordered: false, items: [] };
      list.items.push(ul[1]);
    } else if (ol) {
      if (!list || !list.ordered) flushList(`${key}-l`);
      list = list ?? { ordered: true, items: [] };
      list.items.push(ol[1]);
    } else if (line.trim() === "") {
      flushList(`${key}-l`);
    } else {
      flushList(`${key}-l`);
      blocks.push(<p key={key} className="leading-relaxed">{renderInline(line, key)}</p>);
    }
  });
  flushList("blk-end-l");

  return <div className="space-y-2 text-sm text-foreground">{blocks}</div>;
}

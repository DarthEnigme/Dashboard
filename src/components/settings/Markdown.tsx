import type { ReactNode } from "react";
import { CopyButton } from "./CopyButton";

/**
 * Enough Markdown for release notes, page texts and runbooks: headings, bullet, numbered and check
 * lists, quotes, rules, ``` code blocks (with a copy button), paragraphs, **bold**, *italic*, `code`
 * and [links](https://…). Builds React elements (never HTML strings), so text can't inject markup,
 * and only http(s) links are made. `rich` gives headings their sizes (notes); elsewhere they stay
 * bold lines that fit small boxes.
 */
export function Markdown({ text, rich }: { text: string; rich?: boolean }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: ReactNode[] } | null = null;
  let para: string[] = [];
  let quote: string[] = [];
  let code: { lang: string; lines: string[] } | null = null;
  const key = (p: string) => `${p}${blocks.length}`;

  const flushList = () => {
    if (list?.items.length) {
      blocks.push(
        list.ordered ? (
          <ol key={key("ol")} className="ml-5 list-decimal space-y-0.5">
            {list.items}
          </ol>
        ) : (
          <ul key={key("ul")} className="ml-4 list-disc space-y-0.5">
            {list.items}
          </ul>
        ),
      );
    }
    list = null;
  };
  const flushPara = () => {
    if (para.length) blocks.push(<p key={key("p")}>{inline(para.join(" "))}</p>);
    para = [];
  };
  const flushQuote = () => {
    if (quote.length) {
      blocks.push(
        <blockquote key={key("q")} className="border-l-2 border-accent/60 pl-3 text-muted">
          {inline(quote.join(" "))}
        </blockquote>,
      );
    }
    quote = [];
  };
  const flush = () => {
    flushList();
    flushPara();
    flushQuote();
  };
  const addItem = (ordered: boolean, node: ReactNode) => {
    flushPara();
    flushQuote();
    if (list && list.ordered !== ordered) flushList();
    list ??= { ordered, items: [] };
    list.items.push(<li key={list.items.length}>{node}</li>);
  };

  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const fence = raw.match(/^\s*```\s*([\w+-]*)\s*$/);
    if (code) {
      if (fence) {
        const body = code.lines.join("\n");
        blocks.push(
          <div key={key("code")} className="group relative">
            <pre className="overflow-x-auto rounded-xl bg-track p-3 text-[0.85em] leading-relaxed" data-lang={code.lang || undefined}>
              <code>{body}</code>
            </pre>
            <CopyButton text={body} />
          </div>,
        );
        code = null;
      } else code.lines.push(raw);
      continue;
    }
    if (fence) {
      flush();
      code = { lang: fence[1], lines: [] };
      continue;
    }
    const line = raw.trimEnd();
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    const check = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/);
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const q = line.match(/^\s*>\s?(.*)$/);
    if (heading) {
      flush();
      const level = heading[1].length;
      const size = rich ? (level === 1 ? "text-xl" : level === 2 ? "text-lg" : "text-base") : "";
      const Tag = rich ? (`h${Math.min(6, level + 1)}` as "h2") : "p";
      blocks.push(
        <Tag key={key("h")} className={`pt-1 font-semibold text-fg ${size}`}>
          {inline(heading[2])}
        </Tag>,
      );
    } else if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flush();
      blocks.push(<hr key={key("hr")} className="border-line" />);
    } else if (check) {
      addItem(
        false,
        <span className="flex items-start gap-1.5">
          <input type="checkbox" checked={check[1] !== " "} readOnly disabled className="mt-1 accent-[var(--accent)]" />
          <span>{inline(check[2])}</span>
        </span>,
      );
    } else if (bullet) addItem(false, inline(bullet[1]));
    else if (numbered) addItem(true, inline(numbered[1]));
    else if (q) {
      flushList();
      flushPara();
      quote.push(q[1]);
    } else if (!line.trim()) flush();
    else {
      flushList();
      flushQuote();
      para.push(line.trim());
    }
  }
  if (code) {
    // An unclosed block still shows as code.
    const body = (code as { lines: string[] }).lines.join("\n");
    blocks.push(
      <pre key={key("code")} className="overflow-x-auto rounded-xl bg-track p-3 text-[0.85em]">
        <code>{body}</code>
      </pre>,
    );
  }
  flush();
  return <div className="flex flex-col gap-1.5 text-sm text-fg/85">{blocks}</div>;
}

function inline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)]+)|(?<![\w*])\*([^*\s][^*]*?)\*(?![\w*])|(?<!\w)_([^_\s][^_]*?)_(?!\w)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const k = out.length;
    if (m[1]) out.push(<strong key={k}>{m[1]}</strong>);
    else if (m[2]) out.push(<code key={k} className="rounded bg-track px-1 text-[0.85em]">{m[2]}</code>);
    else if (m[6] ?? m[7]) out.push(<em key={k}>{m[6] ?? m[7]}</em>);
    else {
      const href = m[4] ?? m[5];
      out.push(
        <a key={k} href={href} target="_blank" rel="noreferrer noopener" className="text-accent underline-offset-2 hover:underline">
          {m[3] ?? href}
        </a>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

import type { ReactNode } from "react";

/**
 * Just enough Markdown for release notes: headings, bullet lists, paragraphs, **bold**, `code`
 * and [links](https://…). Builds React elements (never HTML strings), so notes can't inject markup.
 */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: ReactNode[] = [];
  let para: string[] = [];
  const flushList = () => {
    if (list.length) blocks.push(<ul key={`ul${blocks.length}`} className="ml-4 list-disc space-y-0.5">{list}</ul>);
    list = [];
  };
  const flushPara = () => {
    if (para.length) blocks.push(<p key={`p${blocks.length}`}>{inline(para.join(" "))}</p>);
    para = [];
  };
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    if (heading) {
      flushList();
      flushPara();
      blocks.push(
        <p key={`h${blocks.length}`} className="pt-1 font-semibold text-fg">
          {inline(heading[2])}
        </p>,
      );
    } else if (bullet) {
      flushPara();
      list.push(<li key={list.length}>{inline(bullet[1])}</li>);
    } else if (!line.trim()) {
      flushList();
      flushPara();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushList();
  flushPara();
  return <div className="flex flex-col gap-1.5 text-sm text-fg/85">{blocks}</div>;
}

function inline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const k = out.length;
    if (m[1]) out.push(<strong key={k}>{m[1]}</strong>);
    else if (m[2]) out.push(<code key={k} className="rounded bg-track px-1 text-[0.85em]">{m[2]}</code>);
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

import type { BookmarkGroup as Group } from "@/lib/config/schema";
import { Icon } from "./Icon";

export function BookmarkGroup({ group, target }: { group: Group; target: string }) {
  return (
    <section className="glass rounded-2xl p-3">
      <h3 className="px-2 pt-1 pb-2 text-xs font-semibold tracking-wider text-muted uppercase">{group.name}</h3>
      <ul className="flex flex-col">
        {group.links.map((l) => (
          <li key={`${l.name}|${l.href}`}>
            <a
              href={l.href}
              target={target}
              rel={target === "_blank" ? "noreferrer" : undefined}
              className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent"
            >
              <Icon icon={l.icon} name={l.name} size={22} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{l.name}</span>
              {l.description && <span className="truncate text-xs text-muted">{l.description}</span>}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

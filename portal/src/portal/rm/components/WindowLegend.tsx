import { useLang } from "../../teacher/i18n";
import { WindowMark } from "../../coach/insights/count";
import { range } from "../../coach/insights/format";
import type { Window } from "../../coach/insights/types";

/**
 * bd-sex15q.17 — the windows a card's counts refer to, written once on the card (B5 add: a multi-number screen carries
 * the window per card), each the element a `data-win` resolves to (G10). Activity windows have no grader (API A7).
 */
export function WindowLegend({ windows, ids, className, sep = false, inline = sep }: {
  windows: readonly Window[]; ids: readonly string[]; className?: string;
  /** a span (inside a Section's hint), not a paragraph */
  inline?: boolean;
  /** bd-sex15q.47 (R6): inline after a hint ("… never a score · 1 Oct to 28 Oct"), a span led by the separator. */
  sep?: boolean;
}) {
  const lang = useLang();
  const list = [...new Set(ids)].map((id) => windows.find((w) => w.id === id)).filter((w): w is Window => !!w);
  if (!list.length) return null;
  const Tag = inline ? "span" : "p";
  return (
    <Tag data-testid="window-legend" className={className ?? "text-[13px] leading-[1.45] text-cp-ink-3"}>
      {sep && (lang === "ur" ? "، " : " · ")}
      {list.map((w, i) => (
        <span key={w.id}>
          {i > 0 && (lang === "ur" ? "، " : " · ")}
          <WindowMark window={w} as="span">{range(w.from, w.to, lang)}</WindowMark>
        </span>
      ))}
    </Tag>
  );
}

/** Every `window_id` under a value, in order of first appearance. */
export function windowIds(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => windowIds(x, out));
  else if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.window_id === "string" && !out.includes(o.window_id)) out.push(o.window_id);
    Object.values(o).forEach((x) => windowIds(x, out));
  }
  return out;
}

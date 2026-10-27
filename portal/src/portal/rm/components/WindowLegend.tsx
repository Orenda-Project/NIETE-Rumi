import { useLang } from "../../teacher/i18n";
import { WindowMark } from "../../coach/insights/count";
import { range } from "../../coach/insights/format";
import type { Window } from "../../coach/insights/types";

/**
 * bd-sex15q.17 — the windows a card's counts refer to, written once on the card (B5 add: a multi-number screen carries
 * the window per card), each the element a `data-win` resolves to (G10). Activity windows have no grader (API A7).
 */
export function WindowLegend({ windows, ids, className }: { windows: readonly Window[]; ids: readonly string[]; className?: string }) {
  const lang = useLang();
  const list = [...new Set(ids)].map((id) => windows.find((w) => w.id === id)).filter((w): w is Window => !!w);
  if (!list.length) return null;
  return (
    <p data-testid="window-legend" className={className ?? "text-[12.5px] leading-snug text-[#6b7280]"}>
      {list.map((w, i) => (
        <span key={w.id}>
          {i > 0 && (lang === "ur" ? "، " : " · ")}
          <WindowMark window={w} as="span">{range(w.from, w.to, lang)}</WindowMark>
        </span>
      ))}
    </p>
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

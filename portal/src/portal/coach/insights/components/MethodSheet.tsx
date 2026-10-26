import { useLang } from "../../../teacher/i18n";
import { CodeText, CountSpan, WindowMark } from "../count";
import { range, weeks } from "../format";
import { pick, t, tx } from "../text";
import type { WDetail } from "../types";

/**
 * bd-sex15q.15 — S2's "How this was counted", collapsed at rest (a native <details>). Grader and model id, the window
 * and its weeks, what the denominator counts, what was excluded, coverage, the current-school rule, the caveats and
 * the governed query id.
 *
 * The excluded sentence's four numbers are parts of the card's base (sessions left out of it), so the sentence is
 * wrapped in a CountSpan of `card.count`; coverage is its own Count. The model id and query id carry digits that are
 * ids, not counts: they render as CodeText atoms. R3 carries no hysteresis flag, so `s2.method.hysteresis` is not drawn.
 */
export default function MethodSheet({ detail }: { detail: WDetail }) {
  const lang = useLang();
  const m = detail.method;
  const w = m.window;
  const x = detail.excluded;
  const line = "text-[13.5px] leading-snug text-[#374151]";
  return (
    <details data-testid="w-method" className="group rounded-2xl border border-[#e5e7eb] bg-white px-4 py-3">
      <summary className="flex min-h-[44px] cursor-pointer items-center text-[15px] font-semibold text-[#1d2025]">
        {t("s2.method.title", lang)}
      </summary>
      <div className="flex flex-col gap-2 pb-1 pt-1">
        <p className={line}>
          {tx("s2.method.grader", lang, { grader_label: pick(w.grader_label, lang), grader: <CodeText lang={lang}>{m.grader}</CodeText> })}
        </p>
        <WindowMark window={w} className={line}>
          {t("s2.method.window", lang, { range: range(w.from, w.to, lang), weeks: w.weeks ? weeks(w.weeks, lang) : "" })}
        </WindowMark>
        <p className={line}>{t("s2.method.denominator", lang)}</p>
        <CountSpan as="p" count={detail.card.count} className={line}>
          {t("s2.method.excluded", lang, { m: x.mismatch, u: x.unusable, dup: x.duplicates, f: x.failed })}
        </CountSpan>
        <CountSpan as="p" count={m.coverage} className={line}>
          {t("s2.method.coverage", lang, { n: m.coverage.n, d: m.coverage.d })}
        </CountSpan>
        <p className={line}>{pick(m.current_school_rule, lang)}</p>
        {m.caveats.map((c, i) => <p key={i} className={line}>{pick(c, lang)}</p>)}
        <p className="text-[12.5px] text-[#6b7280]">{tx("s2.method.query", lang, { query_id: <CodeText lang={lang}>{m.query_id}</CodeText> })}</p>
      </div>
    </details>
  );
}

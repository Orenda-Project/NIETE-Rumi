import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useLang } from "../../../teacher/i18n";
import { CodeText, CountSpan, Num, WindowMark } from "../count";
import { digits, range } from "../format";
import { pick, t, tx } from "../text";
import type { WRow as WRowData } from "../types";

/**
 * bd-sex15q.15 — G9: ONE row for every weakness that is not the headline (S1's Move 2, S3's per-school top W, S6's rows,
 * the Not-yet list), in three states:
 *
 *   ranked     the count, "Move 2", the short name, the sentence, "{school} first (n of d) · range · grader"
 *   also_seen  the short name, the sentence, "{school} first (n of d) · range"
 *   not_yet    the short name, "{graded} of {needed} graded lessons · the card shows at {needed}", the codes line
 *
 * One `data-num/den/win` per count; the window resolves to the row's own meta element. `sectorLabel` (the sector's name)
 * is passed by a screen that knows it; without it the sector line is not drawn (it never shows a bare number).
 */
export function WRow({ row, to, sectorLabel, testId = "wrow" }: { row: WRowData; to?: string; sectorLabel?: string | null; testId?: string }) {
  const lang = useLang();
  const sep = lang === "ur" ? "، " : " · ";
  const win = <WindowMark window={row.window} as="span">{range(row.window.from, row.window.to, lang)}</WindowMark>;
  let lead: React.ReactNode = null;
  let sub: React.ReactNode = null;
  if (row.state === "not_yet" && row.not_yet) {
    const g = row.not_yet.graded;
    sub = (
      <>
        {g && (
          <span className="block">
            {tx("wrow.not_yet.sub", lang, { needed: <span data-nonum="">{digits(g.d, lang)}</span> }, [{ n: "graded", d: "needed", count: g }])}
          </span>
        )}
        <CountSpan count={{ n: row.not_yet.codes_seen, d: row.not_yet.codes_needed, window_id: row.window.id }} className="block">
          {t("wrow.not_yet.codes", lang, { seen: row.not_yet.codes_seen, needed: row.not_yet.codes_needed })}
        </CountSpan>
        <span className="block">{win}</span>
      </>
    );
  } else {
    if (row.state === "ranked" && row.count) {
      lead = (
        <span className="flex w-[64px] shrink-0 flex-col items-center leading-tight">
          <Num count={row.count} lang={lang} className="text-center text-[15px] font-bold text-[#1d2025]" />
          <span data-nonum="" className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-[#6b7280] rtl:tracking-normal">{t("s1.move_2", lang)}</span>
        </span>
      );
    }
    const wf = row.where_first;
    if (wf) {
      const key = row.state === "ranked" ? "wrow.ranked.sub" : "wrow.also_seen.sub";
      const vars: Record<string, React.ReactNode> = {
        school: <CodeText lang={lang}>{wf.school.school_name}</CodeText>,
        range: <WindowMark window={row.window} as="span">{range(row.window.from, row.window.to, lang)}</WindowMark>,
      };
      if (key === "wrow.ranked.sub") vars.grader_label = pick(row.window.grader_label, lang);
      sub = tx(key, lang, vars, [{ n: "n", d: "d", count: wf.count }]);
    } else if (row.count && row.state !== "ranked") {
      sub = <><Num count={row.count} lang={lang} />{sep}{win}</>;
    } else {
      sub = win;
    }
  }
  const body = (
    <>
      {lead}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15.5px] font-semibold leading-snug text-[#1d2025]">{pick(row.short_name, lang)}</span>
        {row.state !== "not_yet" && <span className="text-[14px] leading-snug text-[#374151]">{pick(row.sentence, lang)}</span>}
        {sub && <span className="text-[12.5px] leading-snug text-[#6b7280]">{sub}</span>}
        {row.sector && sectorLabel && (
          <span className="text-[12.5px] text-[#6b7280]">
            {tx("wrow.sector", lang, { sector: sectorLabel }, [{ n: "n", d: "d", count: row.sector }])}
          </span>
        )}
      </span>
      {to && <ChevronRight className="h-5 w-5 shrink-0 self-center text-[#9ca3af] rtl:rotate-180" aria-hidden="true" />}
    </>
  );
  const cls = "flex w-full items-start gap-3 rounded-2xl border border-[#e5e7eb] bg-white px-3.5 py-3 text-start";
  return to
    ? <Link to={to} data-testid={testId} data-w={row.w_id} data-state={row.state} className={cls}>{body}</Link>
    : <div data-testid={testId} data-w={row.w_id} data-state={row.state} className={cls}>{body}</div>;
}

/** Re-exported for screens that list counts beside a row. */
export { CountSpan };

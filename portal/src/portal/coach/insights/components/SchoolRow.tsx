import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { useLang, type Lang } from "../../../teacher/i18n";
import { CodeText, CountSpan, DateText } from "../count";
import { t, tx } from "../text";
import type { WSchool } from "../types";

/**
 * bd-sex15q.15 — one school on S3 (G5, DESIGN §9). The school line ("{school} · n of d lessons · visit {date}"), then by
 * state:
 *
 *   shows       each teacher code with its recordings and "g of n graded"; where the server sent a strip (≥ 4 graded),
 *               a "Trend" disclosure, closed at rest, with one dot per lesson: filled indigo where this W showed,
 *               half where partly, an outline where not. Never red, never a percentage, never a score; the codes stay
 *               in the payload's order (never ranked).
 *   too_few     "Too few to name a code yet (n of d lessons)" and no code.
 *   no_graded   "No graded recordings this month (r recordings, …)" and no code.
 */
/** One school as S2 and S3 say it: "{school} · n of d lessons · visit {date}" or "… · no visit booked". */
export function schoolLine(s: WSchool, lang: Lang, key: "s2.where.row" | "s3.row") {
  const school = <CodeText lang={lang}>{s.school.school_name}</CodeText>;
  const counts = [{ n: "n", d: "d", count: s.count }];
  return s.next_visit
    ? tx(key, lang, { school, date: <DateText iso={s.next_visit.date} lang={lang} /> }, counts)
    : tx("s3.row.no_visit", lang, { school }, counts);
}

export default function SchoolRow({ s }: { s: WSchool }) {
  const lang = useLang();
  const counts = [{ n: "n", d: "d", count: s.count }];
  const head = schoolLine(s, lang, "s3.row");
  return (
    <li data-testid="school-row" data-school={s.school.school_id} data-state={s.state}
      className="flex flex-col gap-2 rounded-2xl border border-[#e5e7eb] bg-white px-4 py-3.5">
      <p className="text-[15px] font-semibold leading-snug text-[#1d2025] [overflow-wrap:anywhere]">{head}</p>
      {s.state === "too_few" && (
        <p data-testid="school-too-few" className="text-[14px] text-[#6b7280]">
          {tx("s3.too_few", lang, {}, counts)}
        </p>
      )}
      {s.state === "no_graded" && (
        <CountSpan as="p" count={s.count} className="text-[14px] text-[#6b7280]">
          <span data-testid="school-no-graded">{t("s3.no_graded", lang, { r: s.count.d })}</span>
        </CountSpan>
      )}
      {s.state !== "too_few" && s.state !== "no_graded" && s.codes.length > 0 && (
        <ul className="flex flex-col divide-y divide-[#f3f4f6]">
          {s.codes.map((c) => <CodeLine key={c.code.code_id} c={c} lang={lang} />)}
        </ul>
      )}
    </li>
  );
}

function CodeLine({ c, lang }: { c: WSchool["codes"][number]; lang: Lang }) {
  const [open, setOpen] = useState(false);
  const sep = lang === "ur" ? "، " : " · ";
  return (
    <li data-testid="school-code" className="flex flex-col gap-1.5 py-2">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-[14px] leading-snug text-[#374151]">
          <CountSpan count={c.graded}>{tx("s3.code", lang, { code: <CodeText lang={lang}>{c.code.code}</CodeText>, n: c.graded.d })}</CountSpan>
          {sep}
          {tx("s3.code.graded", lang, {}, [{ n: "g", d: "n", count: c.graded }])}
        </span>
        {c.strip && (
          <button type="button" data-testid="trend-toggle" aria-expanded={open ? "true" : "false"} onClick={() => setOpen((o) => !o)}
            className="flex min-h-[44px] shrink-0 items-center gap-0.5 rounded-full px-2 text-[13.5px] font-semibold text-[#4f46e5]">
            {t("s3.trend", lang)}
            <ChevronRight className={`h-4 w-4 rtl:rotate-180 ${open ? "rotate-90 rtl:rotate-90" : ""}`} aria-hidden="true" />
          </button>
        )}
      </div>
      {c.strip && open && (
        <div data-testid="trend" className="flex flex-col gap-1.5 rounded-xl bg-[#f9fafb] px-3 py-2">
          <div className="flex flex-wrap gap-2" aria-hidden="true">
            {c.strip.map((h) => (
              <span key={h.session_id} data-testid="trend-dot" data-shows={String(h.shows)}
                className={h.shows === true
                  ? "h-3.5 w-3.5 rounded-full border-2 border-[#4f46e5] bg-[#4f46e5]"
                  : h.shows === "partial"
                    ? "h-3.5 w-3.5 rounded-full border-2 border-[#4f46e5] bg-[linear-gradient(90deg,#4f46e5_50%,transparent_50%)] rtl:bg-[linear-gradient(270deg,#4f46e5_50%,transparent_50%)]"
                    : "h-3.5 w-3.5 rounded-full border-2 border-[#4f46e5] bg-white"} />
            ))}
          </div>
          <p data-testid="trend-hint" className="text-[12.5px] text-[#6b7280]">{t("s3.trend.hint", lang)}</p>
        </div>
      )}
    </li>
  );
}


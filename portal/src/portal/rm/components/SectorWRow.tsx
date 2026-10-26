import { useLang } from "../../teacher/i18n";
import { CodeText, Num, WindowMark } from "../../coach/insights/count";
import { dateShort, range } from "../../coach/insights/format";
import { pick } from "../../coach/insights/text";
import type { Count, School, WRow } from "../../coach/insights/types";
import { CountLine } from "./CountLine";
import { rt, rtx } from "../text";

/**
 * bd-sex15q.17 — a weakness row at sector scope (S8's month list, RmStats). It is G9's WRow with the sector's count AS
 * its count (`sector` is null: the row IS the sector, API R17), so it carries no "Move 2" label: an RM's rows are the
 * cluster session's agenda, not a coach's second move. B23: a row under the sector floor reads "not enough recordings
 * yet across the sector" with the coach count, never a share. `by_school` is S8's three schools, never a coach (G4).
 * S9 passes a coach's row with `sector` (the sector's count beside the coach's).
 */
export function SectorWRow({ row, bySchool, agenda, sector, testId = "sector-wrow" }: {
  row: WRow; bySchool?: readonly { school: School; count: Count }[]; agenda?: boolean;
  /** S9: the row is one coach's and this is the sector's count beside it ("Urban-I: 171 of 505"). */
  sector?: { label: string; count: Count } | null; testId?: string;
}) {
  const lang = useLang();
  const sep = lang === "ur" ? "، " : " · ";
  const meta = [range(row.window.from, row.window.to, lang)];
  if (row.window.grader_label) meta.push(pick(row.window.grader_label, lang));
  if (row.window.scoring_changed_on) meta.push(rt("meta.changed", lang, { date_short: dateShort(row.window.scoring_changed_on, lang) }));
  const ranked = row.state !== "not_yet" && row.count;
  return (
    <div data-testid={testId} data-w={row.w_id} data-state={row.state} data-agenda={agenda ? "1" : undefined}
      className={`flex items-start gap-3 rounded-2xl border bg-white px-3.5 py-3 ${agenda ? "border-[#47BA7D] border-s-4" : "border-[#e5e7eb]"}`}>
      {ranked && row.count && (
        <span className="flex min-w-[76px] shrink-0 flex-col items-center rounded-xl bg-[#f3f4f6] px-2 py-2 text-center">
          <Num count={row.count} lang={lang} className="text-[16px] font-bold leading-tight text-[#1d2025]" />
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-[16px] font-semibold leading-snug">{pick(row.short_name, lang)}</p>
        {row.state !== "not_yet" && <p className="text-[14px] leading-snug text-[#374151]">{pick(row.sentence, lang)}</p>}
        {row.state === "not_yet" && row.not_yet && (
          <>
            {row.not_yet.graded && (
              <CountLine k="wrow.not_yet.sub" count={row.not_yet.graded} vars={{ graded: row.not_yet.graded.n, needed: row.not_yet.graded.d }}
                className="text-[13.5px] text-[#374151]" as="p" />
            )}
            {row.not_yet.coaches_with_5plus !== null && (
              <CountLine k="wrow.sector.not_yet" count={{ n: row.not_yet.coaches_with_5plus, d: 3, window_id: row.window.id }}
                vars={{ c: row.not_yet.coaches_with_5plus }} className="text-[13.5px] text-[#374151]" as="p" />
            )}
          </>
        )}
        {bySchool && bySchool.length > 0 && (
          <ul data-testid="by-school" className="mt-1 flex flex-col divide-y divide-[#f3f4f6]">
            {bySchool.map((b) => (
              <li key={b.school.school_id} data-testid="by-school-row" className="py-1.5 text-[14px] text-[#1d2025]">
                {rtx("s8.moves.by_school.row", lang, { school: <CodeText lang={lang}>{b.school.school_name}</CodeText> }, [{ n: "n", d: "d", count: b.count }])}
              </li>
            ))}
          </ul>
        )}
        {sector && (
          <p data-testid="sector-line" className="text-[13px] text-[#6b7280]">
            {rtx("wrow.sector", lang, { sector: <CodeText lang={lang}>{sector.label}</CodeText> }, [{ n: "n", d: "d", count: sector.count }])}
          </p>
        )}
        <WindowMark window={row.window} className="text-[12.5px] leading-snug text-[#6b7280]">{meta.join(sep)}</WindowMark>
      </div>
    </div>
  );
}

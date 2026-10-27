import { useLang } from "../../../teacher/i18n";
import { CountSpan, Num } from "../count";
import { digits } from "../format";
import { pick, t, tx } from "../text";
import type { StatsRow as Row } from "../types";

/**
 * bd-sex15q.15 — one S6 row (R14): the short name, the sentence, this window's "n of d" and, when the payload has it,
 * last window's, and the change pill only when `change` is set (B19: the server sets it only for one grader and one
 * framework). Rows are drawn in the order sent; nothing here sorts by a count.
 *
 *   insufficient  the "not enough recordings yet" line in place of the numbers; the 20 is a floor, not a count.
 *   sector        not drawn: the payload has the sector's count but no sector name to say it with (WRow's rule).
 *
 * The pill is a neutral chip in every state: no red, no green, never a percentage.
 */
export const INSUFFICIENT_FLOOR = 20;

export function StatsRow({ row }: { row: Row }) {
  const lang = useLang();
  const insufficient = row.status === "insufficient";
  const pill = row.change ? t(`s6.pill.${row.change}` as const, lang) : null;
  // fix-r5 s2 item 15 (design-qa 073628 §3, qa-coach 073257 (2)): an S6-only W carries no sentence, or the server's
  // fallback repeats the short name; the row is then one line, never the name twice
  const name = pick(row.short_name, lang);
  const sentence = pick(row.sentence, lang).trim();
  const showSentence = sentence !== "" && sentence !== name.trim();
  return (
    <li
      data-testid="s6-row"
      data-w={row.w_id}
      data-status={row.status}
      className="flex items-start gap-3 border-t border-[#f0f1f3] px-4 py-3 first:border-t-0"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-semibold leading-snug text-[#1d2025]">{name}</span>
        {showSentence && <span data-testid="s6-sentence" className="text-[13.5px] leading-snug text-[#374151]">{sentence}</span>}
        {insufficient && (
          <span className="text-[12.5px] leading-snug text-[#6b7280]">
            {/* graded = the window's in-denominator lessons (now.d), against the floor of 20 (API §3 Empty.detail.graded) */}
            {tx("s6.insufficient", lang, {}, [{ n: "graded", d: "needed", count: { n: row.now.d, d: INSUFFICIENT_FLOOR, window_id: row.now.window_id } }])}
          </span>
        )}
        {pill && (
          <span data-testid="s6-pill" data-change={row.change} className="mt-1 w-fit rounded-full bg-[#eef2ff] px-2.5 py-0.5 text-[12px] font-semibold text-[#3730a3]">
            {pill}
          </span>
        )}
      </span>
      {!insufficient && (
        <span className="flex shrink-0 gap-3 text-end">
          {/* one atom (P10): "۴۶ میں سے ۲۸" never wraps, in a column wide enough for it at 15 px (design-qa 073628 §4) */}
          <Num count={row.now} lang={lang} className="w-[96px] whitespace-nowrap text-[15px] font-bold text-[#1d2025]" />
          {row.before && <Num count={row.before} lang={lang} className="w-[96px] whitespace-nowrap text-[14px] text-[#6b7280]" />}
        </span>
      )}
    </li>
  );
}

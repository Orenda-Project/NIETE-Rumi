import { useLang } from "../../../teacher/i18n";
import { pick, t, tx } from "../text";
import type { StatsRow as Row } from "../types";
import { RowCount } from "../../../coachip-ui/Count";
import { FractionBar } from "../../../coachip-ui/FractionBar";
import { Pill } from "../../../coachip-ui/Pill";

/**
 * bd-sex15q.15 — one S6 row (R14): the short name, the sentence, this window's "n of d" and, when the payload has it,
 * last window's, and the change pill only when `change` is set (B19: the server sets it only for one grader and one
 * framework). Rows are drawn in the order sent; nothing here sorts by a count.
 *
 *   insufficient  the "not enough recordings yet" line in place of the numbers; the 20 is a floor, not a count.
 *   sector        not drawn: the payload has the sector's count but no sector name to say it with (WRow's rule).
 *
 * The pill is a neutral chip in every state: no red, no green, never a percentage.
 *
 * R6 (bd-sex15q.46, SCREENS.md S6): a hairline row; each window's count is a RowCount over its 4 px FractionBar (the
 * counts are lessons), last window's bar grey; the pill coachip-ui's grey Pill.
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
      className="flex min-h-[44px] items-start gap-4 border-t border-cp-hairline py-3.5 first:border-t-0"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[17px] font-semibold leading-[1.4] text-cp-ink">{name}</span>
        {showSentence && <span data-testid="s6-sentence" className="text-[13px] leading-[1.45] text-cp-ink-2">{sentence}</span>}
        {insufficient && (
          <span className="text-[13px] leading-[1.45] text-cp-ink-3">
            {/* graded = the window's in-denominator lessons (now.d), against the floor of 20 (API §3 Empty.detail.graded) */}
            {tx("s6.insufficient", lang, {}, [{ n: "graded", d: "needed", count: { n: row.now.d, d: INSUFFICIENT_FLOOR, window_id: row.now.window_id } }])}
          </span>
        )}
        {pill && (
          <Pill tone="grey" testId="s6-pill" data-change={row.change ?? undefined} className="mt-1.5 w-fit">
            {pill}
          </Pill>
        )}
      </span>
      {!insufficient && (
        <span className="flex shrink-0 gap-4 pt-0.5">
          {/* one atom (P10): "۴۶ میں سے ۲۸" never wraps, in a column wide enough for it (design-qa 073628 §4) */}
          <span className="flex w-[96px] flex-col items-end gap-1.5">
            <RowCount count={row.now} lang={lang} className="w-[96px] justify-end whitespace-nowrap" />
            <FractionBar n={row.now.n} d={row.now.d} className="w-full" />
          </span>
          {row.before && (
            <span className="flex w-[96px] flex-col items-end gap-1.5">
              <RowCount count={row.before} lang={lang} className="w-[96px] justify-end whitespace-nowrap opacity-70" />
              <FractionBar n={row.before.n} d={row.before.d} tone="grey" className="w-full" />
            </span>
          )}
        </span>
      )}
    </li>
  );
}

import { useLang } from "../../teacher/i18n";
import { CodeText, WindowMark } from "../../coach/insights/count";
import { dateShort, range } from "../../coach/insights/format";
import { pick } from "../../coach/insights/text";
import type { Count, School, Window, WRow } from "../../coach/insights/types";
import { CountLine } from "./CountLine";
import { rt, rtx, rtxTemplate } from "../text";
import { RM_COPY } from "../rm.copy";
import { WRowFrame } from "../../coach/insights/components/WRow";
import { RingCount } from "../../coachip-ui/Count";
import { Ring } from "../../coachip-ui/Ring";
import { FractionBar } from "../../coachip-ui/FractionBar";

/**
 * bd-sex15q.17 — a weakness row at sector scope (S8's month list, RmStats). It is G9's WRow with the sector's count AS
 * its count (`sector` is null: the row IS the sector, API R17), so it carries no "Move 2" label: an RM's rows are the
 * cluster session's agenda, not a coach's second move. B23: a row under the sector floor reads "not enough recordings
 * yet across the sector" with the coach count, never a share. `by_school` is S8's three schools, never a coach (G4).
 * S9 passes a coach's row with `sector` (the sector's count beside the coach's).
 *
 * bd-sex15q.42 (R6, CODE_MAP C2 ruled): built on WRow's frame, so the two rows can never drift. A ranked row's count is
 * a ring (lessons, never a coach or a teacher: DESIGN_SYSTEM §6) with "of d" and the name beside it; a row under the
 * floor shows the empty ring (the track only, no number); each school has its own fraction bar.
 */
/** Urdu only: the line breaks before a Latin school name, never inside it, and an "n of d" stays whole (ux-coach 185839). */
export const URDU_ISOLATE = "[&_[data-code]]:inline-block [&_[data-num]]:whitespace-nowrap";

/** A fidelity window's one meta line: the range, the grader, the scoring change ("28 Sep to 25 Oct · lesson-plan fidelity"). */
export function windowMeta(w: Window, lang: "en" | "ur"): string {
  const meta = [range(w.from, w.to, lang)];
  if (w.grader_label) meta.push(pick(w.grader_label, lang));
  if (w.scoring_changed_on) meta.push(rt("meta.changed", lang, { date_short: dateShort(w.scoring_changed_on, lang) }));
  return meta.join(lang === "ur" ? "، " : " · ");
}

/** EN one line ("S-01 · 11 of 22 lessons"); UR the school on its own line and the count under it, so no digit crosses
 *  the bidi boundary (FIX_R6 B6, lander 212337). */
function SchoolLine({ school, count, lang }: { school: string; count: Count; lang: "en" | "ur" }) {
  const name = <CodeText lang={lang}>{school}</CodeText>;
  const slot = [{ n: "n", d: "d", count }];
  if (lang !== "ur") return <span>{rtx("s8.moves.by_school.row", lang, { school: name }, slot)}</span>;
  const rest = RM_COPY["s8.moves.by_school.row"].ur.split("{school}")[1].replace(/^[\s،]+/, "");
  return (
    <span className={URDU_ISOLATE}>
      <span className="block">{name}</span>
      <span className="block">{rtxTemplate(rest, "s8.moves.by_school.row", lang, {}, slot)}</span>
    </span>
  );
}

export function SectorWRow({ row, bySchool, agenda, sector, stated, testId = "sector-wrow" }: {
  row: WRow; bySchool?: readonly { school: School; count: Count }[]; agenda?: boolean;
  /** S9: the row is one coach's and this is the sector's count beside it ("Urban-I: 171 of 505"). */
  sector?: { label: string; count: Count } | null;
  /** FIX_R6 B1: the window the screen already states (a block's hint, a card); the row then drops its own line. */
  stated?: string; testId?: string;
}) {
  const lang = useLang();
  const count = row.state !== "not_yet" ? row.count : null;
  const name = <p className="text-[16px] font-semibold leading-snug text-cp-ink">{pick(row.short_name, lang)}</p>;
  return (
    <WRowFrame testId={testId} w={row.w_id} state={row.state} kind="sector" agenda={agenda}
      lead={count ? undefined : <Ring n={0} d={1} size="row" tone="notice" className="me-1" />}>
      {count ? (
        // FIX_R6 B4: a weakness count is a notice (navy), never a green arc
        <RingCount count={count} lang={lang} size="row" tone="notice">
          {name}
          <p className="mt-0.5 text-[14px] leading-[1.45] text-cp-ink-2">{pick(row.sentence, lang)}</p>
        </RingCount>
      ) : name}
      {row.state === "not_yet" && row.not_yet && (
        <>
          {row.not_yet.graded && (
            <CountLine k="wrow.not_yet.sub" count={row.not_yet.graded} vars={{ graded: row.not_yet.graded.n, needed: row.not_yet.graded.d }}
              className="text-[13.5px] leading-[1.45] text-cp-ink-2" as="p" />
          )}
          {row.not_yet.coaches_with_5plus !== null && (
            <CountLine k="wrow.sector.not_yet" count={{ n: row.not_yet.coaches_with_5plus, d: 3, window_id: row.window.id }}
              vars={{ c: row.not_yet.coaches_with_5plus }} className="text-[13.5px] leading-[1.45] text-cp-ink-2" as="p" />
          )}
        </>
      )}
      {bySchool && bySchool.length > 0 && (
        <ul data-testid="by-school" className="mt-2 flex flex-col">
          {bySchool.map((b) => (
            // bd-sex15q.47 (ux-lead-2 183234 #2): the sentence full width, then the bar on its own line (real names are long)
            <li key={b.school.school_id} data-testid="by-school-row" className="flex flex-col gap-1.5 py-2 text-[14px] leading-[1.45] text-cp-ink">
              {/* ux-coach 185839: in Urdu the name is one atomic box and "۹ میں سے ۶" never splits */}
              <SchoolLine school={b.school.school_name} count={b.count} lang={lang} />
              <FractionBar n={b.count.n} d={b.count.d} tone="notice" className="w-full" />
            </li>
          ))}
        </ul>
      )}
      {sector && (
        <p data-testid="sector-line" className="text-[13px] text-cp-ink-3">
          {rtx("wrow.sector", lang, { sector: <CodeText lang={lang}>{sector.label}</CodeText> }, [{ n: "n", d: "d", count: sector.count }])}
        </p>
      )}
      {stated !== row.window.id && <WindowMark window={row.window} className="text-[13px] leading-[1.45] text-cp-ink-3">{windowMeta(row.window, lang)}</WindowMark>}
    </WRowFrame>
  );
}

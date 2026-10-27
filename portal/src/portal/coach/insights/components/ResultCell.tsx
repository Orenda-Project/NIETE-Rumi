import { Link } from "react-router-dom";
import { useLang, type Lang } from "../../../teacher/i18n";
import { CodeText, LibraryText, Num, TestedSpan } from "../count";
import { digits } from "../format";
import { pick, t, tx } from "../text";
import type { ResultCell as Cell } from "../types";

/**
 * bd-sex15q.15 — one S7 card (R15): a school-grade-language cell of the coach's reading checks. Counts of children,
 * never a child and never a percentage (B20):
 *
 *   tested ≥ 5    "n children tested", then each row: ok → the count + short name + sentence; insufficient → the short
 *                 name only; not_measured / not_graded → their words, never a zero
 *   tested < 5    "n tested of 5 needed" and no row at all (the server nulls every count below the floor)
 *
 * The send opens the existing FLN send page with no recipient and no query string (c-api finding 10:09Z): the sound
 * plans for a letter row (W-LS, W-LN, W-DEC), the story plans for a reading row (W-RC, W-ORF); "ask your RM" when the
 * user's send is switched off. The language word is COPY's subject word (`s4.subject.urdu` / `.english`; fix-r5 s2 item 14:
 * the kit's short label said "Eng").
 */
const SOUND_W = new Set(["W-LS", "W-LN", "W-DEC"]);
const STORY_W = new Set(["W-RC", "W-ORF"]);

/** The FLN send page: no code, no recipient, no query. */
const FLN_SEND = "/portal/fln/send";

function languageWord(code: "ur" | "en", lang: Lang): string {
  return t(code === "ur" ? "s4.subject.urdu" : "s4.subject.english", lang);
}

export function ResultCell({ cell }: { cell: Cell }) {
  const lang = useLang();
  const full = cell.tested.n >= cell.tested.floor;
  const g = <span data-nonum="">{digits(cell.grade, lang)}</span>;
  const language = languageWord(cell.language, lang);
  const sendKey = cell.rows.some((r) => SOUND_W.has(r.w_id)) ? "s7.send" as const
    : cell.rows.some((r) => STORY_W.has(r.w_id)) ? "s7.send.story" as const : null;

  return (
    <section
      data-testid="s7-cell"
      data-school={cell.school.school_id}
      data-grade={cell.grade}
      className="flex flex-col gap-2 rounded-2xl border border-[#e5e7eb] bg-white px-4 py-3.5"
    >
      <h2 className="text-[15.5px] font-semibold leading-snug text-[#1d2025] [overflow-wrap:anywhere]">
        {tx("s7.cell", lang, { g, language, school: <CodeText lang={lang}>{cell.school.school_name}</CodeText> })}
      </h2>
      <span data-testid="s7-tested" className="flex">
        <TestedSpan
          tested={cell.tested}
          className={full ? "text-[12.5px] text-[#6b7280]" : "w-fit rounded-full bg-[#f3f4f6] px-2.5 py-0.5 text-[12.5px] font-semibold text-[#4b5563]"}
        >
          {full ? t("s7.tested", lang, { t: cell.tested.n }) : t("s7.filling", lang, { t: cell.tested.n })}
        </TestedSpan>
      </span>

      {full && (
        <>
          <ul data-testid="s7-rows" className="flex flex-col divide-y divide-[#f0f1f3]">
            {cell.rows.map((r) => (
              <li key={r.w_id} data-w={r.w_id} data-status={r.status} className="flex flex-col gap-0.5 py-2">
                {r.status === "ok" && r.count && (
                  <Num count={r.count} lang={lang} className="text-[22px] font-bold leading-tight text-[#1d2025]" />
                )}
                <span className="text-[14.5px] font-semibold leading-snug text-[#1d2025]">{pick(r.short_name, lang)}</span>
                {r.status === "ok" && r.count && <span className="text-[14px] leading-snug text-[#374151]">{pick(r.sentence, lang)}</span>}
                {r.status === "not_measured" && <span className="text-[13px] text-[#6b7280]">{t("s7.not_measured", lang)}</span>}
                {r.status === "not_graded" && <span className="text-[13px] text-[#6b7280]">{t("s7.not_graded", lang)}</span>}
              </li>
            ))}
          </ul>

          {sendKey && (cell.fln.can_send ? (
            <Link
              to={FLN_SEND}
              data-testid="s7-send"
              className="flex min-h-[44px] items-center justify-center rounded-xl bg-[#33374a] px-4 py-2.5 text-center text-[15px] font-semibold text-white [overflow-wrap:anywhere]"
            >
              {/* one inline run: the {g} node must not become a flex item of its own (design-qa 092007) */}
              <span data-testid="s7-send-text">{tx(sendKey, lang, { g, language })}</span>
            </Link>
          ) : (
            <p data-testid="s7-send-off" className="text-[13.5px] text-[#6b7280]">{t("s5.fln.off", lang)}</p>
          ))}

          {cell.debrief_line && (
            <LibraryText as="p" className="rounded-xl bg-[#f9fafb] px-3 py-2 text-[14.5px] leading-snug text-[#374151]">
              {pick(cell.debrief_line, lang)}
            </LibraryText>
          )}
        </>
      )}
    </section>
  );
}

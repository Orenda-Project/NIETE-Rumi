import { useLang } from "../../teacher/i18n";
import { DateText, WindowMark } from "../../coach/insights/count";
import { dateShort, range } from "../../coach/insights/format";
import { StateBlock } from "../../coach/insights/components/StateBlock";
import { rm } from "../api";
import { useRmLoad } from "../useRmLoad";
import { useRmSession } from "../RmGate";
import { RmCard, RmNote, RmPage } from "../components/RmFrame";
import { SectorWRow, windowMeta } from "../components/SectorWRow";
import { rt } from "../text";
import { pick } from "../../coach/insights/text";

/**
 * bd-sex15q.17 — the RM's Stats: S6's rows at sector scope. No RM stats route exists in API v1.4, so this reads R17's
 * sector rows (`moves[].row`, the sector's count AS the count, `sector` null: the row IS the sector) and the window. The
 * marker row says when scoring changed (no window before it is compared, B19); one window only, so no change pill.
 */
export default function RmStats() {
  const lang = useLang();
  const { sector } = useRmSession();
  const { data, error } = useRmLoad(() => rm.home(), []);
  if (error === "not_found") {
    return <RmPage title={rt("nav.rm.stats", lang)} testId="rm-stats"><RmNote testId="rm-no-sector">{rt("s8.empty.no_sector", lang)}</RmNote></RmPage>;
  }
  const w = data?.window;
  return (
    // fix-r5 s2 item 17 (design-qa 073629): with no scoring_changed_on marker a card would hold only the dates, so the
    // window folds into the band's sub line; with a marker the card keeps both.
    <RmPage
      title={rt("stats.title", lang, { sector: data?.sector ?? sector })}
      // FIX_R6 §7.3 B9: the sub is held as a placeholder line until the read says whether the window joins it
      sub={!data && !error ? null : w && !w.scoring_changed_on
        ? <>{rt("stats.sub", lang)}{lang === "ur" ? "، " : " · "}<WindowMark window={w} as="span">{windowMeta(w, lang)}</WindowMark></>
        : rt("stats.sub", lang)}
      windows={data?.windows} testId="rm-stats" trust={data ? "s8.trust" : null}>
      {!data || !w ? <StateBlock error={error} testId="rm-state" /> : (
        <div className="flex flex-col">
          {data.stale && <div className="mb-3"><RmNote tone="info" testId="rm-stale"><span data-date={data.stale.as_of}>{rt("s8.empty.stale", lang, { date: dateShort(data.stale.as_of, lang) })}</span></RmNote></div>}
          {w.scoring_changed_on && (
            <RmCard testId="rm-stats-window">
              {/* FIX_R6 B1: the window and its grader said once here; the rows below drop their own line */}
              <WindowMark window={w} className="text-[15px] font-semibold text-cp-ink">{range(w.from, w.to, lang)}{w.grader_label ? `${lang === "ur" ? "، " : " · "}${pick(w.grader_label, lang)}` : ""}</WindowMark>
              <p data-testid="rm-stats-marker" className="mt-2 self-start rounded-[12px] bg-cp-navy-tint px-3 py-2 text-[13px] text-cp-navy">
                <span data-date={w.scoring_changed_on}>{rt("s6.marker", lang, { date_short: dateShort(w.scoring_changed_on, lang) })}</span>
              </p>
            </RmCard>
          )}
          {/* bd-sex15q.47 (R6): the rows sit flush under hairlines (each a ring row), no card per row */}
          <div className="flex flex-col">{data.moves.map((m) => <SectorWRow key={m.row.w_id} row={m.row} testId="rm-stats-row" stated={w.id} />)}</div>
        </div>
      )}
    </RmPage>
  );
}

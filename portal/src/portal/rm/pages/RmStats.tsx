import { useLang } from "../../teacher/i18n";
import { DateText, WindowMark } from "../../coach/insights/count";
import { dateShort, range } from "../../coach/insights/format";
import { StateBlock } from "../../coach/insights/components/StateBlock";
import { rm } from "../api";
import { useRmLoad } from "../useRmLoad";
import { useRmSession } from "../RmGate";
import { RmCard, RmNote, RmPage } from "../components/RmFrame";
import { SectorWRow } from "../components/SectorWRow";
import { rt } from "../text";

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
    <RmPage title={rt("stats.title", lang, { sector: data?.sector ?? sector })} sub={rt("stats.sub", lang)} windows={data?.windows} testId="rm-stats" trust={data ? "s8.trust" : null}>
      {!data || !w ? <StateBlock error={error} testId="rm-state" /> : (
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          <RmCard testId="rm-stats-window">
            <WindowMark window={w} className="text-[14px] text-[#374151]">{range(w.from, w.to, lang)}</WindowMark>
            {w.scoring_changed_on && (
              <p data-testid="rm-stats-marker" className="rounded-xl bg-[#f3f4f6] px-3 py-2 text-[13.5px] text-[#374151]">
                <span data-date={w.scoring_changed_on}>{rt("s6.marker", lang, { date_short: dateShort(w.scoring_changed_on, lang) })}</span>
              </p>
            )}
          </RmCard>
          {data.moves.map((m) => <SectorWRow key={m.row.w_id} row={m.row} testId="rm-stats-row" />)}
          {data.stale && <RmNote tone="info" testId="rm-stale"><span data-date={data.stale.as_of}>{rt("s8.empty.stale", lang, { date: dateShort(data.stale.as_of, lang) })}</span></RmNote>}
        </div>
      )}
    </RmPage>
  );
}

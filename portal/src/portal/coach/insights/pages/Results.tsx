import { useLang } from "../../../teacher/i18n";
import InsightsGate from "../InsightsGate";
import { useLoad } from "../useLoad";
import { coachip } from "../api";
import { insightsPaths } from "../paths";
import { InsightsPage, MetaLine } from "../components/Frame";
import { StateBlock, NoteCard } from "../components/StateBlock";
import { ResultCell } from "../components/ResultCell";
import { DateText } from "../count";
import { t, tx } from "../text";
import type { Results as ResultsData } from "../types";

/**
 * bd-sex15q.15 — S7, Results (`/stats/results`, R15): the children's reading checks, one card per school-grade cell
 * in the order sent, under the test window's meta line. Empty: before the first visit (`empty.status = "pending"`
 * with `detail.as_of`) the start date; otherwise "no reading check in your schools yet".
 */
/** The read sits INSIDE the gate, so with portal_coachip off no /coachip/* request fires (B7; red-2 18:08Z). */
export default function Results() {
  return (
    <InsightsGate>
      <ResultsLoaded />
    </InsightsGate>
  );
}

function ResultsLoaded() {
  const lang = useLang();
  const { data, error } = useLoad<ResultsData>(() => coachip.results(), []);
  const asOf = data?.empty?.status === "pending" ? data.empty.detail.as_of : null;

  return (
    <InsightsPage testId="insights-results" backTo={insightsPaths.stats} title={t("s7.title", lang)} windows={data?.windows}>
      {!data ? <StateBlock error={error} /> : (
        <>
          <MetaLine window={data.window} className="px-1 text-[12.5px] leading-snug text-[#6b7280]" />
          {data.cells.length === 0 || data.empty ? (
            <NoteCard testId="s7-empty">
              {asOf
                ? tx("s7.empty.before_first", lang, { date_short: <DateText iso={asOf} lang={lang} short /> })
                : t("s7.empty.none", lang)}
            </NoteCard>
          ) : (
            data.cells.map((c) => <ResultCell key={`${c.school.school_id}:${c.grade}:${c.language}`} cell={c} />)
          )}
        </>
      )}
    </InsightsPage>
  );
}

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
    <InsightsPage testId="insights-results" backTo={insightsPaths.stats} title={t("s7.title", lang)} windows={data?.windows}
      chips={data ? <MetaLine window={data.window} /> : null}>
      {!data ? <StateBlock error={error} /> : (
        <>
          {data.cells.length === 0 || data.empty ? (
            <NoteCard testId="s7-empty" tone={asOf ? "info" : "neutral"}>
              {asOf
                ? tx("s7.empty.before_first", lang, { date_short: <DateText iso={asOf} lang={lang} short /> })
                : t("s7.empty.none", lang)}
            </NoteCard>
          ) : (
            // R6 (bd-sex15q.46, SCREENS S7): flat white tiles in a grid; one column at 390 (a cell's send sentence is too
            // wide for half a phone), two from md
            <div data-testid="s7-grid" className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {data.cells.map((c) => <ResultCell key={`${c.school.school_id}:${c.grade}:${c.language}`} cell={c} />)}
            </div>
          )}
        </>
      )}
    </InsightsPage>
  );
}

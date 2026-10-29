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
import type { Home, Results as ResultsData } from "../types";

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
  // R6 fix cycle 2 (FIX_R6 A13, panel 015904): the empty page carries S1's phonics line, so a coach learns what a result
  // will be and when it starts. The home is read beside the results (one request, inside the gate: B7), and an empty page
  // waits for it, so the line never drops in under the card after the first paint; a failed home read just leaves it out.
  // The line is drawn here from COPY, not by importing S1's PhonicsTile: that import split the tile out of S1's chunk,
  // +762 B gz on the coach's first open (FIX_R6 §7.1 byte gate).
  const home = useLoad<Home>(() => coachip.home(), []);
  const empty = !!data && (data.cells.length === 0 || !!data.empty);
  const ready = !!data && (!empty || !!home.data || !!home.error);
  const asOf = data?.empty?.status === "pending" ? data.empty.detail.as_of : null;

  return (
    <InsightsPage testId="insights-results" backTo={insightsPaths.stats} title={t("s7.title", lang)} windows={data?.windows}
      chips={data ? <MetaLine window={data.window} /> : error ? undefined : null}>
      {!data || !ready ? <StateBlock error={error} /> : (
        <>
          {empty ? (
            <>
              <NoteCard testId="s7-empty" tone={asOf ? "info" : "neutral"}>
                {asOf
                  ? tx("s7.empty.before_first", lang, { date_short: <DateText iso={asOf} lang={lang} short /> })
                  : t("s7.empty.none", lang)}
              </NoteCard>
              {home.data && home.data.empty?.status !== "no_scope" && <PhonicsLine phonics={home.data.phonics} />}
            </>
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

/**
 * A13: S1's phonics line on S7's empty page, the same words and markup as PhonicsTile's one-line states (testing: "{read}
 * of 30" is the gate's progress, `data-nonum`; paused: held for a person's check). Once phonics is `ok` its move is a card
 * on S1, so S7 says nothing more.
 */
function PhonicsLine({ phonics }: { phonics: Home["phonics"] }) {
  const lang = useLang();
  if (phonics.status === "ok" && phonics.card) return null;
  const paused = phonics.status === "paused";
  return (
    <section data-testid="s1-phonics" data-status={paused ? "paused" : "testing"} data-section="" className="mt-5 border-t border-cp-hairline pt-5">
      <p data-testid="s1-phonics-line" data-nonum="" className="text-[15px] leading-[1.45] text-cp-ink-2">
        {paused ? t("s1.phonics.paused", lang) : t("s1.phonics.line", lang, { read: phonics.read })}
      </p>
    </section>
  );
}

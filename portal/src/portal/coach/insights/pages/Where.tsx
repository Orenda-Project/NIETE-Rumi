import { useParams } from "react-router-dom";
import { useLang } from "../../../teacher/i18n";
import InsightsGate from "../InsightsGate";
import { coachip } from "../api";
import { useLoad } from "../useLoad";
import { InsightsPage, MetaLine } from "../components/Frame";
import { StateBlock } from "../components/StateBlock";
import SchoolRow from "../components/SchoolRow";
import { insightsPaths } from "../paths";
import { pick, t, tx } from "../text";
import type { WDetail } from "../types";

/**
 * bd-sex15q.15 — S3, where it shows (G5): `/w/:wId/where`, the same `GET /coachip/w/:wId` as S2. Every school the
 * server lists, in the order it sent them (next visit, then name; never re-sorted, never by a count), each a SchoolRow;
 * under the list, how many schools do not show this. The read sits inside the gate (B7).
 */
export default function Where() {
  return (
    <InsightsGate>
      <WhereBody />
    </InsightsGate>
  );
}

function WhereBody() {
  const { wId = "" } = useParams();
  const lang = useLang();
  const { data, error } = useLoad<WDetail>(() => coachip.w(wId), [wId]);
  return (
    <InsightsPage
      testId="insights-where"
      backTo={insightsPaths.w(wId)}
      title={t("s3.title", lang)}
      crumb={data ? pick(data.card.short_name, lang) : error ? undefined : null}
      windows={data?.windows}
      chips={data ? <MetaLine window={data.card.window} /> : error ? undefined : null}
    >
      {!data ? <StateBlock error={error} /> : (
        <div className="flex flex-col lg:max-w-[560px]">
          {/* R6 (bd-sex15q.46): hairline rows on the ground, the window line in the app bar (SCREENS S3) */}
          <ul data-testid="where-list" className="flex flex-col">
            {data.schools.map((s) => <SchoolRow key={s.school.school_id} s={s} />)}
          </ul>
          {/* fix-r5 s2 item 3 (B10, design-qa 073628 §2): at n = 0 there is nothing to say, so no zero sentence */}
          {data.schools_not_showing.n > 0 && (
            <p data-testid="where-not-showing" className="border-t border-cp-hairline pt-4 text-[13px] leading-[1.45] text-cp-ink-3">
              {tx("s3.not_showing", lang, {}, [{ n: "n", d: "d", count: data.schools_not_showing }])}
            </p>
          )}
        </div>
      )}
    </InsightsPage>
  );
}

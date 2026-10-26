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
      crumb={data ? pick(data.card.short_name, lang) : null}
      windows={data?.windows}
    >
      {!data ? <StateBlock error={error} /> : (
        <div className="flex flex-col gap-3">
          <MetaLine window={data.card.window} className="px-1 text-[12.5px] leading-snug text-[#6b7280]" />
          <ul className="flex flex-col gap-3">
            {data.schools.map((s) => <SchoolRow key={s.school.school_id} s={s} />)}
          </ul>
          <p data-testid="where-not-showing" className="px-1 text-[13.5px] text-[#6b7280]">
            {tx("s3.not_showing", lang, {}, [{ n: "n", d: "d", count: data.schools_not_showing }])}
          </p>
        </div>
      )}
    </InsightsPage>
  );
}

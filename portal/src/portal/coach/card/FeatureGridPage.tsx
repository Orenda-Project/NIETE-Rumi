import { useLocation, useParams } from "react-router-dom";
import { PageChip } from "../../teacher/TeacherPage";
import { useCopy } from "../../teacher/i18n";
import { Loading } from "../ui";
import PeopleFrame, { LoadFailed } from "../people/PeopleFrame";
import { SCHOOL_CARD } from "./copy";
import { card } from "./api";
import { CardOnly, useCardLoad } from "./frame";
import { aheadLine, bucketLabels, perDayLine, perDayOf, usePeriod, withPeriod } from "./period";
import { CARD_FEATURES, FEATURE_OF, PeriodChips, TeacherGrid } from "./parts";
import ScoresByTeacher from "./ScoresByTeacher";
import type { CardFeature, FeatureGridData } from "./types";

/**
 * One feature of a school by teacher ("Lesson plans by teacher"): a column per school day (This week) or per week (This
 * month), only the totals for Today. The School row adds each column up; teachers with nothing stay in, grey, at the
 * bottom; days still ahead are dashed. A row opens HER list of this feature (HerItemsPage: her lesson plans, her
 * assessments, her training courses and modules), and its Back returns here (bd-dgfkgs.1). Digital Coaching and Coach
 * observations are scores, not counts: their address (feature dc | coach) opens ScoresByTeacher.
 */
function FeatureGrid() {
  const C = useCopy(SCHOOL_CARD);
  const { emis = "", feature: raw = "" } = useParams();
  const feature = (CARD_FEATURES as readonly string[]).includes(raw) ? (raw as CardFeature) : null;
  const [period] = usePeriod();
  const from = (useLocation().state || {}) as { schoolName?: string };
  const { data, failed, reload } = useCardLoad<FeatureGridData | null>(
    () => (feature ? card.grid(emis, feature, period) : Promise.reject(new Error("unknown feature"))), [emis, feature, period]);

  const school = `/portal/coach/school/${encodeURIComponent(emis)}`;
  const here = withPeriod(`${school}/feature/${raw}`, period);
  const title = feature ? C.byTeacher[feature] : C.dash;
  const columns = data ? bucketLabels(period, data.period.buckets, C) : [];
  const future = data ? data.period.buckets.map((b) => b.future) : [];
  const makers = data ? data.rows.filter((r) => r.total > 0).length : null;
  const ahead = data ? aheadLine(period, data.period.buckets, C) : null;
  const rate = data ? perDayLine(period, perDayOf(data.total, data.period.schoolDaysSoFar), data.total, C) : null;

  return (
    <PeopleFrame title={title} crumb={from.schoolName || undefined} backTo={withPeriod(school, period)} feature={feature ? FEATURE_OF[feature] : "schools"}>
      <PeriodChips />
      {failed && <LoadFailed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {data && feature && (
        <>
          <div data-testid="grid-summary" className="flex flex-wrap gap-2 px-1">
            <PageChip>{`${data.total} ${C.tileLabel[feature](data.total)}`}</PageChip>
            {makers != null && <PageChip>{C.byN(makers, data.rows.length)}</PageChip>}
            {rate && <PageChip>{rate}</PageChip>}
          </div>
          <TeacherGrid feature={feature} columns={columns} future={future} school={data.school} total={data.total}
            rows={data.rows.map((r) => ({ key: r.teacherExtId, name: r.name, cells: r.cells, total: r.total }))}
            linkOf={(ext) => (ext ? withPeriod(`/portal/coach/teacher/${encodeURIComponent(ext)}/items/${feature}`, period) : null)}
            stateOf={(_, name) => ({ teacherName: name, back: here })}
            schoolWord={C.schoolRow} totalWord={C.total} />
          {ahead && <p data-testid="grid-ahead" className="m-0 mx-1 -mt-1 text-[14px] leading-[1.4] text-[#6b7280] rtl:leading-[1.8]">{ahead}</p>}
        </>
      )}
    </PeopleFrame>
  );
}

function FeatureOrScores() {
  const { emis = "", feature = "" } = useParams();
  if (feature === "dc" || feature === "coach") return <ScoresByTeacher emis={emis} kind={feature} />;
  return <FeatureGrid />;
}

export default function FeatureGridPage() {
  return <CardOnly><FeatureOrScores /></CardOnly>;
}

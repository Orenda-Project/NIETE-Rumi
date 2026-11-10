import { useLocation, useParams } from "react-router-dom";
import { useCopy } from "../../teacher/i18n";
import { Loading } from "../ui";
import PeopleFrame, { LoadFailed } from "../people/PeopleFrame";
import { SCHOOL_CARD } from "./copy";
import { card } from "./api";
import { CardOnly, useCardLoad } from "./frame";
import { aheadLine, bucketLabels, usePeriod, withPeriod } from "./period";
import { Bars, CARD_FEATURES, FEATURE_OF, PeriodChips, TeacherGrid } from "./parts";
import { ByTeacherHead, DetailsTop, oneDecimal } from "./schoolView";
import { FEATURE_HUE } from "../../teacher/icons/features";
import ScoresByTeacher from "./ScoresByTeacher";
import { TrainingByTeacher } from "./training";
import { useLevel, withLevel } from "../people/level";
import type { CardFeature, FeatureGridData, TrainingByTeacherData } from "./types";

/**
 * One feature of a school by teacher ("Lesson plans by teacher"), opened from its box on the School card. bd-17v39c.4.13:
 * it opens with the box's numbers (the total, per teacher per school day for lesson plans, the same days before, by N of
 * M) and the day bars that used to sit on the card, then "By teacher": a column per school day (This week) or per week (This
 * month), only the totals for Today. The School row adds each column up; teachers with nothing stay in, grey, at the
 * bottom; days still ahead are dashed. A row opens HER list of this feature (HerItemsPage: her lesson plans, her
 * assessments; Training by teacher is its own page, TrainingGrid, bd-hl4a4y), and its Back returns here (bd-dgfkgs.1). Digital Coaching and Coach
 * observations are scores, not counts: their address (feature dc | coach) opens ScoresByTeacher.
 */
function FeatureGrid() {
  const C = useCopy(SCHOOL_CARD);
  const { emis = "", feature: raw = "" } = useParams();
  const feature = (CARD_FEATURES as readonly string[]).includes(raw) ? (raw as CardFeature) : null;
  const [period] = usePeriod();
  // bd-ewbzns.1 — opened from a school's card for one teaching level: that level's teachers, and Back keeps it.
  const [level] = useLevel();
  const from = (useLocation().state || {}) as { schoolName?: string };
  const { data, failed, reload } = useCardLoad<FeatureGridData | null>(
    () => (feature ? card.grid(emis, feature, period, level) as Promise<FeatureGridData> : Promise.reject(new Error("unknown feature"))),
    [emis, feature, period, level]);

  const school = `/portal/coach/school/${encodeURIComponent(emis)}`;
  const here = withLevel(withPeriod(`${school}/feature/${raw}`, period), level);
  const title = feature ? C.byTeacher[feature] : C.dash;
  const columns = data ? bucketLabels(period, data.period.buckets, C) : [];
  const future = data ? data.period.buckets.map((b) => b.future) : [];
  const makers = data ? (data.makers ?? data.rows.filter((r) => r.total > 0).length) : null;
  const ahead = data ? aheadLine(period, data.period.buckets, C) : null;
  const rate = feature === "lp" ? oneDecimal(data?.perTeacherDay) : null;
  const before = feature === "lp" ? oneDecimal(data?.prev?.perTeacherDay) : data?.prev ? String(data.prev.total) : null;

  return (
    <PeopleFrame title={title} crumb={from.schoolName || undefined} backTo={withLevel(withPeriod(school, period), level)} feature={feature ? FEATURE_OF[feature] : "schools"}>
      <PeriodChips />
      {failed && <LoadFailed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {data && feature && (
        <>
          <DetailsTop feature={feature} total={data.total} word={C.tileLabel[feature](data.total)}
            empty={data.total === 0 && (feature === "lp" || feature === "papers") ? C.noneYet[feature][period] : null}
            pills={[
              rate ? C.perTeacherDay[period](rate) : null,
              before ? C.rateBeforeLine[period](before) : null,
              data.total > 0 && makers != null ? C.byN(makers, data.teachers ?? data.rows.length) : null,
            ]}
            chart={period !== "today" && columns.length
              ? <Bars values={data.school} labels={columns} future={future} colour={FEATURE_HUE[FEATURE_OF[feature]].fg} testId={`bars-${feature}`} />
              : undefined} />
          <ByTeacherHead sub={C.mostFirst[feature === "papers" ? "papers" : "lp"]} />
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

/**
 * bd-hl4a4y — Training by teacher: each teacher's trainings with her progress. bd-17v39c.4.13: counted in modules, one
 * way everywhere: the box's number on top (modules completed in the period, by N of M, the same days before), so the
 * period chips are back; then each teacher's "N of M modules completed" and how many in the period. No day bars:
 * modules are counted, not charted by day (mockups v3).
 */
function TrainingGrid({ emis }: { emis: string }) {
  const C = useCopy(SCHOOL_CARD);
  const [period] = usePeriod();
  const [level] = useLevel();
  const from = (useLocation().state || {}) as { schoolName?: string };
  const { data, failed, reload } = useCardLoad<TrainingByTeacherData>(
    () => card.grid(emis, "training", period, level) as Promise<TrainingByTeacherData>, [emis, period, level]);
  const school = `/portal/coach/school/${encodeURIComponent(emis)}`;
  const here = withLevel(withPeriod(`${school}/feature/training`, period), level);
  return (
    <PeopleFrame title={C.byTeacher.training} crumb={from.schoolName || undefined} backTo={withLevel(withPeriod(school, period), level)} feature={FEATURE_OF.training}>
      <PeriodChips />
      {failed && <LoadFailed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {data && data.total != null && (
        <DetailsTop feature="training" total={data.total} word={C.tileLabel.training(data.total)}
          empty={data.total === 0 ? C.noneYet.training[period] : null}
          pills={[
            data.total > 0 && data.makers != null ? C.byN(data.makers, data.teachers ?? data.rows.length) : null,
            data.prev ? C.rateBeforeLine[period](String(data.prev.total)) : null,
          ]} />
      )}
      {data && <ByTeacherHead sub={C.mostFirst.training} />}
      {data && (
        <TrainingByTeacher rows={data.rows} period={period}
          linkOf={(ext) => (ext ? withPeriod(`/portal/coach/teacher/${encodeURIComponent(ext)}/items/training`, period) : null)}
          stateOf={(_, name) => ({ teacherName: name, back: here })} />
      )}
    </PeopleFrame>
  );
}

function FeatureOrScores() {
  const { emis = "", feature = "" } = useParams();
  if (feature === "dc" || feature === "coach") return <ScoresByTeacher emis={emis} kind={feature} />;
  if (feature === "training") return <TrainingGrid emis={emis} />;
  return <FeatureGrid />;
}

export default function FeatureGridPage() {
  return <CardOnly><FeatureOrScores /></CardOnly>;
}

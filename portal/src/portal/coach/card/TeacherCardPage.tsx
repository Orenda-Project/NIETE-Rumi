import { useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronRight, Lock, Pencil } from "lucide-react";
import { useCopy } from "../../teacher/i18n";
import { FEATURE_HUE } from "../../teacher/icons/features";
import { Card, Loading } from "../ui";
import { PEOPLE } from "../people/copy";
import PeopleFrame, { LoadFailed } from "../people/PeopleFrame";
import { EmptyRow } from "../people/rows";
import { SCHOOL_CARD } from "./copy";
import { card } from "./api";
import { useCardLoad } from "./frame";
import { bucketLabels, usePeriod, withPeriod } from "./period";
import { Bars, ChangePill, FEATURE_OF, NumTile, PeriodChips, ScoreChart } from "./parts";
import type { ItemsFeature, TeacherCardData } from "./types";

/**
 * A teacher (the switch on): the period chips, then her tiles for the period. Lesson plans, Papers made, DC observations,
 * Coach observations and Training parts each carry her count (and her own small bars for a week or a month) and open her
 * list of them; the AI score, the Coach score and the days with any NIETE use are flat information. Then the score chart
 * (each AI-score dot opens its DC report) and "Her coaching reports", which only the coach sees.
 */
export default function TeacherCardPage() {
  const C = useCopy(SCHOOL_CARD);
  const P = useCopy(PEOPLE);
  const { ext = "" } = useParams();
  const [period] = usePeriod();
  const { data, failed, reload } = useCardLoad<TeacherCardData>(() => card.teacher(ext, period), [ext, period]);
  const known = useRef<TeacherCardData["teacher"] | null>(null);
  if (data?.teacher) known.current = data.teacher;
  const t = data?.teacher ?? known.current;

  const me = `/portal/coach/teacher/${encodeURIComponent(ext)}`;
  const state = t ? { teacherName: t.name } : undefined;
  const labels = data ? bucketLabels(period, data.period.buckets, C).map(([a]) => [a, ""] as [string, string]) : [];
  const future = data ? data.period.buckets.map((b) => b.future) : [];
  const mini = (f: ItemsFeature, series: readonly (number | null)[] | undefined) =>
    period !== "today" && series && labels.length
      ? <Bars mini values={series} labels={labels} future={future} colour={FEATURE_HUE[FEATURE_OF[f]].fg} testId={`mini-${f}`} />
      : undefined;
  const list = (f: ItemsFeature) => withPeriod(`${me}/items/${f}`, period);
  const v = (n: number | null | undefined) => (n == null ? C.dash : n.toLocaleString("en-US"));
  const tiles = data?.tiles;
  const delta = (s: { avg: number | null; prevAvg: number | null } | undefined) =>
    s && s.avg != null && s.prevAvg != null ? Math.round(s.avg) - Math.round(s.prevAvg) : null;

  return (
    <PeopleFrame title={t?.name || C.dash} crumb={t?.school || undefined} feature="schools"
      backTo={t?.emis ? withPeriod(`/portal/coach/school/${encodeURIComponent(t.emis)}`, period) : "/portal/coach/people"}
      action={t?.teacherExtId ? (
        <Link to={`/portal/coach/teacher/${encodeURIComponent(t.teacherExtId)}/edit`}
          className="flex min-h-[56px] min-w-[56px] shrink-0 items-center justify-center gap-1.5 rounded-xl border border-[#e5e7eb] bg-white px-3.5 text-sm font-semibold text-[#33374a]">
          <Pencil className="h-4 w-4" aria-hidden="true" />{P.edit}
        </Link>
      ) : undefined}>
      <PeriodChips />
      {failed && <LoadFailed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {data && tiles && (
        <>
          <div data-testid="teacher-tiles" className="[display:grid] grid-cols-2 gap-2.5">
            <NumTile testId="t-lp" feature="lessons" value={v(tiles.lp?.count)} label={C.tiles.lp} bars={mini("lp", tiles.lp?.series)} to={list("lp")} state={state} />
            <NumTile testId="t-papers" feature="assessment" value={v(tiles.papers?.count)} label={C.tiles.papers} bars={mini("papers", tiles.papers?.series)} to={list("papers")} state={state} />
            <NumTile testId="t-dc" feature="coaching" value={v(tiles.dc?.count)} label={C.tiles.dc} bars={mini("dc", tiles.dc?.series)} to={list("dc")} state={state} />
            <NumTile testId="t-ai" flat value={C.pct(tiles.aiScore?.avg ?? null)} label={C.aiScore}
              extra={<ChangePill delta={delta(tiles.aiScore)} same={C.same} />} />
            <NumTile testId="t-coach" feature="observations" value={v(tiles.coach?.count)} label={C.tiles.coach} to={list("coach")} state={state} />
            <NumTile testId="t-coach-score" flat value={C.pct(tiles.coachScore?.avg ?? null)} label={C.coachScore}
              extra={<ChangePill delta={delta(tiles.coachScore)} same={C.same} />} />
            <NumTile testId="t-days" flat value={v(tiles.days?.withUse)} label={C.daysWithUse}
              sub={tiles.days?.schoolDays != null ? C.ofSchoolDays(tiles.days.schoolDays) : undefined} />
            <NumTile testId="t-training" feature="training" value={v(tiles.training?.parts)} label={C.tiles.training}
              sub={tiles.training?.courses != null ? C.coursesDone(tiles.training.courses) : undefined}
              bars={mini("training", tiles.training?.series)} to={list("training")} state={state} />
          </div>

          <Card className="flex flex-col gap-2 p-4">
            <span className="text-[17px] font-light text-[#4b5563]">{C.scores}</span>
            {data.chart.some((p) => typeof p.score === "number")
              ? (
                <>
                  <ScoreChart points={data.chart} label={C.scores} aiWord={C.aiScore} coachWord={C.coachScore}
                    dateLabel={(iso) => { const [, m, d] = iso.slice(0, 10).split("-").map(Number); return C.dayMonth(d, C.months[m - 1]); }}
                    linkOf={(id) => `/portal/coach/session/${encodeURIComponent(id)}`} />
                  {data.chart.some((p) => p.kind === "dc" && typeof p.score === "number") && (
                    <span className="flex items-center gap-1.5 text-[14px] font-semibold text-[#4b5563]">
                      <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />{C.tapDot}
                    </span>
                  )}
                </>
              )
              : <span data-testid="no-scores" className="text-[15px] font-semibold text-[#6b7280]">{C.noScores}</span>}
          </Card>

          <Link to={withPeriod(`${me}/reports`, period)} state={state} data-testid="her-reports"
            className="flex min-h-[64px] items-center justify-center gap-2.5 rounded-[18px] bg-[#2e7d57] text-[19px] font-semibold text-white rtl:leading-[1.7]">
            {C.herReports}<ChevronRight className="h-6 w-6 rtl:rotate-180" aria-hidden="true" />
          </Link>
          <p className="m-0 -mt-1 flex items-center justify-center gap-1.5 text-[13px] font-semibold text-[#6b7280]">
            <Lock className="h-4 w-4" aria-hidden="true" />{C.onlyYou}
          </p>
        </>
      )}
      {data && !tiles && <EmptyRow icon={<span>·</span>}>{C.dash}</EmptyRow>}
    </PeopleFrame>
  );
}

import { useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronRight, Pencil } from "lucide-react";
import { useCopy } from "../../teacher/i18n";
import { FEATURE_HUE } from "../../teacher/icons/features";
import { Loading } from "../ui";
import { PEOPLE } from "../people/copy";
import PeopleFrame, { LoadFailed } from "../people/PeopleFrame";
import { EmptyRow } from "../people/rows";
import { SCHOOL_CARD } from "./copy";
import { card } from "./api";
import { useCardLoad } from "./frame";
import { bucketLabels, usePeriod, withPeriod } from "./period";
import { Bars, CoachingLines, FEATURE_OF, NumTile, PeriodChips, ScoreChart, chartDate } from "./parts";
import type { ItemsFeature, TeacherCardData } from "./types";

/**
 * A teacher (the switch on): the period chips, then her tiles for the period. Lesson plans, Papers made and Training parts
 * each carry her count (and her own small bars for a week or a month) and open her list of them; the days with any NIETE
 * use are flat information. Between them, ONE wide Observations card: her Digital Coaching (count, AI score and its
 * change) and her Coach observations (count, Coach score) on two lines, and the two-series chart. The whole card opens her
 * Observations page (/coaching) for the same period, where her DC reports and coach observations are one list.
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
        <div data-testid="teacher-tiles" className="[display:grid] grid-cols-2 gap-2.5">
          <NumTile testId="t-lp" feature="lessons" value={v(tiles.lp?.count)} label={C.tiles.lp} bars={mini("lp", tiles.lp?.series)} to={list("lp")} state={state} />
          <NumTile testId="t-papers" feature="assessment" value={v(tiles.papers?.count)} label={C.tiles.papers} bars={mini("papers", tiles.papers?.series)} to={list("papers")} state={state} />

          {/* ONE Observations card: her DC observations and coach observations, their scores and the chart; it opens her Observations page. */}
          <Link to={withPeriod(`${me}/coaching`, period)} state={state} data-testid="coaching-card"
            className="col-span-2 flex flex-col gap-2.5 rounded-[20px] border border-[#e5e7eb] bg-white p-3.5 text-[#1d2025] shadow-[0_1px_2px_rgba(16,24,40,0.05)] transition-colors hover:bg-[#f9fafb] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#f59e0b]">
            <span className="flex min-h-7 items-center gap-2">
              <span data-testid="coaching-title" className="min-w-0 flex-1 text-[19px] font-bold leading-[1.3] rtl:leading-[1.8]">{C.observations}</span>
              <ChevronRight className="h-[22px] w-[22px] shrink-0 text-[#9ca3af] rtl:rotate-180" aria-hidden="true" />
            </span>
            <CoachingLines summary={data.summary} />
            {data.chart?.some((p) => typeof p.score === "number")
              ? <ScoreChart points={data.chart} label={C.observations} aiWord={C.aiScore} coachWord={C.coachScore} dateLabel={chartDate(C)} height={118} />
              : <span data-testid="no-scores" className="py-1 text-[15px] font-semibold text-[#6b7280]">{C.noScores}</span>}
          </Link>

          <NumTile testId="t-days" flat value={v(tiles.days?.withUse)} label={C.daysWithUse}
            sub={tiles.days?.schoolDays != null ? C.ofSchoolDays(tiles.days.schoolDays) : undefined} />
          <NumTile testId="t-training" feature="training" value={v(tiles.training?.parts)} label={C.tiles.training}
            sub={tiles.training?.courses != null ? C.coursesDone(tiles.training.courses) : undefined}
            bars={mini("training", tiles.training?.series)} to={list("training")} state={state} />
        </div>
      )}
      {data && !tiles && <EmptyRow icon={<span>·</span>}>{C.dash}</EmptyRow>}
    </PeopleFrame>
  );
}

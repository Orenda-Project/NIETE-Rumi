import { useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { Pencil } from "lucide-react";
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
import { Bars, FEATURE_OF, NumTile, PeriodChips } from "./parts";
import { DaysUsed, ScoreLine } from "./scores";
import type { ItemsFeature, ScoreKind, TeacherCardData } from "./types";

/**
 * A teacher (the switch on; design v9): the period chips, then her tiles. Digital Coaching and Coach observations first,
 * each with her average score, "AI score · N observations" and a small line (a point per day or week with a report, her
 * average dashed); each opens her page of that kind. Then Lesson plans, Assessments and Training parts (her count and her
 * own small bars; each opens her list), and the days she used NIETE (one dot per school day), information only.
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
  const buckets = data?.period.buckets ?? [];
  const labels = data ? bucketLabels(period, buckets, C).map(([a]) => [a, ""] as [string, string]) : [];
  const future = buckets.map((b) => b.future);
  const mini = (f: ItemsFeature, series: readonly (number | null)[] | undefined) =>
    period !== "today" && series && labels.length
      ? <Bars mini values={series} labels={labels} future={future} colour={FEATURE_HUE[FEATURE_OF[f]].fg} testId={`mini-${f}`} />
      : undefined;
  const list = (f: ItemsFeature) => withPeriod(`${me}/items/${f}`, period);
  const v = (n: number | null | undefined) => (n == null ? C.dash : n.toLocaleString("en-US"));
  const tiles = data?.tiles;

  // Her scores per day (week) or per week (month): the mean of her reports in each, from the card's chart.
  const bucketOf = (date: string) => {
    let at = -1;
    buckets.forEach((b, i) => { if (b.date <= date) at = i; });
    return period === "week" ? buckets.findIndex((b) => b.date === date) : at;
  };
  const line = (kind: ScoreKind) => {
    if (!data || period === "today" || !labels.length) return undefined;
    const pts = (data.chart ?? []).filter((p) => p.kind === kind && typeof p.score === "number");
    if (!pts.length) return undefined;
    const values = buckets.map((_, i) => {
      const xs = pts.filter((p) => bucketOf(p.date) === i).map((p) => p.score as number);
      return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
    });
    return <ScoreLine compact kind={kind} values={values} avg={data.summary?.[kind]?.avg ?? null} labels={labels} future={future} />;
  };
  const scoreTile = (kind: ScoreKind) => {
    const sc = data?.summary?.[kind];
    return (
      <NumTile testId={`t-${kind}`} feature={FEATURE_OF[kind]} value={C.pct(sc?.avg ?? null)}
        label={kind === "dc" ? C.digitalCoaching : C.coachObsName}
        sub={`${kind === "dc" ? C.aiScore : C.coachScore} · ${C.obsN(sc?.count ?? 0)}`}
        bars={line(kind)} to={withPeriod(`${me}/${kind === "dc" ? "dc" : "observations"}`, period)} state={state} />
    );
  };

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
          {scoreTile("dc")}
          {scoreTile("coach")}
          <NumTile testId="t-lp" feature="lessons" value={v(tiles.lp?.count)} label={C.tiles.lp} bars={mini("lp", tiles.lp?.series)} to={list("lp")} state={state} />
          <NumTile testId="t-papers" feature="assessment" value={v(tiles.papers?.count)} label={C.tiles.papers} bars={mini("papers", tiles.papers?.series)} to={list("papers")} state={state} />
          <NumTile testId="t-training" feature="training" value={v(tiles.training?.parts)} label={C.tiles.training}
            sub={tiles.training?.courses != null ? C.coursesDone(tiles.training.courses) : undefined}
            bars={mini("training", tiles.training?.series)} to={list("training")} state={state} />
          <DaysUsed period={period} today={data.period.today} from={data.period.from} buckets={buckets}
            used={tiles.days?.used ?? []} withUse={tiles.days?.withUse ?? null} schoolDays={tiles.days?.schoolDays ?? null} />
        </div>
      )}
      {data && !tiles && <EmptyRow icon={<span>·</span>}>{C.dash}</EmptyRow>}
    </PeopleFrame>
  );
}

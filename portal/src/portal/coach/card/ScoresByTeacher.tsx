import { Link, useLocation } from "react-router-dom";
import { ChevronRight, Lock } from "lucide-react";
import { useCopy } from "../../teacher/i18n";
import { Loading } from "../ui";
import PeopleFrame, { LoadFailed } from "../people/PeopleFrame";
import { SCHOOL_CARD } from "./copy";
import { card } from "./api";
import { useCardLoad } from "./frame";
import { usePeriod, withPeriod } from "./period";
import { FEATURE_OF, PeriodChips } from "./parts";
import { ScoreLine, ScoreSummary, kindColour } from "./scores";
import type { SchoolScoresData, ScoreKind } from "./types";

/**
 * Digital Coaching (or Coach observations) by teacher: the school's average and how many, then a row per teacher with her
 * count, a tiny line (one point per report, her average dashed) and her average in the kind's colour. Teachers with none
 * are grey at the bottom (the server sorts by count, then average). A row opens her Digital Coaching (or Coach
 * observations) page for the same period.
 */
const LIST = "overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]";
const COLS = "minmax(0,1fr) 92px 64px 22px";

export default function ScoresByTeacher({ emis, kind }: { emis: string; kind: ScoreKind }) {
  const C = useCopy(SCHOOL_CARD);
  const [period] = usePeriod();
  const from = (useLocation().state || {}) as { schoolName?: string };
  const { data, failed, reload } = useCardLoad<SchoolScoresData>(() => card.schoolScores(emis, kind, period), [emis, kind, period]);
  const school = `/portal/coach/school/${encodeURIComponent(emis)}`;
  const her = (ext: string) => withPeriod(`/portal/coach/teacher/${encodeURIComponent(ext)}/${kind === "dc" ? "dc" : "observations"}`, period);
  const colour = kindColour(kind);

  return (
    <PeopleFrame title={C.byTeacher[kind]} crumb={data?.school?.name || from.schoolName || undefined} backTo={withPeriod(school, period)} feature={FEATURE_OF[kind]}>
      <PeriodChips />
      {failed && <LoadFailed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {data && (
        <>
          <ScoreSummary kind={kind} avg={data.school.avg}
            sub={`${C.obsN(data.school.count)} · ${C.byN(data.school.makers, data.school.teachers)}`} />
          <div data-testid="scores-heads" aria-hidden="true" className="grid items-end gap-2 px-4 text-[13px] font-semibold text-[#6b7280]" style={{ gridTemplateColumns: COLS }}>
            <span>{C.teacherCol}</span><span className="text-center">{C.scoresCol}</span><span className="text-end">{C.averageCol}</span><span />
          </div>
          <section className={LIST}>
            {data.rows.map((r, i) => {
              const none = r.count === 0;
              return (
                <Link key={r.teacherExtId} to={her(r.teacherExtId)} data-testid="score-row" data-none={none ? "1" : undefined}
                  className={`grid min-h-[68px] items-center gap-2 px-4 py-2 transition-colors hover:bg-[#f9fafb] ${i ? "border-t border-[#f0f1f3]" : ""}`}
                  style={{ gridTemplateColumns: COLS }}>
                  <span className="flex min-w-0 flex-col">
                    <span dir="auto" className={`truncate text-[16px] font-semibold leading-[1.3] ${none ? "text-[#9ca3af]" : "text-[#1d2025]"}`}>{r.name}</span>
                    <span className={`text-[13px] font-semibold leading-[1.3] rtl:leading-[1.75] ${none ? "text-[#b6bac2]" : "text-[#6b7280]"}`}>{C.obsN(r.count)}</span>
                  </span>
                  <span className="min-w-0">
                    {r.points.length ? <ScoreLine tiny kind={kind} values={r.points.map((p) => p.score)} avg={r.avg} testId="row-line" /> : null}
                  </span>
                  <b dir="ltr" className="text-end text-[18px] font-bold tabular-nums" style={{ color: r.avg == null ? "#9ca3af" : colour }}>{C.pct(r.avg)}</b>
                  <ChevronRight className="h-[22px] w-[22px] text-[#9ca3af] rtl:rotate-180" aria-hidden="true" />
                </Link>
              );
            })}
          </section>
          <p className="m-0 flex items-center justify-center gap-1.5 text-[13px] font-semibold text-[#6b7280]">
            <Lock className="h-4 w-4" aria-hidden="true" />{C.onlyYou}
          </p>
        </>
      )}
    </PeopleFrame>
  );
}

import { useRef } from "react";
import { useLocation, useParams } from "react-router-dom";
import { Lock } from "lucide-react";
import { useCopy, useLang } from "../../teacher/i18n";
import { Loading, SectionLabel } from "../ui";
import PeopleFrame, { LoadFailed } from "../people/PeopleFrame";
import { EmptyRow } from "../people/rows";
import { SCHOOL_CARD } from "./copy";
import { card } from "./api";
import { CardOnly, useBackTo, useCardLoad } from "./frame";
import { pkDate, usePeriod, withPeriod } from "./period";
import { PeriodChips, chartDate } from "./parts";
import { DetailChart, PracticeSection, ReportRow, ScoreSummary } from "./scores";
import type { ScoreKind, TeacherScoresData } from "./types";

/**
 * Her Digital Coaching page (/teacher/:ext/dc) or her Coach observations page (/teacher/:ext/observations), design v9:
 * the period chips; the summary (her average and its change, how many) with the detailed graph, each point opening its
 * report; "Average by practice", every section and practice averaged across her scored reports, out of the framework's
 * scale; then her reports (or observations), newest first, each opening the coach's view of it. Only a reviewed visit
 * on the FICO form has a Coach score: a field-form visit is listed, never averaged.
 */
const LIST = "overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]";

function TeacherScores() {
  const C = useCopy(SCHOOL_CARD);
  const lang = useLang();
  const { ext = "" } = useParams();
  const kind: ScoreKind = /\/observations\/?$/.test(useLocation().pathname) ? "coach" : "dc";
  const [period] = usePeriod();
  const backTo = useBackTo(withPeriod(`/portal/coach/teacher/${encodeURIComponent(ext)}`, period));
  const { data, failed, reload } = useCardLoad<TeacherScoresData>(() => card.teacherScores(ext, kind, period), [ext, kind, period]);
  const known = useRef<TeacherScoresData["teacher"] | null>(null);
  if (data?.teacher) known.current = data.teacher;
  const t = data?.teacher ?? known.current;
  const today = data?.period?.today ?? pkDate(new Date().toISOString()) ?? undefined;
  const report = (id: string) => withPeriod(`/portal/coach/session/${encodeURIComponent(id)}`, period);
  const scored = data?.series ?? [];
  const max = data?.sections.flatMap((s) => s.indicators)[0]?.scaleMax ?? null;

  return (
    <PeopleFrame title={kind === "dc" ? C.digitalCoaching : C.coachObsName} crumb={t?.name || undefined} feature="schools"
      backTo={backTo}>
      <PeriodChips />
      {failed && <LoadFailed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {data && (
        <>
          <ScoreSummary kind={kind} avg={data.avg} prevAvg={data.prevAvg} sub={C.obsN(data.count)}>
            {scored.length
              ? (
                <>
                  <DetailChart kind={kind} points={scored} avg={data.avg} from={data.period.from} to={data.period.to} linkOf={report} dateLabel={chartDate(C)} />
                  <p className="m-0 text-center text-[13px] font-semibold text-[#6b7280] rtl:leading-[1.8]">{C.tapDot}</p>
                </>
              )
              : data.count > 0 ? <span data-testid="no-scores" className="py-1 text-[15px] font-semibold text-[#6b7280]">{C.noScores}</span> : null}
          </ScoreSummary>

          {data.count === 0 && <EmptyRow icon={<span>·</span>} testId="no-observations">{C.noKind[kind][period]}</EmptyRow>}

          {data.sections.length > 0 && (
            <>
              <div data-testid="practices-head" className="mx-1 mt-1 flex flex-col gap-0.5">
                <h2 className="m-0 text-[22px] font-light leading-[1.25] text-[#1d2025] rtl:leading-[1.8]">{C.byPractice}</h2>
                {max != null && <span className="text-[14px] font-semibold text-[#6b7280] rtl:leading-[1.8]">{C.across[kind](scored.length, max)}</span>}
              </div>
              {data.sections.map((s) => <PracticeSection key={s.code} section={s} reports={scored.length} kind={kind} />)}
            </>
          )}

          {data.reports.length > 0 && (
            <>
              <div data-testid="reports-head"><SectionLabel count={data.reports.length}>{C.herList[kind]}</SectionLabel></div>
              <section className={LIST}>
                {data.reports.map((r, i) => (
                  <ReportRow key={r.id} report={r} kind={kind} today={today} lang={lang} first={i === 0} to={report(r.id)} />
                ))}
              </section>
            </>
          )}

          <p className="m-0 flex items-center justify-center gap-1.5 text-[13px] font-semibold text-[#6b7280]">
            <Lock className="h-4 w-4" aria-hidden="true" />{C.onlyYou}
          </p>
        </>
      )}
    </PeopleFrame>
  );
}

export default function TeacherScoresPage() {
  return <CardOnly><TeacherScores /></CardOnly>;
}

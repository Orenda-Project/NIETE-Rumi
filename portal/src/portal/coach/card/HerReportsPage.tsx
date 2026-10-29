import { Link, useLocation, useParams } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { HistoryList, StatusChip, type HistoryItem } from "../../teacher/ui";
import { useCopy } from "../../teacher/i18n";
import { Loading, SectionLabel } from "../ui";
import PeopleFrame, { LoadFailed } from "../people/PeopleFrame";
import { EmptyRow } from "../people/rows";
import { SCHOOL_CARD } from "./copy";
import { card } from "./api";
import { CardOnly, useCardLoad } from "./frame";
import { dayLabel, pkDate, usePeriod, withPeriod } from "./period";
import { PeriodChips } from "./parts";
import type { ReportsData, SectionScores } from "./types";

/**
 * Her coaching reports in the period, compiled from what her reports already say (no scoring engine): what the Digital
 * Coach told her (each report's next step, newest first, in the words she received), what went well (her last three
 * reports), the scores by report (one row per DC report and per coach visit, marked Coach; B shows "Not scored" when the
 * plan was not assessed), and the coach visits with the step agreed. A DC row opens the coach's view of that report; a
 * coach visit is information only. Numbers are neutral: no flags, no colours for low or high.
 */

const SECTIONS: readonly (keyof SectionScores)[] = ["B", "C", "D", "F"];
const LIST = "overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]";
const COLS = "minmax(0,1fr) 48px repeat(4, 38px) 20px";
const sessionLink = (id: string) => `/portal/coach/session/${encodeURIComponent(id)}`;

function HerReports() {
  const C = useCopy(SCHOOL_CARD);
  const { ext = "" } = useParams();
  const [period] = usePeriod();
  const from = (useLocation().state || {}) as { teacherName?: string };
  const { data, failed, reload } = useCardLoad<ReportsData>(() => card.reports(ext, period), [ext, period]);
  const today = data?.period?.today ?? pkDate(new Date().toISOString()) ?? undefined;

  // A strength or a score row carries no class: it is the same report as a next step, which does.
  const classOf = new Map<string, { grade: string | number | null | undefined; subject: string | null | undefined }>([
    ...(data?.strengths ?? []).filter((s) => s.grade != null || s.subject).map((s) => [s.sessionId, { grade: s.grade, subject: s.subject }] as const),
    ...(data?.nextSteps ?? []).map((n) => [n.sessionId, { grade: n.grade, subject: n.subject }] as const),
  ]);
  const quoteRow = (id: string, date: string, text: string, key = id): HistoryItem => {
    const k = classOf.get(id);
    return {
      id: key, lead: "grade", grade: k?.grade ?? null, subject: k?.subject ?? "", title: `“${text}”`, wrapTitle: true,
      extra: dayLabel(date, today, C), to: sessionLink(id), action: "chevron",
    };
  };
  const nextSteps = [...(data?.nextSteps ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  const strengths = [...(data?.strengths ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  const scores = [...(data?.scores ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  const visits = [...(data?.coachVisits ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  const empty = data && !nextSteps.length && !strengths.length && !scores.length && !visits.length;
  const cell = (v: number | null) => (v == null
    ? <span className="text-center text-[10px] font-semibold leading-[1.15] text-[#6b7280] rtl:leading-[1.5]">{C.notScored}</span>
    : <span dir="ltr" className="text-center font-bold tabular-nums">{Math.round(v)}</span>);

  return (
    <PeopleFrame title={C.herReports} crumb={from.teacherName || undefined} feature="schools"
      backTo={withPeriod(`/portal/coach/teacher/${encodeURIComponent(ext)}`, period)}>
      <PeriodChips />
      {failed && <LoadFailed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {empty && <EmptyRow icon={<span>·</span>} testId="no-reports">{C.noReports[period]}</EmptyRow>}
      {data && !empty && (
        <>
          {nextSteps.length > 0 && (
            <div data-testid="block-next-steps">
              <HistoryList heading={C.dcToldHer} showMore={false} groups={[{ day: "", items: nextSteps.map((n) => quoteRow(n.sessionId, n.date, n.text)) }]} />
            </div>
          )}
          {strengths.length > 0 && (
            <div data-testid="block-strengths">
              <HistoryList heading={C.wentWell} showMore={false} groups={[{ day: "", items: strengths.flatMap((s) => (s.texts?.length ? s.texts : [s.text]).map((t, i) => quoteRow(s.sessionId, s.date, t, `${s.sessionId}-${i}`))) }]} />
            </div>
          )}

          {scores.length > 0 && (
            <>
              <SectionLabel>{C.scoresByReport}</SectionLabel>
              <section data-testid="block-scores" className={LIST}>
                <div className="grid items-center gap-1 border-b border-[#f0f1f3] px-3 py-2.5 text-[12px] font-bold text-[#6b7280]" style={{ gridTemplateColumns: COLS }}>
                  <span>{C.reportCol}</span><span className="text-center">{C.overall}</span>
                  {SECTIONS.map((k) => <span key={k} dir="ltr" className="text-center">{k}</span>)}<span />
                </div>
                {scores.map((r, i) => {
                  const k = classOf.get(r.id);
                  const inner = (
                    <>
                      <span className="flex min-w-0 flex-col items-start gap-[3px]">
                        <b className="whitespace-nowrap text-[14px] font-bold">{dayLabel(r.date, today, C)}</b>
                        {r.kind === "coach"
                          ? <StatusChip text={r.form === "observe2" ? C.fieldForm : C.coachTag} tone="info" />
                          : k?.subject ? <span dir="auto" className="text-[12px] text-[#6b7280]">{k.subject}</span> : null}
                      </span>
                      <span dir="ltr" className="text-center text-[15.5px] font-bold tabular-nums">{C.pct(r.overall)}</span>
                      {SECTIONS.map((s) => <span key={s} className="flex justify-center">{cell(r.sections?.[s] ?? null)}</span>)}
                      {r.kind === "dc" ? <ChevronRight className="h-5 w-5 text-[#9ca3af] rtl:rotate-180" aria-hidden="true" /> : <span />}
                    </>
                  );
                  const cls = `grid min-h-[58px] items-center gap-1 px-3 py-1.5 text-[14px] ${i ? "border-t border-[#f0f1f3]" : ""}`;
                  return r.kind === "dc"
                    ? <Link key={`${r.kind}-${r.id}`} to={sessionLink(r.id)} data-testid="score-row" className={`${cls} hover:bg-[#f9fafb]`} style={{ gridTemplateColumns: COLS }}>{inner}</Link>
                    : <div key={`${r.kind}-${r.id}`} data-testid="score-row-coach" role="group" className={cls} style={{ gridTemplateColumns: COLS }}>{inner}</div>;
                })}
              </section>
              <p data-testid="section-key" className="m-0 mx-1 -mt-1 flex flex-col gap-0.5 text-[12.5px] text-[#6b7280] rtl:leading-[1.9]">
                {SECTIONS.map((k) => <span key={k}>{C.sectionKey(k, C.sectionNames[k])}</span>)}
              </p>
            </>
          )}

          {visits.length > 0 && (
            <>
              <SectionLabel count={visits.length}>{C.coachVisits}</SectionLabel>
              <section data-testid="block-visits" className={LIST}>
                {visits.map((v, i) => (
                  // Information only: the visit's report lives in Observe, which the coach app does not show yet.
                  <div key={v.id} data-testid="visit-row" role="group" className={`flex flex-col gap-2 px-4 py-3 ${i ? "border-t border-[#f0f1f3]" : ""}`}>
                    <span className="flex flex-wrap items-center gap-2">
                      <b className="text-[16px] font-bold">{dayLabel(v.date, today, C)}</b>
                      {v.form === "observe2"
                        ? <StatusChip text={C.fieldForm} tone="info" />
                        : v.score != null && <StatusChip text={C.coachScoreN(Math.round(v.score))} tone="score" />}
                    </span>
                    {v.step && (
                      <span className="flex flex-col gap-0.5 rounded-[10px] bg-[#f4f5f8] px-2.5 py-2">
                        <small className="text-[12px] font-bold text-[#6b7280]">{C.stepAgreed}</small>
                        <span dir="auto" className="text-[14.5px] leading-[1.45] rtl:leading-[1.9]">{v.step}</span>
                      </span>
                    )}
                  </div>
                ))}
              </section>
            </>
          )}
        </>
      )}
    </PeopleFrame>
  );
}

export default function HerReportsPage() {
  return <CardOnly><HerReports /></CardOnly>;
}

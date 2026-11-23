import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { CalendarClock, CalendarPlus, ChevronDown, ChevronUp, Clock, Inbox, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import TeacherPage from "../TeacherPage";
import { HistoryRow, addDays } from "../ui";
import { StatusChip } from "../ui/StatusChip";
import { FOCUS, LIST_CARD } from "../ui/styles";
import { TEACHER_FRAME } from "../copy";
import { TEACHER_UI } from "../ui/copy";
import { useCopy, useLang } from "../i18n";
import { todayLabel } from "../format";
import { teacherPath } from "../routes";
import { LESSONS } from "../lessons/copy";
import { dayName, pkDayOf, pkToday } from "../lessons/days";
import { OBS_HOME } from "../observations/paths";
import { lessonPath } from "../coaching/paths";
import { loadDcHistory, type DcItem } from "../coaching/api";
import { coach } from "../../services/api";
import { Chevron, Failed, Loading, SearchBox, SectionLabel, useLoad } from "../../coach/ui";
import { karachiDay } from "../../coach/time";
import type { CoachReport, CoachVisit } from "../../coach/types";
import { SCHEDULE } from "../../coach/schedule/copy";
import { REPORTS } from "../../coach/reports/copy";
import { SCHOOL_CARD } from "../../coach/card/copy";
import { reportChip } from "../../coach/reports/ReportRows";
import { FLOW_V6 } from "../../coach/flow/copy";
import { BookedRow } from "../../coach/flow/BookedRow";
import { groupBooked, oldestFirst, waitedDays } from "../../coach/flow/model";
import { useFlowV6 } from "../../coach/flow/useCoachFlowV2";
import { trackFlow } from "../../coach/flow/track";
import { PRINCIPAL } from "./copy";
import { PRINCIPAL_V6 } from "./copyV6";
import { PRINCIPAL_MY_OBSERVATIONS, PRINCIPAL_PICK, principalBookedTo, principalObservationPath } from "./observe";

const NEEDS_SHOWN = 2;
const DAYS_AHEAD = 90;

/**
 * bd-o15qnr.28 (queue #204) — the principal's Observe in the coach flow's look (#188's board p7-observe; the coach's own is
 * coach/pages/CoachObserveToday.tsx), behind the v6/v7 switch for a principal on the principal app:
 *
 *   Schedule an observation   the dark button → Pick the teacher ("One of my teachers, or my own lesson"; Pick offers both)
 *   Booked for today          the visits she booked for today, each card opening that teacher's page (record OR upload:
 *                             bd-o15qnr.29); All booked opens IN PLACE (Late, Coming up), as the coach's does, never the old
 *                             My schedule page (the operator 21 Nov ~08:50: "not accessible from any other page")
 *   Needs you                 her observations waiting on her, OLDEST first: two, then See all N opening in place
 *   History                   how many she has made in all → My observations
 *
 * No coach-only roster actions (no Team schedule, no school step, no Cancel). Reads her observations (GET /coach/reports)
 * and her bookings from today to 90 days ahead, late ones too (GET /coach/schedule), both her own.
 */
export function PrincipalObserveV6() {
  const S = useCopy(SCHEDULE);
  const R = useCopy(REPORTS);
  const F = useCopy(FLOW_V6);
  const W = useCopy(PRINCIPAL_V6);
  const Frame = useCopy(TEACHER_FRAME);
  const lang = useLang();
  const today = karachiDay();
  const schedule = useLoad(() => coach.getSchedule({ from: today, to: addDays(today, DAYS_AHEAD) }), [today]);
  const reports = useLoad(() => coach.getReports({ page: 1 }), []);
  const [needsOpen, setNeedsOpen] = useState(false);
  const [bookedOpen, setBookedOpen] = useState(false);
  const g = useMemo(() => groupBooked(schedule.data, today), [schedule.data, today]);
  const more = g.late.length + g.coming.length;
  const waiting = useMemo(() => oldestFirst(reports.data?.waiting), [reports.data]);
  const group = (label: string, testId: string, visits: CoachVisit[], warn = false) => visits.length > 0 && (
    <div data-testid={testId} className="border-t border-[#e5e7eb]">
      <h3 className="m-0 flex items-center gap-2 px-4 pb-1 pt-3 text-[15px] font-semibold text-[#4b5563]">
        {label}<StatusChip text={String(visits.length)} tone={warn ? "waiting" : "info"} />
      </h3>
      {visits.map((v, i) => <BookedRow key={v.id} v={v} today={today} first={i === 0} to={principalBookedTo} />)}
    </div>
  );
  const shownWaiting = needsOpen ? waiting : waiting.slice(0, NEEDS_SHOWN);

  return (
    <TeacherPage feature="observations" title={Frame.coachNav.observe} crumb={todayLabel(new Date(), lang)} backTo={teacherPath("home")}
      testId="principal-observe-v6">
      <div className="flex flex-col gap-2.5">
        <section className="flex flex-col gap-2">
          <Link to={PRINCIPAL_PICK} onClick={() => trackFlow("observe.schedule")}
            className={cn("flex min-h-[56px] items-center justify-center gap-2.5 rounded-2xl bg-[#33374a] px-4 py-2 text-[17px] font-semibold leading-tight text-white rtl:leading-[1.8]", FOCUS)}>
            <CalendarPlus className="h-5 w-5 shrink-0" aria-hidden="true" />{F.scheduleObservation}
          </Link>
          <p className="m-0 text-center text-[14px] text-[#6b7280]">{W.scheduleSub}</p>
        </section>

        <section data-testid="booked-today" className="flex flex-col gap-2">
          <SectionLabel count={schedule.data ? g.today.length : undefined}>{S.bookedToday}</SectionLabel>
          {schedule.failed && <Failed onRetry={schedule.reload} />}
          {!schedule.data && !schedule.failed && <Loading />}
          {schedule.data && (
            <div className={LIST_CARD}>
              {g.today.length === 0 && (
                <div className="flex min-h-[64px] items-center gap-3 px-4 text-[15px] font-semibold text-[#6b7280]">
                  <CalendarClock className="h-5 w-5 shrink-0" aria-hidden="true" />{F.noVisitsToday}
                </div>
              )}
              {g.today.map((v, i) => <BookedRow key={v.id} v={v} today={today} first={i === 0} to={principalBookedTo} />)}
              {bookedOpen && group(S.late, "booked-late", g.late, true)}
              {bookedOpen && group(S.comingUp, "booked-coming", g.coming)}
              {(more > 0 || bookedOpen) && (
                <button type="button" onClick={() => { if (!bookedOpen) trackFlow("observe.booked_open"); setBookedOpen((o) => !o); }} aria-expanded={bookedOpen}
                  className={cn("flex min-h-[56px] w-full items-center gap-2 border-t border-[#e5e7eb] px-4 text-start text-[16px] font-semibold text-[#33374a]", FOCUS)}>
                  {bookedOpen ? (
                    <><span className="flex-1 text-center">{F.hide}</span><ChevronUp className="h-5 w-5" aria-hidden="true" /></>
                  ) : (
                    <>
                      <span className="flex-1">{F.allBooked}</span>
                      {g.late.length > 0 && <StatusChip text={S.lateN(g.late.length)} tone="waiting" />}
                      <span className="text-[14px] font-medium text-[#6b7280]">{F.nMore(more)}</span>
                      <ChevronDown className="h-5 w-5 text-[#6b7280]" aria-hidden="true" />
                    </>
                  )}
                </button>
              )}
            </div>
          )}
        </section>

        <section data-testid="needs-you" className="flex flex-col gap-2">
          <SectionLabel count={reports.data ? waiting.length : undefined} countTone={waiting.length ? "warn" : "info"}>{S.needsYou}</SectionLabel>
          {reports.failed && <Failed onRetry={reports.reload} />}
          {!reports.data && !reports.failed && <Loading />}
          {reports.data && waiting.length === 0 && (
            <div className={cn(LIST_CARD, "flex min-h-[64px] items-center gap-3 px-4 text-[15px] font-semibold text-[#6b7280]")}>
              <Inbox className="h-5 w-5 shrink-0" aria-hidden="true" />{S.nothingWaiting}
            </div>
          )}
          {waiting.length > 0 && (
            <div className={LIST_CARD}>
              {shownWaiting.map((r, i) => (
                <HistoryRow key={r.id} lead="person" first={i === 0} title={r.teacherName || S.dash}
                  extra={S.waitingSince(waitedDays(r, today))} chip={reportChip(r, R)} to={principalObservationPath(r.id)} />
              ))}
              {waiting.length > NEEDS_SHOWN && (
                <button type="button" onClick={() => setNeedsOpen((o) => !o)} aria-expanded={needsOpen}
                  className={cn("flex min-h-[56px] w-full items-center justify-center gap-1 border-t border-[#e5e7eb] text-[15px] font-semibold text-[#33374a]", FOCUS)}>
                  {needsOpen ? S.showFewer : S.seeAllN(waiting.length)}
                  {needsOpen ? <ChevronUp className="h-5 w-5" aria-hidden="true" /> : <ChevronDown className="h-5 w-5" aria-hidden="true" />}
                </button>
              )}
            </div>
          )}
        </section>

        <nav aria-label={S.history} className={cn(LIST_CARD, "mt-1")}>
          <Link to={PRINCIPAL_MY_OBSERVATIONS} className={cn("flex min-h-[60px] items-center gap-3 px-4 text-[16px] font-semibold", FOCUS)}>
            <Clock className="h-5 w-5 shrink-0 text-[#6b7280]" aria-hidden="true" />
            <span className="flex-1">{S.history}</span>
            {reports.data && <span className="text-[14px] font-medium text-[#6b7280]">{S.inAllN(reports.data.all.total)}</span>}
            <Chevron />
          </Link>
        </nav>
      </div>
    </TeacherPage>
  );
}

type DoneItem = { key: string; at: string; report?: CoachReport; lesson?: DcItem };

/**
 * bd-o15qnr.28 (queue #204) — My observations (#188's board p9-observations): every observation she made, and her own
 * lessons, in the coach flow's look. Teacher name finds one teacher's. Then:
 *
 *   Needs you   her observations waiting on her, oldest first: the teacher, the day and where it is ("Report to send")
 *   Analysing   (only when there are some) the ones the Digital Coach is still listening to
 *   Done        the sent ones and her own lessons ("My own lesson"), newest first; "Done", never a score (the
 *               observation's feedback page shows the score)
 *
 * Show more reads the next page of her observations. Behind the v6/v7 switch: off, the page is not there (→ Observe).
 */
export function PrincipalMyObservations() {
  const on = useFlowV6();
  if (on === null) return null;
  if (!on) return <Navigate to={OBS_HOME} replace />;
  return <MyObservations />;
}

function MyObservations() {
  const S = useCopy(SCHEDULE);
  const R = useCopy(REPORTS);
  const W = useCopy(PRINCIPAL_V6);
  const P = useCopy(PRINCIPAL);
  const Card = useCopy(SCHOOL_CARD);
  const U = useCopy(TEACHER_UI);
  const Frame = useCopy(TEACHER_FRAME);
  const { days } = useCopy(LESSONS);
  const today = pkToday();
  const [q, setQ] = useState("");
  const [pages, setPages] = useState<CoachReport[][]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [more, setMore] = useState(false);
  const [waitingRows, setWaiting] = useState<CoachReport[] | null>(null);
  const own = useLoad(() => loadDcHistory({ range: "all" }), []);

  const loadPage = (page: number) => {
    setFailed(false);
    if (page > 1) setMore(true);
    coach.getReports({ page })
      .then((r) => { setPages((p) => { const n = [...p]; n[page - 1] = r.all.items; return n; }); setTotal(r.all.total); if (page === 1) setWaiting(r.waiting); })
      .catch(() => setFailed(true))
      .finally(() => setMore(false));
  };
  useEffect(() => { loadPage(1); }, []);

  const needle = q.trim().toLowerCase();
  const match = (r: CoachReport) => !needle || (r.teacherName || "").toLowerCase().includes(needle);
  const day = (iso: string | null) => { const d = pkDayOf(iso); return d ? dayName(d, today, days) : ""; };
  const items = pages.flat();
  const waitingIds = new Set((waitingRows ?? []).map((r) => r.id));
  const needs = oldestFirst(waitingRows ?? []).filter(match);
  const analysing = items.filter((r) => r.step === "analysing" && !waitingIds.has(r.id)).filter(match);
  const doneReports = items.filter((r) => r.step === "sent" && !waitingIds.has(r.id)).filter(match);

  const reportRow = (r: CoachReport, i: number, done: boolean) => (
    <HistoryRow key={r.id} lead="person" first={i === 0} title={r.teacherName || S.dash}
      extra={[day(r.createdAt), W.rowStep[r.step] ?? W.rowStep.analysing].filter(Boolean).join(" · ")}
      chip={done ? { text: W.done, tone: "done" } : reportChip(r, R)} to={principalObservationPath(r.id)} />
  );
  const done: DoneItem[] = [
    ...doneReports.map((r) => ({ key: r.id, at: r.createdAt || "", report: r })),
    ...(needle ? [] : (own.data?.items ?? []).map((d) => ({ key: `dc-${d.id}`, at: `${d.date}T12:00:00Z`, lesson: d }))),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const doneRow = (x: DoneItem, i: number) => (x.report ? reportRow(x.report, i, true) : x.lesson ? (
    <HistoryRow key={x.key} lead="glyph" glyph={UserRound} first={i === 0} title={P.ownLesson}
      extra={[day(x.at), x.lesson.topic].filter(Boolean).join(" · ")}
      chip={{ text: W.done, tone: "done" }} to={lessonPath(x.lesson.id)} />
  ) : null);
  const loaded = pages.length > 0;
  const canMore = total != null && items.length < total && !needle;

  return (
    <TeacherPage feature="observations" title={W.myObservations} crumb={Frame.coachNav.observe} backTo={OBS_HOME} testId="my-obs">
      <div className="flex flex-col gap-2.5">
        <SearchBox value={q} onChange={setQ} placeholder={Card.teacherName} />
        {failed && !loaded && <Failed onRetry={() => loadPage(1)} />}
        {!loaded && !failed && <Loading />}
        {loaded && needs.length > 0 && (
          <section data-testid="my-obs-needs" className="flex flex-col gap-2">
            <SectionLabel count={needs.length} countTone="warn">{S.needsYou}</SectionLabel>
            <div className={LIST_CARD}>{needs.map((r, i) => reportRow(r, i, false))}</div>
          </section>
        )}
        {loaded && analysing.length > 0 && (
          <section data-testid="my-obs-analysing" className="flex flex-col gap-2">
            <SectionLabel count={analysing.length}>{W.rowStep.analysing}</SectionLabel>
            <div className={LIST_CARD}>{analysing.map((r, i) => reportRow(r, i, false))}</div>
          </section>
        )}
        {loaded && (
          <section data-testid="my-obs-done" className="flex flex-col gap-2">
            <SectionLabel count={done.length}>{W.done}</SectionLabel>
            {done.length > 0 ? (
              <div className={LIST_CARD}>{done.map(doneRow)}</div>
            ) : (
              <div className={cn(LIST_CARD, "flex min-h-[64px] items-center gap-3 px-4 text-[15px] font-semibold text-[#6b7280]")}>
                <Inbox className="h-5 w-5 shrink-0" aria-hidden="true" />{needle ? Card.noMatch : R.noObservations}
              </div>
            )}
          </section>
        )}
        {loaded && canMore && (
          <button type="button" disabled={more} onClick={() => loadPage(pages.length + 1)}
            className={cn("flex min-h-[56px] w-full items-center justify-center gap-1 rounded-2xl border border-[#e5e7eb] bg-white text-[15px] font-semibold text-[#33374a]", FOCUS)}>
            {U.showMore}<ChevronDown className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
        {loaded && failed && <Failed onRetry={() => loadPage(pages.length + 1)} />}
      </div>
    </TeacherPage>
  );
}

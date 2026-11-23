import { useMemo } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, CalendarPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "../../hooks/useAuth";
import TeacherPage from "../TeacherPage";
import { FeatureTile, HistoryRow, HomeGreeting, tileGrid } from "../ui";
import { FeatureMotionProvider } from "../icons";
import { FOCUS, LIST_CARD } from "../ui/styles";
import { TEACHER_FRAME } from "../copy";
import { useCopy, useLang } from "../i18n";
import { fullName, todayLabel } from "../format";
import { teacherPath } from "../routes";
import { coach } from "../../services/api";
import { Chevron, Loading, SectionLabel, useLoad } from "../../coach/ui";
import { karachiDay } from "../../coach/time";
import { SCHEDULE } from "../../coach/schedule/copy";
import { REPORTS } from "../../coach/reports/copy";
import { OBSERVE } from "../../coach/observe/copy";
import { reportChip, ReportSegments } from "../../coach/reports/ReportRows";
import { FLOW_V6 } from "../../coach/flow/copy";
import { BookedRow } from "../../coach/flow/BookedRow";
import { groupBooked, oldestFirst, waitedDays } from "../../coach/flow/model";
import { trackFlow } from "../../coach/flow/track";
import { SchoolHomeCard } from "./SchoolHomeCard";
import { PRINCIPAL_MY_OBSERVATIONS, PRINCIPAL_PICK, principalObservationPath, principalBookedTo } from "./observe";

/**
 * bd-o15qnr.28 (queue #204) — the principal's Focus card (#188's board p9-home): the coach's Focus card (coach/flow/
 * FocusCard.tsx) with her own links. ONE slot under the band, the one most important thing:
 *
 *   1 waiting   the observation waiting on her LONGEST: the teacher, the school and how long, its status line, ONE button
 *               naming the next step, and "N more waiting" (→ My observations)
 *   2 booked    the visits she booked for today, each with Record (her record screen for that teacher)
 *   3 nothing   "No visits booked today" and Schedule an observation (→ Pick the teacher)
 *
 * Reads her observations (GET /coach/reports, her own) and today's bookings (GET /coach/schedule, her own); a read that
 * fails shows nothing it cannot back.
 */
export function PrincipalFocus() {
  const S = useCopy(SCHEDULE);
  const R = useCopy(REPORTS);
  const F = useCopy(FLOW_V6);
  const today = karachiDay();
  const reports = useLoad(() => coach.getReports({ page: 1 }), []);
  const schedule = useLoad(() => coach.getSchedule({ from: today, to: today }), [today]);
  const waiting = useMemo(() => oldestFirst(reports.data?.waiting), [reports.data]);
  const g = useMemo(() => groupBooked(schedule.data, today), [schedule.data, today]);
  const big = cn("flex min-h-[56px] items-center justify-center gap-2.5 rounded-2xl bg-[#33374a] px-4 text-[16px] font-semibold leading-tight text-white rtl:leading-[1.8]", FOCUS);

  let body: JSX.Element | null = null;
  if (waiting.length > 0) {
    const r = waiting[0];
    const step = (r.step in F.continueStep ? r.step : "analysing") as keyof typeof F.continueStep;
    body = (
      <section data-testid="focus-waiting" className="flex flex-col gap-2">
        <SectionLabel count={waiting.length} countTone="warn">{R.waitingForYou}</SectionLabel>
        <div className={cn(LIST_CARD, "border-2 border-[#f59e0b]")}>
          <HistoryRow lead="person" first title={r.teacherName || S.dash} action="none" chip={reportChip(r, R)}
            extra={[r.schoolName, S.waitingSince(waitedDays(r, today))].filter(Boolean).join(" · ")} />
          <ReportSegments step={r.step} />
          <div className="px-3 pb-3">
            <Link to={principalObservationPath(r.id)} onClick={() => trackFlow("home.focus")} className={big}>
              {F.continueStep[step]}
            </Link>
          </div>
          {waiting.length > 1 && (
            <Link to={PRINCIPAL_MY_OBSERVATIONS}
              className={cn("flex min-h-[52px] items-center justify-center gap-1 border-t border-[#e5e7eb] text-[15px] font-semibold text-[#33374a]", FOCUS)}>
              {F.moreWaiting(waiting.length - 1)}<Chevron />
            </Link>
          )}
        </div>
      </section>
    );
  } else if ((!reports.data && !reports.failed) || (!schedule.data && !schedule.failed)) {
    body = <Loading />;
  } else if (g.today.length > 0) {
    body = (
      <section data-testid="focus-booked" className="flex flex-col gap-2">
        <SectionLabel count={g.today.length}>{S.bookedToday}</SectionLabel>
        <div className={LIST_CARD}>
          {g.today.map((v, i) => <BookedRow key={v.id} v={v} today={today} first={i === 0} to={principalBookedTo} />)}
        </div>
      </section>
    );
  } else if (schedule.data || reports.data) {
    body = (
      <section data-testid="focus-empty" className="flex flex-col gap-2">
        <SectionLabel>{S.today}</SectionLabel>
        <div className={LIST_CARD}>
          <div className="flex min-h-[60px] items-center gap-3 px-4 text-[15px] font-semibold text-[#6b7280]">
            <CalendarClock className="h-5 w-5 shrink-0" aria-hidden="true" />{F.noVisitsToday}
          </div>
          <div className="px-3 pb-3">
            <Link to={PRINCIPAL_PICK} onClick={() => trackFlow("home.focus")} className={big}>
              <CalendarPlus className="h-5 w-5 shrink-0" aria-hidden="true" />{F.scheduleObservation}
            </Link>
          </div>
        </div>
      </section>
    );
  }
  if (!body) return null;
  return <div data-testid="focus-card" className="mt-1">{body}</div>;
}

/**
 * bd-o15qnr.28 (queue #204; the operator 20 Nov ~22:20: "Right now get the portal ready for principal and the coaches
 * both") — the principal's Home in the coach flow's look (#188's board p9-home), behind the v6/v7 switch for a principal
 * on the principal app: the NIETE band (greeting and today's date), the Focus card, her school's card (My school · This
 * week, opening Analytics), then three tiles, the coach Home's compact three per row: Observe (N waiting), Lesson Plans,
 * Training. Attendance, Analytics and the rest stay on their pages (Analytics through My school; the bar's More).
 */
export function PrincipalHomeV6() {
  const C = useCopy(TEACHER_FRAME);
  const B = useCopy(OBSERVE);
  const lang = useLang();
  const { user } = useAuth();
  const reports = useLoad(() => coach.getReports({ page: 1 }), []);
  const waiting = reports.data?.waiting.length ?? null;
  return (
    <TeacherPage
      testId="principal-home-v6"
      hero={(
        <HomeGreeting
          title={C.home.greeting(fullName(user))}
          name={fullName(user)}
          date={todayLabel(new Date(), lang)}
          school={null}
          brand={C.brand}
          logoAlt={C.logoAlt}
          className="rounded-b-[28px] pb-6"
        />
      )}
    >
      <PrincipalFocus />
      <SchoolHomeCard />
      <FeatureMotionProvider>
        <nav aria-label={C.home.features} data-testid="feature-tiles" className={`mt-2 ${tileGrid(true)}`}>
          <FeatureTile feature="observations" label={C.coachNav.observe} to={teacherPath("observations")} compact
            chip={waiting != null ? { text: B.waitingN(waiting), tone: waiting > 0 ? "waiting" : "info" } : null} />
          <FeatureTile feature="lessons" label={C.home.tiles.lessons} to={teacherPath("lessons")} compact />
          <FeatureTile feature="training" label={C.home.tiles.training} to={teacherPath("training")} compact />
        </nav>
      </FeatureMotionProvider>
    </TeacherPage>
  );
}

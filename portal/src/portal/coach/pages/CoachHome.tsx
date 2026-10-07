import { Link } from "react-router-dom";
import { CalendarDays, Check, Eye, GraduationCap, School } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { coach } from "../../services/api";
import { COACH_COPY as C } from "../copy";
import { fullDate, hoursUntil } from "../time";
import { CoachPage, SectionLabel, Chip, IconCircle, TimeTile, RowText, TapRow, Chevron, Loading, Failed, useLoad } from "../ui";
import type { CoachVisit } from "../types";

/**
 * bd-o15qnr — v2 Home (v18 Main): today's visits, the current one expanded with
 * one "Take observation" button (which opens its Visit page, where Record live
 * or Attach is chosen); then one big tile per feature. bd-o15qnr.18: the full
 * date under the greeting ("Wednesday, 7th October"), no pills.
 */

function CurrentVisit({ v }: { v: CoachVisit }) {
  const h = hoursUntil(v.scheduledSlot);
  return (
    <section data-testid="visit-current" className="overflow-hidden rounded-[18px] border-2 border-[#33374a] bg-white shadow-[0_4px_14px_rgba(51,55,74,0.14)]">
      <Link to={`/portal/coach/visit/${v.id}`} className="flex min-h-[88px] items-center gap-3.5 p-3.5">
        <TimeTile slot={v.scheduledSlot} tone="next" size={64} />
        <RowText name={<span className="text-xl">{v.teacherName || C.dash}</span>} sub={v.schoolName} />
        {h != null && h >= 0 && <Chip>{C.inHours(h)}</Chip>}
        <Chevron />
      </Link>
      <div className="px-3 pb-3">
        <Link to={`/portal/coach/visit/${v.id}`}
          className="flex min-h-[64px] items-center gap-2.5 rounded-[14px] border border-[#e5e7eb] bg-[#f9fafb] px-3 text-[15px] font-semibold">
          <IconCircle hue="observe" size={40}><Eye className="h-5 w-5" /></IconCircle>
          <span className="flex-1">{C.takeObservation}</span>
          <Chevron />
        </Link>
      </div>
    </section>
  );
}

function FeatureTile({ to, title, hue, icon, chip }: { to: string; title: string; hue: "scheduling" | "observe" | "schools" | "training"; icon: React.ReactNode; chip?: React.ReactNode }) {
  return (
    <Link to={to} className="flex min-h-[150px] flex-col items-start justify-between gap-3.5 rounded-[18px] border border-[#e5e7eb] bg-white p-4 shadow-[0_1px_3px_rgba(16,24,40,0.08)] hover:bg-[#f9fafb]">
      <IconCircle hue={hue} size={56}>{icon}</IconCircle>
      <span className="flex flex-col items-start gap-1.5">
        <b className="text-lg font-semibold leading-tight">{title}</b>
        {chip}
      </span>
    </Link>
  );
}

const CoachHome = () => {
  const { user } = useAuth();
  const { data, failed, reload } = useLoad(() => coach.getHome(), []);
  const home = data?.home;

  return (
    <CoachPage title={C.greeting(user?.firstName)} subtitle={fullDate()}>
      <SectionLabel count={<span data-testid="todays-visits">{home ? home.today.length : 0}</span>}>{C.todaysVisits}</SectionLabel>
      {failed && <Failed onRetry={reload} />}
      {!home && !failed && <Loading />}
      {home && (
        <div className="flex flex-col gap-2">
          {home.today.map((v) => (v.current ? <CurrentVisit key={v.id} v={v} /> : (
            <TapRow key={v.id} to={`/portal/coach/visit/${v.id}`} muted={v.status === "done"}>
              <TimeTile slot={v.scheduledSlot} tone={v.status === "done" ? "done" : "neutral"} size={52} />
              <RowText name={<span className={v.status === "done" ? "text-[#6b7280]" : ""}>{v.teacherName || C.dash}</span>} sub={v.schoolName} />
              {v.status === "done" && <Chip tone="done"><Check className="h-3.5 w-3.5" aria-hidden="true" />{C.done}</Chip>}
            </TapRow>
          )))}
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3" data-testid="feature-tiles">
        <FeatureTile to="/portal/coach/scheduling" title={C.scheduling} hue="scheduling" icon={<CalendarDays className="h-7 w-7" />}
          chip={home ? <Chip>{C.thisWeekN(home.counts.week)}</Chip> : undefined} />
        <FeatureTile to="/portal/coach/observe" title={C.observe} hue="observe" icon={<Eye className="h-7 w-7" />}
          chip={home ? <Chip tone={home.counts.waiting > 0 ? "warn" : "info"}>{C.waitingN(home.counts.waiting)}</Chip> : undefined} />
        <FeatureTile to="/portal/coach/people" title={C.schoolsAndTeachers} hue="schools" icon={<School className="h-7 w-7" />}
          chip={home ? <Chip>{C.teachersN(home.counts.teachers)}</Chip> : undefined} />
        <FeatureTile to="/portal/training" title={C.training} hue="training" icon={<GraduationCap className="h-7 w-7" />} />
      </div>
    </CoachPage>
  );
};

export default CoachHome;

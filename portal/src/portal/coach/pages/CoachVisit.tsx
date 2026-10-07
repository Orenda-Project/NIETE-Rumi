import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CalendarDays, Clock, MapPin, Phone, User, X } from "lucide-react";
import { coach, leader } from "../../services/api";
import { COACH_COPY as C } from "../copy";
import { CoachPage, Card, SectionLabel, Chip, Initials, Loading, Failed, useLoad, Chevron, formatPhone } from "../ui";
import { formatSlot, hoursUntil, karachiDay } from "../time";
import type { LastVisit } from "../types";

/**
 * bd-o15qnr — one scheduled visit (Take observation, step 2), as the v21 canvas
 * draws it (Visit.dc.html):
 *
 *   header       the crumb and the teacher's name
 *   Observation  one box, no visible title (operator: "Remove the heading
 *                altogether"): Record live and Upload recording as two squares,
 *                then Reschedule and Cancel
 *   Teacher      one card: initials, name and phone; school; time (In N h);
 *                her numbers; the Last visit row; Teacher profile
 *
 * bd-o15qnr.9 — Record live and Upload recording go straight to this visit's own
 * v2 steps (/record, /attach), never to a second Record/Upload choice. Those
 * send with this visit's teacher and school, so portal-observe's markDone ties
 * the session to the schedule entry. Reschedule opens step 3 of New visit;
 * Cancel asks first.
 */

const dayText = (day: string) => new Date(`${day}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

/** Record live: indigo square, a live pulse — a beating core and two rings (still under reduced motion). */
function RecordSquare({ to }: { to: string }) {
  return (
    <Link to={to}
      className="flex min-h-[176px] flex-col items-center justify-center gap-3.5 rounded-[20px] bg-[#33374a] px-3 py-[18px] text-center text-base font-semibold leading-tight text-white shadow-[0_8px_20px_rgba(51,55,74,0.25)]">
      <span className="relative flex h-[84px] w-[84px] items-center justify-center" aria-hidden="true">
        <i data-testid="rec-ring" className="absolute inset-[10px] rounded-full border-[2.5px] border-[rgba(255,77,61,0.6)] motion-safe:animate-coach-rec-ring motion-reduce:opacity-0" />
        <i data-testid="rec-ring" className="absolute inset-[10px] rounded-full border-[2.5px] border-[rgba(255,77,61,0.6)] motion-safe:animate-coach-rec-ring motion-reduce:opacity-0 [animation-delay:0.9s]" />
        <i data-testid="rec-core" className="h-8 w-8 rounded-full bg-[#ff4d3d] shadow-[0_0_0_8px_rgba(255,77,61,0.25)] motion-safe:animate-coach-rec-beat" />
      </span>
      <span>{C.recordLive}</span>
    </Link>
  );
}

/** Upload recording: white square, an indigo arrow in a soft circle that nudges up. */
function UploadSquare({ to }: { to: string }) {
  return (
    <Link to={to}
      className="flex min-h-[176px] flex-col items-center justify-center gap-3.5 rounded-[20px] border border-[#e5e7eb] bg-white px-3 py-[18px] text-center text-base font-semibold leading-tight text-[#1d2025] shadow-[0_1px_3px_rgba(16,24,40,0.08)]">
      <span className="flex h-[84px] w-[84px] items-center justify-center rounded-full bg-[#e8e9f0] text-[#33374a]" aria-hidden="true">
        <svg data-testid="up-arrow" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
          className="motion-safe:animate-coach-up-nudge">
          <path d="M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
        </svg>
      </span>
      <span>{C.attachRecording}</span>
    </Link>
  );
}

function LastVisitRow({ last }: { last: LastVisit }) {
  const date = last.date ? new Date(last.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : C.dash;
  const who = last.byMe ? C.you : (last.observerName || C.dash);
  const step = last.step ? C.reportStep[last.step] : null;
  // bd-o15qnr.19 — the one v2 observation page, portal or WhatsApp.
  const to = last.id ? `/portal/coach/observation/${last.id}` : null;
  const inner = (
    <>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#f3f4f6] text-[13px] font-bold text-[#33374a]">{C.pct(last.score)}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[15px] font-semibold">{C.lastVisitOn(date)}</span>
        <span className="truncate text-[13px] text-[#6b7280]">{C.hitlBy(who)}</span>
      </span>
      {step && <Chip tone={last.step === "sent" ? "done" : last.step === "analysing" ? "info" : "warn"}>{step}</Chip>}
      {to && <Chevron />}
    </>
  );
  const cls = "flex min-h-[68px] items-center gap-3 border-t border-[#e5e7eb] py-2 pe-3.5 ps-4";
  return to
    ? <Link to={to} data-testid="last-visit" className={`${cls} hover:bg-[#f9fafb]`}>{inner}</Link>
    : <div data-testid="last-visit" className={cls}>{inner}</div>;
}

const CoachVisit = () => {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data, failed, reload } = useLoad(() => coach.getVisit(id), [id]);
  const [asking, setAsking] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const visit = data?.visit;
  const teacher = data?.teacher;
  const today = karachiDay(); // bd-o15qnr.23: the day in Pakistan

  const rescheduleLink = () => {
    const qs = new URLSearchParams({
      school: visit?.schoolExtId || "", teacher: visit?.teacherExtId || "", visit: id, slot: visit?.scheduledSlot || "",
    });
    return `/portal/coach/new-visit?${qs.toString()}`;
  };
  const cancel = async () => {
    setCancelling(true);
    try {
      await leader.cancelSchedule(id);
      navigate("/portal/coach/schedule");
    } catch {
      setCancelling(false);
      setAsking(false);
    }
  };

  const isToday = visit?.scheduledFor === today;
  const when = `${formatSlot(visit?.scheduledSlot)} · ${isToday ? C.today : visit?.scheduledFor ? dayText(visit.scheduledFor) : ""}`;
  const h = isToday ? hoursUntil(visit?.scheduledSlot) : null;
  const upcoming = visit?.status === "upcoming";
  const name = visit?.teacherName || teacher?.name || C.dash;
  const phone = formatPhone(teacher?.phone || visit?.teacherExtId);

  return (
    <CoachPage title={name}
      crumb={`${C.takeObservation} · ${visit?.scheduledFor ? dayText(visit.scheduledFor) : ""}`}
      backTo="/portal/coach/observe/pick">
      {failed && <Failed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {visit && (
        <>
          {upcoming && visit.teacherExtId && (
            <section aria-label={C.observation}
              className="mt-1 flex flex-col gap-3 rounded-3xl border border-[#e5e7eb] bg-[#f9fafb] p-3.5 shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
              <div className="grid grid-cols-2 gap-3">
                <RecordSquare to={`/portal/coach/visit/${id}/record`} />
                <UploadSquare to={`/portal/coach/visit/${id}/attach`} />
              </div>
              <div className="flex gap-2.5">
                <Link to={rescheduleLink()}
                  className="flex h-[52px] flex-1 items-center justify-center gap-2 rounded-2xl border border-[#e5e7eb] bg-white text-[15px] font-semibold text-[#1d2025]">
                  <CalendarDays className="h-5 w-5" aria-hidden="true" />{C.reschedule}
                </Link>
                <button type="button" onClick={() => setAsking(true)}
                  className="flex h-[52px] flex-1 items-center justify-center gap-2 rounded-2xl border border-[#e5e7eb] bg-white text-[15px] font-semibold text-[#c8331f]">
                  <X className="h-5 w-5" aria-hidden="true" />{C.cancel}
                </button>
              </div>
            </section>
          )}

          <div className="mt-[10px]"><SectionLabel>{C.teacher}</SectionLabel></div>
          <Card className="overflow-hidden" data-testid="teacher-card">
            <div className="flex items-center gap-3 px-4 py-3.5">
              <Initials name={name} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-lg font-semibold">{name}</span>
                {phone && (
                  <span data-testid="teacher-phone" className="flex items-center gap-1 text-[13px] text-[#6b7280]">
                    <Phone className="h-[13px] w-[13px]" aria-hidden="true" />{phone}
                  </span>
                )}
              </span>
            </div>
            <div className="flex flex-col gap-3 border-t border-[#e5e7eb] px-4 py-3.5">
              <div className="flex items-center gap-2.5 text-[15px] font-medium"><MapPin className="h-5 w-5 shrink-0 text-[#6b7280]" aria-hidden="true" />{visit.schoolName || C.dash}</div>
              <div className="flex items-center gap-2.5 text-[15px] font-medium"><Clock className="h-5 w-5 shrink-0 text-[#6b7280]" aria-hidden="true" /><span className="flex-1">{when}</span>
                {visit.status === "done" ? <Chip tone="done">{C.done}</Chip> : h != null && h >= 0 ? <Chip>{C.inHours(h)}</Chip> : null}</div>
            </div>
            {teacher && (
              <div className="grid grid-cols-3 gap-x-1 gap-y-3 border-t border-[#e5e7eb] px-4 py-3.5" data-testid="visit-stats">
                {[
                  { value: teacher.hitl, label: C.hitl }, { value: teacher.dc, label: C.dc },
                  { value: C.pct(teacher.avgHitl), label: C.avgScore }, { value: C.daysShort(teacher.daysSinceTraining), label: C.trainingCol },
                  // bd-o15qnr.20 — lesson plan engagement, live on sandbox
                  { value: teacher.examsGenerated ?? C.dash, label: C.examsGenerated }, { value: teacher.lpOpened ?? C.dash, label: C.lpOpened },
                ].map((s) => (
                  <span key={s.label} data-stat className="flex flex-col gap-0.5">
                    <b className="text-[22px] font-bold tabular-nums">{s.value}</b>
                    <span className="text-xs text-[#6b7280]">{s.label}</span>
                  </span>
                ))}
              </div>
            )}
            {data?.lastVisit && <LastVisitRow last={data.lastVisit} />}
            {visit.teacherExtId && (
              <Link to={`/portal/coach/teacher/${visit.teacherExtId}`} className="flex min-h-[60px] items-center gap-3 border-t border-[#e5e7eb] py-2 pe-3.5 ps-4 text-[15px] font-semibold">
                <User className="h-5 w-5 text-[#48b078]" aria-hidden="true" /><span className="flex-1">{C.teacherProfile}</span><Chevron />
              </Link>
            )}
          </Card>
        </>
      )}

      {asking && (
        <div className="fixed inset-0 z-50 flex items-end bg-[rgba(17,24,39,0.5)] md:items-center md:justify-center" role="dialog" aria-modal="true" aria-label={C.cancelVisit}>
          <div className="flex w-full flex-col gap-3 rounded-t-3xl bg-white p-4 pb-6 md:max-w-md md:rounded-3xl">
            <h2 className="text-2xl font-light">{C.cancelVisit}</h2>
            <div className="text-[15px] font-semibold">{visit?.teacherName} · {formatSlot(visit?.scheduledSlot)}</div>
            <div className="flex gap-2.5">
              <button type="button" onClick={() => setAsking(false)} className="flex h-14 flex-1 items-center justify-center rounded-2xl border border-[#e5e7eb] bg-white text-base font-semibold">{C.keepVisit}</button>
              <button type="button" onClick={cancel} disabled={cancelling} className="flex h-14 flex-1 items-center justify-center rounded-2xl bg-[#c8331f] text-base font-semibold text-white">{C.cancelVisit}</button>
            </div>
          </div>
        </div>
      )}
    </CoachPage>
  );
};

export default CoachVisit;

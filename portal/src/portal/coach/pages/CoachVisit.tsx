import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CalendarDays, MapPin, User, X } from "lucide-react";
import { useCopy } from "../../teacher/i18n";
import { HistoryRow } from "../../teacher/ui";
import { StatusChip } from "../../teacher/ui/StatusChip";
import { Tray } from "../../teacher/ui/Tray";
import { TimeStamp } from "../../teacher/ui/TimeStamp";
import { coach, leader } from "../../services/api";
import { Card, SectionLabel, Loading, Failed, useLoad, Chevron, formatPhone } from "../ui";
import { hoursUntil, karachiDay } from "../time";
import { OBSERVE } from "../observe/copy";
import { dayMonth, dayShort, daysShort, pct } from "../observe/format";
import ObservePage from "../observe/ObservePage";
import { sendingPath, useSendJob } from "../observe/sender";
import type { LastVisit } from "../types";

/**
 * bd-4404s7.4 — one scheduled visit (Take observation, step 2), on the kit (Blueprint: Coach_Visit):
 *
 *   header       the crumb ("Take observation · Wed 7 Oct") and the teacher's name
 *   Observation  one box, no visible title: Start recording and Upload recording as two squares, then Reschedule and
 *                Cancel visit. While this visit's observation is being SENT the squares give way to a link to it
 *                (a second one would send the visit twice)
 *   Teacher      one card: initials, name and phone; school; time (TimeStamp) with "In 2 h"; her numbers; the Last
 *                visit row; Teacher profile
 *
 * Start recording and Upload recording go straight to this visit's own steps (/record, /attach), which send with this
 * visit's teacher and school, so portal-observe's markDone ties the session to the schedule entry. Reschedule opens
 * step 3 of New visit; Cancel visit asks first (a Tray).
 */

/** Start recording: indigo square, a live pulse — a beating core and two rings (still under reduced motion). */
function RecordSquare({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to}
      className="flex min-h-[176px] flex-col items-center justify-center gap-3.5 rounded-[20px] bg-[#33374a] px-3 py-[18px] text-center text-base font-semibold leading-tight text-white shadow-[0_8px_20px_rgba(51,55,74,0.25)]">
      <span className="relative flex h-[84px] w-[84px] items-center justify-center" aria-hidden="true">
        <i data-testid="rec-ring" className="absolute inset-[10px] rounded-full border-[2.5px] border-[rgba(255,77,61,0.6)] motion-safe:animate-coach-rec-ring motion-reduce:opacity-0" />
        <i data-testid="rec-ring" className="absolute inset-[10px] rounded-full border-[2.5px] border-[rgba(255,77,61,0.6)] motion-safe:animate-coach-rec-ring motion-reduce:opacity-0 [animation-delay:0.9s]" />
        <i data-testid="rec-core" className="h-8 w-8 rounded-full bg-[#ff4d3d] shadow-[0_0_0_8px_rgba(255,77,61,0.25)] motion-safe:animate-coach-rec-beat" />
      </span>
      <span>{label}</span>
    </Link>
  );
}

/** Upload recording: white square, an indigo arrow in a soft circle that nudges up. */
function UploadSquare({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to}
      className="flex min-h-[176px] flex-col items-center justify-center gap-3.5 rounded-[20px] border border-[#e5e7eb] bg-white px-3 py-[18px] text-center text-base font-semibold leading-tight text-[#1d2025] shadow-[0_1px_3px_rgba(16,24,40,0.08)]">
      <span className="flex h-[84px] w-[84px] items-center justify-center rounded-full bg-[#e8e9f0] text-[#33374a]" aria-hidden="true">
        <svg data-testid="up-arrow" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
          className="motion-safe:animate-coach-up-nudge">
          <path d="M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
        </svg>
      </span>
      <span>{label}</span>
    </Link>
  );
}

function LastVisitRow({ last }: { last: LastVisit }) {
  const C = useCopy(OBSERVE);
  const date = dayMonth(last.date, C) || C.dash;
  const who = last.byMe ? C.you : (last.observerName || C.dash);
  const step = last.step ? C.lastStep[last.step] : null;
  // bd-o15qnr.19 — the one v2 observation page, portal or WhatsApp.
  const to = last.id ? `/portal/coach/observation/${last.id}` : undefined;
  return (
    <div data-testid="last-visit-row" className="border-t border-[#e5e7eb]">
      <HistoryRow lead="person" leadText={pct(last.score)} leadLabel={pct(last.score)} title={C.lastVisitOn(date)} extra={C.hitlBy(who)}
        to={to} action={to ? "chevron" : "none"}
        chip={step ? { text: step, tone: last.step === "sent" ? "done" : last.step === "analysing" ? "info" : "waiting" } : null} />
    </div>
  );
}

const CoachVisit = () => {
  const C = useCopy(OBSERVE);
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data, failed, reload } = useLoad(() => coach.getVisit(id), [id]);
  const [asking, setAsking] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const job = useSendJob(id);
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
  const h = isToday ? hoursUntil(visit?.scheduledSlot) : null;
  const upcoming = visit?.status === "upcoming";
  const name = visit?.teacherName || teacher?.name || C.dash;
  const phone = formatPhone(teacher?.phone || visit?.teacherExtId);
  const sendingNow = job?.state === "sending";

  return (
    <ObservePage title={name} feature="observations"
      crumb={`${C.takeObservation} · ${visit?.scheduledFor ? dayShort(visit.scheduledFor, C) : ""}`}
      backTo="/portal/coach/observe/pick">
      {failed && <Failed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {visit && (
        <>
          {upcoming && visit.teacherExtId && (
            <section aria-label={C.observation}
              className="mt-1 flex flex-col gap-3 rounded-3xl border border-[#e5e7eb] bg-[#f9fafb] p-3.5 shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
              {sendingNow ? (
                <Link to={sendingPath(id)} data-testid="sending-link"
                  className="flex min-h-[76px] items-center gap-3 rounded-2xl border border-[#e5e7eb] bg-white p-3 text-[17px] font-semibold">
                  <span className="flex-1">{C.sendingNow} · {job.pct}%</span>
                  <Chevron />
                </Link>
              ) : (
                <div className="[display:grid] grid-cols-2 gap-3">
                  <RecordSquare to={`/portal/coach/visit/${id}/record`} label={C.startRecording} />
                  <UploadSquare to={`/portal/coach/visit/${id}/attach`} label={C.uploadRecording} />
                </div>
              )}
              <div className="flex gap-2.5">
                <Link to={rescheduleLink()}
                  className="flex h-[52px] flex-1 items-center justify-center gap-2 rounded-2xl border border-[#e5e7eb] bg-white text-[15px] font-semibold text-[#1d2025]">
                  <CalendarDays className="h-5 w-5" aria-hidden="true" />{C.reschedule}
                </Link>
                <button type="button" onClick={() => setAsking(true)}
                  className="flex h-[52px] flex-1 items-center justify-center gap-2 rounded-2xl border border-[#e5e7eb] bg-white text-[15px] font-semibold text-[#c8331f]">
                  <X className="h-5 w-5" aria-hidden="true" />{C.cancelVisit}
                </button>
              </div>
            </section>
          )}

          <div className="mt-[10px]"><SectionLabel>{C.teacher}</SectionLabel></div>
          <Card className="overflow-hidden" data-testid="teacher-card">
            <HistoryRow lead="person" title={name} extra={phone || undefined} action="none" />
            <div className="flex flex-col gap-3 border-t border-[#e5e7eb] px-4 py-3.5">
              <div className="flex items-center gap-2.5 text-[15px] font-medium"><MapPin className="h-5 w-5 shrink-0 text-[#6b7280]" aria-hidden="true" />{visit.schoolName || C.dash}</div>
              <div className="flex items-center gap-2.5 text-[15px] font-medium">
                <TimeStamp time={visit.scheduledSlot} tone={visit.status === "done" ? "done" : "next"} size={15} />
                <span className="flex-1">· {isToday ? C.today : visit.scheduledFor ? dayShort(visit.scheduledFor, C) : ""}</span>
                {visit.status === "done" ? <StatusChip text={C.done} tone="done" /> : h != null && h >= 0 ? <StatusChip text={C.inHours(h)} tone="info" /> : null}
              </div>
            </div>
            {teacher && (
              <div className="[display:grid] grid-cols-3 gap-x-1 gap-y-3 border-t border-[#e5e7eb] px-4 py-3.5" data-testid="visit-stats">
                {[
                  { value: teacher.hitl, label: C.hitl }, { value: teacher.dc, label: C.dc },
                  { value: pct(teacher.avgHitl), label: C.avgHitl }, { value: daysShort(teacher.daysSinceTraining), label: C.training },
                  // bd-o15qnr.20 — lesson plan engagement, live on sandbox
                  { value: teacher.examsGenerated ?? C.dash, label: C.papersMade }, { value: teacher.lpOpened ?? C.dash, label: C.lpOpened },
                ].map((st) => (
                  <span key={st.label} data-stat className="flex flex-col gap-0.5">
                    <b className="text-[22px] font-bold tabular-nums">{st.value}</b>
                    <span className="text-xs text-[#6b7280]">{st.label}</span>
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

      <Tray open={asking} title={C.cancelVisit} onClose={() => setAsking(false)}>
        <div className="text-[15px] font-semibold">{visit?.teacherName}{visit?.scheduledSlot ? <> · <TimeStamp time={visit.scheduledSlot} size={15} /></> : null}</div>
        <div className="flex gap-2.5">
          <button type="button" onClick={() => setAsking(false)} className="flex h-14 flex-1 items-center justify-center rounded-2xl border border-[#e5e7eb] bg-white text-base font-semibold">{C.keepVisit}</button>
          <button type="button" onClick={cancel} disabled={cancelling} className="flex h-14 flex-1 items-center justify-center rounded-2xl bg-[#c8331f] text-base font-semibold text-white">{C.cancelVisit}</button>
        </div>
      </Tray>
    </ObservePage>
  );
};

export default CoachVisit;

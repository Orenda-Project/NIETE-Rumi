import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CalendarDays, MapPin, User, X } from "lucide-react";
import { useCopy } from "../../teacher/i18n";
import { HistoryRow, RecordUploadPair, StatStrip } from "../../teacher/ui";
import { StatusChip } from "../../teacher/ui/StatusChip";
import { Tray } from "../../teacher/ui/Tray";
import { TimeStamp } from "../../teacher/ui/TimeStamp";
import { leader } from "../../services/api";
import { Card, SectionLabel, Loading, Failed, useLoad, Chevron, formatPhone } from "../ui";
import { hoursUntil, karachiDay } from "../time";
import { OBSERVE } from "../observe/copy";
import { SCHEDULE } from "../schedule/copy";
import { FROM_OBSERVE } from "../../teacher/menu";
import { dayMonth, dayShort, daysShort, pct } from "../observe/format";
import ObservePage from "../observe/ObservePage";
import { useSendJob } from "../observe/sender";
import { useObserveRoutes } from "../observe/observeRoutes";
import { SCHOOL_CARD } from "../card/copy";
import { PRINCIPAL } from "../../teacher/principal/copy";
import { LESSONS } from "../../teacher/lessons/copy";
import { dayName, pkDayOf, pkToday } from "../../teacher/lessons/days";
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
 *
 * bd-33wxxi.9.3 — the principal app draws this same screen for the teacher she picked (#78; the operator, 10 Nov: the
 * recording screen "needs to look similar to the Coach's flow"). Its visit, links and Back come from the observe routes
 * (coach/observe/observeRoutes; the coach's are exactly the paths above). With no booked visit (visitActions false):
 * no Reschedule / Cancel visit, no Last visit row, no coach Teacher profile; the crumb is "One of my teachers · Today";
 * the Teacher card's second line is when she last observed her, and its numbers are her school card's counts for this
 * week (counts only, never a score, #55 Q1).
 */

function LastVisitRow({ last }: { last: LastVisit }) {
  const C = useCopy(OBSERVE);
  const date = dayMonth(last.date, C) || C.dash;
  const who = last.byMe ? C.you : (last.observerName || C.dash);
  const step = last.step ? C.lastStep[last.step] : null;
  // bd-jjcofw.10 — "Last observation · 14 Sep" was cut before the date at 390 px: the title is the words; the date and
  // who did it go on the line under it.
  // bd-o15qnr.19 — the one v2 observation page, portal or WhatsApp.
  const to = last.id ? `/portal/coach/observation/${last.id}` : undefined;
  return (
    <div data-testid="last-visit-row" className="border-t border-[#e5e7eb]">
      <HistoryRow lead="person" leadText={pct(last.score)} leadLabel={pct(last.score)} title={C.lastObservation} extra={`${date} · ${who}`}
        to={to} action={to ? "chevron" : "none"}
        chip={step ? { text: step, tone: last.step === "sent" ? "done" : last.step === "analysing" ? "info" : "waiting" } : null} />
    </div>
  );
}

const CoachVisit = () => {
  const C = useCopy(OBSERVE);
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const routes = useObserveRoutes();
  const { data, failed, reload } = useLoad(() => (routes.loadVisitPage ?? routes.loadVisit)(id), [id]);
  const [asking, setAsking] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const job = useSendJob(id);
  const visit = data?.visit;
  const teacher = data?.teacher;
  const counts = data?.counts;
  const P = useCopy(PRINCIPAL);
  const SC = useCopy(SCHOOL_CARD);
  const { days } = useCopy(LESSONS);
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
      navigate("/portal/coach/schedule", { replace: true });
    } catch {
      setCancelling(false);
      setAsking(false);
    }
  };

  const isToday = visit?.scheduledFor === today;
  const h = isToday ? hoursUntil(visit?.scheduledSlot) : null;
  // bd-jjcofw.10 (M5) — a visit is her schedule's (crumb My schedule, menu Schedule); opened from Observe's list
  // (?from=observe) it stays Observe's.
  const [params] = useSearchParams();
  const fromObserve = params.get("from") === FROM_OBSERVE;
  const S = useCopy(SCHEDULE);
  const upcoming = visit?.status === "upcoming";
  const name = visit?.teacherName || teacher?.name || C.dash;
  const phone = formatPhone(teacher?.phone || visit?.teacherExtId);
  const sendingNow = job?.state === "sending";
  // The principal's picked teacher: when she last observed her (her own words, as on Pick the teacher).
  const observedDay = data?.lastObservedAt ? pkDayOf(data.lastObservedAt) : null;
  const extra = routes.visitActions ? phone || undefined : observedDay ? P.lastObserved(dayName(observedDay, pkToday(), days)) : P.notObserved;
  const visitDay = isToday ? C.today : visit?.scheduledFor ? dayShort(visit.scheduledFor, C) : "";

  return (
    <ObservePage title={name} feature="observations"
      crumb={routes.visitActions
        ? `${fromObserve ? C.takeObservation : S.mySchedule} · ${visit?.scheduledFor ? dayShort(visit.scheduledFor, C) : ""}`
        : `${P.oneTeacher} · ${visitDay}`}
      backTo={routes.visitBack(fromObserve)}>
      {failed && <Failed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {visit && (
        <>
          {upcoming && visit.teacherExtId && (
            <div role="group" aria-label={C.observation} className="mt-1">
              {sendingNow ? (
                <Link to={routes.sending(id)} data-testid="sending-link"
                  className="flex min-h-[76px] items-center gap-3 rounded-2xl border border-[#e5e7eb] bg-white p-3 text-[17px] font-semibold">
                  <span className="flex-1">{C.sendingNow} · {job.pct}%</span>
                  <Chevron />
                </Link>
              ) : (
                <RecordUploadPair
                  recordTo={routes.record(id)} uploadTo={routes.attach(id)}
                  copy={{ startRecording: C.startRecording, uploadRecording: C.uploadRecording }}
                  actions={routes.visitActions ? [
                    { key: "reschedule", label: C.reschedule, icon: <CalendarDays className="h-5 w-5" aria-hidden="true" />, to: rescheduleLink() },
                    { key: "cancel", label: C.cancelVisit, icon: <X className="h-5 w-5" aria-hidden="true" />, onPress: () => setAsking(true), danger: true },
                  ] : undefined} />
              )}
            </div>
          )}

          <div className="mt-[10px]"><SectionLabel>{C.teacher}</SectionLabel></div>
          <Card className="overflow-hidden" data-testid="teacher-card">
            <HistoryRow lead="person" title={name} extra={extra} action="none" />
            <div className="flex flex-col gap-3 border-t border-[#e5e7eb] px-4 py-3.5">
              <div className="flex items-center gap-2.5 text-[15px] font-medium"><MapPin className="h-5 w-5 shrink-0 text-[#6b7280]" aria-hidden="true" />{visit.schoolName || C.dash}</div>
              <div className="flex items-center gap-2.5 text-[15px] font-medium">
                <TimeStamp time={visit.scheduledSlot} tone={visit.status === "done" ? "done" : "next"} size={15} />
                {/* A picked teacher has no visit time: the day alone, no "·" before it. */}
                <span className="flex-1">{routes.visitActions || visit.scheduledSlot ? "· " : ""}{visitDay}</span>
                {visit.status === "done" ? <StatusChip text={C.done} tone="done" /> : h != null && h >= 0 ? <StatusChip text={C.inHours(h)} tone="info" /> : null}
              </div>
            </div>
            {teacher && (
              <div data-testid="visit-stats">
                <StatStrip items={[
                  { value: teacher.hitl, label: C.hitl }, { value: teacher.dc, label: C.dc },
                  { value: pct(teacher.avgHitl), label: C.avgHitl },
                  { value: daysShort(teacher.daysSinceTraining), label: C.training },
                ]} />
                {/* bd-o15qnr.20 — lesson plan engagement, live on sandbox */}
                <StatStrip items={[{ value: teacher.examsGenerated, label: C.papersMade }, { value: teacher.lpOpened, label: C.lpOpened }]} />
              </div>
            )}
            {/* The principal's picked teacher: this week's counts from her school card (never a score). */}
            {!teacher && counts && (
              <div data-testid="visit-stats">
                <StatStrip items={[
                  { value: counts.lp, label: SC.featureName.lp }, { value: counts.dc, label: SC.digitalCoaching },
                  { value: counts.training, label: SC.featureName.training }, { value: counts.papers, label: SC.featureName.papers },
                ]} />
              </div>
            )}
            {routes.visitActions && data?.lastVisit && <LastVisitRow last={data.lastVisit} />}
            {routes.visitActions && visit.teacherExtId && (
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

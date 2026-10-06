import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CalendarDays, CircleDot, Clock, MapPin, Upload, User, X } from "lucide-react";
import { coach, leader } from "../../services/api";
import { COACH_COPY as C } from "../copy";
import { CoachPage, Card, SectionLabel, Chip, IconCircle, Stats, BottomLink, Loading, Failed, useLoad, Chevron } from "../ui";
import { formatSlot, localDay } from "../time";

/**
 * bd-o15qnr — one scheduled visit (Take observation, step 2): the teacher's
 * numbers, then Record live or Attach recording. Both open the existing
 * observation pipeline with this visit's teacher and school, so the session is
 * tied to the schedule entry (portal-observe markDone stamps session_id); the
 * pipeline's check step asks for her lesson plan and board photos, then sends.
 * Reschedule opens step 3 of New visit; Cancel asks first.
 */

const CoachVisit = () => {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data, failed, reload } = useLoad(() => coach.getVisit(id), [id]);
  const [asking, setAsking] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const visit = data?.visit;
  const teacher = data?.teacher;
  const today = localDay();

  const observeLink = (way: "record" | "upload") => {
    const qs = new URLSearchParams({
      teacher: visit?.teacherExtId || "", school: visit?.schoolExtId || "", way, return: `/portal/coach/visit/${id}`,
    });
    return `/portal/leader/observe/new?${qs.toString()}`;
  };
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

  const when = visit?.scheduledFor === today
    ? `${formatSlot(visit?.scheduledSlot)} · ${C.today}`
    : `${formatSlot(visit?.scheduledSlot)} · ${visit?.scheduledFor ? new Date(`${visit.scheduledFor}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : ""}`;
  const upcoming = visit?.status === "upcoming";

  return (
    <CoachPage title={visit?.teacherName || C.dash}
      crumb={`${C.takeObservation} · ${visit?.scheduledFor ? new Date(`${visit.scheduledFor}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : ""}`}
      backTo="/portal/coach/observe/pick"
      dock={visit && upcoming ? (
        <>
          <BottomLink to={rescheduleLink()} tone="outline"><CalendarDays className="h-5 w-5" aria-hidden="true" />{C.reschedule}</BottomLink>
          <button type="button" onClick={() => setAsking(true)}
            className="flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl border border-[#e5e7eb] bg-white text-base font-semibold text-[#c8331f]">
            <X className="h-5 w-5" aria-hidden="true" />{C.cancel}
          </button>
        </>
      ) : undefined}>
      {failed && <Failed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {visit && (
        <>
          <Card className="overflow-hidden">
            <div className="flex flex-col gap-3 p-4">
              <div className="flex items-center gap-2.5 text-[15px] font-medium"><MapPin className="h-5 w-5 shrink-0 text-[#6b7280]" aria-hidden="true" />{visit.schoolName || C.dash}</div>
              <div className="flex items-center gap-2.5 text-[15px] font-medium"><Clock className="h-5 w-5 shrink-0 text-[#6b7280]" aria-hidden="true" /><span className="flex-1">{when}</span>
                {visit.status === "done" && <Chip tone="done">{C.done}</Chip>}</div>
            </div>
            {teacher && (
              <Stats testId="visit-stats" items={[
                { value: teacher.hitl, label: C.hitl }, { value: teacher.dc, label: C.dc },
                { value: C.pct(teacher.avgHitl), label: C.avg }, { value: C.daysShort(teacher.daysSinceTraining), label: C.trainingCol },
              ]} />
            )}
            {visit.teacherExtId && (
              <Link to={`/portal/coach/teacher/${visit.teacherExtId}`} className="flex min-h-[60px] items-center gap-3 border-t border-[#e5e7eb] px-4 text-[15px] font-semibold">
                <User className="h-5 w-5 text-[#48b078]" aria-hidden="true" /><span className="flex-1">{C.teacherProfile}</span><Chevron />
              </Link>
            )}
          </Card>

          {upcoming && visit.teacherExtId && (
            <>
              <SectionLabel>{C.takeObservation}</SectionLabel>
              <div className="grid grid-cols-2 gap-3">
                <Link to={observeLink("record")} className="flex min-h-[156px] flex-col items-start justify-between gap-4 rounded-2xl border border-[#e5e7eb] bg-white p-4 text-lg font-semibold shadow-[0_1px_3px_rgba(16,24,40,0.08)] hover:bg-[#f9fafb]">
                  <IconCircle hue="observe" size={56}><CircleDot className="h-7 w-7" /></IconCircle>{C.recordLive}
                </Link>
                <Link to={observeLink("upload")} className="flex min-h-[156px] flex-col items-start justify-between gap-4 rounded-2xl border border-[#e5e7eb] bg-white p-4 text-lg font-semibold shadow-[0_1px_3px_rgba(16,24,40,0.08)] hover:bg-[#f9fafb]">
                  <IconCircle hue="green" size={56}><Upload className="h-7 w-7" /></IconCircle>{C.attachRecording}
                </Link>
              </div>
            </>
          )}

          {data?.lastVisit && (
            <>
              <SectionLabel>{C.lastVisit}</SectionLabel>
              <Card className="flex min-h-[80px] items-center gap-3.5 p-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#f3f4f6] text-sm font-bold text-[#33374a]">{C.pct(data.lastVisit.score)}</span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[17px] font-semibold">{data.lastVisit.date ? new Date(data.lastVisit.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : C.dash}</span>
                  <span className="text-[13px] text-[#6b7280]">{C.hitlYou}</span>
                </span>
              </Card>
            </>
          )}
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

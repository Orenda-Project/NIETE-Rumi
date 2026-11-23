import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarClock, CalendarPlus, ChevronDown, ChevronUp, Clock, Inbox, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { coach, leader } from "../../services/api";
import { useCopy, useLang } from "../../teacher/i18n";
import { HistoryRow, addDays } from "../../teacher/ui";
import { useKitCopy } from "../../teacher/ui/useKitCopy";
import { StatusChip } from "../../teacher/ui/StatusChip";
import { FOCUS, LIST_CARD } from "../../teacher/ui/styles";
import { todayLabel } from "../../teacher/format";
import { Chevron, Failed, Loading, SectionLabel, useLoad } from "../ui";
import { karachiDay } from "../time";
import type { CoachReport, CoachVisit } from "../types";
import ObservePage from "../observe/ObservePage";
import { OBSERVE } from "../observe/copy";
import { SCHEDULE } from "../schedule/copy";
import { CancelVisitTray } from "../schedule/CancelVisitTray";
import { REPORTS } from "../reports/copy";
import { classParts, reportChip, reportHref, useCardLine, type ClassWords } from "../reports/ReportRows";
import { pkTime } from "../reports/data";
import { sendingPath, useSendingJobs } from "../observe/sender";
import { trackFlow } from "../flow/track";
import { FLOW_V6 } from "../flow/copy";
import { BookedRow } from "../flow/BookedRow";
import { groupBooked, oldestFirst, waitedDays } from "../flow/model";

/**
 * bd-o15qnr.27 (queue #204, v6; the operator 20 Nov ~13:30: "ok v6 looks good. Lets get this built.") — the coach's ONE
 * Observe screen, behind portal_coach_flow_v2, in the app's own look (#188's canvas, page v6): the kit's page header
 * (Back circle, the feature tile, today's date as the crumb, the 26px light title), kit rows and the app's buttons.
 *
 *   Schedule an observation   the dark button: school → teacher → Schedule for Now / Schedule for Later (New visit)
 *   Needs you                 observations waiting on her, OLDEST first: two, then See all N opening in place
 *   In progress               (bd-o15qnr.45) started, not finished, NOT waiting on her: still going up from this phone
 *                             ("Sending · 62%", opens its Sending page), analysing, the report sending, waiting for the
 *                             teacher; one row each (the teacher, the date and class, the stage chip, the time it
 *                             started), opening the visit. Never a row Needs you has; no section when there is none
 *   Booked for today          today's visits still to do, each with Record; under them All booked (N late · N more),
 *                             which opens IN PLACE: Late and Coming up, every visit with Record / Reschedule and Cancel
 *                             (Cancel asks first), Team schedule, Hide. ?booked=open opens it at once (the Home's link,
 *                             and the old Booked visits address)
 *   History                   her observations (how many in all)
 *
 * The order (bd-o15qnr.45, queue #240; the operator 23 Nov ~19:40: "You can decide in which order"): Needs you first —
 * review before a visit is due — then In progress, Booked for today, History.
 *
 * Not on this screen (the operator on v5): the WhatsApp button ("remove this button. No need once this is live."), and the
 * yellow "N observations need you" bar (Needs you right under the header says the same). Booked is apart from Schedule
 * an observation (round 5: "The 'Booked for Today' should be disconnected from the Start an Observation button").
 *
 * Reads today to 90 days ahead (the server adds every late visit however old) and the first reports page.
 */

const NEEDS_SHOWN = 2;
const DAYS_AHEAD = 90;

const CoachObserveToday = () => {
  const S = useCopy(SCHEDULE);
  const O = useCopy(OBSERVE);
  const R = useCopy(REPORTS);
  const F = useCopy(FLOW_V6);
  const lang = useLang();
  const today = karachiDay();
  const [params] = useSearchParams();
  const schedule = useLoad(() => coach.getSchedule({ from: today, to: addDays(today, DAYS_AHEAD) }), [today]);
  const reports = useLoad(() => coach.getReports({ page: 1 }), []);
  const [bookedOpen, setBookedOpen] = useState(params.get("booked") === "open");
  const [needsOpen, setNeedsOpen] = useState(false);
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [asking, setAsking] = useState<CoachVisit | null>(null);
  const [busy, setBusy] = useState(false);

  const g = useMemo(() => groupBooked(schedule.data, today, gone), [schedule.data, today, gone]);
  const waiting = useMemo(() => oldestFirst(reports.data?.waiting), [reports.data]);
  const more = g.late.length + g.coming.length;
  // bd-o15qnr.45 — In progress: this phone's sends first, then the server's rows; nothing Needs you already shows.
  const line = useCardLine();
  const kit = useKitCopy(); // the upload's words are the strip's own (notify.sending: "Sending · 62%")
  const classWords = O as unknown as ClassWords;
  const uploads = useSendingJobs();
  const going = useMemo(() => {
    const mine = new Set(waiting.map((r) => r.id));
    return (reports.data?.inProgress || []).filter((r) => !mine.has(r.id));
  }, [reports.data, waiting]);
  const goingCount = uploads.length + going.length;
  // A send that has just arrived leaves the list; read the reports again so its server row (Analysing) takes its place.
  const lastUploads = useRef(uploads.length);
  const reloadReports = reports.reload;
  useEffect(() => {
    if (uploads.length < lastUploads.current) reloadReports();
    lastUploads.current = uploads.length;
  }, [uploads.length, reloadReports]);

  const askCancel = (v: CoachVisit) => { trackFlow("schedule.cancel_tap"); setAsking(v); };
  const confirmCancel = async () => {
    if (!asking) return;
    const id = asking.id;
    trackFlow("schedule.cancel_confirm");
    setBusy(true);
    try {
      await leader.cancelSchedule(id);
      setGone((prev) => new Set(prev).add(id));
    } catch {
      /* the visit stays, as on the visit page */
    } finally {
      setBusy(false);
      setAsking(null);
    }
  };
  const toggleBooked = () => {
    if (!bookedOpen) trackFlow("observe.booked_open");
    setBookedOpen((o) => !o);
  };
  const cancel = bookedOpen ? askCancel : undefined;
  const group = (label: string, testId: string, visits: CoachVisit[], warn = false) => visits.length > 0 && (
    <div data-testid={testId} className="border-t border-[#e5e7eb]">
      <h3 className="m-0 flex items-center gap-2 px-4 pb-1 pt-3 text-[15px] font-semibold text-[#4b5563]">
        {label}<StatusChip text={String(visits.length)} tone={warn ? "waiting" : "info"} />
      </h3>
      {visits.map((v, i) => <BookedRow key={v.id} v={v} today={today} actions onCancel={askCancel} first={i === 0} />)}
    </div>
  );

  const shownWaiting = needsOpen ? waiting : waiting.slice(0, NEEDS_SHOWN);

  return (
    <ObservePage title={O.observe} crumb={todayLabel(new Date(), lang)} backTo="/portal/coach" feature="observations" banner={false} whatsapp={false}>
      <div data-testid="observe-v6" className="flex flex-col gap-2.5">
        {/* Schedule an observation: the whole flow, Now or Later at its end */}
        <section className="flex flex-col gap-2">
          <Link to="/portal/coach/new-visit" onClick={() => trackFlow("observe.schedule")}
            className={cn("flex min-h-[56px] items-center justify-center gap-2.5 rounded-2xl bg-[#33374a] px-4 py-2 text-[17px] font-semibold leading-tight text-white rtl:leading-[1.8]", FOCUS)}>
            <CalendarPlus className="h-5 w-5 shrink-0" aria-hidden="true" />{F.scheduleObservation}
          </Link>
          <p className="m-0 text-center text-[14px] text-[#6b7280]">{F.scheduleSub}</p>
        </section>

        {/* Needs you: oldest first, two, then all of them here */}
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
              {shownWaiting.map((r: CoachReport, i) => (
                <HistoryRow key={r.id} lead="person" first={i === 0} title={r.teacherName || S.dash}
                  extra={[S.waitingSince(waitedDays(r, today)), ...classParts(r, classWords)].join(" · ")} chip={reportChip(r, R, true)} to={reportHref(r)} />
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

        {/* In progress (bd-o15qnr.45): what the system is doing, one row each; no section when there is none */}
        {goingCount > 0 && (
          <section data-testid="in-progress" className="flex flex-col gap-2">
            <SectionLabel count={goingCount}>{R.inProgress}</SectionLabel>
            <div className={LIST_CARD}>
              {uploads.map((j, i) => (
                <HistoryRow key={`send-${j.visitId}`} lead="person" first={i === 0} title={j.teacherName || S.dash} time={pkTime(j.startedAt)}
                  extra={line({ createdAt: j.startedAt, grade: j.grade, subject: j.subject }) || undefined}
                  chip={{ text: kit.notify.sending(j.pct), tone: "info" }} to={j.waitHref || sendingPath(j.visitId)} />
              ))}
              {going.map((r: CoachReport, i) => (
                <HistoryRow key={r.id} lead="person" first={uploads.length === 0 && i === 0} title={r.teacherName || S.dash} time={pkTime(r.createdAt)}
                  extra={line(r) || undefined} chip={reportChip(r, R, true)} to={reportHref(r)} />
              ))}
            </div>
          </section>
        )}

        {/* Booked for today, then All booked opening in place */}
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
              {g.today.map((v, i) => <BookedRow key={v.id} v={v} today={today} actions={bookedOpen} onCancel={cancel} first={i === 0} />)}
              {bookedOpen && group(S.late, "booked-late", g.late, true)}
              {bookedOpen && group(S.comingUp, "booked-coming", g.coming)}
              {bookedOpen && (
                <Link to="/portal/coach/team" className={cn("flex min-h-[56px] items-center justify-center gap-2 border-t border-[#e5e7eb] px-4 text-[15px] font-semibold text-[#be185d]", FOCUS)}>
                  <Users className="h-5 w-5 shrink-0" aria-hidden="true" />{S.teamSchedule}
                </Link>
              )}
              {(more > 0 || bookedOpen || g.today.length > 0) && (
                <button type="button" onClick={toggleBooked} aria-expanded={bookedOpen}
                  className={cn("flex min-h-[56px] w-full items-center gap-2 border-t border-[#e5e7eb] px-4 text-start text-[16px] font-semibold text-[#33374a]", FOCUS)}>
                  {bookedOpen ? (
                    <><span className="flex-1 text-center">{F.hide}</span><ChevronUp className="h-5 w-5" aria-hidden="true" /></>
                  ) : (
                    <>
                      <span className="flex-1">{F.allBooked}</span>
                      {g.late.length > 0 && <StatusChip text={S.lateN(g.late.length)} tone="waiting" />}
                      {more > 0 && <span className="text-[14px] font-medium text-[#6b7280]">{F.nMore(more)}</span>}
                      <ChevronDown className="h-5 w-5 text-[#6b7280]" aria-hidden="true" />
                    </>
                  )}
                </button>
              )}
            </div>
          )}
        </section>

        {/* History */}
        <nav aria-label={S.history} data-testid="observe-history" className={cn(LIST_CARD, "mt-1")}>
          <Link to="/portal/coach/reports" className={cn("flex min-h-[60px] items-center gap-3 px-4 text-[16px] font-semibold", FOCUS)}>
            <Clock className="h-5 w-5 shrink-0 text-[#6b7280]" aria-hidden="true" />
            <span className="flex-1">{S.history}</span>
            {reports.data && <span className="text-[14px] font-medium text-[#6b7280]">{S.inAllN(reports.data.all.total)}</span>}
            <Chevron />
          </Link>
        </nav>
      </div>

      <CancelVisitTray open={!!asking} teacherName={asking?.teacherName} slot={asking?.scheduledSlot} busy={busy}
        onKeep={() => setAsking(null)} onConfirm={() => { void confirmCancel(); }} />
    </ObservePage>
  );
};

export default CoachObserveToday;

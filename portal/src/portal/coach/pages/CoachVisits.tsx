import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, Plus, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { coach, leader } from "../../services/api";
import { useCopy } from "../../teacher/i18n";
import { addDays } from "../../teacher/ui";
import { FOCUS, LIST_CARD } from "../../teacher/ui/styles";
import { DayLabel, Failed, Loading, SectionLabel, useLoad } from "../ui";
import { karachiDay } from "../time";
import type { CoachVisit } from "../types";
import ObservePage from "../observe/ObservePage";
import { OBSERVE } from "../observe/copy";
import { SCHEDULE } from "../schedule/copy";
import { dayShort } from "../schedule/model";
import { CancelVisitTray } from "../schedule/CancelVisitTray";
import { VisitCard } from "../schedule/VisitCard";
import { trackFlow } from "../flow/track";

/**
 * bd-o15qnr.26 — Concept 1 (#188, the operator 19 Nov): this is "Booked visits", opened from the Observe screen: Late ·
 * Today · Ahead, each visit with Record / Reschedule and Cancel visit; Book ahead and Team schedule at the end. The done
 * past is History's (no Earlier here). What follows is Option A's first build note.
 *
 * bd-o15qnr.26 (queue #177, Option A: "Schedule holds every visit") — the coach's ONE list of visits, behind
 * portal_coach_flow_v2. It replaces the Schedule hub, My schedule's week and Take observation's pick list.
 *
 *   Overdue     visits still to do from before today, oldest first, each "N days late"
 *   Today       today's visits by time; the first one still to do is Next
 *   Coming up   the days ahead, each day under its own small heading
 *   Earlier     the 30 days before today, newest day first: nothing folded (operator, 18 Nov: "A lot of visits are
 *               collapsed inside earlier. Lets not have them collapsed.")
 *
 * Every group starts open (rule 3: a list she came for starts open) and says how many it holds. A visit not yet done
 * carries its own buttons (VisitCard: Start recording or Reschedule, and Cancel visit, which asks first in the one
 * CancelVisitTray and then calls the same server cancel as the visit page). A done visit opens its observation.
 * New visit is in the dock; Team schedule is a row after what is still to come; the way back to WhatsApp (#166) is on
 * top, as on every Observe screen (ObservePage). The week strip is gone: the list already runs by day.
 *
 * Reads GET /coach/schedule for 30 days back to 90 ahead (the range Take observation read), plus every overdue visit
 * however old (the server adds those).
 */

// Concept 1: from today (the server adds every late visit however old); the done past is History's.
const DAYS_BACK = 0;
const DAYS_AHEAD = 90;

const slotKey = (v: CoachVisit) => (/^\d{2}:\d{2}$/.test(v.scheduledSlot || "") ? v.scheduledSlot! : "~");
const byTime = (a: CoachVisit, b: CoachVisit) => {
  const da = a.scheduledFor || "";
  const db = b.scheduledFor || "";
  if (da !== db) return da < db ? -1 : 1;
  const sa = slotKey(a);
  const sb = slotKey(b);
  return sa === sb ? 0 : sa < sb ? -1 : 1;
};

/** Visits grouped by day, in the order given. */
function byDay(visits: CoachVisit[]): { day: string; visits: CoachVisit[] }[] {
  const groups: { day: string; visits: CoachVisit[] }[] = [];
  for (const v of visits) {
    const day = v.scheduledFor || "";
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.visits.push(v);
    else groups.push({ day, visits: [v] });
  }
  return groups;
}

/** Overdue · Today · Coming up · Earlier, from one answer of GET /coach/schedule (overdue and the range, deduplicated). */
export function groupVisits(all: CoachVisit[], today: string) {
  const sorted = [...all].sort(byTime);
  const open = (v: CoachVisit) => v.status === "upcoming";
  const overdue = sorted.filter((v) => open(v) && (v.scheduledFor || "") < today);
  const todays = sorted.filter((v) => v.scheduledFor === today);
  const coming = sorted.filter((v) => (v.scheduledFor || "") > today);
  const earlier = sorted.filter((v) => !open(v) && (v.scheduledFor || "") < today)
    // newest day first; a day's visits keep their time order
    .sort((a, b) => ((a.scheduledFor || "") === (b.scheduledFor || "") ? byTime(a, b) : (a.scheduledFor || "") < (b.scheduledFor || "") ? 1 : -1));
  return { overdue, todays, coming: byDay(coming), earlier: byDay(earlier), nextId: todays.find(open)?.id ?? null };
}

const CoachVisits = () => {
  const S = useCopy(SCHEDULE);
  const O = useCopy(OBSERVE);
  const today = karachiDay(); // bd-o15qnr.23: the day in Pakistan
  const { data, failed, reload } = useLoad(
    () => coach.getSchedule({ from: addDays(today, -DAYS_BACK), to: addDays(today, DAYS_AHEAD) }), [today]);
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [asking, setAsking] = useState<CoachVisit | null>(null);
  const [busy, setBusy] = useState(false);

  const all = useMemo(() => {
    const seen = new Set<string>();
    const out: CoachVisit[] = [];
    for (const v of [...(data?.overdue || []), ...(data?.visits || [])]) {
      if (!seen.has(v.id) && !gone.has(v.id)) { seen.add(v.id); out.push(v); }
    }
    return out;
  }, [data, gone]);
  const g = useMemo(() => groupVisits(all, today), [all, today]);
  const comingCount = g.coming.reduce((n, d) => n + d.visits.length, 0);

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

  const card = (v: CoachVisit) => <VisitCard key={v.id} v={v} today={today} next={v.id === g.nextId} onCancel={askCancel} />;

  return (
    <ObservePage title={S.bookedVisits} crumb={O.observe} backTo="/portal/coach/observe" feature="schedule">
      {failed && <Failed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {data && (
        <div data-testid="visit-list" className="flex flex-col gap-2.5">
          {all.length === 0 && (
            <div className={cn(LIST_CARD, "flex min-h-[64px] items-center gap-3 px-4 text-[15px] font-semibold text-[#6b7280]")}>
              <CalendarClock className="h-5 w-5 shrink-0" aria-hidden="true" />{S.noVisits}
            </div>
          )}

          {g.overdue.length > 0 && (
            <section data-group="overdue" className="flex flex-col gap-2.5">
              <SectionLabel count={g.overdue.length} countTone="warn">{S.late}</SectionLabel>
              {g.overdue.map(card)}
            </section>
          )}

          {g.todays.length > 0 && (
            <section data-group="today" className="flex flex-col gap-2.5">
              <SectionLabel count={g.todays.length}>{`${S.today} · ${dayShort(today, S)}`}</SectionLabel>
              {g.todays.map(card)}
            </section>
          )}

          {comingCount > 0 && (
            <section data-group="coming" className="flex flex-col gap-2.5">
              <SectionLabel count={comingCount}>{S.ahead}</SectionLabel>
              {g.coming.map((d) => (
                <div key={d.day} className="flex flex-col gap-2.5">
                  <DayLabel>{d.day ? dayShort(d.day, S) : S.dash}</DayLabel>
                  {d.visits.map(card)}
                </div>
              ))}
            </section>
          )}

          {/* Concept 1: day and time only from here (Start an observation books for now); the done past is History's */}
          <Link to="/portal/coach/new-visit" className={cn(LIST_CARD, "mt-1 flex min-h-[56px] items-center justify-center gap-2 px-4 text-[16px] font-semibold text-[#33374a]", FOCUS)}>
            <Plus className="h-5 w-5 shrink-0" aria-hidden="true" />{S.bookAhead}
          </Link>
          <Link to="/portal/coach/team" className={cn("flex min-h-[56px] items-center justify-center gap-2 px-4 text-[15px] font-semibold text-[#be185d]", FOCUS)}>
            <Users className="h-5 w-5 shrink-0" aria-hidden="true" />{S.teamSchedule}
          </Link>
        </div>
      )}

      <CancelVisitTray open={!!asking} teacherName={asking?.teacherName} slot={asking?.scheduledSlot} busy={busy}
        onKeep={() => setAsking(null)} onConfirm={() => { void confirmCancel(); }} />
    </ObservePage>
  );
};

export default CoachVisits;

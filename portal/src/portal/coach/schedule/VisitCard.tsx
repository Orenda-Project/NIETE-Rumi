import { Link } from "react-router-dom";
import { CalendarDays, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCopy } from "../../teacher/i18n";
import { HistoryRow } from "../../teacher/ui";
import { FOCUS, GRID, LIST_CARD } from "../../teacher/ui/styles";
import { OBSERVE } from "../observe/copy";
import { useSendJob } from "../observe/sender";
import { Chevron } from "../ui";
import { hoursUntil } from "../time";
import type { CoachVisit } from "../types";
import { SCHEDULE } from "./copy";
import { dayShort, daysBetween } from "./model";
import { trackFlow } from "../flow/track";

/**
 * bd-o15qnr.26 (queue #177, Option A) — one visit on the Schedule list: the kit's coach row (HistoryRow lead="person": the
 * TimeStamp, the teacher, the school) in its own card, and, while the visit is not yet done, its own buttons under it:
 *
 *   overdue or today   Start recording (straight to this visit's record step, as the visit page's square) · Cancel visit
 *   coming up          Reschedule (New visit's step 3 for this visit, as the visit page's) · Cancel visit
 *   being sent         the squares give way to "Sending · 62%" (a second recording would send the visit twice)
 *
 * Cancel visit is the caller's tray (CancelVisitTray): it asks first. A done visit has no buttons and opens its
 * observation (its session); without one, the visit page. The row itself always opens the visit page.
 */

export const visitPath = (id: string) => `/portal/coach/visit/${id}`;
export const recordPath = (id: string) => `/portal/coach/visit/${id}/record`;

export function reschedulePath(v: CoachVisit): string {
  const qs = new URLSearchParams({ school: v.schoolExtId || "", teacher: v.teacherExtId || "", visit: v.id, slot: v.scheduledSlot || "" });
  return `/portal/coach/new-visit?${qs.toString()}`;
}

/** Where a done visit opens: its observation, or (no session recorded) the visit page. */
export const doneTo = (v: CoachVisit) => (v.sessionId ? `/portal/coach/observation/${v.sessionId}` : visitPath(v.id));

const BUTTON = "flex min-h-[56px] items-center justify-center gap-2 rounded-2xl px-3 text-[15px] font-semibold";

export function VisitCard({ v, today, next = false, onCancel }: {
  v: CoachVisit; today: string; next?: boolean; onCancel: (v: CoachVisit) => void;
}) {
  const S = useCopy(SCHEDULE);
  const C = useCopy(OBSERVE);
  const job = useSendJob(v.id);
  const day = v.scheduledFor || "";
  const done = v.status === "done";
  const open = v.status === "upcoming";
  const late = open && !!day && day < today;
  const isToday = day === today;
  const h = open && isToday ? hoursUntil(v.scheduledSlot) : null;
  const sending = job?.state === "sending";

  const chip = done ? { text: S.done, tone: "done" as const }
    : late ? { text: S.daysLate(daysBetween(day, today)), tone: "waiting" as const }
      : next && h != null && h >= 0 ? { text: C.inHours(h), tone: "info" as const }
        : next ? { text: S.next, tone: "info" as const } : null;

  return (
    <section data-testid={`visit-${v.id}`} className={LIST_CARD}>
      <HistoryRow lead="person" title={v.teacherName || S.dash}
        extra={[v.schoolName, late ? dayShort(day, S) : null].filter(Boolean).join(" · ") || undefined}
        time={v.scheduledSlot} timeTone={late ? "overdue" : undefined}
        state={done ? "done" : next ? "next" : "default"} chip={chip}
        to={done ? doneTo(v) : visitPath(v.id)} />
      {open && (
        <div role="group" aria-label={C.observation} className={cn(GRID, "grid-cols-2 gap-2 px-3 pb-3 pt-1")}>
          {sending ? (
            <Link to={`/portal/coach/visit/${v.id}/sending`} data-testid="sending-link" className={cn(BUTTON, "border border-[#e5e7eb] bg-white", FOCUS)}>
              <span className="flex-1 text-start">{C.sendingNow} · {job.pct}%</span><Chevron />
            </Link>
          ) : late || isToday ? (
            <Link to={recordPath(v.id)} onClick={() => trackFlow("schedule.start")} className={cn(BUTTON, "bg-[#33374a] text-white", FOCUS)}>
              <span aria-hidden="true" className="h-3.5 w-3.5 shrink-0 rounded-full bg-[#ff4d3d] shadow-[0_0_0_3px_rgba(255,77,61,0.25)]" />
              {C.startRecording}
            </Link>
          ) : (
            <Link to={reschedulePath(v)} className={cn(BUTTON, "border border-[#e5e7eb] bg-white text-[#33374a]", FOCUS)}>
              <CalendarDays className="h-5 w-5 shrink-0" aria-hidden="true" />{C.reschedule}
            </Link>
          )}
          <button type="button" onClick={() => onCancel(v)} className={cn(BUTTON, "border border-[#e5e7eb] bg-white text-[#c8331f]", FOCUS)}>
            <X className="h-5 w-5 shrink-0" aria-hidden="true" />{C.cancelVisit}
          </button>
        </div>
      )}
    </section>
  );
}

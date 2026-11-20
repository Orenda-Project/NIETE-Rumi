import { Link } from "react-router-dom";
import { CalendarDays, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCopy } from "../../teacher/i18n";
import { HistoryRow } from "../../teacher/ui";
import { FOCUS } from "../../teacher/ui/styles";
import { OBSERVE } from "../observe/copy";
import { SCHEDULE } from "../schedule/copy";
import { dayShort, daysBetween } from "../schedule/model";
import { recordPath, reschedulePath } from "../schedule/VisitCard";
import { hoursUntil } from "../time";
import type { CoachVisit } from "../types";
import { FLOW_V6 } from "./copy";
import { trackFlow } from "./track";

/**
 * bd-o15qnr.27 (queue #204, v6) — one booked visit in the coach flow's lists (Observe's Booked for today and All booked,
 * the Home's Focus card): the kit's coach row (HistoryRow lead="person": avatar, the time, the teacher, the school),
 * and its buttons, the app's 48px pills (#188's v6 boards, drawn from the kit):
 *
 *   folded (`actions` false)   Record at the end of the row, for a visit due today or late
 *   open   (`actions` true)    under the row: Record (today or late) or Reschedule (coming up), and Cancel (asks first:
 *                              the caller's CancelVisitTray, the same server cancel as the visit page)
 *
 * A late visit says its day and "N days late". The row is information (not a link): its pills are what she taps.
 */

const PILL = "flex min-h-[48px] shrink-0 items-center justify-center gap-2 rounded-xl px-3.5 text-[15px] font-semibold leading-tight rtl:leading-[1.8]";

function RecordPill({ v, to }: { v: CoachVisit; to?: (v: CoachVisit) => string }) {
  const S = useCopy(SCHEDULE);
  return (
    <Link to={to ? to(v) : recordPath(v.id)} onClick={() => trackFlow("schedule.start")} className={cn(PILL, "bg-[#33374a] text-white", FOCUS)}>
      <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full bg-[#ff4d3d]" />{S.record}
    </Link>
  );
}

export function BookedRow({ v, today, actions = false, onCancel, first = false, recordTo }: {
  v: CoachVisit; today: string; actions?: boolean; onCancel?: (v: CoachVisit) => void; first?: boolean;
  /** bd-o15qnr.28 — where Record goes for someone who is not the coach (a principal: her record screen for that teacher) */
  recordTo?: (v: CoachVisit) => string;
}) {
  const S = useCopy(SCHEDULE);
  const O = useCopy(OBSERVE);
  const F = useCopy(FLOW_V6);
  const day = v.scheduledFor || "";
  const late = !!day && day < today;
  const coming = !!day && day > today;
  const h = day === today ? hoursUntil(v.scheduledSlot) : null;
  const extra = [v.schoolName, late || coming ? dayShort(day, S) : null, h != null && h > 0 ? O.inHours(h).toLowerCase() : null]
    .filter(Boolean).join(" · ");
  const canRecord = !coming;
  return (
    <div data-testid={`booked-row-${v.id}`} className={cn(!first && "border-t border-[#e5e7eb]")}>
      <div className="flex items-center gap-2 pe-3">
        <div className="min-w-0 flex-1">
          <HistoryRow lead="person" first title={v.teacherName || S.dash} extra={extra || undefined} time={v.scheduledSlot}
            timeTone={late ? "overdue" : undefined} action="none"
            chip={late ? { text: S.daysLate(daysBetween(day, today)), tone: "waiting" } : null} />
        </div>
        {!actions && canRecord && <RecordPill v={v} to={recordTo} />}
      </div>
      {actions && (
        <div role="group" aria-label={O.observation} className="flex flex-wrap gap-2 pb-3 pe-3.5 ps-[72px]">
          {canRecord ? <RecordPill v={v} to={recordTo} /> : (
            <Link to={reschedulePath(v)} className={cn(PILL, "border border-[#e5e7eb] bg-white text-[#33374a]", FOCUS)}>
              <CalendarDays className="h-5 w-5 shrink-0" aria-hidden="true" />{O.reschedule}
            </Link>
          )}
          {onCancel && (
            <button type="button" onClick={() => onCancel(v)} className={cn(PILL, "border border-[#e5e7eb] bg-white text-[#c8331f]", FOCUS)}>
              <X className="h-5 w-5 shrink-0" aria-hidden="true" />{F.cancel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

import { Link } from "react-router-dom";
import { CalendarDays, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCopy } from "../../teacher/i18n";
import { HistoryRow } from "../../teacher/ui";
import { FOCUS } from "../../teacher/ui/styles";
import { OBSERVE } from "../observe/copy";
import { SCHEDULE } from "../schedule/copy";
import { dayShort, daysBetween } from "../schedule/model";
import { reschedulePath, visitPath } from "../schedule/VisitCard";
import { hoursUntil } from "../time";
import type { CoachVisit } from "../types";
import { FLOW_V6 } from "./copy";

/**
 * bd-o15qnr.27 (queue #204, v6) — one booked visit in the coach flow's lists (Observe's Booked for today and All booked,
 * the Home's Focus card), for a coach and a principal: the kit's coach row (HistoryRow lead="person": avatar, the time,
 * the teacher, the school). A late visit says its day and "N days late".
 *
 * bd-o15qnr.29 (the operator 21 Nov ~08:50: "remove the button, instead show a chevron and the whole tile/card is
 * clickable. If they do that, they land on the taking an observation page") — the WHOLE row is one link, with the kit's
 * chevron, to the take-an-observation page (`to`: the coach's visit page; a principal's page for that teacher), where she
 * records OR uploads. No Record button (it went straight to the microphone, so Upload could not be reached).
 *
 *   open (`actions` true)   under the row, the coach's own pills: Reschedule (coming up) and Cancel (asks first: the
 *                           caller's CancelVisitTray, the same server cancel as the visit page)
 */

const PILL = "flex min-h-[48px] shrink-0 items-center justify-center gap-2 rounded-xl px-3.5 text-[15px] font-semibold leading-tight rtl:leading-[1.8]";

export function BookedRow({ v, today, actions = false, onCancel, first = false, to = (x) => visitPath(x.id) }: {
  v: CoachVisit; today: string; actions?: boolean; onCancel?: (v: CoachVisit) => void; first?: boolean;
  /** Where the card goes: the take-an-observation page (the coach's visit; a principal's: her page for that teacher). */
  to?: (v: CoachVisit) => string;
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
  return (
    <div data-testid={`booked-row-${v.id}`} className={cn(!first && "border-t border-[#e5e7eb]")}>
      <HistoryRow lead="person" first title={v.teacherName || S.dash} extra={extra || undefined} time={v.scheduledSlot}
        timeTone={late ? "overdue" : undefined} to={to(v)}
        chip={late ? { text: S.daysLate(daysBetween(day, today)), tone: "waiting" } : null} />
      {actions && (coming || onCancel) && (
        <div role="group" aria-label={O.observation} className="flex flex-wrap gap-2 pb-3 pe-3.5 ps-[72px]">
          {coming && (
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

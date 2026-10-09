import { Link } from "react-router-dom";
import { Eye } from "lucide-react";
import { HistoryRow, type HistoryItem } from "../../teacher/ui";
import type { CoachHomeCopy } from "./copy";
import { hoursUntil } from "../time";
import { Chevron, IconCircle } from "../ui";
import type { CoachVisit } from "../types";

/**
 * bd-4404s7.2 — a visit on the coach Home is the kit's HistoryRow: a round person avatar, the time as a TimeStamp
 * on line 1 ("8:30 AM"), the teacher, the school. The grade-subject column is not used (it is reserved).
 */

const to = (v: CoachVisit) => `/portal/coach/visit/${v.id}`;

/** A visit as a HistoryList item (every visit today but the current one). */
export function visitItem(v: CoachVisit, W: CoachHomeCopy): HistoryItem {
  const done = v.status === "done";
  return {
    id: v.id,
    lead: "person",
    title: v.teacherName || "—",
    extra: v.schoolName || undefined,
    time: v.scheduledSlot,
    state: done ? "done" : undefined,
    chip: done ? { text: W.done, tone: "done" } : null,
    to: to(v),
  };
}

/** The visit that is next: a bordered card, the visit row, and one Take observation button inside it. */
export function CurrentVisit({ v, W }: { v: CoachVisit; W: CoachHomeCopy }) {
  const h = hoursUntil(v.scheduledSlot);
  return (
    <section data-testid="visit-current" className="overflow-hidden rounded-[18px] border-2 border-[#33374a] bg-white shadow-[0_4px_14px_rgba(51,55,74,0.14)]">
      <HistoryRow
        lead="person"
        title={v.teacherName || "—"}
        extra={v.schoolName || undefined}
        time={v.scheduledSlot}
        state="next"
        chip={h != null && h >= 0 ? { text: h === 0 ? W.now : W.inHours(h), tone: "info" } : null}
        to={to(v)}
      />
      <div className="px-3 pb-3 pt-2">
        <Link to={to(v)}
          className="flex min-h-[64px] items-center gap-2.5 rounded-[14px] border border-[#e5e7eb] bg-[#f9fafb] px-3 text-[15px] font-semibold">
          <IconCircle hue="observe" size={40}><Eye className="h-5 w-5" /></IconCircle>
          <span className="flex-1">{W.takeObservation}</span>
          <Chevron />
        </Link>
      </div>
    </section>
  );
}

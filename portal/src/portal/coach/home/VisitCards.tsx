import { Link } from "react-router-dom";
import { Eye } from "lucide-react";
import { StatusChip, TimeStamp } from "../../teacher/ui";
import type { CoachHomeCopy } from "./copy";
import { hoursUntil } from "../time";
import { Chevron, IconCircle, RowText, TapRow } from "../ui";
import type { CoachVisit } from "../types";

/**
 * bd-4404s7.2 — one visit on the coach Home. The time is the kit's TimeStamp ("8:30 AM", bold, plain: the
 * grade-subject tile is reserved). Rows are the coach app's own TapRow/RowText until the kit's HistoryRow takes the
 * person lead and a `time` (the kit agent's next PR); then they become HistoryRow and this file shrinks to nothing.
 */

function Lines({ v, tone, W }: { v: CoachVisit; tone: "neutral" | "next" | "done"; W: CoachHomeCopy }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <TimeStamp time={v.scheduledSlot} tone={tone} size={15} />
      <RowText name={<span className={tone === "next" ? "text-xl" : ""}>{v.teacherName || "—"}</span>} sub={v.schoolName} />
    </span>
  );
}

/** The visit that is next: a bordered card, the visit, and one Take observation button inside it. */
export function CurrentVisit({ v, W }: { v: CoachVisit; W: CoachHomeCopy }) {
  const h = hoursUntil(v.scheduledSlot);
  return (
    <section data-testid="visit-current" className="overflow-hidden rounded-[18px] border-2 border-[#33374a] bg-white shadow-[0_4px_14px_rgba(51,55,74,0.14)]">
      <Link to={`/portal/coach/visit/${v.id}`} className="flex min-h-[88px] items-center gap-3.5 p-3.5">
        <Lines v={v} tone="next" W={W} />
        {h != null && h >= 0 && <StatusChip text={h === 0 ? W.now : W.inHours(h)} tone="info" />}
        <Chevron />
      </Link>
      <div className="px-3 pb-3">
        <Link to={`/portal/coach/visit/${v.id}`}
          className="flex min-h-[64px] items-center gap-2.5 rounded-[14px] border border-[#e5e7eb] bg-[#f9fafb] px-3 text-[15px] font-semibold">
          <IconCircle hue="observe" size={40}><Eye className="h-5 w-5" /></IconCircle>
          <span className="flex-1">{W.takeObservation}</span>
          <Chevron />
        </Link>
      </div>
    </section>
  );
}

/** Any other visit today: done ones are muted with a green time and a Done chip. */
export function VisitRow({ v, W }: { v: CoachVisit; W: CoachHomeCopy }) {
  const done = v.status === "done";
  return (
    <TapRow to={`/portal/coach/visit/${v.id}`} muted={done}>
      <Lines v={v} tone={done ? "done" : "neutral"} W={W} />
      {done && <StatusChip text={W.done} tone="done" tick />}
    </TapRow>
  );
}

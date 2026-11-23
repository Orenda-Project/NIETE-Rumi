import { useCopy } from "../../teacher/i18n";
import { Tray } from "../../teacher/ui/Tray";
import { TimeStamp } from "../../teacher/ui/TimeStamp";
import { OBSERVE } from "../observe/copy";

/**
 * bd-o15qnr.26 — Cancel visit asks first: ONE tray for every place a visit can be cancelled (the visit page and each
 * not-done row of the Schedule list), moved here unchanged from pages/CoachVisit.tsx. The teacher's name and the
 * visit's time, then Keep visit and Cancel visit (red). What a confirm does is the caller's: the same server cancel
 * everywhere (leader.cancelSchedule → observation_schedules.status = 'cancelled').
 */
export function CancelVisitTray({ open, teacherName, slot, busy = false, onKeep, onConfirm }: {
  open: boolean;
  teacherName: string | null | undefined;
  slot: string | null | undefined;
  busy?: boolean;
  onKeep: () => void;
  onConfirm: () => void;
}) {
  const C = useCopy(OBSERVE);
  return (
    <Tray open={open} title={C.cancelVisit} onClose={onKeep}>
      <div className="text-[15px] font-semibold">{teacherName}{slot ? <> · <TimeStamp time={slot} size={15} /></> : null}</div>
      <div className="flex gap-2.5">
        <button type="button" onClick={onKeep} className="flex h-14 flex-1 items-center justify-center rounded-2xl border border-[#e5e7eb] bg-white text-base font-semibold">{C.keepVisit}</button>
        <button type="button" onClick={onConfirm} disabled={busy} className="flex h-14 flex-1 items-center justify-center rounded-2xl bg-[#c8331f] text-base font-semibold text-white">{C.cancelVisit}</button>
      </div>
    </Tray>
  );
}

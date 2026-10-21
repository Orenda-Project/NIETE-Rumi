import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useCopy } from "../../teacher/i18n";
import { FOCUS, OUTLINE_WIDE, PRIMARY_WIDE } from "../../teacher/ui/styles";
import { disagreements } from "./api";
import { DISAGREE } from "./copy";

/**
 * bd-tbprit.12 — Rifat's footer, fixed to the bottom of the card: "✓ Mark as done" with its hint, or on a done card
 * "Move back to To do". Either tap, once the server has it, goes back to the list saying where the card went;
 * a failed save stays on the card and says so.
 */

export function DoneBadge({ done }: { done: boolean }) {
  const C = useCopy(DISAGREE);
  if (!done) return null;
  return (
    <p data-testid="done-badge" className="self-start rounded-full bg-[#e7f6ec] px-3 py-1 text-[14px] font-bold text-[#1d6b3a]">
      {C.doneBadge}
    </p>
  );
}

export function DoneBar({ id, done, teacher }: { id: string; done: boolean; teacher: string }) {
  const C = useCopy(DISAGREE);
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const tap = async () => {
    setSaving(true);
    setFailed(false);
    const ok = await (done ? disagreements.undone(id) : disagreements.visited(id));
    setSaving(false);
    if (ok) navigate("/portal/coach/disagreements", { state: { moved: { who: teacher, done: !done } } });
    else setFailed(true);
  };
  return (
    <div data-testid="done-bar" className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-1.5 border-t border-[#e1e4ea] bg-white px-4 pb-4 pt-3">
      {failed ? <p role="alert" className="text-[14px] text-[#c8331f]">{C.saveFailed}</p> : null}
      {done ? (
        <button type="button" onClick={tap} disabled={saving} className={cn(OUTLINE_WIDE, FOCUS)}>{C.undo}</button>
      ) : (
        <>
          <button type="button" onClick={tap} disabled={saving} className={cn(PRIMARY_WIDE, "bg-[#1d7a45]", FOCUS)}>{C.markDone}</button>
          <p className="text-center text-[13px] text-[#5f6677]">{C.doneHint}</p>
        </>
      )}
    </div>
  );
}

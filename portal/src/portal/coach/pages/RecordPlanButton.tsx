import { useState } from "react";
import { Camera, ChevronLeft, FileText, Paperclip } from "lucide-react";
import { useCopy } from "../../teacher/i18n";
import { useLessonPlanOpen } from "../../lib/lessonPlanSwitch";
import { LESSON_PLAN_SHEET_COPY } from "../../components/lessonPlanSheetCopy";
import { LessonPlanOpenRow } from "../../components/LessonPlanOpenRow";
import LessonPlanSheet from "../../components/LessonPlanSheet";
import LibraryPicker, { type PickedPlan } from "../../components/coaching/LibraryPicker";
import { useOverlayEntry } from "../../lib/useOverlayEntry";
import { checkPlanFile, formatSize, PLAN_FILE_EXTENSIONS, planKindOf } from "../../lib/coachingUpload";
import { holdFile, isFileRefused, tellUnreadablePick } from "../../lib/pickedRead";
import { leader } from "../../services/api";
import { downloadsOnly } from "../../lib/observeRecentPlans";
import { OBSERVE } from "../observe/copy";
import { planKindLabel } from "../observe/format";
import { getHeldPlan, setHeldPlan, viewSourceOf, type HeldPlan } from "../observePlan";
import type { CoachVisit } from "../types";

/**
 * bd-kijmb8 (queue #318, the operator 27 Nov ~17:30) — on the coach's recording page:
 *   a plan is attached  →  "Lesson plan · NIETE plan / Teacher's own plan · Open": the plan opens OVER the live recording
 *                          (its own history entry; Back closes it, the recording never stops; "Recording continues").
 *   nothing attached    →  "Attach lesson plan": a layer to pick one (the teacher's recent or the library, or their own file);
 *                          it is then attached, here and on Check and send, and the button reads "Lesson plan".
 * Behind portal_lesson_plan_open; off: nothing is drawn.
 */
export function RecordPlanButton({ visit, recording }: { visit: CoachVisit; recording: boolean }) {
  const on = useLessonPlanOpen();
  const C = useCopy(LESSON_PLAN_SHEET_COPY);
  const [plan, setPlan] = useState<HeldPlan | null>(() => getHeldPlan(visit.id));
  const [sheet, setSheet] = useState<"view" | "attach" | null>(null);
  if (!on) return null;

  const attached = (p: HeldPlan) => { setHeldPlan(visit.id, p); setPlan(p); setSheet(null); };
  if (plan) {
    const source = viewSourceOf(plan);
    return (
      <div className="flex w-full flex-col gap-2">
        <LessonPlanOpenRow source={plan.kind === "file" ? "own" : "library"} title={plan.title}
          onOpen={() => (source ? setSheet("view") : undefined)} />
        {!source && <p className="m-0 px-1 text-[13px] text-[#6b7280]">{C.cantOpenHere}</p>}
        {sheet === "view" && source && (
          <LessonPlanSheet recording={recording} onClose={() => setSheet(null)} view={{ source, title: plan.title }} />
        )}
      </div>
    );
  }
  return (
    <div className="flex w-full flex-col gap-2">
      <button type="button" data-testid="lesson-plan-attach" onClick={() => setSheet("attach")}
        className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl border-[1.5px] border-[#c7cad6] bg-white text-base font-semibold text-[#33374a]">
        <Paperclip className="h-5 w-5" aria-hidden="true" />{C.attachPlan}
      </button>
      {sheet === "attach" && <AttachPlanLayer visit={visit} onClose={() => setSheet(null)} onPicked={attached} />}
    </div>
  );
}

/** The picker layer: NIETE plans (their recent, then the library) or the teacher's own plan (a photo or a file). */
function AttachPlanLayer({ visit, onClose, onPicked }: { visit: CoachVisit; onClose: () => void; onPicked: (p: HeldPlan) => void }) {
  const C = useCopy(LESSON_PLAN_SHEET_COPY);
  const O = useCopy(OBSERVE);
  const close = useOverlayEntry(onClose);
  const [library, setLibrary] = useState(false);
  const [level, setLevel] = useState(0);
  const [backSignal, setBackSignal] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);

  const pickedLibrary = (p: PickedPlan) => onPicked({ kind: "library", pick: p.pick, title: p.title, sub: p.sub, lessonId: "lessonId" in p.pick ? p.pick.lessonId : null });
  const pickedFile = async (file: File | undefined) => {
    setProblem(null);
    if (!file) return;
    const bad = checkPlanFile(file);
    if (bad) { setProblem(bad === "too_large" ? O.tooLarge : O.notPlanFile); return; }
    const out = await holdFile(file);
    if (isFileRefused(out)) { tellUnreadablePick("lesson_plan", file, out.errName); setProblem(O.fileWontOpen); return; }
    const kind = planKindLabel(planKindOf(file.name), O);
    onPicked({ kind: "file", file: out.file, title: file.name, sub: [kind, formatSize(file.size)].filter(Boolean).join(" · ") });
  };
  const back = () => (library && level > 0 ? setBackSignal((n) => n + 1) : library ? setLibrary(false) : close());
  const btn = "flex min-h-[64px] w-full items-center gap-3 rounded-2xl border border-[#e5e7eb] bg-white px-4 text-start text-[17px] font-semibold text-[#1d2025]";

  return (
    <div data-testid="attach-plan-layer" role="dialog" aria-modal="true" aria-label={C.attachPlan}
      className="fixed inset-0 z-[70] flex flex-col gap-3 overflow-y-auto bg-[#f7f8fa] px-4 pb-6 pt-3">
      <div className="flex min-h-12 items-center gap-1">
        <button type="button" onClick={back} aria-label={O.back} className="flex h-11 w-11 items-center justify-center rounded-lg text-[#33374a]"><ChevronLeft className="h-6 w-6 rtl:rotate-180" aria-hidden="true" /></button>
        <h1 className="text-lg font-bold text-[#33374a]">{C.attachPlan}</h1>
      </div>
      {library ? (
        <LibraryPicker onPick={pickedLibrary} onStepChange={setLevel} backSignal={backSignal} showUsed={false}
          loadRecent={() => leader.getObserveRecentPlans(visit.teacherExtId || "", visit.schoolExtId || null).then(downloadsOnly)} recentTitle={O.theirRecentPlans} />
      ) : (
        <>
          <button type="button" className={btn} onClick={() => setLibrary(true)}><FileText className="h-5 w-5" aria-hidden="true" />{C.nietePlan}</button>
          <label className={btn}><Camera className="h-5 w-5" aria-hidden="true" />{C.takePhoto}
            <input data-testid="attach-photo" type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void pickedFile(e.target.files?.[0]); e.target.value = ""; }} /></label>
          <label className={btn}><Paperclip className="h-5 w-5" aria-hidden="true" />{C.attachFile}
            <input data-testid="attach-file" type="file" accept={PLAN_FILE_EXTENSIONS.join(",")} className="hidden" onChange={(e) => { void pickedFile(e.target.files?.[0]); e.target.value = ""; }} /></label>
          {problem && <p role="alert" className="m-0 rounded-2xl bg-[#fef3c7] px-3.5 py-3 text-[15px] text-[#b45309]">{problem}</p>}
        </>
      )}
    </div>
  );
}

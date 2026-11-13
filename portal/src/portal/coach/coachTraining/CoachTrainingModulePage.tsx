import { Check, ExternalLink, FileText, PlayCircle, RotateCcw } from "lucide-react";
import { Navigate, useParams } from "react-router-dom";
import CoachGate from "../CoachGate";
import TeacherPage from "../../teacher/TeacherPage";
import { useCopy, useLang } from "../../teacher/i18n";
import { ChoicePair, DockButton, StatusChip } from "../../teacher/ui";
import { COACH_TRAINING } from "./copy";
import { COACH_TRAINING_PATH, moduleByNumber, moduleUrl, videoUrl } from "./modules";
import { useCoachTrainingProgress } from "./progress";

const ART = "h-9 w-9";

/**
 * bd-rlxkkt.6 — one Coach Training module (/portal/coach/coach-training/<n>): its number and title, then a clean choice of
 * two big buttons, PDF (the module's page) and Video (its video lesson), the operator's ask of 5 Nov 2026. A tap opens that
 * format in the browser; coming back lands here, on the choice. Back goes to the list. A number that is not a module goes
 * back to the list.
 *
 * bd-rlxkkt.9 — the ICT HITL owner, 6 Nov 2026: when she completes a module she gets a "complete" option here. The dock
 * holds Mark done (the Training Library part page's button and words); once done, a Done tick sits under the title and the
 * dock offers Mark not done to take it back. Saved per coach (useCoachTrainingProgress); a failed save says Not saved.
 *
 * bd-rlxkkt.12 — a module whose video is not made yet (Module 10, 10 Nov 2026) keeps both squares: Video is greyed, says
 * Coming soon and opens nothing; PDF and Mark done work as on every module.
 */
export default function CoachTrainingModulePage() {
  const C = useCopy(COACH_TRAINING);
  const lang = useLang();
  const { n } = useParams();
  const { done, saving, notSaved, mark } = useCoachTrainingProgress();
  const m = moduleByNumber(Number(n));
  if (!m) return <Navigate to={COACH_TRAINING_PATH} replace />;
  const open = (url: string) => { window.open(url, "_blank", "noopener,noreferrer"); };
  const isDone = !!(done && done[m.key]);
  const video = videoUrl(m);

  const chips = isDone || notSaved ? (
    <>
      {isDone ? <span data-testid="coach-module-done"><StatusChip text={C.done} tone="done" tick /></span> : null}
      {notSaved ? <span data-testid="coach-progress-not-saved"><StatusChip text={C.notSaved} tone="error" /></span> : null}
    </>
  ) : undefined;

  // Nothing to press until her progress has loaded: a button that guesses would undo a module she already marked.
  const dock = done === null ? undefined : isDone ? (
    <DockButton icon={RotateCcw} outline onClick={() => { void mark(m.key, false); }} disabled={saving} testId="coach-mark-not-done">{C.markNotDone}</DockButton>
  ) : (
    <DockButton icon={Check} onClick={() => { void mark(m.key, true); }} disabled={saving} testId="coach-mark-done">{C.markDone}</DockButton>
  );

  return (
    <CoachGate>
      <TeacherPage
        title={lang === "ur" ? m.title.ur : m.title.en}
        crumb={C.title}
        backTo={COACH_TRAINING_PATH}
        feature="coachTraining"
        chips={chips}
        dock={dock}
        testId="coach-training-module"
      >
        <p className="mb-3 text-[15px] text-[#4b5563]">{`${C.coachModule} ${m.n}`}</p>
        <ChoicePair
          items={[
            { key: "pdf", label: C.pdf, art: <FileText className={ART} strokeWidth={2} />, onPress: () => open(moduleUrl(m)), testId: "coach-format-pdf" },
            video
              ? { key: "video", label: C.video, art: <PlayCircle className={ART} strokeWidth={2} />, onPress: () => open(video), testId: "coach-format-video" }
              : { key: "video", label: C.video, art: <PlayCircle className={ART} strokeWidth={2} />, off: true, note: C.videoSoon, testId: "coach-format-video" },
          ]}
        />
        <p className="mt-3 flex items-center gap-1.5 text-[13px] text-[#6b7280]">
          <ExternalLink className="h-4 w-4" aria-hidden="true" />{C.opensInBrowser}
        </p>
      </TeacherPage>
    </CoachGate>
  );
}

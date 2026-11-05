import { ExternalLink, FileText, PlayCircle } from "lucide-react";
import { Navigate, useParams } from "react-router-dom";
import CoachGate from "../CoachGate";
import TeacherPage from "../../teacher/TeacherPage";
import { useCopy, useLang } from "../../teacher/i18n";
import { ChoicePair } from "../../teacher/ui";
import { COACH_TRAINING } from "./copy";
import { COACH_TRAINING_PATH, moduleByNumber, moduleUrl, videoUrl } from "./modules";

const ART = "h-9 w-9";

/**
 * bd-rlxkkt.6 — one Coach Training module (/portal/coach/coach-training/<n>): its number and title, then a clean choice of
 * two big buttons, PDF (the module's page) and Video (its video lesson), the operator's ask of 5 Nov 2026. A tap opens that
 * format in the browser; coming back lands here, on the choice. Back goes to the list. A number that is not a module goes
 * back to the list.
 */
export default function CoachTrainingModulePage() {
  const C = useCopy(COACH_TRAINING);
  const lang = useLang();
  const { n } = useParams();
  const m = moduleByNumber(Number(n));
  if (!m) return <Navigate to={COACH_TRAINING_PATH} replace />;
  const open = (url: string) => { window.open(url, "_blank", "noopener,noreferrer"); };
  return (
    <CoachGate>
      <TeacherPage
        title={lang === "ur" ? m.title.ur : m.title.en}
        crumb={C.title}
        backTo={COACH_TRAINING_PATH}
        feature="coachTraining"
        testId="coach-training-module"
      >
        <p className="mb-3 text-[15px] text-[#4b5563]">{`${C.coachModule} ${m.n}`}</p>
        <ChoicePair
          items={[
            { key: "pdf", label: C.pdf, art: <FileText className={ART} strokeWidth={2} />, onPress: () => open(moduleUrl(m)), testId: "coach-format-pdf" },
            { key: "video", label: C.video, art: <PlayCircle className={ART} strokeWidth={2} />, onPress: () => open(videoUrl(m)), testId: "coach-format-video" },
          ]}
        />
        <p className="mt-3 flex items-center gap-1.5 text-[13px] text-[#6b7280]">
          <ExternalLink className="h-4 w-4" aria-hidden="true" />{C.opensInBrowser}
        </p>
      </TeacherPage>
    </CoachGate>
  );
}

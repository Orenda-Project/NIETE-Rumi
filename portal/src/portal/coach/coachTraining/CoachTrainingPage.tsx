import CoachGate from "../CoachGate";
import TeacherPage from "../../teacher/TeacherPage";
import { useCopy, useLang } from "../../teacher/i18n";
import { ListRow } from "../../teacher/ui";
import { COACH_TRAINING } from "./copy";
import { COACH_MODULES, modulePath } from "./modules";

/**
 * Coach Training (/portal/coach/coach-training), from the Coach Training tile on the coach's Home: the nine modules of
 * the coaching programme, in the rubric's order, each a row with its number. A tap opens that module's own screen, where
 * she picks its PDF (the module page) or its Video (bd-rlxkkt.6, the operator 5 Nov 2026: never both on one list).
 */
export default function CoachTrainingPage() {
  const C = useCopy(COACH_TRAINING);
  const lang = useLang();
  return (
    <CoachGate>
      <TeacherPage title={C.title} crumb={C.crumb} backTo="/portal/coach" feature="coachTraining" testId="coach-training">
        <p className="mb-3 text-[15px] text-[#4b5563]">{C.coachIntro}</p>
        <nav aria-label={C.title} data-testid="coach-modules" className="flex flex-col gap-2.5">
          {COACH_MODULES.map((m) => (
            <ListRow
              key={m.key}
              testId="coach-module"
              prefix={C.coachModule}
              number={m.n}
              label={lang === "ur" ? m.title.ur : m.title.en}
              to={modulePath(m)}
            />
          ))}
        </nav>
      </TeacherPage>
    </CoachGate>
  );
}

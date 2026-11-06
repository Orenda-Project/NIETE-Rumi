import CoachGate from "../CoachGate";
import TeacherPage from "../../teacher/TeacherPage";
import { useCopy, useLang } from "../../teacher/i18n";
import { ListRow, StatusChip } from "../../teacher/ui";
import { COACH_TRAINING } from "./copy";
import { COACH_MODULES, modulePath } from "./modules";
import { useCoachTrainingProgress } from "./progress";

/**
 * Coach Training (/portal/coach/coach-training), from the Coach Training tile on the coach's Home: the nine modules of
 * the coaching programme, in the rubric's order, each a row with its number. A tap opens that module's own screen, where
 * she picks its PDF (the module page) or its Video (bd-rlxkkt.6, the operator 5 Nov 2026: never both on one list).
 *
 * bd-rlxkkt.9 — a module she marked done carries the green Done tick, and the count beside the intro says how many of the
 * nine are done ("3 of 9 done"). Until her progress loads, or if it does not, the count is "—", never a 0.
 */
export default function CoachTrainingPage() {
  const C = useCopy(COACH_TRAINING);
  const lang = useLang();
  const { done } = useCoachTrainingProgress();
  const count = done ? COACH_MODULES.filter((m) => done[m.key]).length : null;
  return (
    <CoachGate>
      <TeacherPage title={C.title} crumb={C.crumb} backTo="/portal/coach" feature="coachTraining" testId="coach-training">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[15px] text-[#4b5563]">{C.coachIntro}</p>
          <span data-testid="coach-training-count">
            <StatusChip text={count === null ? "—" : C.doneOf(count, COACH_MODULES.length)} tone={count === COACH_MODULES.length ? "done" : "info"} />
          </span>
        </div>
        <nav aria-label={C.title} data-testid="coach-modules" className="flex flex-col gap-2.5">
          {COACH_MODULES.map((m) => (
            <ListRow
              key={m.key}
              testId="coach-module"
              prefix={C.coachModule}
              number={m.n}
              label={lang === "ur" ? m.title.ur : m.title.en}
              state={done && done[m.key] ? "used" : "default"}
              copy={{ used: C.done }}
              to={modulePath(m)}
            />
          ))}
        </nav>
      </TeacherPage>
    </CoachGate>
  );
}

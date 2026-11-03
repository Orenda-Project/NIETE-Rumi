import { ExternalLink } from "lucide-react";
import CoachGate from "../CoachGate";
import TeacherPage from "../../teacher/TeacherPage";
import { useCopy, useLang } from "../../teacher/i18n";
import { ListRow } from "../../teacher/ui";
import { COACH_TRAINING } from "./copy";
import { COACH_MODULES, moduleUrl } from "./modules";

/**
 * Coach Training (/portal/coach/coach-training), from the Coach Training tile on the coach's Home: the nine modules of
 * the coaching programme, in the rubric's order, each a row with its number. A tap opens the module in the browser (the
 * modules are pages hosted outside the portal; the same pattern as a Training resource, CoursePage). Read only.
 */
export default function CoachTrainingPage() {
  const C = useCopy(COACH_TRAINING);
  const lang = useLang();
  const open = (url: string) => { window.open(url, "_blank", "noopener,noreferrer"); };
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
              onPress={() => open(moduleUrl(m))}
            />
          ))}
        </nav>
        <p className="mt-3 flex items-center gap-1.5 text-[13px] text-[#6b7280]">
          <ExternalLink className="h-4 w-4" aria-hidden="true" />{C.opensInBrowser}
        </p>
      </TeacherPage>
    </CoachGate>
  );
}

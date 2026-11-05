import { ExternalLink, FileText, PlayCircle } from "lucide-react";
import CoachGate from "../CoachGate";
import TeacherPage from "../../teacher/TeacherPage";
import { useCopy, useLang } from "../../teacher/i18n";
import { ListRow } from "../../teacher/ui";
import { LIST_CARD, ROW_SUB, ROW_TITLE } from "../../teacher/ui/styles";
import { COACH_TRAINING } from "./copy";
import { COACH_MODULES, moduleUrl, videoUrl } from "./modules";

const GLYPH = "h-6 w-6";

/**
 * Coach Training (/portal/coach/coach-training), from the Coach Training tile on the coach's Home: the nine modules of
 * the coaching programme, in the rubric's order. Each module is a card: its number and title (flat, not tappable), then
 * its two pages, the Video first and then the Module page (bd-rlxkkt.5: the owner's DM, 5 Nov 2026, every module has
 * both). A tap opens that page in the browser (the modules are pages hosted outside the portal; the same pattern as a
 * Training resource, CoursePage). Read only.
 */
export default function CoachTrainingPage() {
  const C = useCopy(COACH_TRAINING);
  const lang = useLang();
  const open = (url: string) => { window.open(url, "_blank", "noopener,noreferrer"); };
  return (
    <CoachGate>
      <TeacherPage title={C.title} crumb={C.crumb} backTo="/portal/coach" feature="coachTraining" testId="coach-training">
        <p className="mb-3 text-[15px] text-[#4b5563]">{C.coachIntro}</p>
        <nav aria-label={C.title} data-testid="coach-modules" className="flex flex-col gap-3">
          {COACH_MODULES.map((m) => {
            const title = lang === "ur" ? m.title.ur : m.title.en;
            return (
              <section key={m.key} data-testid="coach-module" aria-label={`${C.coachModule} ${m.n}: ${title}`} className={LIST_CARD}>
                <div className="px-3.5 pb-1.5 pt-3">
                  <p className={ROW_SUB}>{`${C.coachModule} ${m.n}`}</p>
                  <h2 className={ROW_TITLE}>{title}</h2>
                </div>
                <ListRow
                  variant="row"
                  testId="coach-module-video"
                  glyph={<PlayCircle className={GLYPH} aria-hidden="true" />}
                  label={C.video}
                  onPress={() => open(videoUrl(m))}
                />
                <ListRow
                  variant="row"
                  first={false}
                  testId="coach-module-page"
                  glyph={<FileText className={GLYPH} aria-hidden="true" />}
                  label={C.coachModulePage}
                  onPress={() => open(moduleUrl(m))}
                />
              </section>
            );
          })}
        </nav>
        <p className="mt-3 flex items-center gap-1.5 text-[13px] text-[#6b7280]">
          <ExternalLink className="h-4 w-4" aria-hidden="true" />{C.opensInBrowser}
        </p>
      </TeacherPage>
    </CoachGate>
  );
}

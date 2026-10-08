import { Link } from "react-router-dom";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "../../hooks/useAuth";
import TeacherPage, { PageChip } from "../TeacherPage";
import { FeatureArt, type TeacherFeature as ArtFeature } from "../icons";
import { TEACHER_FRAME } from "../copy";
import { useCopy, useLang } from "../i18n";
import { cleanSchool, fullName, todayLabel } from "../format";
import { teacherPath } from "../routes";

/**
 * bd-fmf24g.1 — teacher v2 Home (canvas v28 Main, after the operator's changes 1–3):
 * "Salaam, <full name>!", today's date and her school as chips, then one big centred
 * tile per feature in a 2 × 3 grid with My Classes as the wide last tile. No numbers on
 * the tiles ("remove the pills… we will figure that out later"). Order is fixed in both
 * languages (most-used first), never alphabetical.
 */
const TILES: ArtFeature[] = ["lessons", "coaching", "observations", "training", "assessment", "attendance", "classes"];

export default function Home() {
  const C = useCopy(TEACHER_FRAME);
  const lang = useLang();
  const tiles = TILES.map((feature) => ({ feature, label: C.home.tiles[feature] }));
  const { user } = useAuth();
  const school = cleanSchool(user?.schoolName);
  return (
    <TeacherPage
      testId="teacher-home"
      title={C.home.greeting(fullName(user))}
      chips={(
        <>
          <PageChip><CalendarDays className="h-[15px] w-[15px]" aria-hidden="true" />{todayLabel(new Date(), lang)}</PageChip>
          {school && <PageChip testId="home-school">{school}</PageChip>}
        </>
      )}
    >
      <nav aria-label={C.home.features} data-testid="feature-tiles" className="[display:grid] grid-cols-2 gap-3">
        {tiles.map(({ feature, label }, i) => {
          const wide = i === tiles.length - 1;
          return (
            <Link
              key={feature}
              to={teacherPath(feature)}
              className={cn(
                "flex flex-col items-center justify-center gap-3.5 rounded-[20px] border border-[#e5e7eb] bg-white px-2.5 py-[18px] text-center shadow-[0_1px_3px_rgba(16,24,40,0.08)]",
                "outline-none transition-colors hover:bg-[#f9fafb] focus-visible:ring-[3px] focus-visible:ring-[#f59e0b] motion-reduce:transition-none",
                wide ? "col-span-2 min-h-[132px]" : "min-h-[176px]",
              )}
            >
              <FeatureArt feature={feature} size={80} />
              <span className="text-[18px] font-semibold leading-tight">{label}</span>
            </Link>
          );
        })}
      </nav>
    </TeacherPage>
  );
}

import { useCopy } from "../../teacher/i18n";
import { FeatureMotionProvider } from "../../teacher/icons";
import { FeatureTile } from "../../teacher/ui";
import { TimeStamp } from "../../teacher/ui/TimeStamp";
import { StatusChip } from "../../teacher/ui/StatusChip";
import { coach } from "../../services/api";
import { Initials, RowText, SectionLabel, TapRow, useLoad } from "../ui";
import { hoursUntil, karachiDay } from "../time";
import { OBSERVE } from "../observe/copy";
import { dayShort } from "../observe/format";
import ObservePage from "../observe/ObservePage";

/**
 * bd-4404s7.4 — Observe, on the kit (Blueprint: Coach_Observe): the AttentionBanner under the header, two FeatureTiles
 * (Take observation, Reports, moving together), and her Next visit.
 *
 *   Take observation   a chip "N left today" ONLY when the API has her visits today (home.today) and some are still to do;
 *                      otherwise no chip (never a made-up number).
 *   Reports            "N waiting" (amber) or, with none waiting, "N in progress"; no chip when both are 0.
 *   Next visit         her next upcoming visit whatever its day (home.next): the teacher, the school, the time (TimeStamp,
 *                      the "next" tone), and "In 2 h" when it is today or its day when it is not.
 *
 * Observe is always against a scheduled visit: Take observation goes to Pick the teacher.
 */
const CoachObserve = () => {
  const C = useCopy(OBSERVE);
  const { data } = useLoad(() => coach.getHome(), []);
  const home = data?.home;
  const next = home?.next || null;
  const today = karachiDay();
  const left = home?.today ? home.today.filter((v) => v.status === "upcoming").length : 0;
  const waiting = home?.counts.waiting ?? 0;
  const inProgress = home?.counts.inProgress ?? 0;
  const reportsChip = waiting > 0 ? { text: C.waitingN(waiting), tone: "waiting" as const }
    : inProgress > 0 ? { text: C.inProgressN(inProgress), tone: "info" as const } : null;
  const hours = next && next.scheduledFor === today ? hoursUntil(next.scheduledSlot) : null;
  const when = next && next.scheduledFor !== today ? dayShort(next.scheduledFor, C) : "";

  return (
    <ObservePage title={C.observe} crumb={C.home} backTo="/portal/coach" feature="observations">
      <FeatureMotionProvider>
        <nav aria-label={C.observe} className="[display:grid] grid-cols-2 gap-3">
          <FeatureTile feature="observations" label={C.takeObservation} to="/portal/coach/observe/pick" chip={left > 0 ? { text: C.leftToday(left), tone: "info" } : null} />
          <FeatureTile feature="reports" label={C.reports} to="/portal/coach/reports" chip={reportsChip} />
        </nav>
      </FeatureMotionProvider>
      {next && (
        <>
          <SectionLabel>{C.nextVisit}</SectionLabel>
          <TapRow to={`/portal/coach/visit/${next.id}`} emphasis testId="next-visit">
            <Initials name={next.teacherName} />
            <RowText name={next.teacherName || C.dash} sub={next.schoolName} />
            <span className="flex shrink-0 flex-col items-end gap-1">
              <TimeStamp time={next.scheduledSlot} tone="next" />
              {hours != null && hours >= 0 ? <StatusChip text={C.inHours(hours)} tone="info" /> : when ? <StatusChip text={when} tone="info" /> : null}
            </span>
          </TapRow>
        </>
      )}
    </ObservePage>
  );
};

export default CoachObserve;

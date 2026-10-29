import { useParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { KpiTiles } from "../../teacher/ui";
import { useCopy } from "../../teacher/i18n";
import { coach } from "../../services/api";
import { SectionLabel, BottomLink, Loading, useLoad } from "../ui";
import { PEOPLE } from "../people/copy";
import PeopleFrame, { LoadFailed } from "../people/PeopleFrame";
import ManageSchool from "../people/ManageSchool";
import { TeacherCard, Notice, useNotice } from "../people/rows";
import { bySince } from "./CoachPeople";
import { coachFeatureReady } from "../training/appReady";
import { useCardSwitch } from "../card/frame";
import SchoolCardPage from "../card/SchoolCardPage";

/**
 * bd-o15qnr + bd-4404s7.6 — one school: its four numbers (the kit's KpiTiles), then its teachers, never-visited first.
 *
 * Then Manage (Blueprint: Coach · Manage schools and teachers), the WhatsApp /observe "Manage teachers" for THIS
 * school: Add a teacher, Remove teachers, and Remove school. Removing the school asks first (the kit's ConfirmTray)
 * and takes only HER link: the teachers stay at the school, for every other coach who holds it.
 */
function CoachSchoolToday() {
  const C = useCopy(PEOPLE);
  const { emis = "" } = useParams();
  const { notice, tellTeam } = useNotice();
  const { data, failed, reload } = useLoad(() => coach.getSchool(emis), [emis]);
  const s = data?.school;

  return (
    <PeopleFrame title={s?.name || C.dash} crumb={C.title} backTo="/portal/coach/people" feature="schools"
      // Schedule a visit here opens Schedule: only once Schedule is in the coach app.
      dock={s && coachFeatureReady("schedule") ? <BottomLink to={`/portal/coach/new-visit?${new URLSearchParams({ school: s.schoolExtId }).toString()}`}><Plus className="h-5 w-5" aria-hidden="true" />{C.scheduleVisitHere}</BottomLink> : undefined}>
      <Notice text={notice} />
      {failed && <LoadFailed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {s && data && (
        <>
          {tellTeam && s.teachers === 0 && (
            <p role="note" data-testid="tell-team" className="m-0 rounded-2xl bg-[#fef3c7] px-3.5 py-3 text-[15px] font-medium leading-snug text-[#b45309]">{C.lines.tellTeam}</p>
          )}
          <KpiTiles columns={2} items={[
            { value: s.visits, label: C.visitsLast3 },
            { value: s.daysSinceVisit == null ? null : C.daysShort(s.daysSinceVisit), label: C.sinceVisit },
            { value: s.avgHitl == null ? null : C.pct(s.avgHitl), label: C.avgHitl },
            { value: s.teachers, label: C.teachersCol },
          ]} />
          <SectionLabel right={<span className="text-[13px] font-semibold text-[#6b7280]">{C.sortDays}</span>}>{C.teachersTab}</SectionLabel>
          {[...data.teachers].sort(bySince).map((t) => <TeacherCard key={t.teacherExtId || t.name} t={t} />)}

          <ManageSchool emis={emis} name={s.name} teacherCount={data.teachers.length} />
        </>
      )}
    </PeopleFrame>
  );
}

/**
 * With the School card switch on (features.schoolCard, read fail-closed), this address is the school's School card
 * (card/SchoolCardPage). Off, it is the page above, unchanged. While the switch is read: the page's own first frame.
 */
const CoachSchool = () => {
  const C = useCopy(PEOPLE);
  const on = useCardSwitch();
  if (on === true) return <SchoolCardPage />;
  if (on === null) return <PeopleFrame title={C.dash} crumb={C.title} backTo="/portal/coach/people" feature="schools"><Loading /></PeopleFrame>;
  return <CoachSchoolToday />;
};

export default CoachSchool;

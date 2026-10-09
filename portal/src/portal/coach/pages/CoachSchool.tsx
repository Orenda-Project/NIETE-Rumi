import { useParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { KpiTiles } from "../../teacher/ui";
import { useCopy } from "../../teacher/i18n";
import { coach } from "../../services/api";
import { SectionLabel, BottomLink, Loading, useLoad } from "../ui";
import { PEOPLE } from "../people/copy";
import PeopleFrame, { LoadFailed } from "../people/PeopleFrame";
import { TeacherCard } from "../people/rows";
import { bySince } from "./CoachPeople";

/** bd-o15qnr + bd-4404s7.6 — one school: its four numbers (the kit's KpiTiles), then its teachers, never-visited first. */
const CoachSchool = () => {
  const C = useCopy(PEOPLE);
  const { emis = "" } = useParams();
  const { data, failed, reload } = useLoad(() => coach.getSchool(emis), [emis]);
  const s = data?.school;
  return (
    <PeopleFrame title={s?.name || C.dash} crumb={C.title} backTo="/portal/coach/people" feature="schools"
      dock={s ? <BottomLink to={`/portal/coach/new-visit?${new URLSearchParams({ school: s.schoolExtId }).toString()}`}><Plus className="h-5 w-5" aria-hidden="true" />{C.scheduleVisitHere}</BottomLink> : undefined}>
      {failed && <LoadFailed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {s && data && (
        <>
          <KpiTiles columns={2} items={[
            { value: s.visits, label: C.visitsLast3 },
            { value: s.daysSinceVisit == null ? null : C.daysShort(s.daysSinceVisit), label: C.sinceVisit },
            { value: s.avgHitl == null ? null : C.pct(s.avgHitl), label: C.avgHitl },
            { value: s.teachers, label: C.teachersCol },
          ]} />
          <SectionLabel right={<span className="text-[13px] font-semibold text-[#6b7280]">{C.sortDays}</span>}>{C.teachersTab}</SectionLabel>
          {[...data.teachers].sort(bySince).map((t) => <TeacherCard key={t.teacherExtId || t.name} t={t} />)}
        </>
      )}
    </PeopleFrame>
  );
};

export default CoachSchool;

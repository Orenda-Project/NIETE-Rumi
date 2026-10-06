import { useParams } from "react-router-dom";
import { Clock, Eye, Plus, TrendingUp, Users } from "lucide-react";
import { coach } from "../../services/api";
import { COACH_COPY as C } from "../copy";
import { CoachPage, Card, SectionLabel, IconCircle, BottomLink, Loading, Failed, useLoad } from "../ui";
import { TeacherCard, bySince } from "./CoachPeople";

/** bd-o15qnr — one school: its numbers, then its teachers (never-visited first). */
const CoachSchool = () => {
  const { emis = "" } = useParams();
  const { data, failed, reload } = useLoad(() => coach.getSchool(emis), [emis]);
  const s = data?.school;
  const cell = (icon: React.ReactNode, value: React.ReactNode, label: string, extra = "") => (
    <div className={`flex items-center gap-3 p-3.5 ${extra}`}>
      <IconCircle hue="schools" size={40}>{icon}</IconCircle>
      <span><b className="block text-xl font-bold tabular-nums">{value}</b><span className="text-xs text-[#6b7280]">{label}</span></span>
    </div>
  );
  return (
    <CoachPage title={s?.name || C.dash} crumb={C.schoolsAndTeachers} backTo="/portal/coach/people?tab=schools"
      dock={s ? <BottomLink to={`/portal/coach/new-visit?${new URLSearchParams({ school: s.schoolExtId }).toString()}`}><Plus className="h-5 w-5" aria-hidden="true" />{C.scheduleVisitHere}</BottomLink> : undefined}>
      {failed && <Failed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {s && data && (
        <>
          <Card className="grid grid-cols-2 overflow-hidden">
            {cell(<Eye className="h-5 w-5" />, s.visits, C.visitsLast3)}
            {cell(<Clock className="h-5 w-5" />, C.daysShort(s.daysSinceVisit), C.sinceVisit, "border-s border-[#e5e7eb]")}
            {cell(<TrendingUp className="h-5 w-5" />, C.pct(s.avgHitl), C.avgHitl, "border-t border-[#e5e7eb]")}
            {cell(<Users className="h-5 w-5" />, s.teachers, C.teachersCol, "border-s border-t border-[#e5e7eb]")}
          </Card>
          <SectionLabel right={<span className="text-[13px] font-semibold text-[#6b7280]">{C.sortDays}</span>}>{C.teachersTab}</SectionLabel>
          {[...data.teachers].sort(bySince).map((t) => <TeacherCard key={t.teacherExtId || t.name} t={t} showSchool={false} />)}
        </>
      )}
    </CoachPage>
  );
};

export default CoachSchool;

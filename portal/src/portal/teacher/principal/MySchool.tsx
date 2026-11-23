import { useRef } from "react";
import { Loading } from "../../coach/ui";
import { LoadFailed } from "../../coach/people/PeopleFrame";
import { LevelChips, useLevel } from "../../coach/people/level";
import { useCardLoad } from "../../coach/card/frame";
import { usePeriod } from "../../coach/card/period";
import { PeriodChips } from "../../coach/card/parts";
import { OverviewCard, SchoolTeachers } from "../../coach/card/schoolView";
import { SchoolLine } from "../analytics/SchoolView";
import { oneTeacherPath } from "../analytics/school";
import { getPrincipalSchoolCard, type PrincipalSchoolCard } from "./api";
import { NoSchoolNotice } from "./NoSchool";

/**
 * bd-33wxxi.3 — Analytics › My school on the principal app (#55, Analytics A): the coach's School view (#19) for her OWN
 * school, a composition of its own pieces with no styling of its own — the school line, PeriodChips (Today · This week ·
 * This month, in the address), LevelChips, the OverviewCard with `countsOnly` (#55 Q1: the DC and Coach boxes are how
 * many and by how many teachers, never an average; no page behind the boxes, so they are flat), then the Teachers
 * section (SchoolTeachers: the coach card's table). A row opens that teacher's Analytics page (OneTeacherPage: the bands
 * a teacher sees about herself). No Where to coach, no Manage, no coach-observations table.
 *
 * The school is the server's (GET /principal/school/card reads her session); her row naming no school: the
 * NoSchoolNotice (no school linked yet, ask her coach to add her; bd-r2uzg1.21.4).
 * Every number is the server's; one that did not load is "—", never 0.
 */
export function MySchool() {
  const [period] = usePeriod();
  const [level] = useLevel();
  const { data, failed, reload } = useCardLoad<PrincipalSchoolCard>(() => getPrincipalSchoolCard(period, level), [period, level]);
  // The school line and the level chips stay put while another period or level loads.
  const known = useRef<PrincipalSchoolCard["school"]>(null);
  if (data?.school) known.current = data.school;
  const knownLevels = useRef<PrincipalSchoolCard["levels"] | null>(null);
  if (data?.levels) knownLevels.current = data.levels;

  if (data && !data.school) return <NoSchoolNotice testId="my-school-none" />;
  const school = data?.school ?? known.current;
  const teachers = data?.teachers ?? [];
  const idOf = new Map(teachers.map((t) => [t.teacherExtId, t.id]));
  // A row opens her Analytics page by her users.id; a row the server sent no id for stays on this page.
  const linkOf = (ext: string) => { const id = idOf.get(ext); return id ? oneTeacherPath(id) : "#"; };

  return (
    <>
      {school ? <SchoolLine name={school.name} teachers={school.teachers} /> : null}
      <PeriodChips />
      <LevelChips counts={knownLevels.current} />
      {failed && <LoadFailed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {data && (
        <>
          <OverviewCard ov={data.overview} scores={data.scores} period={period} countsOnly />
          <SchoolTeachers teachers={teachers} period={period} level={level} linkOf={linkOf} state={undefined} />
        </>
      )}
    </>
  );
}

import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, School } from "lucide-react";
import { StatusChip } from "../../teacher/ui";
import { useCopy } from "../../teacher/i18n";
import { Tabs, ChoiceChips, Loading, useLoad, BottomLink } from "../ui";
import { coach } from "../../services/api";
import type { CoachSchool, CoachTeacher } from "../types";
import { PEOPLE } from "../people/copy";
import PeopleFrame, { LoadFailed } from "../people/PeopleFrame";
import { SchoolCard, SchoolGroup, EmptyRow, Notice, useNotice } from "../people/rows";
import { coachFeatureReady } from "../training/appReady";
import { useCardSwitch } from "../card/frame";

/**
 * bd-o15qnr + bd-4404s7.6 — Schools & teachers: one page, Schools | Teachers tabs (Schools first), numbers only.
 *
 *   Schools   12 rows, no search (a search box over 12 rows is more work than looking), sort chips, a visit-status
 *             chip on each row in a status tone with a legend.
 *   Teachers  grouped by school (the Blueprint's Coach_TeachersB): a school opens in place to its first two teachers
 *             and "Show all N" shows the rest; no search and no school filter, the groups are the filter.
 *
 * The dock is her way to change the list (Blueprint: Coach · Manage schools and teachers): Add a school on the
 * Schools tab, Add a teacher on the Teachers tab — the WhatsApp /observe "Add or remove a school" and
 * "Manage teachers". A coach with no schools sees one slim row saying so, above the same Add a school.
 */

/** Never-visited first, then the most days since a visit. */
export function bySince<T extends { daysSinceVisit: number | null }>(a: T, b: T) {
  if (a.daysSinceVisit == null && b.daysSinceVisit == null) return 0;
  if (a.daysSinceVisit == null) return -1;
  if (b.daysSinceVisit == null) return 1;
  return b.daysSinceVisit - a.daysSinceVisit;
}

function byAvg<T extends { avgHitl: number | null }>(a: T, b: T) {
  if (a.avgHitl == null && b.avgHitl == null) return 0;
  if (a.avgHitl == null) return 1;
  if (b.avgHitl == null) return -1;
  return a.avgHitl - b.avgHitl;
}

type TeacherSort = "days" | "avg" | "az";
type SchoolSort = "least" | "most" | "days";

const byName = (a: CoachTeacher, b: CoachTeacher) => a.name.localeCompare(b.name);

/** Teachers grouped by school, each group sorted, the groups ordered by their first teacher (or by name for A–Z). */
export function groupBySchool(teachers: CoachTeacher[], sort: TeacherSort): { id: string; name: string; teachers: CoachTeacher[] }[] {
  const cmp = (sort === "avg" ? byAvg : sort === "az" ? byName : bySince) as (a: CoachTeacher, b: CoachTeacher) => number;
  const groups = new Map<string, { id: string; name: string; teachers: CoachTeacher[] }>();
  for (const t of teachers) {
    const id = t.schoolExtId || t.schoolName || "";
    const g = groups.get(id) || { id, name: t.schoolName || id, teachers: [] };
    g.teachers.push(t);
    groups.set(id, g);
  }
  const out = [...groups.values()].map((g) => ({ ...g, teachers: [...g.teachers].sort(cmp) }));
  return out.sort((a, b) => (sort === "az" ? a.name.localeCompare(b.name) : cmp(a.teachers[0], b.teachers[0])));
}

const CoachPeople = () => {
  const C = useCopy(PEOPLE);
  const [params] = useSearchParams();
  // bd-o15qnr.8 — operator: "the first tab should be Schools, and should be the one that opens by default".
  const tab = params.get("tab") === "teachers" ? "teachers" : "schools";
  const { data, failed, reload } = useLoad(() => coach.getPeople(), []);
  const [tSort, setTSort] = useState<TeacherSort>("days");
  const [sSort, setSSort] = useState<SchoolSort>("least");
  const { notice } = useNotice();

  const groups = useMemo(() => groupBySchool(data?.teachers || [], tSort), [data, tSort]);
  const schools = useMemo(() => {
    const cmp = sSort === "most" ? (a: CoachSchool, b: CoachSchool) => b.visits - a.visits
      : sSort === "days" ? bySince : (a: CoachSchool, b: CoachSchool) => a.visits - b.visits;
    return [...(data?.schools || [])].sort(cmp as (a: CoachSchool, b: CoachSchool) => number);
  }, [data, sSort]);

  // A menu page while the coach Home is not in the coach app: no Back to it (that tap would land on the Training Library).
  // With the School card on, the slim Home is in the coach app and My schools opens from it.
  const card = useCardSwitch() === true;
  const home = coachFeatureReady("home") || card;
  return (
    <PeopleFrame title={C.title} crumb={home ? C.home : undefined} backTo={home ? "/portal/coach" : undefined} feature="schools"
      dock={tab === "teachers"
        ? <BottomLink to="/portal/coach/add-teacher"><Plus className="h-5 w-5" aria-hidden="true" />{C.addTeacher}</BottomLink>
        : <BottomLink to="/portal/coach/schools/add"><Plus className="h-5 w-5" aria-hidden="true" />{C.addSchool}</BottomLink>}>
      <Notice text={notice} />
      <Tabs label={C.title} items={[
        { to: "/portal/coach/people", label: C.schoolsTab, count: data?.schools.length, active: tab === "schools" },
        { to: "/portal/coach/people?tab=teachers", label: C.teachersTab, count: data?.teachers.length, active: tab === "teachers" },
      ]} />
      {failed && <LoadFailed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {data && tab === "teachers" && (
        <>
          <ChoiceChips<TeacherSort> label={C.sort} value={tSort} onChange={setTSort}
            options={[{ value: "days", label: C.sortDays }, { value: "avg", label: C.sortAvg }, { value: "az", label: C.sortAz }]} />
          {groups.map((g, i) => <SchoolGroup key={`${g.id}:${tSort}`} id={g.id} name={g.name} teachers={g.teachers} defaultOpen={i === 0} />)}
        </>
      )}
      {data && tab === "schools" && (
        <>
          <ChoiceChips<SchoolSort> label={C.sort} value={sSort} onChange={setSSort}
            options={[{ value: "least", label: C.sortLeast }, { value: "most", label: C.sortMost }, { value: "days", label: C.sortDays }]} />
          <div data-testid="visit-legend" className="flex flex-col gap-1.5 px-1">
            <span className="text-[13px] font-semibold text-[#6b7280]">{C.lastVisit}</span>
            <span className="flex flex-wrap gap-1.5">
              <StatusChip text={C.legendOver} tone="waiting" />
              <StatusChip text={C.legendMid} tone="info" />
              <StatusChip text={C.legendRecent} tone="done" />
            </span>
          </div>
          {schools.length === 0 && <EmptyRow testId="no-schools" icon={<School className="h-5 w-5" />}>{C.noSchoolsYet}</EmptyRow>}
          {schools.length > 0 && <div className="px-1 text-[13px] font-semibold text-[#6b7280]">{C.visitsLast3}</div>}
          {schools.map((s) => <SchoolCard key={s.schoolExtId} s={s} />)}
        </>
      )}
    </PeopleFrame>
  );
};

export default CoachPeople;

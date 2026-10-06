import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { School } from "lucide-react";
import { coach } from "../../services/api";
import { COACH_COPY as C } from "../copy";
import { CoachPage, Tabs, SearchBox, SelectBox, ChoiceChips, Initials, IconCircle, RowText, Stats, Loading, Failed, useLoad, personMatches, Chevron } from "../ui";
import type { CoachSchool, CoachTeacher } from "../types";

/**
 * bd-o15qnr — Schools & teachers: one page, Schools | Teachers tabs (Schools first, bd-o15qnr.8). Numbers
 * only — days since the last visit, HITL and DC counts, average HITL, days
 * since training; for a school its visits (last 3 months), days since a
 * visit, teachers and average. No "Due" / "Done" labels (operator, v18).
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

export function TeacherCard({ t, showSchool = true }: { t: CoachTeacher; showSchool?: boolean }) {
  const body = (
    <span data-testid="teacher-card" className="flex flex-col">
      <span className="flex min-h-[72px] items-center gap-3 p-2.5 ps-3.5">
        <Initials name={t.name} />
        <RowText name={t.name} sub={showSchool ? t.schoolName : undefined} />
        {t.teacherExtId && <Chevron />}
      </span>
      <Stats items={[
        { value: C.daysShort(t.daysSinceVisit), label: C.sinceVisit }, { value: t.hitl, label: C.hitl },
        { value: t.dc, label: C.dc }, { value: C.pct(t.avgHitl), label: C.avg }, { value: C.daysShort(t.daysSinceTraining), label: C.trainingCol },
      ]} />
    </span>
  );
  const cls = "overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.08)]";
  return t.teacherExtId
    ? <Link to={`/portal/coach/teacher/${t.teacherExtId}`} className={`${cls} hover:bg-[#f9fafb]`}>{body}</Link>
    : <div className={cls}>{body}</div>;
}

function SchoolCard({ s }: { s: CoachSchool }) {
  return (
    <Link to={`/portal/coach/school/${encodeURIComponent(s.emis || "")}`} className="overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.08)] hover:bg-[#f9fafb]">
      <span data-testid="school-card" className="flex flex-col">
        <span className="flex min-h-[68px] items-center gap-3 p-2.5 ps-3.5">
          <IconCircle hue="schools" size={44}><School className="h-[22px] w-[22px]" /></IconCircle>
          <RowText name={s.name || C.dash} />
          <Chevron />
        </span>
        <Stats items={[
          { value: s.visits, label: C.visitsCol }, { value: C.daysShort(s.daysSinceVisit), label: C.sinceVisit },
          { value: s.teachers, label: C.teachersCol }, { value: C.pct(s.avgHitl), label: C.avgHitl },
        ]} />
      </span>
    </Link>
  );
}

type TeacherSort = "days" | "avg" | "az";
type SchoolSort = "least" | "most" | "days";

const CoachPeople = () => {
  const [params] = useSearchParams();
  // bd-o15qnr.8 — operator: "the first tab should be Schools, and should be the
  // one that opens by default". Teachers is ?tab=teachers.
  const tab = params.get("tab") === "teachers" ? "teachers" : "schools";
  const { data, failed, reload } = useLoad(() => coach.getPeople(), []);
  const [q, setQ] = useState("");
  const [school, setSchool] = useState("");
  const [tSort, setTSort] = useState<TeacherSort>("days");
  const [sSort, setSSort] = useState<SchoolSort>("least");

  const teachers = useMemo(() => {
    const list = (data?.teachers || []).filter((t) => (!school || t.schoolExtId === school) && personMatches(t.name, t.phone, q));
    const cmp = tSort === "avg" ? byAvg : tSort === "az" ? (a: CoachTeacher, b: CoachTeacher) => a.name.localeCompare(b.name) : bySince;
    return [...list].sort(cmp as (a: CoachTeacher, b: CoachTeacher) => number);
  }, [data, school, q, tSort]);

  const schools = useMemo(() => {
    const list = (data?.schools || []).filter((s) => !q || String(s.name || "").toLowerCase().includes(q.toLowerCase()));
    const cmp = sSort === "most" ? (a: CoachSchool, b: CoachSchool) => b.visits - a.visits
      : sSort === "days" ? bySince : (a: CoachSchool, b: CoachSchool) => a.visits - b.visits;
    return [...list].sort(cmp as (a: CoachSchool, b: CoachSchool) => number);
  }, [data, q, sSort]);

  return (
    <CoachPage title={C.schoolsAndTeachers} crumb={C.home} backTo="/portal/coach">
      <Tabs items={[
        { to: "/portal/coach/people", label: C.schoolsTab, count: data?.schools.length, active: tab === "schools" },
        { to: "/portal/coach/people?tab=teachers", label: C.teachersTab, count: data?.teachers.length, active: tab === "teachers" },
      ]} />
      {failed && <Failed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {data && tab === "teachers" && (
        <>
          <SearchBox value={q} onChange={setQ} placeholder={C.searchPlaceholder} />
          <SelectBox label={C.school} value={school} onChange={setSchool} icon={<School className="h-5 w-5 shrink-0 text-[#6b7280]" aria-hidden="true" />}
            options={[{ value: "", label: C.allSchools }, ...data.schools.map((s) => ({ value: s.schoolExtId, label: s.name || s.schoolExtId }))]} />
          <ChoiceChips<TeacherSort> label={C.sort} value={tSort} onChange={setTSort}
            options={[{ value: "days", label: C.sortDays }, { value: "avg", label: C.sortAvg }, { value: "az", label: C.sortAz }]} />
          {teachers.map((t) => <TeacherCard key={t.teacherExtId || t.name} t={t} />)}
        </>
      )}
      {data && tab === "schools" && (
        <>
          <SearchBox value={q} onChange={setQ} placeholder={C.schoolSearchPlaceholder} />
          <ChoiceChips<SchoolSort> label={C.sort} value={sSort} onChange={setSSort}
            options={[{ value: "least", label: C.sortLeast }, { value: "most", label: C.sortMost }, { value: "days", label: C.sortDays }]} />
          <div className="px-1 text-[13px] font-semibold text-[#6b7280]">{C.visitsLast3}</div>
          {schools.map((s) => <SchoolCard key={s.schoolExtId} s={s} />)}
        </>
      )}
    </CoachPage>
  );
};

export default CoachPeople;

import { useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { CalendarDays, MapPin } from "lucide-react";
import { PageChip } from "../../teacher/TeacherPage";
import { TEACHER_FRAME } from "../../teacher/copy";
import { useCopy } from "../../teacher/i18n";
import { Loading, SearchBox, SectionLabel } from "../ui";
import PeopleFrame, { LoadFailed } from "../people/PeopleFrame";
import ManageSchool from "../people/ManageSchool";
import { EmptyRow, Notice, useNotice } from "../people/rows";
import { LevelChips, useLevel, withLevel } from "../people/level";
import { PEOPLE } from "../people/copy";
import { SCHOOL_CARD } from "./copy";
import { card } from "./api";
import { useCardLoad } from "./frame";
import { usePeriod, withPeriod } from "./period";
import { PeriodChips } from "./parts";
import { CoachObsTable, OverviewCard, TeacherTable } from "./schoolView";
import type { SchoolCardData } from "./types";

/**
 * A school's School card (the switch on), as Rifat's School view (bd-17v39c.4.13, mockups v3 approved 5 Nov): the school,
 * the period (Today · This week · This month), then the overview (who used NIETE this period and the same days before;
 * five boxes two to a row, each opening that feature's details page), one teacher table (her four counts under icon heads,
 * Contribution %, ★ on the top two, the teachers with nothing always shown with 0s), the coach-observations table, and
 * the school's Manage group. The five Activity tiles left the card: their charts open the details pages now.
 * No Share, no Schedule dock. Every number is the server's; one that did not load is "—", never 0.
 */

const SEARCH_FROM = 10;

export default function SchoolCardPage() {
  const C = useCopy(SCHOOL_CARD);
  const F = useCopy(TEACHER_FRAME);
  const P = useCopy(PEOPLE);
  const { emis = "" } = useParams();
  const [period] = usePeriod();
  // bd-ewbzns.1 — Primary / Middle / High: the server's card for that level's teachers (every tile and the list).
  const [level] = useLevel();
  const { notice } = useNotice();
  const { data, failed, reload } = useCardLoad<SchoolCardData>(() => card.school(emis, period, level), [emis, period, level]);
  const [query, setQuery] = useState("");
  // The school's name and numbers stay in the header while another period loads.
  const known = useRef<SchoolCardData["school"] | null>(null);
  if (data?.school) known.current = data.school;
  const school = data?.school ?? known.current;
  // The chips stay put while another level loads.
  const knownLevels = useRef<SchoolCardData["levels"] | null>(null);
  if (data?.levels) knownLevels.current = data.levels;

  const base = `/portal/coach/school/${encodeURIComponent(emis)}`;
  const teachers = data?.teachers ?? [];
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => (q ? teachers.filter((t) => t.name.toLowerCase().includes(q)) : teachers), [teachers, q]);
  const active = shown.filter((t) => t.total > 0)
    .sort((a, b) => (b.total - a.total) || a.name.localeCompare(b.name));
  const none = shown.filter((t) => !(t.total > 0)).sort((a, b) => a.name.localeCompare(b.name));
  const teacherLink = (ext: string) => withPeriod(`/portal/coach/teacher/${encodeURIComponent(ext)}`, period);
  const observationsLink = (ext: string) => withPeriod(`/portal/coach/teacher/${encodeURIComponent(ext)}/observations`, period);
  const schoolPage = (path: string) => withLevel(withPeriod(path, period), level);
  const linkState = school ? { schoolName: school.name, emis: school.emis } : undefined;
  const coachObs = data?.coachObservations?.teachers ?? [];
  const coachScores = data?.scores?.coach;

  return (
    <PeopleFrame title={school?.name || C.dash} crumb={F.coachNav.schools} backTo={withLevel("/portal/coach/people", level)} feature="schools"
      chips={school ? (
        <>
          <PageChip testId="card-emis"><MapPin className="h-3.5 w-3.5" aria-hidden="true" />{C.emis(school.emis || emis)}</PageChip>
          <PageChip testId="card-last-visit"><CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />{C.lastVisit(school.lastVisitDaysAgo)}</PageChip>
        </>
      ) : undefined}>
      <Notice text={notice} />
      <PeriodChips />
      <LevelChips counts={knownLevels.current} />
      {failed && <LoadFailed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {data && (
        <>
          <OverviewCard ov={data.overview} scores={data.scores} period={period} link={(kind) => schoolPage(`${base}/feature/${kind}`)} />

          <SectionLabel>{C.teachers}</SectionLabel>
          <p className="m-0 mx-1 -mt-2 text-[13px] font-semibold text-[#6b7280] rtl:leading-[1.8]">{C.tapTeacher}</p>
          {teachers.length > SEARCH_FROM && <SearchBox value={query} onChange={setQuery} placeholder={C.teacherName} />}
          {teachers.length === 0 && <EmptyRow icon={<span>·</span>} testId="no-teachers">{level ? P.noneAtLevel : C.noTeachers}</EmptyRow>}
          {teachers.length > 0 && shown.length === 0 && <EmptyRow icon={<span>·</span>} testId="no-match">{C.noMatch}</EmptyRow>}
          {shown.length > 0 && <TeacherTable key={`${period}|${level}|${q}`} active={active} quiet={none} period={period} linkOf={teacherLink} state={linkState} />}

          <SectionLabel>{C.coachObsName}</SectionLabel>
          {coachObs.length > 0 && coachScores ? (
            <p data-testid="coach-obs-sub" className="m-0 mx-1 -mt-2 text-[13px] font-semibold text-[#6b7280] rtl:leading-[1.8]">
              {C.obsSub(C.obsN(coachScores.count), C.pct(coachScores.avg))}
              {coachScores.prevAvg != null ? ` ${C.lastWeekPct[period](C.pct(coachScores.prevAvg))}` : ""}
            </p>
          ) : null}
          {coachObs.length > 0
            ? <CoachObsTable rows={coachObs} linkOf={observationsLink} state={{ ...linkState, back: schoolPage(base) }} />
            : <EmptyRow icon={<span>·</span>} testId="no-coach-obs">{C.noKind.coach[period]}</EmptyRow>}

          {/* Manage is the whole school's, whatever level is picked. */}
          <ManageSchool emis={emis} name={data.school.name} teacherCount={data.school.roster ?? data.school.teachers ?? teachers.length} />
        </>
      )}
    </PeopleFrame>
  );
}

import { useRef } from "react";
import { useParams } from "react-router-dom";
import { CalendarDays, MapPin, UserRound } from "lucide-react";
import { PageChip, PageLinkChip } from "../../teacher/TeacherPage";
import { FEATURE_HUE } from "../../teacher/icons/features";
import { TEACHER_FRAME } from "../../teacher/copy";
import { useCopy } from "../../teacher/i18n";
import { Loading, SectionLabel } from "../ui";
import PeopleFrame, { LoadFailed } from "../people/PeopleFrame";
import ManageSchool from "../people/ManageSchool";
import { EmptyRow, Notice, useNotice } from "../people/rows";
import { LevelChips, useLevel, withLevel, type TeachingLevel } from "../people/level";
import { SCHOOL_CARD } from "./copy";
import { card } from "./api";
import { useCardLoad } from "./frame";
import { usePeriod, withPeriod } from "./period";
import { PeriodChips } from "./parts";
import { CoachObsTable, OverviewCard, SchoolTeachers } from "./schoolView";
import type { PeriodKey, SchoolCardData, SchoolPrincipal } from "./types";
import { WhereDoor } from "./whereDoor";
import { WHERE } from "./whereCopy";
import { firstTo } from "./where";

/**
 * A school's School card (the switch on), as Rifat's School view (bd-17v39c.4.13, mockups v3 approved 5 Nov): the school,
 * the period (Today · This week · This month), then the overview (who used NIETE this period and the same days before;
 * five boxes two to a row, each opening that feature's details page), one teacher table (her four counts under icon heads,
 * Contribution %, ★ on the top two, the teachers with nothing always shown with 0s), the coach-observations table, and
 * the school's Manage group. The five Activity tiles left the card: their charts open the details pages now.
 * THE PRINCIPAL (bd-17v39c.4.15, option A): never in the table or a count (the server leaves them out); the header names
 * them in a chip, "Principal: name ›", that opens their page, one chip each. None recorded: a dashed "Principal: not
 * recorded ›" chip that opens the school's Edit teacher, where a coach can set who is the principal.
 * No Share, no Schedule dock. Every number is the server's; one that did not load is "—", never 0.
 */

/**
 * bd-17v39c.4.15 — the school's principal(s) in its header, in the Schools feature's colour (the kit's FEATURE_HUE): one
 * chip each opening their page; none recorded, the dashed chip to Edit teacher. An older server that sends no list: none.
 */
export function PrincipalChips({ principals, emis, period, level }: {
  principals: SchoolPrincipal[] | undefined; emis: string; period: PeriodKey; level: TeachingLevel | null;
}) {
  const C = useCopy(SCHOOL_CARD);
  if (!principals) return null;
  const icon = <UserRound className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />;
  if (!principals.length) {
    return (
      <PageLinkChip testId="card-principal-none" dashed to={withLevel(`/portal/coach/school/${encodeURIComponent(emis)}/edit-teacher`, level)}
        label={C.principalNoneSpoken}>
        {icon}<span>{C.principalKey} {C.principalNone}</span>
      </PageLinkChip>
    );
  }
  return (
    <>
      {principals.map((p) => (
        <PageLinkChip key={p.teacherExtId} testId="card-principal" hue={FEATURE_HUE.schools} label={C.principalSpoken(p.name)}
          to={withPeriod(`/portal/coach/teacher/${encodeURIComponent(p.teacherExtId)}`, period)}>
          {icon}<span className="shrink-0">{C.principalKey}</span>{" "}<span dir="auto" className="min-w-0 truncate font-bold text-[#1d2025]">{p.name}</span>
        </PageLinkChip>
      ))}
    </>
  );
}

export default function SchoolCardPage() {
  const C = useCopy(SCHOOL_CARD);
  const F = useCopy(TEACHER_FRAME);
  const W = useCopy(WHERE);
  const { emis = "" } = useParams();
  const [period] = usePeriod();
  // bd-ewbzns.1 — Primary / Middle / High: the server's card for that level's teachers (every tile and the list).
  const [level] = useLevel();
  const { notice } = useNotice();
  const { data, failed, reload } = useCardLoad<SchoolCardData>(() => card.school(emis, period, level), [emis, period, level]);
  // The school's name and numbers stay in the header while another period loads.
  const known = useRef<SchoolCardData["school"] | null>(null);
  if (data?.school) known.current = data.school;
  const school = data?.school ?? known.current;
  // The chips stay put while another level loads.
  const knownLevels = useRef<SchoolCardData["levels"] | null>(null);
  if (data?.levels) knownLevels.current = data.levels;

  const base = `/portal/coach/school/${encodeURIComponent(emis)}`;
  const teachers = data?.teachers ?? [];
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
          <PrincipalChips principals={school.principals} emis={school.emis || emis} period={period} level={level} />
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

          {/* bd-33wxxi.3 — the Teachers section is one shared piece (a principal's My school draws it too). */}
          <SchoolTeachers teachers={teachers} period={period} level={level} linkOf={teacherLink} state={linkState} />

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

          {/* bd-17v39c.4.14 — coach only (Rifat's pick 2A: its own page, so this view stays as a head would see it). */}
          <WhereDoor testId="first-door" to={withLevel(firstTo(emis), level)} label={W.openFirst} state={{ back: schoolPage(base) }} />

          {/* Manage is the whole school's, whatever level is picked. */}
          {/* bd-17v39c.4.16 — Remove teachers lists teachers only: the whole roster less its principals. */}
          <ManageSchool emis={emis} name={data.school.name} teacherCount={data.school.roster ?? data.school.teachers ?? teachers.length}
            removeCount={data.school.roster != null && data.school.principals ? data.school.roster - data.school.principals.length : undefined} />
        </>
      )}
    </PeopleFrame>
  );
}

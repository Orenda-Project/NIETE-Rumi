import { useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { CalendarDays, ChevronDown, ChevronRight, MapPin } from "lucide-react";
import { PageChip } from "../../teacher/TeacherPage";
import { TEACHER_FRAME } from "../../teacher/copy";
import { useCopy } from "../../teacher/i18n";
import { Loading, SearchBox, SectionLabel } from "../ui";
import PeopleFrame, { LoadFailed } from "../people/PeopleFrame";
import ManageSchool from "../people/ManageSchool";
import { EmptyRow, Notice, useNotice } from "../people/rows";
import { SCHOOL_CARD } from "./copy";
import { card } from "./api";
import { useCardLoad } from "./frame";
import { bucketLabels, perDayLine, usePeriod, withPeriod } from "./period";
import { ActivityTile, Bars, CARD_FEATURES, ChangePill, CountsRow, FEATURE_OF, PeriodChips, Sparkline, StarChip } from "./parts";
import { FEATURE_HUE } from "../../teacher/icons/features";
import type { CardTeacher, SchoolCardData } from "./types";

/**
 * A school's School card (the switch on): the school, the period (Today · This week · This month), its four feature
 * tiles (plain counts: the total, "by N of M teachers", "about N a day" for a week or a month, a bar per school day or per
 * week; each opens that feature by teacher), its teachers (her four counts, last visit, Contribution %, ★ on the top two)
 * with the ones who did nothing in the period in a neutral fold, the coach observations, and the school's Manage group.
 * No Share, no Schedule dock. Every number is the server's; one that did not load is "—", never 0.
 */

const SEARCH_FROM = 10;
const LIST = "overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]";

const initials = (name: string) => {
  const w = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "·";
  return (Array.from(w[0])[0] + (w.length > 1 ? Array.from(w[w.length - 1])[0] : "")).toUpperCase();
};

function Avatar({ name }: { name: string }) {
  return <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#e8e9f0] text-[16px] font-bold text-[#33374a]">{initials(name)}</span>;
}

function TeacherRow({ t, to, state, first }: { t: CardTeacher; to: string; state: unknown; first: boolean }) {
  const C = useCopy(SCHOOL_CARD);
  const active = t.total > 0;
  return (
    <Link to={to} state={state} data-testid={active ? "card-teacher" : "card-teacher-none"}
      className={`flex min-h-[76px] items-center gap-3 px-3.5 transition-colors hover:bg-[#f9fafb] ${first ? "" : "border-t border-[#f0f1f3]"}`}>
      <Avatar name={t.name} />
      <span className="flex min-w-0 flex-1 flex-col gap-1 py-[11px]">
        {active && t.star ? <StarChip text={C.topContributor} /> : null}
        <span dir="auto" className="text-[16px] font-semibold leading-[1.3] [overflow-wrap:anywhere]">{t.name}</span>
        {active ? <CountsRow counts={t.counts} /> : null}
        <span className="truncate text-[13px] leading-[1.3] text-[#6b7280] rtl:leading-[1.75]">{C.lastVisit(t.lastVisitDaysAgo)}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {active ? <span dir="ltr" data-testid="contribution" className="text-[17px] font-bold tabular-nums">{C.pct(t.contributionPct)}</span> : null}
        <ChevronRight className="h-[22px] w-[22px] text-[#9ca3af] rtl:rotate-180" aria-hidden="true" />
      </span>
    </Link>
  );
}

function Fold({ title, rows }: { title: string; rows: ReactNode[] }) {
  const [open, setOpen] = useState(false);
  return (
    <section data-testid="nothing-fold" className={LIST}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="flex min-h-[56px] w-full items-center gap-2.5 px-4 text-start text-[16px] font-semibold text-[#374151] rtl:leading-[1.7]">
        <span>{title}</span>
        <span data-testid="nothing-count" className="inline-flex h-6 items-center rounded-full bg-[#e5e7eb] px-[9px] text-[12px] font-semibold text-[#374151]">{rows.length}</span>
        <ChevronDown className={`ms-auto h-[22px] w-[22px] text-[#6b7280] motion-safe:transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && <div className="border-t border-[#f0f1f3]">{rows}</div>}
    </section>
  );
}

export default function SchoolCardPage() {
  const C = useCopy(SCHOOL_CARD);
  const F = useCopy(TEACHER_FRAME);
  const { emis = "" } = useParams();
  const [period] = usePeriod();
  const { notice } = useNotice();
  const { data, failed, reload } = useCardLoad<SchoolCardData>(() => card.school(emis, period), [emis, period]);
  const [query, setQuery] = useState("");
  // The school's name and numbers stay in the header while another period loads.
  const known = useRef<SchoolCardData["school"] | null>(null);
  if (data?.school) known.current = data.school;
  const school = data?.school ?? known.current;

  const base = `/portal/coach/school/${encodeURIComponent(emis)}`;
  const teachers = data?.teachers ?? [];
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => (q ? teachers.filter((t) => t.name.toLowerCase().includes(q)) : teachers), [teachers, q]);
  const active = shown.filter((t) => t.total > 0)
    .sort((a, b) => (b.total - a.total) || a.name.localeCompare(b.name));
  const none = shown.filter((t) => !(t.total > 0)).sort((a, b) => a.name.localeCompare(b.name));
  const labels = data ? bucketLabels(period, data.period.buckets, C) : [];
  const future = data ? data.period.buckets.map((b) => b.future) : [];
  const teacherLink = (ext: string) => withPeriod(`/portal/coach/teacher/${encodeURIComponent(ext)}`, period);
  const linkState = school ? { schoolName: school.name, emis: school.emis } : undefined;

  return (
    <PeopleFrame title={school?.name || C.dash} crumb={F.coachNav.schools} backTo="/portal/coach/people" feature="schools"
      chips={school ? (
        <>
          <PageChip testId="card-emis"><MapPin className="h-3.5 w-3.5" aria-hidden="true" />{C.emis(school.emis || emis)}</PageChip>
          <PageChip testId="card-last-visit"><CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />{C.lastVisit(school.lastVisitDaysAgo)}</PageChip>
        </>
      ) : undefined}>
      <Notice text={notice} />
      <PeriodChips />
      {failed && <LoadFailed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {data && (
        <>
          <SectionLabel>{C.activity}</SectionLabel>
          <div data-testid="activity" className="flex flex-col gap-2.5">
            {CARD_FEATURES.map((f) => {
              const tile = data.tiles.find((x) => x.feature === f);
              const total = tile?.total ?? null;
              const lines = [
                tile && tile.makers != null ? C.byN(tile.makers, data.school.teachers) : null,
                perDayLine(period, tile?.perDay, total, C),
              ].filter((l): l is string => !!l);
              return (
                <ActivityTile key={f} feature={f} total={total} label={C.tileLabel[f](total ?? 0)} lines={lines}
                  to={withPeriod(`${base}/feature/${f}`, period)} state={linkState}
                  bars={period !== "today" && tile && labels.length
                    ? <Bars values={tile.series} labels={labels} future={future} colour={FEATURE_HUE[FEATURE_OF[f]].fg} testId={`bars-${f}`} />
                    : undefined} />
              );
            })}
          </div>

          <SectionLabel right={<span className="text-[13px] font-semibold text-[#6b7280]">{C.contribution}</span>}>{C.teachers}</SectionLabel>
          {teachers.length > SEARCH_FROM && <SearchBox value={query} onChange={setQuery} placeholder={C.teacherName} />}
          {teachers.length === 0 && <EmptyRow icon={<span>·</span>} testId="no-teachers">{C.noTeachers}</EmptyRow>}
          {teachers.length > 0 && shown.length === 0 && <EmptyRow icon={<span>·</span>} testId="no-match">{C.noMatch}</EmptyRow>}
          {active.length > 0 && (
            <section data-testid="card-teachers" className={LIST}>
              {active.map((t, i) => <TeacherRow key={t.teacherExtId} t={t} to={teacherLink(t.teacherExtId)} state={linkState} first={i === 0} />)}
            </section>
          )}
          {none.length > 0 && (
            <Fold title={C.nothing[period]} rows={none.map((t, i) => <TeacherRow key={t.teacherExtId} t={t} to={teacherLink(t.teacherExtId)} state={linkState} first={i === 0} />)} />
          )}

          <SectionLabel count={C.inPeriod[period](data.coachObservations.count)}
            right={data.coachObservations.teachers.length ? <span className="text-[13px] font-semibold text-[#6b7280]">{C.coachScore}</span> : undefined}>
            {C.coachObs}
          </SectionLabel>
          {data.coachObservations.teachers.length === 0
            ? <EmptyRow icon={<span>·</span>} testId="no-coach-obs">{C.noCoachObs[period]}</EmptyRow>
            : (
              <section data-testid="coach-obs" className={LIST}>
                {data.coachObservations.teachers.map((o, i) => (
                  // Information only: a coach observation's report lives in Observe, which the coach app does not show yet.
                  <div key={o.teacherExtId} data-testid="coach-obs-row" role="group"
                    className={`grid min-h-[68px] items-center gap-2.5 px-3.5 py-2 ${i ? "border-t border-[#f0f1f3]" : ""}`} style={{ gridTemplateColumns: "minmax(0,1fr) 64px auto" }}>
                    <span className="min-w-0">
                      <span dir="auto" className="block truncate text-[16px] font-semibold leading-[1.3]">{o.name}</span>
                      <span className="text-[13px] leading-[1.3] text-[#6b7280] rtl:leading-[1.75]">{C.obsN(o.count)}</span>
                    </span>
                    <Sparkline values={o.points.map((p) => p.score).filter((s): s is number => typeof s === "number")} />
                    <span className="flex flex-col items-end gap-[3px]">
                      <b dir="ltr" className="text-[17px] font-bold tabular-nums" style={{ lineHeight: 1.15 }}>{C.pct(o.latest)}</b>
                      <ChangePill delta={o.change} same={C.same} />
                    </span>
                  </div>
                ))}
              </section>
            )}

          <ManageSchool emis={emis} name={data.school.name} teacherCount={data.school.teachers ?? teachers.length} />
        </>
      )}
    </PeopleFrame>
  );
}

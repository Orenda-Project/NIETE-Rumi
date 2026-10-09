import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Clock, Plus, School } from "lucide-react";
import { useCopy } from "../../teacher/i18n";
import { StatusChip } from "../../teacher/ui/StatusChip";
import { TimeStamp } from "../../teacher/ui/TimeStamp";
import { coach } from "../../services/api";
import { SectionLabel, DayLabel, Initials, RowText, TapRow, SelectBox, BottomLink, Loading, Failed, useLoad, formatPhone } from "../ui";
import { karachiDay, localDay } from "../time";
import { OBSERVE } from "../observe/copy";
import { dayShort } from "../observe/format";
import ObservePage from "../observe/ObservePage";
import type { CoachVisit } from "../types";

/**
 * bd-4404s7.4 — Take observation, step 1: pick the teacher from her scheduled visits (Blueprint: Coach_Pick).
 *
 * NO search (operator, 9 Oct: "Buttons and grouping stay simple here"): the list is grouped by day — Today first, the
 * days that follow in order, and the days before folded under "Earlier" (one tap; its count and how many are overdue
 * show on the fold) — and ONE School button narrows it. A visit already done cannot be picked. No visit scheduled:
 * "Schedule a visit first".
 *
 * Every visit from 30 days back to 90 ahead, and every overdue one however old (bd-o15qnr.8). Times are TimeStamp; the
 * status of a visit uses the kit's status tones (Done green, Next grey, N days late amber).
 */

const DAYS_BACK = 30;
const DAYS_AHEAD = 90;

function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + n);
  return localDay(d);
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

/** Visits in date-then-time order, grouped by day. */
function byDay(visits: CoachVisit[]): { day: string; visits: CoachVisit[] }[] {
  const sorted = [...visits].sort((a, b) => {
    const da = a.scheduledFor || "";
    const db = b.scheduledFor || "";
    if (da !== db) return da < db ? -1 : 1;
    const sa = /^\d{2}:\d{2}$/.test(a.scheduledSlot || "") ? a.scheduledSlot! : "~";
    const sb = /^\d{2}:\d{2}$/.test(b.scheduledSlot || "") ? b.scheduledSlot! : "~";
    return sa === sb ? 0 : sa < sb ? -1 : 1;
  });
  const groups: { day: string; visits: CoachVisit[] }[] = [];
  for (const v of sorted) {
    const day = v.scheduledFor || "";
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.visits.push(v);
    else groups.push({ day, visits: [v] });
  }
  return groups;
}

const CoachObservePick = () => {
  const C = useCopy(OBSERVE);
  const today = karachiDay(); // bd-o15qnr.23: the day in Pakistan
  const { data, failed, reload } = useLoad(
    () => coach.getSchedule({ from: addDays(today, -DAYS_BACK), to: addDays(today, DAYS_AHEAD) }), [today]);
  const [school, setSchool] = useState("");
  const [openEarlier, setOpenEarlier] = useState(false);

  const all = useMemo(() => {
    const seen = new Set<string>();
    const out: CoachVisit[] = [];
    for (const v of [...(data?.overdue || []), ...(data?.visits || [])]) {
      if (!seen.has(v.id)) { seen.add(v.id); out.push(v); }
    }
    return out;
  }, [data]);
  const schools = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of all) if (v.schoolExtId) m.set(v.schoolExtId, v.schoolName || v.schoolExtId);
    return [...m.entries()].map(([value, label]) => ({ value, label }));
  }, [all]);
  const shown = all.filter((v) => !school || v.schoolExtId === school);
  const earlier = byDay(shown.filter((v) => (v.scheduledFor || "") < today));
  const todays = shown.filter((v) => v.scheduledFor === today);
  const later = byDay(shown.filter((v) => (v.scheduledFor || "") > today));
  const nextId = todays.find((v) => v.status === "upcoming")?.id;
  const earlierCount = earlier.reduce((n, g) => n + g.visits.length, 0);
  const lateCount = earlier.reduce((n, g) => n + g.visits.filter((v) => v.status === "upcoming").length, 0);
  // A school filter opens Earlier, so a match is never hidden behind the fold.
  const earlierOpen = openEarlier || !!school;

  const sub = (v: CoachVisit) => [v.schoolName, formatPhone(v.teacherExtId)].filter(Boolean).join(" · ");

  const row = (v: CoachVisit) => {
    if (v.status === "done") {
      return (
        <div key={v.id} aria-disabled="true" className="flex min-h-[84px] items-center gap-3.5 rounded-2xl border border-[#e5e7eb] bg-[#f9fafb] p-3 opacity-75">
          <Initials name={v.teacherName} />
          <RowText name={v.teacherName || C.dash} sub={sub(v)} />
          <span className="flex shrink-0 flex-col items-end gap-1">
            <TimeStamp time={v.scheduledSlot} tone="done" />
            <StatusChip text={C.done} tone="done" tick />
          </span>
        </div>
      );
    }
    const late = !!v.scheduledFor && v.scheduledFor < today;
    return (
      <TapRow key={v.id} to={`/portal/coach/visit/${v.id}`} emphasis={v.id === nextId}>
        <Initials name={v.teacherName} />
        <RowText name={v.teacherName || C.dash} sub={sub(v)} />
        <span className="flex shrink-0 flex-col items-end gap-1">
          <TimeStamp time={v.scheduledSlot} tone={late ? "overdue" : v.id === nextId ? "next" : "neutral"} />
          {late ? <StatusChip text={C.daysLate(daysBetween(v.scheduledFor!, today))} tone="waiting" />
            : v.id === nextId ? <StatusChip text={C.next} tone="info" /> : null}
        </span>
      </TapRow>
    );
  };

  const group = (g: { day: string; visits: CoachVisit[] }) => (
    <div key={g.day} className="flex flex-col gap-2.5">
      <DayLabel count={g.visits.length}>{g.day ? dayShort(g.day, C) : C.dash}</DayLabel>
      {g.visits.map(row)}
    </div>
  );

  return (
    <ObservePage title={C.pickTheTeacher} crumb={`${C.observe} · ${C.takeObservation}`} backTo="/portal/coach/observe" feature="observations"
      dock={<BottomLink to="/portal/coach/new-visit" tone="outline"><Plus className="h-5 w-5" aria-hidden="true" />{C.scheduleFirst}</BottomLink>}>
      <SelectBox label={C.school} value={school} onChange={setSchool} icon={<School className="h-5 w-5 shrink-0 text-[#6b7280]" aria-hidden="true" />}
        options={[{ value: "", label: C.allSchools }, ...schools]} />
      {failed && <Failed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {data && (
        <>
          {earlierCount > 0 && (
            <section data-testid="day-group" data-day="earlier" className="flex flex-col gap-2.5">
              <button type="button" aria-expanded={earlierOpen} onClick={() => setOpenEarlier((o) => !o)}
                className="flex min-h-[56px] items-center gap-2.5 rounded-2xl border border-[#e5e7eb] bg-white px-3.5 text-start text-[15px] font-semibold text-[#33374a] shadow-[0_1px_3px_rgba(16,24,40,0.08)]">
                <Clock className="h-[18px] w-[18px] text-[#6b7280]" aria-hidden="true" />
                <span>{C.earlier}</span>
                <StatusChip text={String(earlierCount)} tone="info" />
                {lateCount > 0 && <StatusChip text={C.overdueN(lateCount)} tone="waiting" />}
                <span className="flex-1" />
                {earlierOpen ? <ChevronUp className="h-5 w-5 text-[#9ca3af]" aria-hidden="true" /> : <ChevronDown className="h-5 w-5 text-[#9ca3af]" aria-hidden="true" />}
              </button>
              {earlierOpen && earlier.map(group)}
            </section>
          )}
          <section data-testid="day-group" data-day={today} className="flex flex-col gap-2.5">
            <SectionLabel count={todays.length}>{C.today}</SectionLabel>
            {todays.map(row)}
          </section>
          {later.map((g) => (
            <section key={g.day} data-testid="day-group" data-day={g.day} className="flex flex-col gap-2.5">
              {group(g)}
            </section>
          ))}
        </>
      )}
    </ObservePage>
  );
};

export default CoachObservePick;

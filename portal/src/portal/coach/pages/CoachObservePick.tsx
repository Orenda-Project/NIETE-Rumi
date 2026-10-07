import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, Clock, Plus, School } from "lucide-react";
import { coach } from "../../services/api";
import { COACH_COPY as C } from "../copy";
import { CoachPage, SectionLabel, DayLabel, Chip, TimeTile, RowText, TapRow, SearchBox, SelectBox, BottomLink, Loading, Failed, useLoad, personMatches, formatPhone } from "../ui";
import { localDay } from "../time";
import type { CoachVisit } from "../types";

/**
 * bd-o15qnr — Take observation, step 1: pick the teacher from her scheduled
 * visits. Search by name or phone (teacher_ext_id is the phone), filter by
 * school. A visit already done cannot be picked. No visit scheduled:
 * "Schedule a visit first".
 *
 * bd-o15qnr.8 — operator: "it shows only today's scheduled observations. You can
 * show all of the observations chronologically ordered". Every visit from 30
 * days back to 90 ahead (and every overdue one, however old), by day, in order:
 * Earlier (one tap to open, so Today stays near the top) · Today · later days.
 * A search or a school filter opens Earlier, so a match is never hidden. Each
 * row shows the teacher's phone.
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

const dayLabel = (day: string) => new Date(`${day}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

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
  const today = localDay();
  const { data, failed, reload } = useLoad(
    () => coach.getSchedule({ from: addDays(today, -DAYS_BACK), to: addDays(today, DAYS_AHEAD) }), [today]);
  const [q, setQ] = useState("");
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
  const keep = (v: CoachVisit) => (!school || v.schoolExtId === school) && personMatches(v.teacherName, v.teacherExtId, q);
  const shown = all.filter(keep);
  const earlier = byDay(shown.filter((v) => (v.scheduledFor || "") < today));
  const todays = shown.filter((v) => v.scheduledFor === today);
  const later = byDay(shown.filter((v) => (v.scheduledFor || "") > today));
  const nextId = todays.find((v) => v.status === "upcoming")?.id;
  const earlierCount = earlier.reduce((n, g) => n + g.visits.length, 0);
  const lateCount = earlier.reduce((n, g) => n + g.visits.filter((v) => v.status === "upcoming").length, 0);
  const earlierOpen = openEarlier || !!q.trim() || !!school;

  const sub = (v: CoachVisit) => [v.schoolName, formatPhone(v.teacherExtId)].filter(Boolean).join(" · ");

  const row = (v: CoachVisit) => {
    if (v.status === "done") {
      return (
        <div key={v.id} aria-disabled="true" className="flex min-h-[84px] items-center gap-3.5 rounded-2xl border border-[#e5e7eb] bg-[#f9fafb] p-3 opacity-75">
          <TimeTile slot={v.scheduledSlot} tone="done" />
          <RowText name={v.teacherName || C.dash} sub={sub(v)} />
          <Chip tone="done"><Check className="h-3.5 w-3.5" aria-hidden="true" />{C.done}</Chip>
        </div>
      );
    }
    const late = !!v.scheduledFor && v.scheduledFor < today;
    return (
      <TapRow key={v.id} to={`/portal/coach/visit/${v.id}`} emphasis={v.id === nextId}>
        <TimeTile slot={v.scheduledSlot} tone={late ? "overdue" : v.id === nextId ? "next" : "neutral"} />
        <RowText name={v.teacherName || C.dash} sub={sub(v)} />
        {v.id === nextId && <Chip>{C.next}</Chip>}
        {late && <Chip tone="warn">{C.daysLate(daysBetween(v.scheduledFor!, today))}</Chip>}
      </TapRow>
    );
  };

  const group = (g: { day: string; visits: CoachVisit[] }) => (
    <div key={g.day} className="flex flex-col gap-2.5">
      <DayLabel count={g.visits.length}>{g.day ? dayLabel(g.day) : C.dash}</DayLabel>
      {g.visits.map(row)}
    </div>
  );

  return (
    <CoachPage title={C.pickTheTeacher} crumb={`${C.observe} · ${C.takeObservation}`} backTo="/portal/coach/observe"
      dock={<BottomLink to="/portal/coach/new-visit" tone="outline"><Plus className="h-5 w-5" aria-hidden="true" />{C.scheduleFirst}</BottomLink>}>
      <SearchBox value={q} onChange={setQ} placeholder={C.searchPlaceholder} />
      <SelectBox label={C.school} value={school} onChange={setSchool} icon={<School className="h-5 w-5 shrink-0 text-[#6b7280]" aria-hidden="true" />}
        options={[{ value: "", label: C.allSchools }, ...schools]} />
      {failed && <Failed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {data && (
        <>
          {earlierCount > 0 && (
            <section data-testid="day-group" data-day="earlier" className="flex flex-col gap-2.5">
              <button type="button" aria-expanded={earlierOpen} onClick={() => setOpenEarlier((o) => !o)}
                className="flex min-h-[56px] items-center gap-2.5 rounded-2xl border border-[#e5e7eb] bg-white px-3.5 text-left text-[15px] font-semibold text-[#33374a] shadow-[0_1px_3px_rgba(16,24,40,0.08)]">
                <Clock className="h-[18px] w-[18px] text-[#6b7280]" aria-hidden="true" />
                <span>{C.earlier}</span>
                <Chip>{earlierCount}</Chip>
                {lateCount > 0 && <Chip tone="warn">{C.overdueN(lateCount)}</Chip>}
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
    </CoachPage>
  );
};

export default CoachObservePick;

import { useMemo, useState } from "react";
import { Check, Clock, Plus, School } from "lucide-react";
import { coach } from "../../services/api";
import { COACH_COPY as C } from "../copy";
import { CoachPage, SectionLabel, Chip, TimeTile, RowText, TapRow, SearchBox, SelectBox, BottomLink, Loading, Failed, useLoad, personMatches } from "../ui";
import { localDay } from "../time";
import type { CoachVisit } from "../types";

/**
 * bd-o15qnr — Take observation, step 1: pick the teacher from her scheduled
 * visits (today, then overdue). Search by name or phone (teacher_ext_id is the
 * phone), filter by school. A visit already done cannot be picked. No visit
 * scheduled: "Schedule a visit first".
 */

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

const CoachObservePick = () => {
  const today = localDay();
  const { data, failed, reload } = useLoad(() => coach.getSchedule({ from: today, to: today }), [today]);
  const [q, setQ] = useState("");
  const [school, setSchool] = useState("");

  const todays = useMemo(() => (data?.visits || []).filter((v) => v.scheduledFor === today), [data, today]);
  const overdue = data?.overdue || [];
  const schools = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of [...todays, ...overdue]) if (v.schoolExtId) m.set(v.schoolExtId, v.schoolName || v.schoolExtId);
    return [...m.entries()].map(([value, label]) => ({ value, label }));
  }, [todays, overdue]);
  const keep = (v: CoachVisit) => (!school || v.schoolExtId === school) && personMatches(v.teacherName, v.teacherExtId, q);
  const nextId = todays.find((v) => v.status === "upcoming")?.id;

  const row = (v: CoachVisit, isOverdue = false) => {
    if (v.status === "done") {
      return (
        <div key={v.id} aria-disabled="true" className="flex min-h-[84px] items-center gap-3.5 rounded-2xl border border-[#e5e7eb] bg-[#f9fafb] p-3 opacity-75">
          <TimeTile slot={v.scheduledSlot} tone="done" />
          <RowText name={v.teacherName || C.dash} sub={v.schoolName} />
          <Chip tone="done"><Check className="h-3.5 w-3.5" aria-hidden="true" />{C.done}</Chip>
        </div>
      );
    }
    return (
      <TapRow key={v.id} to={`/portal/coach/visit/${v.id}`} emphasis={v.id === nextId}>
        <TimeTile slot={v.scheduledSlot} tone={isOverdue ? "overdue" : v.id === nextId ? "next" : "neutral"} />
        <RowText name={v.teacherName || C.dash} sub={isOverdue && v.scheduledFor ? `${v.schoolName || ""} · ${new Date(`${v.scheduledFor}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}` : v.schoolName} />
        {v.id === nextId && <Chip>{C.next}</Chip>}
        {isOverdue && v.scheduledFor && <Chip tone="warn">{C.daysLate(daysBetween(v.scheduledFor, today))}</Chip>}
      </TapRow>
    );
  };

  const shownToday = todays.filter(keep);
  const shownOverdue = overdue.filter(keep);

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
          <SectionLabel>{C.today}</SectionLabel>
          {shownToday.map((v) => row(v))}
          {shownOverdue.length > 0 && (
            <>
              <SectionLabel><span className="inline-flex items-center gap-2"><Clock className="h-[18px] w-[18px] text-[#b45309]" aria-hidden="true" />{C.overdue}</span></SectionLabel>
              {shownOverdue.map((v) => row(v, true))}
            </>
          )}
        </>
      )}
    </CoachPage>
  );
};

export default CoachObservePick;

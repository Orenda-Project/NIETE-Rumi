import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Plus, School, User } from "lucide-react";
import { coach, leader } from "../../services/api";
import { COACH_COPY as C } from "../copy";
import {
  CoachPage, Card, SectionLabel, Chip, Initials, RowText, Stats, SearchBox, StepBar, BottomButton, BottomLink, Loading, Failed, useLoad, personMatches, Chevron, formatPhone, IconTile,
} from "../ui";
import { DEFAULT_TIME, formatSlot, fromSlot, isAllowedSlot, karachiDay, localDay, pickHour, stepHour, toSlot, type VisitTime } from "../time";
import type { CoachSchool, CoachTeacher } from "../types";

/**
 * bd-o15qnr — New visit: 1 school → 2 teacher (her numbers, a Profile link,
 * search by name or phone) → 3 day and time → "Visit scheduled".
 *
 * The time is three toggles (hour 7–6, :00/:30, AM/PM), starting at 9:00 AM;
 * an hour picks its default AM/PM (7–11 AM, 12–6 PM) and she can still flip it.
 * Reschedule opens step 3 for one visit (?visit=…&slot=…) and edits it instead
 * of booking a new one. The server re-checks the teacher and the time.
 *
 * bd-o15qnr.8 (operator feedback): step 2 shows each teacher's phone; the day
 * strip pages a week back or forward, so a visit can be booked on a past day;
 * no AM/PM warning — whatever the toggles make can be booked.
 */

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Never-visited first, then the longest since a visit. */
function bySince<T extends { daysSinceVisit: number | null }>(a: T, b: T) {
  if (a.daysSinceVisit == null && b.daysSinceVisit == null) return 0;
  if (a.daysSinceVisit == null) return -1;
  if (b.daysSinceVisit == null) return 1;
  return b.daysSinceVisit - a.daysSinceVisit;
}

/** Seven days from today (in Pakistan, bd-o15qnr.23) + `offset` days. */
function weekFrom(offset: number) {
  const start = karachiDay();
  return Array.from({ length: 7 }, (_, i) => shiftDay(start, offset + i));
}

function shiftDay(day: string, by: number) {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + by);
  return localDay(d);
}

const short = (day: string) => new Date(`${day}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const WEEKS_BACK = 4;
const WEEKS_AHEAD = 8;

function SchoolStep({ schools, onPick }: { schools: CoachSchool[]; onPick: (s: CoachSchool) => string }) {
  return (
    <>
      <StepBar step={1} />
      <div className="px-1 pt-0.5 text-[13px] font-semibold text-[#6b7280]">{C.sortedBySince}</div>
      {[...schools].sort(bySince).map((s) => (
        <Link key={s.schoolExtId} to={onPick(s)} data-testid="school-option"
          className="flex min-h-[84px] items-center gap-3.5 rounded-2xl border border-[#e5e7eb] bg-white p-3 pe-3.5 shadow-[0_1px_3px_rgba(16,24,40,0.08)] hover:bg-[#f9fafb]">
          <IconTile hue="schools" size={48} testId="school-icon"><School className="h-6 w-6" /></IconTile>
          <RowText name={s.name || C.dash} sub={`${C.teachersCount(s.teachers)} · ${C.lastVisitDays(s.daysSinceVisit)}`} />
          <Chevron />
        </Link>
      ))}
    </>
  );
}

function TeacherStep({ school, teachers, linkFor }: { school: CoachSchool | undefined; teachers: CoachTeacher[]; linkFor: (t: CoachTeacher) => string }) {
  const [q, setQ] = useState("");
  const shown = teachers.filter((t) => personMatches(t.name, t.phone, q)).sort(bySince);
  return (
    <>
      <StepBar step={2} />
      <Card className="flex min-h-[60px] items-center gap-3 p-1.5 ps-3">
        <IconTile hue="schools" size={40} testId="school-icon"><School className="h-5 w-5" /></IconTile>
        <RowText name={<span className="text-base">{school?.name || C.dash}</span>} sub={school ? C.teachersCount(school.teachers) : undefined} />
        <Link to="/portal/coach/new-visit" className="flex min-h-[48px] min-w-[88px] items-center justify-center rounded-xl bg-[#f3f4f6] px-3.5 text-sm font-semibold text-[#33374a]">{C.change}</Link>
      </Card>
      <SearchBox value={q} onChange={setQ} placeholder={C.searchPlaceholder} />
      <div className="px-1 text-[13px] font-semibold text-[#6b7280]">{C.sortedBySince}</div>
      {shown.map((t) => (
        <div key={t.teacherExtId || t.name} data-testid={`teacher-${t.teacherExtId}`}
          className="flex flex-col overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.08)]">
          <Link to={linkFor(t)} className="flex flex-col hover:bg-[#f9fafb]">
            <span className="flex min-h-[76px] items-center gap-3 p-3 pe-3">
              <Initials name={t.name} />
              <RowText name={t.name} sub={[formatPhone(t.phone || t.teacherExtId), C.lastVisitDays(t.daysSinceVisit)].filter(Boolean).join(" · ")} />
              <Chevron />
            </span>
            <Stats items={[
              { value: t.hitl, label: C.hitl }, { value: t.dc, label: C.dc },
              { value: C.pct(t.avgHitl), label: C.avg }, { value: C.daysShort(t.daysSinceTraining), label: C.trainingCol },
            ]} />
          </Link>
          {t.teacherExtId && (
            <Link to={`/portal/coach/teacher/${t.teacherExtId}`} className="flex min-h-[48px] items-center gap-2 border-t border-[#e5e7eb] px-3.5 text-sm font-semibold text-[#33374a]">
              <User className="h-[18px] w-[18px]" aria-hidden="true" />{C.profile}
            </Link>
          )}
        </div>
      ))}
    </>
  );
}

function TimePicker({ value, onChange }: { value: VisitTime; onChange: (t: VisitTime) => void }) {
  const slot = toSlot(value);
  const opt = (on: boolean) => `flex min-h-[64px] items-center justify-center rounded-[14px] border text-xl font-bold tabular-nums ${on ? "border-[#33374a] bg-[#33374a] text-white" : "border-[#e5e7eb] bg-white text-[#4b5563]"}`;
  return (
    <Card className="flex flex-col gap-3.5 p-4" aria-label={C.time}>
      <div className="flex items-baseline justify-center gap-2 text-[44px] font-light leading-none tabular-nums" data-testid="time-readout" aria-live="polite">
        {formatSlot(slot)}
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        <div className="flex flex-col gap-1.5" role="group" aria-label={C.hour}>
          <span className="text-center text-xs font-semibold text-[#6b7280]">{C.hour}</span>
          <button type="button" aria-label={C.laterHour} onClick={() => onChange({ ...value, ...pickHour(stepHour(value.hour, 1)) })}
            className="flex min-h-[56px] items-center justify-center rounded-[14px] bg-[#f3f4f6] text-[#33374a]"><ChevronUp className="h-6 w-6" aria-hidden="true" /></button>
          <div className="flex min-h-[56px] items-center justify-center text-3xl font-bold tabular-nums">{value.hour}</div>
          <button type="button" aria-label={C.earlierHour} onClick={() => onChange({ ...value, ...pickHour(stepHour(value.hour, -1)) })}
            className="flex min-h-[56px] items-center justify-center rounded-[14px] bg-[#f3f4f6] text-[#33374a]"><ChevronDown className="h-6 w-6" aria-hidden="true" /></button>
        </div>
        <div className="flex flex-col gap-1.5" role="radiogroup" aria-label={C.minutes}>
          <span className="text-center text-xs font-semibold text-[#6b7280]">{C.minutes}</span>
          {([0, 30] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={value.minute === m} onClick={() => onChange({ ...value, minute: m })}
              className={`${opt(value.minute === m)} min-h-[81px]`}>{m === 0 ? ":00" : ":30"}</button>
          ))}
        </div>
        <div className="flex flex-col gap-1.5" role="radiogroup" aria-label={C.amPm}>
          <span className="text-center text-xs font-semibold text-[#6b7280]">{C.amPm}</span>
          {(["AM", "PM"] as const).map((mer) => (
            <button key={mer} type="button" role="radio" aria-checked={value.meridiem === mer} onClick={() => onChange({ ...value, meridiem: mer })}
              className={`${opt(value.meridiem === mer)} min-h-[81px]`}>{mer}</button>
          ))}
        </div>
      </div>
    </Card>
  );
}

function TimeStep({ teacher, schoolName, visitId, initialSlot, onDone }: {
  teacher: CoachTeacher | undefined; schoolName: string | null; visitId: string | null; initialSlot: string | null;
  onDone: (when: { date: string; slot: string }) => void;
}) {
  const today = karachiDay(); // bd-o15qnr.23: the day in Pakistan
  const [week, setWeek] = useState(0);
  const [date, setDate] = useState(today);
  const days = weekFrom(week * 7);
  // Paging keeps the same weekday picked, so a day is always chosen on screen.
  const page = (dir: 1 | -1) => { setWeek((w) => w + dir); setDate((d) => shiftDay(d, dir * 7)); };
  const [time, setTime] = useState<VisitTime>(() => (initialSlot ? fromSlot(initialSlot) : { ...DEFAULT_TIME }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const booked = useLoad(() => coach.getSchedule({ from: date, to: date }), [date]);
  const bookedSlots = (booked.data?.visits || []).filter((v) => v.id !== visitId && v.scheduledFor === date).map((v) => v.scheduledSlot);
  const slot = toSlot(time);

  const submit = async () => {
    if (!teacher?.teacherExtId || !isAllowedSlot(slot)) return;
    setSaving(true);
    setError(null);
    try {
      if (visitId) await coach.editSchedule(visitId, { date, slot });
      else await leader.createSchedule({ teacherExtId: teacher.teacherExtId, date, slot });
      onDone({ date, slot });
    } catch (err: any) {
      setError(err?.response?.data?.error || C.loadFailed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <StepBar step={3} />
      <Card className="flex min-h-[72px] items-center gap-3 p-2.5 ps-3">
        <Initials name={teacher?.name} />
        <RowText name={teacher?.name || C.dash} sub={schoolName} />
        {!visitId && <Link to={`/portal/coach/new-visit?school=${encodeURIComponent(teacher?.schoolExtId || "")}`}
          className="flex min-h-[48px] min-w-[88px] items-center justify-center rounded-xl bg-[#f3f4f6] px-3.5 text-sm font-semibold text-[#33374a]">{C.change}</Link>}
      </Card>
      <SectionLabel right={(
        <span className="flex items-center gap-1.5">
          <span className="text-[13px] font-semibold text-[#6b7280]">{`${short(days[0])} – ${short(days[6])}`}</span>
          <button type="button" aria-label={C.earlierDays} disabled={week <= -WEEKS_BACK} onClick={() => page(-1)}
            className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#e5e7eb] bg-white text-[#33374a] disabled:opacity-40"><ChevronLeft className="h-5 w-5 rtl:rotate-180" aria-hidden="true" /></button>
          <button type="button" aria-label={C.laterDays} disabled={week >= WEEKS_AHEAD} onClick={() => page(1)}
            className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#e5e7eb] bg-white text-[#33374a] disabled:opacity-40"><ChevronRight className="h-5 w-5 rtl:rotate-180" aria-hidden="true" /></button>
        </span>
      )}>{C.day}</SectionLabel>
      <Card className="grid grid-cols-7 gap-1 p-2">
        {days.map((d) => {
          const dt = new Date(`${d}T00:00:00`);
          const on = d === date;
          return (
            <button key={d} type="button" aria-pressed={on} aria-label={`${WEEKDAY[dt.getDay()]} ${dt.getDate()}`} onClick={() => setDate(d)}
              className={`flex min-h-[68px] flex-col items-center justify-center gap-0.5 rounded-xl ${on ? "bg-[#33374a] text-white" : d === today ? "shadow-[inset_0_0_0_1.5px_#c7cad6]" : ""} ${[0, 6].includes(dt.getDay()) && !on ? "opacity-50" : ""}`}>
              <small className={`text-[11px] font-semibold uppercase ${on ? "text-[#c7cad6]" : "text-[#6b7280]"}`}>{WEEKDAY[dt.getDay()]}</small>
              <b className="text-lg font-bold tabular-nums">{dt.getDate()}</b>
            </button>
          );
        })}
      </Card>
      <SectionLabel>{C.time}</SectionLabel>
      <TimePicker value={time} onChange={setTime} />
      {bookedSlots.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          <span className="text-[13px] font-semibold text-[#6b7280]">{C.booked}</span>
          {bookedSlots.map((s, i) => <Chip key={`${s}-${i}`}>{formatSlot(s)}</Chip>)}
        </div>
      )}
      {error && <Card className="border-[#fde68a] bg-[#fffbeb] p-3.5 text-[15px] font-semibold text-[#b45309]" role="alert">{error}</Card>}
      <div className="sticky bottom-20 z-10 -mx-4 flex bg-[#f3f4f6]/95 px-4 pb-2 pt-3 md:bottom-4 md:mx-0 md:px-0">
        <BottomButton onClick={submit} disabled={saving || !isAllowedSlot(slot) || !teacher?.teacherExtId}>
          <Check className="h-5 w-5" aria-hidden="true" />{saving ? C.saving : C.schedule}
        </BottomButton>
      </div>
    </>
  );
}

function Done({ teacher, schoolName, when }: { teacher: CoachTeacher | undefined; schoolName: string | null; when: { date: string; slot: string } }) {
  const dt = new Date(`${when.date}T00:00:00`);
  return (
    <>
      <div className="flex flex-col items-center gap-5 pt-10">
        <span className="flex h-[120px] w-[120px] items-center justify-center rounded-full bg-[#eaf6ef] text-[#48b078]" aria-hidden="true"><Check className="h-14 w-14" /></span>
        <h2 className="text-[30px] font-light">{C.visitScheduled}</h2>
      </div>
      <Card className="overflow-hidden">
        <div className="flex min-h-[72px] items-center gap-3 px-3.5 py-2.5"><Initials name={teacher?.name} /><RowText name={teacher?.name || C.dash} sub={schoolName} /></div>
        <div className="flex min-h-[72px] items-center gap-3 border-t border-[#e5e7eb] px-3.5 py-2.5">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#f3f4f6] text-[#33374a]" aria-hidden="true"><CalendarDays className="h-5 w-5" /></span>
          <RowText name={dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} sub={formatSlot(when.slot)} />
        </div>
      </Card>
      <div className="flex gap-2.5 pt-2">
        <BottomLink to="/portal/coach/new-visit" tone="outline"><Plus className="h-5 w-5" aria-hidden="true" />{C.newVisit}</BottomLink>
        <BottomLink to="/portal/coach/schedule">{C.mySchedule}</BottomLink>
      </div>
    </>
  );
}

const CoachNewVisit = () => {
  const [params] = useSearchParams();
  const schoolExt = params.get("school");
  const teacherExt = params.get("teacher");
  const visitId = params.get("visit");
  const initialSlot = params.get("slot");
  const { data, failed, reload } = useLoad(() => coach.getPeople(), []);
  const [done, setDone] = useState<{ date: string; slot: string } | null>(null);

  const school = useMemo(() => data?.schools.find((s) => s.schoolExtId === schoolExt), [data, schoolExt]);
  const teachers = useMemo(() => (data?.teachers || []).filter((t) => t.schoolExtId === schoolExt), [data, schoolExt]);
  const teacher = useMemo(() => (data?.teachers || []).find((t) => t.teacherExtId === teacherExt), [data, teacherExt]);

  const title = done ? C.newVisit : teacherExt ? C.pickDayTime : schoolExt ? C.pickTeacher : C.pickSchool;
  const back = visitId ? `/portal/coach/visit/${visitId}` : teacherExt ? `/portal/coach/new-visit?school=${encodeURIComponent(schoolExt || "")}` : schoolExt ? "/portal/coach/new-visit" : "/portal/coach/scheduling";
  const crumb = `${C.scheduling} · ${visitId ? C.reschedule : C.newVisit}`;

  return (
    <CoachPage title={title} crumb={crumb} backTo={back}>
      {failed && <Failed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {data && done && <Done teacher={teacher} schoolName={teacher?.schoolName || school?.name || null} when={done} />}
      {data && !done && !schoolExt && !teacherExt && (
        <SchoolStep schools={data.schools} onPick={(s) => `/portal/coach/new-visit?school=${encodeURIComponent(s.schoolExtId)}`} />
      )}
      {data && !done && schoolExt && !teacherExt && (
        <TeacherStep school={school} teachers={teachers}
          linkFor={(t) => `/portal/coach/new-visit?school=${encodeURIComponent(schoolExt)}&teacher=${encodeURIComponent(t.teacherExtId || "")}`} />
      )}
      {data && !done && teacherExt && (
        <TimeStep teacher={teacher} schoolName={teacher?.schoolName || school?.name || null} visitId={visitId} initialSlot={initialSlot} onDone={setDone} />
      )}
    </CoachPage>
  );
};

export default CoachNewVisit;

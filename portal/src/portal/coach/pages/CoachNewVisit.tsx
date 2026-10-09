import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Plus, User } from "lucide-react";
import { coach, leader } from "../../services/api";
import {
  CoachPage, Card, SectionLabel, RowText, Stats, SearchBox, StepBar, BottomButton, BottomLink, Loading, Failed, useLoad, personMatches, formatPhone,
} from "../ui";
import { DEFAULT_TIME, fromSlot, isAllowedSlot, karachiDay, pickHour, stepHour, toSlot, type VisitTime } from "../time";
import type { CoachSchool, CoachTeacher } from "../types";
import { ChosenSoFar, HistoryList, HistoryRow, StatusChip, TimeStamp } from "../../teacher/ui";
import { useKitCopy } from "../../teacher/ui/useKitCopy";
import { useCopy } from "../../teacher/i18n";
import { SCHEDULE } from "../schedule/copy";
import { BookedList, ClashAlert } from "../schedule/BookedList";
import { bookedOn, clashesAt, dayLong, dayShort, shiftDay, sinceText, sinceTone, timeWords, weekMonth } from "../schedule/model";

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
 *
 * bd-4404s7.3 (the Blueprint, coach build): what she chose so far is the kit's ChosenSoFar (plain text, a separate
 * Change); the month shows over the day strip; every time is the kit's TimeStamp; "Already booked" says who and when;
 * a time she already holds is an amber Clash row and a warning, and Schedule stays enabled (it warns, never blocks);
 * a school's and a teacher's last visit is a status chip in the kit's tones. Words: ../schedule/copy.ts (en + ur).
 * DayStrip, TimePicker and StepBar below are this page's own until the kit's PR 2 lands; then they are swapped in.
 */

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

const WEEKS_BACK = 4;
const WEEKS_AHEAD = 8;
const NEW_VISIT = "/portal/coach/new-visit";
const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n * 10) / 10}%`);

function SchoolStep({ schools, onPick }: { schools: CoachSchool[]; onPick: (s: CoachSchool) => string }) {
  const c = useCopy(SCHEDULE);
  return (
    <>
      <StepBar step={1} label={c.stepOf(1)} />
      <SectionLabel>{c.pickSchool}</SectionLabel>
      <p className="mx-1 -mt-1.5 text-[13px] font-semibold text-[#6b7280]">{c.lastVisit}</p>
      <div data-testid="since-legend" className="mx-1 flex flex-wrap gap-1.5">
        <StatusChip text={c.legendOld} tone="waiting" />
        <StatusChip text={c.legendMid} tone="info" />
        <StatusChip text={c.legendNew} tone="done" />
      </div>
      <HistoryList showMore={false} groups={[{
        day: "",
        items: [...schools].sort(bySince).map((s) => ({
          id: s.schoolExtId,
          lead: "school" as const,
          title: s.name || c.dash,
          extra: c.teachersCount(s.teachers),
          chip: { text: sinceText(s.daysSinceVisit, c), tone: sinceTone(s.daysSinceVisit) },
          to: onPick(s),
        })),
      }]} />
    </>
  );
}

function TeacherStep({ school, teachers, linkFor }: { school: CoachSchool | undefined; teachers: CoachTeacher[]; linkFor: (t: CoachTeacher) => string }) {
  const c = useCopy(SCHEDULE);
  const [q, setQ] = useState("");
  const shown = teachers.filter((t) => personMatches(t.name, t.phone, q)).sort(bySince);
  return (
    <>
      <StepBar step={2} label={c.stepOf(2)} />
      <ChosenSoFar heading={c.chosenSoFar} copy={{ change: c.change, chosenSoFar: c.chosenSoFar }}
        items={[{ label: c.school, value: school?.name || c.dash, sub: school ? c.teachersCount(school.teachers) : undefined, to: NEW_VISIT }]} />
      <SectionLabel>{c.pickTeacher}</SectionLabel>
      <SearchBox value={q} onChange={setQ} placeholder={c.searchPlaceholder} />
      <p className="mx-1 text-[13px] font-semibold text-[#6b7280]">{c.lastVisit}</p>
      {shown.map((t) => (
        <div key={t.teacherExtId || t.name} data-testid={`teacher-${t.teacherExtId}`}
          className="flex flex-col overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.08)]">
          <HistoryRow lead="person" title={t.name} extra={formatPhone(t.phone || t.teacherExtId) ?? undefined}
            chip={{ text: sinceText(t.daysSinceVisit, c), tone: sinceTone(t.daysSinceVisit) }} to={linkFor(t)} />
          <Stats items={[
            { value: t.hitl, label: c.hitl }, { value: t.dc, label: c.dc },
            { value: pct(t.avgHitl), label: c.avgHitl }, { value: t.daysSinceTraining == null ? "—" : `${t.daysSinceTraining}d`, label: c.training },
          ]} />
          {t.teacherExtId && (
            <Link to={`/portal/coach/teacher/${t.teacherExtId}`} className="flex min-h-[48px] items-center gap-2 border-t border-[#e5e7eb] px-3.5 text-sm font-semibold text-[#33374a]">
              <User className="h-[18px] w-[18px]" aria-hidden="true" />{c.profile}
            </Link>
          )}
        </div>
      ))}
    </>
  );
}

function TimePicker({ value, onChange, dayText, clash }: { value: VisitTime; onChange: (t: VisitTime) => void; dayText: string; clash: boolean }) {
  const c = useCopy(SCHEDULE);
  const kit = useKitCopy();
  const slot = toSlot(value);
  const opt = (on: boolean) => `flex min-h-[64px] items-center justify-center rounded-[14px] border text-xl font-bold tabular-nums ${on ? "border-[#33374a] bg-[#33374a] text-white" : "border-[#e5e7eb] bg-white text-[#4b5563]"}`;
  return (
    <Card className="flex flex-col gap-3.5 p-4" aria-label={c.time}>
      <div className="flex flex-col items-center gap-1" data-testid="time-readout">
        {/* the picked time as the kit draws every time; the live line below tells a screen reader when it changes */}
        <span aria-hidden="true" className="flex justify-center"><TimeStamp time={slot} tone={clash ? "overdue" : "neutral"} size={44} /></span>
        <span className="sr-only" aria-live="polite">{timeWords(slot, kit)}</span>
        <p className="text-[15px] font-semibold text-[#4b5563]">{dayText}</p>
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        <div className="flex flex-col gap-1.5" role="group" aria-label={c.hour}>
          <span className="text-center text-xs font-semibold text-[#6b7280]">{c.hour}</span>
          <button type="button" aria-label={c.laterHour} onClick={() => onChange({ ...value, ...pickHour(stepHour(value.hour, 1)) })}
            className="flex min-h-[56px] items-center justify-center rounded-[14px] bg-[#f3f4f6] text-[#33374a]"><ChevronUp className="h-6 w-6" aria-hidden="true" /></button>
          <div className="flex min-h-[56px] items-center justify-center text-3xl font-bold tabular-nums">{value.hour}</div>
          <button type="button" aria-label={c.earlierHour} onClick={() => onChange({ ...value, ...pickHour(stepHour(value.hour, -1)) })}
            className="flex min-h-[56px] items-center justify-center rounded-[14px] bg-[#f3f4f6] text-[#33374a]"><ChevronDown className="h-6 w-6" aria-hidden="true" /></button>
        </div>
        <div className="flex flex-col gap-1.5" role="radiogroup" aria-label={c.minutes}>
          <span className="text-center text-xs font-semibold text-[#6b7280]">{c.minutes}</span>
          {([0, 30] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={value.minute === m} onClick={() => onChange({ ...value, minute: m })}
              className={`${opt(value.minute === m)} min-h-[81px]`}>{m === 0 ? ":00" : ":30"}</button>
          ))}
        </div>
        <div className="flex flex-col gap-1.5" role="radiogroup" aria-label={c.amPm}>
          <span className="text-center text-xs font-semibold text-[#6b7280]">{c.amPm}</span>
          {(["AM", "PM"] as const).map((mer) => (
            <button key={mer} type="button" role="radio" aria-checked={value.meridiem === mer} onClick={() => onChange({ ...value, meridiem: mer })}
              className={`${opt(value.meridiem === mer)} min-h-[81px]`}>{mer === "AM" ? kit.am : kit.pm}</button>
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
  const c = useCopy(SCHEDULE);
  const kit = useKitCopy();
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
  const bookedVisits = useMemo(() => bookedOn(booked.data?.visits, date, visitId), [booked.data, date, visitId]);
  const slot = toSlot(time);
  const clashing = useMemo(() => clashesAt(bookedVisits, slot), [bookedVisits, slot]);
  const clashIds = useMemo(() => new Set(clashing.map((v) => v.id)), [clashing]);

  const submit = async () => {
    if (!teacher?.teacherExtId || !isAllowedSlot(slot)) return;
    setSaving(true);
    setError(null);
    try {
      if (visitId) await coach.editSchedule(visitId, { date, slot });
      else await leader.createSchedule({ teacherExtId: teacher.teacherExtId, date, slot });
      onDone({ date, slot });
    } catch (err: any) {
      setError(err?.response?.data?.error || c.loadFailed);
    } finally {
      setSaving(false);
    }
  };

  const teacherPhone = formatPhone(teacher?.phone || teacher?.teacherExtId);
  const arrow = "flex h-14 w-14 items-center justify-center text-[#33374a] disabled:opacity-40";
  return (
    <>
      <StepBar step={3} label={c.stepOf(3)} />
      {visitId ? (
        <Card className="overflow-hidden">
          <HistoryRow lead="person" action="none" title={teacher?.name || c.dash} extra={schoolName ?? undefined} />
        </Card>
      ) : (
        <ChosenSoFar heading={c.chosenSoFar} copy={{ change: c.change, chosenSoFar: c.chosenSoFar }} items={[
          { label: c.school, value: schoolName || c.dash, to: NEW_VISIT },
          { label: c.teacher, value: teacher?.name || c.dash, sub: teacherPhone ?? undefined, to: `${NEW_VISIT}?school=${encodeURIComponent(teacher?.schoolExtId || "")}` },
        ]} />
      )}
      <SectionLabel>{c.pickDayTime}</SectionLabel>
      <Card aria-label={c.day}>
        <div className="flex items-center gap-1 px-1 pt-1">
          <button type="button" aria-label={c.earlierDays} disabled={week <= -WEEKS_BACK} onClick={() => page(-1)} className={arrow}><ChevronLeft className="h-5 w-5 rtl:rotate-180" aria-hidden="true" /></button>
          <b className="flex-1 text-center text-lg font-semibold">{weekMonth(days, c)}</b>
          <button type="button" aria-label={c.laterDays} disabled={week >= WEEKS_AHEAD} onClick={() => page(1)} className={arrow}><ChevronRight className="h-5 w-5 rtl:rotate-180" aria-hidden="true" /></button>
        </div>
        <div className="grid grid-cols-7 gap-1 px-2 pb-2">
          {days.map((d) => {
            const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
            const on = d === date;
            const label = dayShort(d, c);
            return (
              <button key={d} type="button" aria-pressed={on} aria-label={label} onClick={() => setDate(d)}
                className={`flex min-h-[68px] flex-col items-center justify-center gap-0.5 rounded-xl ${on ? "bg-[#33374a] text-white" : d === today ? "shadow-[inset_0_0_0_1.5px_#c7cad6]" : ""} ${[0, 6].includes(dow) && !on ? "opacity-50" : ""}`}>
                <small className={`text-[11px] font-semibold uppercase ${on ? "text-[#c7cad6]" : "text-[#6b7280]"}`}>{c.weekdaysShort[dow]}</small>
                <b className="text-lg font-bold tabular-nums">{Number(d.slice(8))}</b>
              </button>
            );
          })}
        </div>
      </Card>
      <BookedList visits={bookedVisits} clashIds={clashIds} />
      <TimePicker value={time} onChange={setTime} dayText={dayLong(date, c)} clash={clashing.length > 0} />
      {clashing.length > 0 && <ClashAlert time={timeWords(slot, kit)} visits={clashing} />}
      {error && <Card className="border-[#fde68a] bg-[#fffbeb] p-3.5 text-[15px] font-semibold text-[#b45309]" role="alert">{error}</Card>}
      <div className="sticky bottom-20 z-10 -mx-4 flex bg-[#f3f4f6]/95 px-4 pb-2 pt-3 md:bottom-4 md:mx-0 md:px-0">
        <BottomButton onClick={submit} disabled={saving || !isAllowedSlot(slot) || !teacher?.teacherExtId}>
          <Check className="h-5 w-5" aria-hidden="true" />{saving ? c.saving : c.schedule}
        </BottomButton>
      </div>
    </>
  );
}

function Done({ teacher, schoolName, when }: { teacher: CoachTeacher | undefined; schoolName: string | null; when: { date: string; slot: string } }) {
  const c = useCopy(SCHEDULE);
  return (
    <>
      <div className="flex flex-col items-center gap-5 pt-10">
        <span className="flex h-[120px] w-[120px] items-center justify-center rounded-full bg-[#eaf6ef] text-[#48b078]" aria-hidden="true"><Check className="h-14 w-14" /></span>
        <h2 className="text-[30px] font-light">{c.visitScheduled}</h2>
      </div>
      <Card className="overflow-hidden">
        <HistoryRow lead="person" action="none" title={teacher?.name || c.dash} extra={schoolName ?? undefined} time={when.slot} timeTone="done" />
        <div className="flex min-h-[72px] items-center gap-3 border-t border-[#e5e7eb] px-3.5 py-2.5">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#f3f4f6] text-[#33374a]" aria-hidden="true"><CalendarDays className="h-5 w-5" /></span>
          <RowText name={dayLong(when.date, c)} sub={c.oneVisitAdded} />
          <StatusChip text={c.scheduled} tone="done" tick />
        </div>
      </Card>
      <div className="flex gap-2.5 pt-2">
        <BottomLink to={NEW_VISIT} tone="outline"><Plus className="h-5 w-5" aria-hidden="true" />{c.newVisit}</BottomLink>
        <BottomLink to="/portal/coach/schedule">{c.mySchedule}</BottomLink>
      </div>
    </>
  );
}

const CoachNewVisit = () => {
  const c = useCopy(SCHEDULE);
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

  const back = visitId ? `/portal/coach/visit/${visitId}` : teacherExt ? `${NEW_VISIT}?school=${encodeURIComponent(schoolExt || "")}` : schoolExt ? NEW_VISIT : "/portal/coach/scheduling";
  const crumb = visitId ? `${c.crumb} · ${c.reschedule}` : c.crumb;

  return (
    <CoachPage title={visitId ? c.reschedule : c.newVisit} crumb={crumb} backTo={back}>
      {failed && <Failed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {data && done && <Done teacher={teacher} schoolName={teacher?.schoolName || school?.name || null} when={done} />}
      {data && !done && !schoolExt && !teacherExt && (
        <SchoolStep schools={data.schools} onPick={(s) => `${NEW_VISIT}?school=${encodeURIComponent(s.schoolExtId)}`} />
      )}
      {data && !done && schoolExt && !teacherExt && (
        <TeacherStep school={school} teachers={teachers}
          linkFor={(t) => `${NEW_VISIT}?school=${encodeURIComponent(schoolExt)}&teacher=${encodeURIComponent(t.teacherExtId || "")}`} />
      )}
      {data && !done && teacherExt && (
        <TimeStep teacher={teacher} schoolName={teacher?.schoolName || school?.name || null} visitId={visitId} initialSlot={initialSlot} onDone={setDone} />
      )}
    </CoachPage>
  );
};

export default CoachNewVisit;

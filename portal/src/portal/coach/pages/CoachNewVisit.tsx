import { useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarDays, Check, Plus, User } from "lucide-react";
import { coach, leader } from "../../services/api";
import {
  CoachPage, Card, SectionLabel, RowText, SearchBox, BottomButton, BottomLink, Loading, Failed, useLoad, personMatches, formatPhone,
} from "../ui";
import { isAllowedSlot, karachiDay } from "../time";
import type { CoachSchool, CoachTeacher } from "../types";
import { ChosenSoFar, DayStrip, HistoryList, HistoryRow, StatStrip, StatusChip, StepBar, TimePicker } from "../../teacher/ui";
import { useKitCopy } from "../../teacher/ui/useKitCopy";
import { useCopy } from "../../teacher/i18n";
import { SCHEDULE } from "../schedule/copy";
import { BookedList, ClashAlert } from "../schedule/BookedList";
import { bookedOn, clashesAt, dayLong, sinceText, sinceTone, timeWords } from "../schedule/model";
import { LevelChips, atLevel, levelCounts, useLevel, withLevel, type TeachingLevel } from "../people/level";
import { useFlowV2 } from "../flow/useCoachFlowV2";
import { trackFlow } from "../flow/track";

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
 * StepBar, DayStrip (the month over the strip, week arrows), TimePicker (its readout turns amber on a clash) and StatStrip
 * are the kit's.
 */

/** Never-visited first, then the longest since a visit. */
function bySince<T extends { daysSinceVisit: number | null }>(a: T, b: T) {
  if (a.daysSinceVisit == null && b.daysSinceVisit == null) return 0;
  if (a.daysSinceVisit == null) return -1;
  if (b.daysSinceVisit == null) return 1;
  return b.daysSinceVisit - a.daysSinceVisit;
}

const NEW_VISIT = "/portal/coach/new-visit";
const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n * 10) / 10}%`);

function SchoolStep({ schools, onPick, chips }: { schools: CoachSchool[]; onPick: (s: CoachSchool) => string; chips?: ReactNode }) {
  const c = useCopy(SCHEDULE);
  return (
    <>
      {chips}
      <StepBar total={3} current={1} label={c.stepOf(1)} />
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

function TeacherStep({ school, teachers, linkFor, chips, changeTo = NEW_VISIT }: {
  school: CoachSchool | undefined; teachers: CoachTeacher[]; linkFor: (t: CoachTeacher) => string;
  /** bd-o15qnr.26 — the teaching-level chips (flow v2) and Change keeping the level */
  chips?: ReactNode; changeTo?: string;
}) {
  const c = useCopy(SCHEDULE);
  const [q, setQ] = useState("");
  const shown = teachers.filter((t) => personMatches(t.name, t.phone, q)).sort(bySince);
  return (
    <>
      {chips}
      <StepBar total={3} current={2} label={c.stepOf(2)} />
      <ChosenSoFar heading={c.chosenSoFar} copy={{ change: c.change, chosenSoFar: c.chosenSoFar }}
        items={[{ label: c.school, value: school?.name || c.dash, sub: school ? c.teachersCount(school.teachers) : undefined, to: changeTo }]} />
      <SectionLabel>{c.pickTeacher}</SectionLabel>
      <SearchBox value={q} onChange={setQ} placeholder={c.searchPlaceholder} />
      <p className="mx-1 text-[13px] font-semibold text-[#6b7280]">{c.lastVisit}</p>
      {shown.map((t) => (
        <div key={t.teacherExtId || t.name} data-testid={`teacher-${t.teacherExtId}`}
          className="flex flex-col overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.08)]">
          <HistoryRow lead="person" title={t.name} extra={formatPhone(t.phone || t.teacherExtId) ?? undefined}
            chip={{ text: sinceText(t.daysSinceVisit, c), tone: sinceTone(t.daysSinceVisit) }} to={linkFor(t)} />
          <StatStrip items={[
            { value: t.hitl, label: c.hitl }, { value: t.dc, label: c.dc },
            { value: pct(t.avgHitl), label: c.avgHitl }, { value: t.daysSinceTraining == null ? null : `${t.daysSinceTraining}d`, label: c.training },
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

/** bd-31ziu8 — where the booking screens link (the coach app's paths, or the principal app's: principals book alike). */
export type NewVisitLinks = { changeSchool: string; changeTeacher: (schoolExt: string) => string; newVisit: string; schedule: string };
const COACH_LINKS: NewVisitLinks = {
  changeSchool: NEW_VISIT,
  changeTeacher: (schoolExt) => `${NEW_VISIT}?school=${encodeURIComponent(schoolExt)}`,
  newVisit: NEW_VISIT,
  schedule: "/portal/coach/schedule",
};

export function TimeStep({ teacher, schoolName, visitId, initialSlot, onDone, links = COACH_LINKS }: {
  teacher: CoachTeacher | undefined; schoolName: string | null; visitId: string | null; initialSlot: string | null;
  onDone: (when: { date: string; slot: string }) => void; links?: NewVisitLinks;
}) {
  const c = useCopy(SCHEDULE);
  const kit = useKitCopy();
  const today = karachiDay(); // bd-o15qnr.23: the day in Pakistan
  const [date, setDate] = useState(today);
  const [slot, setSlot] = useState<string>(() => (initialSlot && isAllowedSlot(initialSlot) ? initialSlot : "09:00"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const booked = useLoad(() => coach.getSchedule({ from: date, to: date }), [date]);
  const bookedVisits = useMemo(() => bookedOn(booked.data?.visits, date, visitId), [booked.data, date, visitId]);
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
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || c.loadFailed);
    } finally {
      setSaving(false);
    }
  };

  const teacherPhone = formatPhone(teacher?.phone || teacher?.teacherExtId);
  return (
    <>
      <StepBar total={3} current={3} label={c.stepOf(3)} />
      {visitId ? (
        <Card className="overflow-hidden">
          <HistoryRow lead="person" action="none" title={teacher?.name || c.dash} extra={schoolName ?? undefined} />
        </Card>
      ) : (
        <ChosenSoFar heading={c.chosenSoFar} copy={{ change: c.change, chosenSoFar: c.chosenSoFar }} items={[
          { label: c.school, value: schoolName || c.dash, to: links.changeSchool },
          { label: c.teacher, value: teacher?.name || c.dash, sub: teacherPhone ?? undefined, to: links.changeTeacher(teacher?.schoolExtId || "") },
        ]} />
      )}
      <SectionLabel>{c.pickDayTime}</SectionLabel>
      <DayStrip label={c.day} value={date} onChange={setDate} />
      <BookedList visits={bookedVisits} clashIds={clashIds} />
      <div data-testid="time-picker"><TimePicker value={slot} onChange={setSlot} caption={dayLong(date, c)} tone={clashing.length > 0 ? "overdue" : undefined} /></div>
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

export function Done({ teacher, schoolName, when, links = COACH_LINKS }: {
  teacher: CoachTeacher | undefined; schoolName: string | null; when: { date: string; slot: string }; links?: NewVisitLinks;
}) {
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
        <BottomLink to={links.newVisit} tone="outline"><Plus className="h-5 w-5" aria-hidden="true" />{c.newVisit}</BottomLink>
        <BottomLink to={links.schedule}>{c.mySchedule}</BottomLink>
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

  // bd-o15qnr.26 (queue #177, flow v2 only) — All · Primary · Middle · High over steps 1 and 2 (the My schools chips, the
  // level in the address so Back keeps it). Shown only when nine in ten of her teachers have a level recorded: with
  // fewer (GB today, 11 of 102) a chip would hide teachers who teach at it, so there are none and every school shows.
  const flow = useFlowV2() === true;
  const [pickedLevel] = useLevel();
  const everyone = useMemo(() => data?.teachers || [], [data]);
  const chipsOn = flow && everyone.length > 0 && everyone.filter((t) => (t.levels ?? []).length > 0).length >= 0.9 * everyone.length;
  const level: TeachingLevel | null = chipsOn ? pickedLevel : null;
  const chipsFor = (counts: Partial<Record<TeachingLevel, number>>) => (chipsOn
    ? <LevelChips counts={counts} onPick={(l) => trackFlow("new_visit.level", l ? (l.toLowerCase() as "primary" | "middle" | "high") : "all")} />
    : undefined);

  const school = useMemo(() => data?.schools.find((s) => s.schoolExtId === schoolExt), [data, schoolExt]);
  const schoolTeachers = useMemo(() => everyone.filter((t) => t.schoolExtId === schoolExt), [everyone, schoolExt]);
  const teachers = useMemo(() => schoolTeachers.filter((t) => atLevel(t.levels, level)), [schoolTeachers, level]);
  const teacher = useMemo(() => everyone.find((t) => t.teacherExtId === teacherExt), [everyone, teacherExt]);
  // At a level: only schools with teachers at it, each counted at that level.
  const schools = useMemo(() => {
    if (!data || !level) return data?.schools || [];
    return data.schools
      .map((s) => ({ ...s, teachers: everyone.filter((t) => t.schoolExtId === s.schoolExtId && atLevel(t.levels, level)).length }))
      .filter((s) => s.teachers > 0);
  }, [data, everyone, level]);
  const shownSchool = school && level ? { ...school, teachers: teachers.length } : school;

  const back = visitId ? `/portal/coach/visit/${visitId}` : teacherExt ? withLevel(`${NEW_VISIT}?school=${encodeURIComponent(schoolExt || "")}`, level) : schoolExt ? withLevel(NEW_VISIT, level) : "/portal/coach/scheduling";
  const crumb = visitId ? `${c.crumb} · ${c.reschedule}` : c.crumb;

  return (
    <CoachPage title={visitId ? c.reschedule : c.newVisit} crumb={crumb} backTo={back}>
      {failed && <Failed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {data && done && <Done teacher={teacher} schoolName={teacher?.schoolName || school?.name || null} when={done} />}
      {data && !done && !schoolExt && !teacherExt && (
        <SchoolStep schools={schools} chips={chipsFor(levelCounts(everyone))}
          onPick={(s) => withLevel(`${NEW_VISIT}?school=${encodeURIComponent(s.schoolExtId)}`, level)} />
      )}
      {data && !done && schoolExt && !teacherExt && (
        <TeacherStep school={shownSchool} teachers={teachers} chips={chipsFor(levelCounts(schoolTeachers))} changeTo={withLevel(NEW_VISIT, level)}
          linkFor={(t) => withLevel(`${NEW_VISIT}?school=${encodeURIComponent(schoolExt)}&teacher=${encodeURIComponent(t.teacherExtId || "")}`, level)} />
      )}
      {data && !done && teacherExt && (
        <TimeStep teacher={teacher} schoolName={teacher?.schoolName || school?.name || null} visitId={visitId} initialSlot={initialSlot} onDone={setDone} />
      )}
    </CoachPage>
  );
};

export default CoachNewVisit;

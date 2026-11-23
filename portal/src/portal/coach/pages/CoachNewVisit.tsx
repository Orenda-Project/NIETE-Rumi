import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { BellOff, CalendarDays, Check, MessageCircle, Plus, Upload, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { coach, leader } from "../../services/api";
import {
  CoachPage, Card, Chevron, SectionLabel, RowText, SearchBox, BottomButton, BottomLink, Loading, Failed, useLoad, personMatches, formatPhone,
} from "../ui";
import { formatSlot, isAllowedSlot, karachiDay, karachiSlotNow } from "../time";
import type { CoachSchool, CoachTeacher } from "../types";
import { ChosenSoFar, DayStrip, HistoryList, HistoryRow, StatStrip, StatusChip, StepBar, TimePicker } from "../../teacher/ui";
import { useKitCopy } from "../../teacher/ui/useKitCopy";
import { useCopy } from "../../teacher/i18n";
import { FOCUS, LIST_CARD } from "../../teacher/ui/styles";
import { OBSERVE } from "../observe/copy";
import { FLOW_V6 } from "../flow/copy";
import ObservePage from "../observe/ObservePage";
import { recordPath } from "../schedule/VisitCard";
import { SCHEDULE } from "../schedule/copy";
import { BookedList, ClashAlert } from "../schedule/BookedList";
import { bookedOn, clashesAt, dayLong, sinceText, sinceTone, timeWords } from "../schedule/model";
import { LevelChips, atLevel, levelCounts, useLevel, useLevelNames, withLevel, type TeachingLevel } from "../people/level";
import { useFlowV2 } from "../flow/useCoachFlowV2";
import { trackFlow } from "../flow/track";
import { searchSchools } from "../../lib/schoolSearch";

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

/**
 * bd-o15qnr.26 — with the visit flow v2 switch on (the operator on #188's canvas, 19 Nov): no last-visit legend and no
 * "Last visit" label ("Remove this legend-like line from here"; each row keeps its chip), no Profile button on a teacher
 * ("Not sure if we need this button here"; the row picks the teacher). `v6` (bd-o15qnr.27): the school search, and teacher rows
 * with the level and phone instead of the numbers.
 */
type StepLook = { trimmed?: boolean; steps?: number; v6?: boolean };

function SchoolStep({ schools, onPick, chips, trimmed = false, steps = 3, v6 = false }: { schools: CoachSchool[]; onPick: (s: CoachSchool) => string; chips?: ReactNode } & StepLook) {
  const c = useCopy(SCHEDULE);
  const F = useCopy(FLOW_V6);
  const [q, setQ] = useState("");
  // bd-o15qnr.27 (v6): a school search over the list (#188's v6 board, step 1). bd-bfagiy: by name or EMIS, case, spaces
  // and punctuation not mattering, words in any order ("i103", "I 10 3", "IMSG I10"); the closest school first, then as
  // the list runs (never-visited first).
  const shown = searchSchools([...schools].sort(bySince), v6 ? q : "", (s) => ({ names: [s.name], codes: [s.emis] }));
  return (
    <>
      {chips}
      <StepBar total={steps} current={1} label={c.stepOfN(1, steps)} />
      <SectionLabel>{c.pickSchool}</SectionLabel>
      {v6 && <SearchBox value={q} onChange={setQ} placeholder={F.schoolSearch} />}
      {!trimmed && (
        <>
          <p className="mx-1 -mt-1.5 text-[13px] font-semibold text-[#6b7280]">{c.lastVisit}</p>
          <div data-testid="since-legend" className="mx-1 flex flex-wrap gap-1.5">
            <StatusChip text={c.legendOld} tone="waiting" />
            <StatusChip text={c.legendMid} tone="info" />
            <StatusChip text={c.legendNew} tone="done" />
          </div>
        </>
      )}
      <HistoryList showMore={false} groups={[{
        day: "",
        items: shown.map((s) => ({
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

function TeacherStep({ school, teachers, linkFor, chips, changeTo = NEW_VISIT, trimmed = false, steps = 3, v6 = false, bookedToday }: {
  school: CoachSchool | undefined; teachers: CoachTeacher[]; linkFor: (t: CoachTeacher) => string;
  /** bd-o15qnr.26 — the teaching-level chips (flow v2) and Change keeping the level */
  chips?: ReactNode; changeTo?: string;
  /** bd-o15qnr.27 (v6) — teacherExtId → today's booked slot, for the "Booked 10:30 AM" chip */
  bookedToday?: ReadonlyMap<string, string | null>;
} & StepLook) {
  const c = useCopy(SCHEDULE);
  const F = useCopy(FLOW_V6);
  const levelNames = useLevelNames();
  const [q, setQ] = useState("");
  const shown = teachers.filter((t) => personMatches(t.name, t.phone, q)).sort(bySince);
  return (
    <>
      {chips}
      <StepBar total={steps} current={2} label={c.stepOfN(2, steps)} />
      <ChosenSoFar heading={c.chosenSoFar} copy={{ change: c.change, chosenSoFar: c.chosenSoFar }}
        items={[{ label: c.school, value: school?.name || c.dash, sub: school ? c.teachersCount(school.teachers) : undefined, to: changeTo }]} />
      <SectionLabel>{c.pickTeacher}</SectionLabel>
      <SearchBox value={q} onChange={setQ} placeholder={c.searchPlaceholder} />
      {!trimmed && <p className="mx-1 text-[13px] font-semibold text-[#6b7280]">{c.lastVisit}</p>}
      {v6 && shown.map((t) => {
        // bd-o15qnr.27 (v6, #188's board): the name, the level and the phone, and when the teacher was last visited (or
        // the time booked today); the numbers stay on the teacher's own page. The row picks the teacher.
        const booked = t.teacherExtId ? bookedToday?.get(t.teacherExtId) : undefined;
        return (
          <div key={t.teacherExtId || t.name} data-testid={`teacher-${t.teacherExtId}`} className={LIST_CARD}>
            <HistoryRow lead="person" title={t.name}
              extra={[levelNames(t.levels), formatPhone(t.phone || t.teacherExtId)].filter(Boolean).join(" · ") || undefined}
              chip={booked !== undefined ? { text: F.bookedAt(formatSlot(booked)), tone: "info" } : { text: sinceText(t.daysSinceVisit, c), tone: sinceTone(t.daysSinceVisit) }}
              to={linkFor(t)} />
          </div>
        );
      })}
      {!v6 && shown.map((t) => (
        <div key={t.teacherExtId || t.name} data-testid={`teacher-${t.teacherExtId}`}
          className="flex flex-col overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.08)]">
          <HistoryRow lead="person" title={t.name} extra={formatPhone(t.phone || t.teacherExtId) ?? undefined}
            chip={{ text: sinceText(t.daysSinceVisit, c), tone: sinceTone(t.daysSinceVisit) }} to={linkFor(t)} />
          <StatStrip items={[
            { value: t.hitl, label: c.hitl }, { value: t.dc, label: c.dc },
            { value: pct(t.avgHitl), label: c.avgHitl }, { value: t.daysSinceTraining == null ? null : `${t.daysSinceTraining}d`, label: c.training },
          ]} />
          {!trimmed && t.teacherExtId && (
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

export function TimeStep({ teacher, schoolName, visitId, initialSlot, onDone, links = COACH_LINKS, note }: {
  teacher: CoachTeacher | undefined; schoolName: string | null; visitId: string | null; initialSlot: string | null;
  onDone: (when: { date: string; slot: string }) => void; links?: NewVisitLinks;
  /** bd-o15qnr.27 (v6, Schedule for Later) — one line above Schedule: who gets told ("Mehwish Ali gets a WhatsApp message.") */
  note?: ReactNode;
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
      {note}
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

/**
 * bd-o15qnr.27 (queue #204, v6) — step 3 of Schedule an observation: When? (#188's canvas, v6; the operator on v5:
 * "Schedule for Now" / "Schedule for Later").
 *
 *   Schedule for Now     the coach is in the class: Start recording or Upload recording. The visit is booked for today,
 *                        this half hour in Pakistan, with `now: true`, so the teacher gets NO "visit scheduled" WhatsApp and
 *                        the coach no calendar invite (the server skips both). Already booked today: that visit, no second
 *                        booking. A refused booking says why, with Try again.
 *   Schedule for Later   the app's own day-and-time picker (TimeStep: the day strip, 7:00 AM to 6:30 PM every half hour;
 *                        the operator: "We are fine with the current UI for picker"); the teacher gets the WhatsApp message.
 *
 * The teacher is named, never "him" or "her" (the operator: "Teachers are both genders").
 */
export function WhenStep({ teacher, schoolName, changeTo, laterTo, onNow }: {
  teacher: CoachTeacher; schoolName: string | null; changeTo: string; laterTo: string;
  /**
   * Where Now goes (the principal app: that teacher's record or upload screen; it books nothing, as the principal app
   * never has). Absent: the coach's quiet booking for now, then that visit's record or upload step.
   */
  onNow?: (kind: "record" | "upload") => Promise<string>;
}) {
  const c = useCopy(SCHEDULE);
  const O = useCopy(OBSERVE);
  const F = useCopy(FLOW_V6);
  const levelNames = useLevelNames();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<"record" | "upload" | null>(null);
  const [error, setError] = useState<{ kind: "record" | "upload"; text: string } | null>(null);

  const go = async (kind: "record" | "upload") => {
    if (!teacher.teacherExtId || busy) return;
    trackFlow(kind === "record" ? "schedule.now_record" : "schedule.now_upload");
    setBusy(kind);
    setError(null);
    const today = karachiDay();
    try {
      if (onNow) { navigate(await onNow(kind), { replace: true }); return; }
      const booked = await coach.getSchedule({ from: today, to: today });
      const mine = (booked?.visits || []).find((v) => v.teacherExtId === teacher.teacherExtId && v.scheduledFor === today && v.status === "upcoming");
      const id = mine?.id || (await leader.createSchedule({ teacherExtId: teacher.teacherExtId, date: today, slot: karachiSlotNow(), now: true })).id;
      if (!id) throw new Error(c.loadFailed);
      navigate(kind === "record" ? recordPath(id) : `/portal/coach/visit/${id}/attach`, { replace: true });
    } catch (err: unknown) {
      setError({ kind, text: (err as { response?: { data?: { error?: string } } })?.response?.data?.error || c.loadFailed });
      setBusy(null);
    }
  };

  const name = teacher.name;
  const sub = [schoolName, levelNames(teacher.levels)].filter(Boolean).join(" · ");
  const BIG = "flex min-h-[56px] w-full items-center justify-center gap-2.5 rounded-2xl px-4 text-[16px] font-semibold leading-tight rtl:leading-[1.8] disabled:opacity-60";
  return (
    <>
      <StepBar total={3} current={3} label={c.stepOfN(3, 3)} />
      <ChosenSoFar heading={c.chosenSoFar} copy={{ change: c.change, chosenSoFar: c.chosenSoFar }}
        items={[{ label: c.teacher, value: name || c.dash, sub: sub || undefined, to: changeTo }]} />
      <SectionLabel>{F.when}</SectionLabel>

      <section data-testid="when-now" className={cn(LIST_CARD, "flex flex-col gap-3 p-4")}>
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-[18px] font-semibold text-[#1d2025]">{F.forNow}</h2>
          <p className="m-0 text-[15px] text-[#4b5563]">{F.forNowSub}</p>
        </div>
        <button type="button" onClick={() => { void go("record"); }} disabled={!!busy}
          className={cn(BIG, "bg-[#33374a] text-white", FOCUS)}>
          <span aria-hidden="true" className="h-3.5 w-3.5 shrink-0 rounded-full bg-[#ff4d3d] shadow-[0_0_0_3px_rgba(255,77,61,0.25)]" />
          {busy === "record" ? c.saving : O.startRecording}
        </button>
        <button type="button" onClick={() => { void go("upload"); }} disabled={!!busy}
          className={cn(BIG, "border border-[#e5e7eb] bg-white text-[#33374a]", FOCUS)}>
          <Upload className="h-5 w-5 shrink-0" aria-hidden="true" />{busy === "upload" ? c.saving : O.uploadRecording}
        </button>
        {error && (
          <div className="flex items-center gap-3 rounded-xl border border-[#fde68a] bg-[#fffbeb] p-3" role="alert">
            <span className="flex-1 text-[15px] font-semibold text-[#b45309]">{error.text}</span>
            <button type="button" onClick={() => { void go(error.kind); }}
              className="min-h-[48px] rounded-xl bg-white px-4 text-sm font-semibold text-[#33374a]">{c.retry}</button>
          </div>
        )}
        <p className="m-0 flex items-center gap-2 text-[14px] text-[#6b7280]">
          <BellOff className="h-4 w-4 shrink-0" aria-hidden="true" /><span>{F.noMessage(name)}</span>
        </p>
      </section>

      <section data-testid="when-later" className={cn(LIST_CARD, "flex flex-col")}>
        <div className="flex flex-col gap-1 p-4 pb-2">
          <h2 className="m-0 text-[18px] font-semibold text-[#1d2025]">{F.forLater}</h2>
          <p className="m-0 text-[15px] text-[#4b5563]">{F.forLaterSub(name)}</p>
        </div>
        <Link to={laterTo} className={cn("flex min-h-[56px] items-center gap-3 border-t border-[#e5e7eb] px-4 text-[16px] font-semibold text-[#33374a]", FOCUS)}>
          <CalendarDays className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="flex-1">{c.pickDayTime}</span>
          <Chevron />
        </Link>
      </section>
    </>
  );
}

/** bd-o15qnr.27 (v6) — Later's "Observation scheduled": who and when, who is told, then Done (Observe) or Schedule another. */
export function ScheduledV6({ teacher, schoolName, when, doneTo = "/portal/coach/observe", anotherTo = NEW_VISIT, line }: {
  teacher: CoachTeacher | undefined; schoolName: string | null; when: { date: string; slot: string };
  /** bd-o15qnr.27 — the principal app's own links and line (no Observe there); absent: the coach's. */
  doneTo?: string; anotherTo?: string; line?: string;
}) {
  const c = useCopy(SCHEDULE);
  const F = useCopy(FLOW_V6);
  return (
    <>
      <div className="flex flex-col items-center gap-5 pt-8">
        <span className="flex h-[120px] w-[120px] items-center justify-center rounded-full bg-[#eaf6ef] text-[#48b078]" aria-hidden="true"><Check className="h-14 w-14" /></span>
        <h2 className="text-center text-[30px] font-light">{F.observationScheduled}</h2>
      </div>
      <Card className="overflow-hidden">
        <HistoryRow lead="person" action="none" title={teacher?.name || c.dash} extra={[dayLong(when.date, c), schoolName].filter(Boolean).join(" · ") || undefined}
          time={when.slot} timeTone="done" />
        <p className="m-0 flex items-start gap-2 border-t border-[#e5e7eb] px-4 py-3 text-[14px] text-[#4b5563]">
          <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#48b078]" aria-hidden="true" /><span>{line ?? F.scheduledLine(teacher?.name)}</span>
        </p>
      </Card>
      <div className="flex gap-2.5 pt-2">
        <BottomLink to={anotherTo} tone="outline"><Plus className="h-5 w-5" aria-hidden="true" />{F.scheduleAnother}</BottomLink>
        <BottomLink to={doneTo}>{F.done}</BottomLink>
      </div>
    </>
  );
}

/**
 * bd-o15qnr.27 (v6) — Schedule an observation draws in the app's own page frame (the Observe screens' ObservePage: the kit's
 * TeacherPage header with the feature tile and the crumb), with no WhatsApp strip and no yellow bar (#188's v6 boards).
 * Switch off, and Reschedule: the coach frame, as on production.
 */
function Frame({ v6, title, crumb, backTo, children }: { v6: boolean; title: ReactNode; crumb: ReactNode; backTo: string; children: ReactNode }) {
  if (v6) return <ObservePage title={title} crumb={crumb} backTo={backTo} feature="observations" banner={false} whatsapp={false}>{children}</ObservePage>;
  return <CoachPage title={title} crumb={crumb} backTo={backTo}>{children}</CoachPage>;
}

const CoachNewVisit = () => {
  const c = useCopy(SCHEDULE);
  const O = useCopy(OBSERVE);
  const F = useCopy(FLOW_V6);
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

  // bd-o15qnr.27 (queue #204, v6) — with the switch on, New visit is "Schedule an observation", under Observe: school,
  // teacher, then When? (Schedule for Now / Schedule for Later; ?when=later opens the day and time). Concept 1's
  // book-now mode (?now=1) is gone: an old link with it simply opens this flow. Reschedule keeps its own screen.
  const v6 = flow && !visitId;
  const later = v6 && params.get("when") === "later";
  const steps = 3;
  const today = karachiDay();
  const bookedRead = useLoad(() => (v6 && schoolExt && !teacherExt ? coach.getSchedule({ from: today, to: today }) : Promise.resolve(null)), [v6, schoolExt, teacherExt, today]);
  const bookedToday = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const v of bookedRead.data?.visits || []) {
      if (v.teacherExtId && v.scheduledFor === today && v.status === "upcoming" && !m.has(v.teacherExtId)) m.set(v.teacherExtId, v.scheduledSlot);
    }
    return m;
  }, [bookedRead.data, today]);
  const schoolPath = withLevel(`${NEW_VISIT}?school=${encodeURIComponent(schoolExt || "")}`, level);
  const teacherPath = withLevel(`${NEW_VISIT}?school=${encodeURIComponent(schoolExt || "")}&teacher=${encodeURIComponent(teacherExt || "")}`, level);
  const laterPath = `${teacherPath}${teacherPath.includes("?") ? "&" : "?"}when=later`;

  const back = visitId ? `/portal/coach/visit/${visitId}`
    : later ? teacherPath
      : teacherExt ? schoolPath
        : schoolExt ? withLevel(NEW_VISIT, level)
          : v6 ? "/portal/coach/observe" : "/portal/coach/scheduling";
  const crumb = visitId ? `${c.crumb} · ${c.reschedule}` : v6 ? O.observe : c.crumb;
  const onLaterDone = (when: { date: string; slot: string }) => { trackFlow("schedule.later"); setDone(when); };

  return (
    <Frame v6={v6} title={visitId ? c.reschedule : v6 ? F.scheduleObservation : c.newVisit} crumb={crumb} backTo={back}>
      {failed && <Failed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {data && done && v6 && <ScheduledV6 teacher={teacher} schoolName={teacher?.schoolName || school?.name || null} when={done} />}
      {data && done && !v6 && <Done teacher={teacher} schoolName={teacher?.schoolName || school?.name || null} when={done} />}
      {data && !done && !schoolExt && !teacherExt && (
        <SchoolStep schools={schools} chips={chipsFor(levelCounts(everyone))} trimmed={flow} steps={steps} v6={v6}
          onPick={(s) => withLevel(`${NEW_VISIT}?school=${encodeURIComponent(s.schoolExtId)}`, level)} />
      )}
      {data && !done && schoolExt && !teacherExt && (
        <TeacherStep school={shownSchool} teachers={teachers} chips={chipsFor(levelCounts(schoolTeachers))} changeTo={withLevel(NEW_VISIT, level)}
          trimmed={flow} steps={steps} v6={v6} bookedToday={bookedToday}
          linkFor={(t) => withLevel(`${NEW_VISIT}?school=${encodeURIComponent(schoolExt)}&teacher=${encodeURIComponent(t.teacherExtId || "")}`, level)} />
      )}
      {data && !done && teacherExt && v6 && !later && teacher && (
        <WhenStep teacher={teacher} schoolName={teacher.schoolName || school?.name || null} changeTo={schoolPath} laterTo={laterPath} />
      )}
      {data && !done && teacherExt && (!v6 || later) && (
        <TimeStep teacher={teacher} schoolName={teacher?.schoolName || school?.name || null} visitId={visitId} initialSlot={initialSlot}
          onDone={v6 ? onLaterDone : setDone}
          note={v6 ? (
            <p className="m-0 flex items-center gap-2 px-1 text-[14px] text-[#4b5563]">
              <MessageCircle className="h-4 w-4 shrink-0 text-[#48b078]" aria-hidden="true" /><span>{F.whatsappMessage(teacher?.name)}</span>
            </p>
          ) : undefined} />
      )}
    </Frame>
  );
};

export default CoachNewVisit;

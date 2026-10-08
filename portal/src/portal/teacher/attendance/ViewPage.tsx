import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import TeacherPage from '../TeacherPage';
import { StatusChip } from '../ui';
import { CARD, FOCUS, GRID, LIST_CARD, ROW_DIVIDER } from '../ui/styles';
import { getClasses, getDay, getMonth, getRoster, useRead } from './api';
import { ATTENDANCE_V2_COPY as C } from './copy';
import { calendar, dayLabel, monthLabel, monthOf, shiftMonth, type CalendarCell } from './model';
import { ATTENDANCE_V2_BASE, markPath, viewPath } from './paths';
import { ClassCard, ClassTray, LoadState } from './ui';

/**
 * bd-fmf24g.7 — one class's month (v28 canvas AttendanceView.dc.html). The class at the top is a card;
 * tapping it opens the same searchable class list as the selector (no class pills — a teacher can have
 * twenty classes). A month calendar tints each MARKED day by present ÷ marked; a day nobody marked is
 * plain (the API does not say which days were school days). Tapping a day shows who was away; its
 * Edit / Mark now opens the roll call for that day. Then every child's present ÷ days marked, lowest
 * first (GET …/month). Every number is the API's.
 */

const TONE: Record<CalendarCell['tone'], string> = {
  hi: 'bg-[#2f7a52] text-white',
  mid: 'bg-[#cfe9da] text-[#1e5c3f]',
  lo: 'bg-[#fde68a] text-[#7c4a03]',
  unmarked: 'text-[#4b5563]',
  future: 'text-[#c4c7cf]',
  blank: '',
};
const SHOWN = 5;

export function ViewPage() {
  const { listId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const classes = useRead('classes', () => getClasses());
  const today = classes.data?.date || null;
  const month = params.get('month') || (today ? monthOf(today) : null);
  const monthRead = useRead(month ? `month:${listId}:${month}` : null, () => getMonth(listId, month as string));
  const roster = useRead(`roster:${listId}`, () => getRoster(listId));
  const [sel, setSel] = useState<string | null>(null);
  const dayRead = useRead(sel ? `day:${listId}:${sel}` : null, () => getDay(listId, sel as string));
  const [tray, setTray] = useState(false);
  const [all, setAll] = useState(false);

  // A new class or month: close the tray, start on its latest marked day.
  useEffect(() => { setTray(false); setAll(false); }, [listId]);
  useEffect(() => {
    const days = monthRead.data?.days || [];
    setSel(days.length ? days[days.length - 1].date : null);
  }, [monthRead.data]);

  const cls = classes.data?.classes.find((c) => c.listId === listId) || null;
  const cells = useMemo(
    () => (month && today && monthRead.data ? calendar(month, monthRead.data.days, today) : []),
    [month, today, monthRead.data],
  );
  const names = useMemo(() => new Map((roster.data?.students || []).map((s) => [s.id, s.name])), [roster.data]);
  const away = Object.entries(dayRead.data?.statuses || {})
    .filter(([, s]) => s === 'absent' || s === 'leave')
    .map(([id, s]) => ({ id, s, name: names.get(id) || C.noValue }));
  const students = monthRead.data?.students || [];
  const shownStudents = all ? students : students.slice(0, SHOWN);

  const goMonth = (m: string) => {
    const next = new URLSearchParams(params);
    next.set('month', m);
    setParams(next, { replace: true });
  };
  const atLatest = !!(today && month && month >= monthOf(today));

  const loading = (classes.loading && !classes.data) || (monthRead.loading && !monthRead.data);
  const error = classes.error || monthRead.error;
  const retry = () => { classes.reload(); monthRead.reload(); roster.reload(); };

  return (
    <TeacherPage title={C.viewTitle} crumb={C.title} backTo={ATTENDANCE_V2_BASE} feature="attendance" testId="attendance-view">
      <LoadState loading={loading} failed={error} onRetry={retry} />
      {cls && <ClassCard cls={cls} onPress={() => setTray(true)} />}
      {month && monthRead.data && (
        <>
          <section className={CARD} aria-label={monthLabel(month)}>
            <div className="flex items-center justify-between p-1">
              <button type="button" aria-label={C.prevMonth} onClick={() => goMonth(shiftMonth(month, -1))} className={cn('flex h-14 w-14 items-center justify-center rounded-xl text-[#33374a]', FOCUS)}>
                <ChevronLeft className="h-[22px] w-[22px] rtl:rotate-180" aria-hidden="true" />
              </button>
              <span className="text-[18px] font-semibold">{monthLabel(month)}</span>
              <button type="button" aria-label={C.nextMonth} disabled={atLatest} onClick={() => goMonth(shiftMonth(month, 1))} className={cn('flex h-14 w-14 items-center justify-center rounded-xl text-[#33374a] disabled:opacity-30', FOCUS)}>
                <ChevronRight className="h-[22px] w-[22px] rtl:rotate-180" aria-hidden="true" />
              </button>
            </div>
            <div className={cn(GRID, 'grid-cols-7 gap-1.5 px-2.5 pb-3')}>
              {cells.map((c) => (c.n && (c.tone === 'hi' || c.tone === 'mid' || c.tone === 'lo' || c.tone === 'unmarked') ? (
                <button
                  key={c.key}
                  type="button"
                  aria-label={c.pct != null ? `${dayLabel(c.date as string)} ${C.pct(c.pct)}` : `${dayLabel(c.date as string)} ${C.unmarked}`}
                  aria-pressed={sel === c.date}
                  onClick={() => setSel(c.date)}
                  className={cn('flex h-14 items-center justify-center rounded-xl text-[15px] font-semibold tabular-nums', FOCUS, TONE[c.tone],
                    sel === c.date && 'shadow-[0_0_0_3px_#fff,0_0_0_5px_#33374a]')}
                >
                  {c.n}
                </button>
              ) : (
                <span key={c.key} aria-hidden="true" className={cn('flex h-14 items-center justify-center text-[15px] font-semibold tabular-nums', TONE[c.tone])}>{c.n ?? ''}</span>
              )))}
            </div>
          </section>
          <div className="flex flex-wrap gap-2 px-1" aria-hidden="true">
            <StatusChip text={C.hi} tone="done" />
            <StatusChip text={C.mid} tone="info" />
            <StatusChip text={C.lo} tone="waiting" />
          </div>
          {!monthRead.data.days.length && (
            <p className="rounded-2xl border border-dashed border-[#d1d5db] bg-white p-5 text-center text-[15px] text-[#6b7280]">{C.nothingThisMonth}</p>
          )}
        </>
      )}
      {sel && (
        <section className={CARD} aria-live="polite">
          <div className="flex items-center gap-2.5 py-3 pe-3 ps-4">
            <h2 className="flex-1 text-[18px] font-semibold">{dayLabel(sel)}</h2>
            {dayRead.data && (dayRead.data.marked && dayRead.data.present != null
              ? <StatusChip text={C.ofTotal(dayRead.data.present, (dayRead.data.present || 0) + (dayRead.data.absent || 0) + (dayRead.data.leave || 0))} tone="done" />
              : <StatusChip text={C.notMarked} tone="waiting" />)}
            <Link to={markPath(listId, sel)} className={cn('flex min-h-[56px] items-center justify-center rounded-xl bg-[#f3f4f6] px-3.5 text-[15px] font-semibold text-[#33374a]', FOCUS)}>
              {dayRead.data?.marked ? C.edit : C.markNow}
            </Link>
          </div>
          {dayRead.data?.marked && (
            <div className={cn('flex flex-wrap gap-2 px-3.5 pb-4 pt-3', ROW_DIVIDER)}>
              {away.length ? away.map((a) => (
                <span key={a.id} className="inline-flex h-9 items-center gap-2 rounded-full border border-[#e5e7eb] bg-[#f9fafb] pe-3 ps-1 text-[14px] font-semibold">
                  <span className={cn('flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-extrabold',
                    a.s === 'absent' ? 'bg-[#fee4e2] text-[#c8331f]' : 'bg-[#fef3c7] text-[#b45309]')}>
                    {a.s === 'absent' ? C.absentShort : C.leaveShort}
                  </span>
                  {a.name}
                </span>
              )) : <StatusChip text={C.everyonePresent} tone="done" />}
            </div>
          )}
        </section>
      )}
      {students.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="mx-1 mt-2 flex items-center gap-2 text-[20px] font-light">
            {C.studentsTitle}
            <StatusChip text={C.lowestFirst} tone="info" />
          </h2>
          <div className={LIST_CARD}>
            {shownStudents.map((s, i) => (
              <div key={s.id} className={cn('flex min-h-[64px] items-center gap-3 py-2 pe-3.5 ps-2.5', i > 0 && ROW_DIVIDER)}>
                <span className="w-7 shrink-0 text-center text-[13px] font-bold text-[#6b7280]">{s.roll ?? ''}</span>
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="truncate text-[16px] font-semibold">{s.name}</span>
                  {s.pct != null && (
                    <span className="relative h-1.5 overflow-hidden rounded-full bg-[#e5e7eb]">
                      <span className={cn('absolute inset-y-0 start-0 rounded-full', s.pct >= 90 ? 'bg-[#2f7a52]' : s.pct >= 75 ? 'bg-[#7cc49b]' : 'bg-[#d97706]')} style={{ width: `${s.pct}%` }} />
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 flex-col items-end gap-0.5">
                  <b className="text-[17px] tabular-nums">{s.pct != null ? C.pct(s.pct) : C.noValue}</b>
                  <span className="text-[12px] text-[#6b7280]">{C.daysOf(s.present, s.marked)}</span>
                </span>
              </div>
            ))}
          </div>
          {students.length > SHOWN && (
            <button type="button" onClick={() => setAll((v) => !v)} className={cn('flex min-h-[56px] w-full items-center justify-center rounded-2xl border-[1.5px] border-[#d1d5db] bg-white text-[16px] font-semibold text-[#33374a]', FOCUS)}>
              {all ? C.fewer : C.allStudents(students.length)}
            </button>
          )}
        </section>
      )}
      {classes.data && (
        <ClassTray open={tray} onClose={() => setTray(false)} classes={classes.data.classes} currentId={listId} to={(id) => viewPath(id, month || undefined)} />
      )}
    </TeacherPage>
  );
}

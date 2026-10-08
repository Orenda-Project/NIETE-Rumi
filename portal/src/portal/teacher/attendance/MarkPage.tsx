import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CalendarDays, Check, ChevronRight, Download, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import TeacherPage from '../TeacherPage';
import { StatusChip } from '../ui';
import { CARD, CHEVRON, FOCUS, LIST_CARD, ROW_DIVIDER } from '../ui/styles';
import { getClasses, getDay, getRoster, postMark, useRead, type MarkResult } from './api';
import { ATTENDANCE_V2_COPY as C } from './copy';
import {
  addDays, dateWindow, dayLabel, filterStudents, markPayload, marksFrom, rollCounts, setStatus, type Marks, type Status,
} from './model';
import { ATTENDANCE_V2_BASE, downloadPath, markPath, viewPath } from './paths';
import { ClassCard, LoadState, SearchBox } from './ui';

/**
 * bd-fmf24g.7 — the roll call (v28 canvas AttendanceMark.dc.html). Everyone starts PRESENT and "All
 * present" shows as chosen; tapping it again puts everyone back to present. A day already marked opens
 * with what was saved and saves as "Save changes" (the bot replaces the day). Every child is listed —
 * the search narrows the list, it never hides anyone by default. Counts and Save stay at the bottom.
 * The window (today back 90 days) is WhatsApp's; the server checks it again.
 */

const SEG: { s: Status; short: keyof typeof C; label: keyof typeof C; on: string }[] = [
  { s: 'present', short: 'presentShort', label: 'present', on: 'bg-[#2f7a52] text-white' },
  { s: 'absent', short: 'absentShort', label: 'absent', on: 'bg-[#c8331f] text-white' },
  { s: 'leave', short: 'leaveShort', label: 'leave', on: 'bg-[#b45309] text-white' },
];

export function MarkPage() {
  const { listId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const classes = useRead('classes', () => getClasses());
  const roster = useRead(`roster:${listId}`, () => getRoster(listId));
  const today = classes.data?.date || null;
  const date = params.get('date') || today;
  const day = useRead(date ? `day:${listId}:${date}` : null, () => getDay(listId, date as string));

  const [marks, setMarks] = useState<Marks>({});
  const [q, setQ] = useState('');
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState<MarkResult | null>(null);

  // A marked day opens with what was saved; a new day with everyone present.
  useEffect(() => { setMarks(day.data?.marked ? marksFrom(day.data.statuses) : {}); setSaved(null); setFailed(false); }, [day.data]);

  const cls = classes.data?.classes.find((c) => c.listId === listId) || null;
  const students = roster.data?.students || [];
  const shown = useMemo(() => filterStudents(students, q), [students, q]);
  const counts = rollCounts(students.length, marks);
  const allPresent = Object.keys(marks).length === 0;
  const already = !!day.data?.marked;
  const win = today ? dateWindow(today) : null;
  const yesterday = today ? addDays(today, -1) : null;

  const pickDate = (d: string | null) => {
    if (!d) return;
    const next = new URLSearchParams(params);
    if (d === today) next.delete('date'); else next.set('date', d);
    setParams(next, { replace: true });
  };

  const save = async () => {
    if (!date || saving) return;
    setSaving(true);
    setFailed(false);
    try {
      setSaved(await postMark(listId, { date, ...markPayload(marks) }));
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const nextClass = classes.data?.classes.find((c) => !c.marked && c.listId !== listId) || null;
  const loading = (classes.loading && !classes.data) || (roster.loading && !roster.data) || (day.loading && !day.data);
  const error = classes.error || roster.error || day.error;
  const retry = () => { classes.reload(); roster.reload(); day.reload(); };

  const chip = (active: boolean, label: string, onClick: () => void) => (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn('min-h-[56px] rounded-full border-[1.5px] px-4 text-[15px] font-semibold', FOCUS,
        active ? 'border-[#33374a] bg-[#33374a] text-white' : 'border-[#d1d5db] bg-white text-[#1d2025]')}
    >
      {label}
    </button>
  );

  if (saved) {
    return (
      <TeacherPage title={C.saved} crumb={C.markTitle} backTo={ATTENDANCE_V2_BASE} feature="attendance" testId="attendance-saved">
        <section className={cn(CARD, 'flex flex-col items-center gap-3.5 px-4 py-7 text-center')} aria-live="polite">
          <span className="flex h-24 w-24 items-center justify-center rounded-full bg-[#eaf6ef] text-[#2f7a52]">
            <Check className="h-12 w-12" aria-hidden="true" />
          </span>
          {cls && <ClassCard cls={cls} chip={false} />}
          <StatusChip text={dayLabel(saved.date)} tone="info" />
          <div className="flex flex-wrap justify-center gap-1.5">
            <StatusChip text={C.presentCount(saved.present)} tone="done" />
            <StatusChip text={C.absentCount(saved.absent)} tone="error" />
            <StatusChip text={C.leaveCount(saved.leave)} tone="waiting" />
          </div>
        </section>
        <nav className={LIST_CARD}>
          <Link to={downloadPath(listId)} className={cn('flex min-h-[72px] items-center gap-3 px-3', FOCUS)}>
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#f3f4f6] text-[#33374a]"><Download className="h-[22px] w-[22px]" aria-hidden="true" /></span>
            <span className="flex min-w-0 flex-1 flex-col"><span className="text-[16px] font-semibold">{C.monthRegister}</span><span className="text-[13px] text-[#6b7280]">{C.excel}</span></span>
            <ChevronRight className={cn(CHEVRON, 'h-[22px] w-[22px]')} aria-hidden="true" />
          </Link>
          <Link to={viewPath(listId)} className={cn('flex min-h-[72px] items-center gap-3 px-3', ROW_DIVIDER, FOCUS)}>
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#f3f4f6] text-[#33374a]"><CalendarDays className="h-[22px] w-[22px]" aria-hidden="true" /></span>
            <span className="min-w-0 flex-1 text-[16px] font-semibold">{C.viewAttendance}</span>
            <ChevronRight className={cn(CHEVRON, 'h-[22px] w-[22px]')} aria-hidden="true" />
          </Link>
        </nav>
        <div className="flex gap-2.5">
          <button type="button" onClick={() => setSaved(null)} className={cn('flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-2xl border border-[#e5e7eb] bg-white text-[16px] font-semibold', FOCUS)}>
            <Pencil className="h-[18px] w-[18px]" aria-hidden="true" />{C.edit}
          </button>
          <button type="button" onClick={() => navigate(nextClass ? markPath(nextClass.listId) : ATTENDANCE_V2_BASE)} className={cn('flex min-h-[56px] flex-1 items-center justify-center rounded-2xl bg-[#33374a] text-[16px] font-semibold text-white', FOCUS)}>
            {C.nextClass}
          </button>
        </div>
      </TeacherPage>
    );
  }

  return (
    <TeacherPage
      title={C.markTitle}
      crumb={C.title}
      backTo={ATTENDANCE_V2_BASE}
      feature="attendance"
      testId="attendance-mark"
      dock={students.length ? (
        <div className="flex w-full flex-col gap-2.5">
          <div className="flex justify-center gap-2" aria-live="polite">
            <StatusChip text={C.presentCount(counts.present)} tone="done" />
            <StatusChip text={C.absentCount(counts.absent)} tone="error" />
            <StatusChip text={C.leaveCount(counts.leave)} tone="waiting" />
          </div>
          {failed && <StatusChip text={C.saveFailed} tone="error" />}
          <button type="button" onClick={save} disabled={saving || !date} className={cn('flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-[#33374a] text-[16px] font-semibold text-white disabled:opacity-60', FOCUS)}>
            <Check className="h-5 w-5" aria-hidden="true" />
            {saving ? C.saving : already ? C.saveChanges : C.save}
          </button>
        </div>
      ) : undefined}
    >
      <LoadState loading={loading} failed={error} onRetry={retry} />
      {cls && <ClassCard cls={cls} to={ATTENDANCE_V2_BASE} />}
      {today && (
        <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={C.date}>
          {chip(date === today && !picking, C.today, () => { setPicking(false); pickDate(today); })}
          {chip(date === yesterday && !picking, C.yesterday, () => { setPicking(false); pickDate(yesterday); })}
          {chip(picking || (date !== today && date !== yesterday), date && date !== today && date !== yesterday ? dayLabel(date) : C.pickDate, () => setPicking(true))}
          {already && <StatusChip text={C.alreadyMarked} tone="waiting" />}
        </div>
      )}
      {picking && win && (
        <label className={cn(CARD, 'flex min-h-[56px] items-center gap-3 px-3.5 text-[15px] font-semibold')}>
          <CalendarDays className="h-5 w-5 text-[#6b7280]" aria-hidden="true" />
          <span className="sr-only">{C.pickDate}</span>
          <input
            type="date"
            min={win.min}
            max={win.max}
            value={date || ''}
            onChange={(e) => { if (e.target.value >= win.min && e.target.value <= win.max) pickDate(e.target.value); }}
            className="h-14 min-w-0 flex-1 border-0 bg-transparent text-[16px] outline-none"
          />
        </label>
      )}
      {roster.data && !students.length && (
        <p className="rounded-2xl border border-dashed border-[#d1d5db] bg-white p-6 text-center text-[16px] text-[#6b7280]">{C.noStudents}</p>
      )}
      {students.length > 0 && (
        <>
          <button
            type="button"
            aria-pressed={allPresent}
            onClick={() => setMarks({})}
            className={cn('flex min-h-[60px] w-full items-center justify-center gap-2.5 rounded-2xl border-[1.5px] text-[17px] font-bold', FOCUS,
              allPresent ? 'border-[#33374a] bg-[#33374a] text-white shadow-[0_4px_12px_rgba(51,55,74,0.22)]' : 'border-[#d1d5db] bg-white text-[#33374a]')}
          >
            <span className={cn('flex h-[26px] w-[26px] items-center justify-center rounded-[8px] border-2',
              allPresent ? 'border-white bg-white text-[#33374a]' : 'border-[#c7cad6] text-transparent')}>
              <Check className="h-4 w-4" aria-hidden="true" />
            </span>
            {C.allPresent}
          </button>
          <SearchBox value={q} onChange={setQ} label={C.searchStudent} sticky />
          {shown.length ? (
            <section className={LIST_CARD} aria-label={C.markTitle}>
              {shown.map((s, i) => {
                const st: Status = marks[s.id] || 'present';
                return (
                  <div
                    key={s.id}
                    className={cn('flex min-h-[68px] items-center gap-2.5 py-1.5 pe-2 ps-2.5', i > 0 && ROW_DIVIDER,
                      st === 'absent' && 'bg-[#fff7f6]', st === 'leave' && 'bg-[#fffbeb]')}
                  >
                    <span className="w-7 shrink-0 text-center text-[13px] font-bold tabular-nums text-[#6b7280]">{s.roll ?? ''}</span>
                    <span className="min-w-0 flex-1 truncate text-[16px] font-semibold">{s.name}</span>
                    <div role="radiogroup" aria-label={s.name} className="flex shrink-0 gap-0.5 rounded-[14px] bg-[#f3f4f6] p-0.5">
                      {SEG.map((g) => (
                        <button
                          key={g.s}
                          type="button"
                          role="radio"
                          aria-checked={st === g.s}
                          aria-label={C[g.label] as string}
                          onClick={() => setMarks((m) => setStatus(m, s.id, g.s))}
                          className={cn('h-14 w-[52px] rounded-xl text-[16px] font-bold', FOCUS, st === g.s ? g.on : 'text-[#6b7280]')}
                        >
                          {C[g.short] as string}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </section>
          ) : (
            <p className="rounded-2xl border border-[#e5e7eb] bg-white p-5 text-center text-[15px] text-[#6b7280]">{C.noStudent}</p>
          )}
        </>
      )}
    </TeacherPage>
  );
}

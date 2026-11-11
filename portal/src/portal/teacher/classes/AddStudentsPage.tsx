import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useParams } from 'react-router-dom';
import { Check, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { classes as classesApi } from '../../services/api';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import type { AddStudentsResponse } from '../../types/portal';
import TeacherPage from '../TeacherPage';
import { StatusChip } from '../ui';
import { CARD, FOCUS, OUTLINE_WIDE, PRIMARY_WIDE } from '../ui/styles';
import { CLASSES } from './copy';
import { useCopy } from '../i18n';
import { classTitle } from './model';
import { LoadFailed, LoadState } from './parts';
import { classPath } from './paths';

/** Rows on a fresh page, so she sees the pattern before she adds one. */
const FIRST_ROWS = 2;

const ROW = '[display:grid] grid-cols-[48px_minmax(0,1fr)_56px] items-start gap-2';
/** The roll badge the class page's student list draws, so the number reads as the same thing on both. */
const ROLL = 'flex h-10 w-10 items-center justify-center rounded-[10px] bg-[#f3f4f6] text-[14px] font-bold tabular-nums text-[#33374a]';
const SAVE = cn(PRIMARY_WIDE, 'text-[17px] disabled:bg-[#d1d5db] disabled:text-[#6b7280]');

interface Row { key: number; name: string }

/**
 * bd-2dn4vu — Add students, one row per child (design picked 4 Nov 2026: roll no + name, no father's name; no
 * heading row — the number is the class page's roll badge and each empty box says "Name").
 *
 * The roll no is SHOWN, never typed: the server numbers new children after the class's highest roll, as it
 * always has, and these rows show that same count. Two rows to start; Add student adds one; ✕ takes one away
 * (the rows below renumber, as the roster will). Save sends only the rows with a name, each exactly as typed
 * (POST /classes/:id/students { names }), and says what landed. A failed save keeps every name.
 */
export function AddStudentsPage() {
  const C = useCopy(CLASSES);
  const { classId = '' } = useParams();
  const [listState, retryList] = useLoad(() => classesApi.list(), 'teacher-classes');
  const [rosterState, reloadRoster] = useLoad(() => classesApi.students(classId), `roster:${classId}`);
  const cls = dataOf(listState)?.classes?.find((c) => c.classId === classId) ?? null;
  const roster = dataOf(rosterState)?.students;
  const firstRoll = useMemo(
    () => (roster ?? []).reduce((max, s) => Math.max(max, s.rollNumber ?? 0), 0) + 1,
    [roster],
  );

  const nextKey = useRef(FIRST_ROWS);
  const boxes = useRef(new Map<number, HTMLTextAreaElement>());
  const focusKey = useRef<number | null>(null);
  const fresh = (): Row[] => Array.from({ length: FIRST_ROWS }, (_, i) => ({ key: i, name: '' }));
  const [rows, setRows] = useState<Row[]>(fresh);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [result, setResult] = useState<AddStudentsResponse | null>(null);

  const named = rows.map((r) => r.name.trim()).filter(Boolean);

  const setName = (key: number, name: string) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, name } : r)));
  const addRow = () => {
    const key = nextKey.current++;
    focusKey.current = key;
    setRows((rs) => [...rs, { key, name: '' }]);
  };
  const removeRow = (key: number) => setRows((rs) => rs.filter((r) => r.key !== key));
  // Enter moves down the register: to the next row, or a new one after the last.
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>, i: number) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    const below = rows[i + 1];
    if (below) boxes.current.get(below.key)?.focus();
    else addRow();
  };
  const boxRef = (key: number) => (el: HTMLTextAreaElement | null) => {
    if (!el) { boxes.current.delete(key); return; }
    boxes.current.set(key, el);
    if (focusKey.current === key) {
      focusKey.current = null;
      el.focus();
      el.scrollIntoView?.({ block: 'center' });
    }
  };

  const save = async () => {
    if (!named.length || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await classesApi.addStudents(classId, named);
      if (!res || res.success !== true) throw new Error('not added');
      setResult(res);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const addMore = () => {
    reloadRoster();
    nextKey.current = FIRST_ROWS;
    setRows(fresh());
    setResult(null);
  };

  const backTo = classPath(classId);

  if (!dataOf(listState) || !cls || !roster) {
    const listFailed = !!dataOf(listState) && !cls;
    return (
      <TeacherPage feature="classes" crumb={C.title} title={C.addStudents} backTo={backTo}>
        {listFailed
          ? <LoadFailed onRetry={retryList} />
          : <LoadState status={dataOf(listState) ? rosterState.status : listState.status} onRetry={dataOf(listState) ? reloadRoster : retryList} />}
      </TeacherPage>
    );
  }

  if (result) {
    const chips = [
      result.duplicates ? C.alreadyThere(result.duplicates) : null,
      result.dropped ? C.notAdded(result.dropped) : null,
    ].filter((x): x is string => !!x);
    return (
      <TeacherPage feature="classes" crumb={classTitle(cls, C)} title={C.addStudents} backTo={backTo}>
        <section role="status" className={cn(CARD, 'flex flex-col items-center gap-3 px-4 py-8 text-center')}>
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-[#eaf6ef] text-[#2f7a52]">
            <Check className="h-10 w-10" strokeWidth={2.6} aria-hidden="true" />
          </span>
          <span className="text-[22px] font-bold">{C.added(result.added ?? 0)}</span>
          {chips.length ? (
            <span className="flex flex-wrap justify-center gap-1.5">
              {chips.map((t) => <StatusChip key={t} text={t} />)}
            </span>
          ) : null}
        </section>
        <button type="button" onClick={addMore} className={cn(OUTLINE_WIDE, FOCUS)}>
          <Plus className="h-5 w-5" aria-hidden="true" />
          {C.addMore}
        </button>
      </TeacherPage>
    );
  }

  const dock = (
    <div className="flex flex-col gap-2">
      {failed ? <p role="alert" className="px-1 text-[15px] font-semibold text-[#c8331f]">{C.saveFailed}</p> : null}
      <button type="button" onClick={save} disabled={!named.length || busy} className={cn(SAVE, FOCUS)}>
        {busy ? C.saving : C.saveStudents(named.length)}
      </button>
    </div>
  );

  return (
    <TeacherPage feature="classes" crumb={classTitle(cls, C)} title={C.addStudents} backTo={backTo} dock={dock} testId="add-students">
      <ol className="flex flex-col gap-2.5">
        {rows.map((r, i) => {
          const roll = firstRoll + i;
          return (
            <li key={r.key} className={cn(CARD, ROW, 'p-2')}>
              <span aria-hidden="true" className="flex min-h-[56px] items-center justify-center">
                <span className={ROLL}>{roll}</span>
              </span>
              <textarea
                ref={boxRef(r.key)}
                rows={1}
                dir="auto"
                placeholder={C.name}
                aria-label={C.nameOfRoll(roll)}
                value={r.name}
                onChange={(e) => setName(r.key, e.target.value)}
                onKeyDown={(e) => onKey(e, i)}
                className={cn('min-h-[56px] w-full min-w-0 resize-none overflow-hidden rounded-xl border border-[#d1d5db] bg-white px-3 py-3.5 text-[17px] leading-[1.6] [field-sizing:content]', FOCUS)}
              />
              <button
                type="button"
                aria-label={C.removeRoll(roll)}
                onClick={() => removeRow(r.key)}
                className={cn('flex h-14 w-14 items-center justify-center rounded-2xl text-[#6b7280]', FOCUS)}
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ol>
      <button type="button" onClick={addRow} className={cn(OUTLINE_WIDE, 'border-2 border-dashed border-[#9ca3af] bg-transparent text-[17px]', FOCUS)}>
        <Plus className="h-5 w-5" aria-hidden="true" />
        {C.addStudent}
      </button>
    </TeacherPage>
  );
}

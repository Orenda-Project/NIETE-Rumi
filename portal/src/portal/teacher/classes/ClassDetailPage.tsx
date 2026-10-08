import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronDown, Trash2, UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { classes as classesApi } from '../../services/api';
import { loadGradeSubjects } from '../../lib/gradeSubjects';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import type { AddStudentsResponse } from '../../types/portal';
import TeacherPage from '../TeacherPage';
import { teacherPath } from '../routes';
import { FeatureArt } from '../icons';
import { StatusChip, SubjectTile, Tray, gradeSubjectLabel } from '../ui';
import { CARD, FOCUS, LIST_CARD, OUTLINE_WIDE, ROW_DIVIDER } from '../ui/styles';
import { CLASSES_V2_COPY as C } from './copy';
import { classChips, classRows, classTitle, lessonPlansLink, rosterRows, type RosterRow } from './model';
import { EmptyCard, LoadFailed, LoadState, SectionHeading } from './parts';
import { CLASSES_HOME } from './paths';

/** How many children show before Show all. */
const FIRST_STUDENTS = 7;

const SQUARE = 'flex min-h-[150px] flex-col items-center justify-center gap-3 rounded-[20px] border border-[#e5e7eb] bg-white px-2.5 py-4 text-center text-[17px] font-semibold shadow-[0_1px_3px_rgba(16,24,40,0.08)]';
const PRIMARY = 'flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-2xl bg-[#33374a] px-4 text-[16px] font-semibold text-white disabled:bg-[#d1d5db] disabled:text-[#6b7280]';
const DANGER = 'flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-2xl bg-[#c8331f] px-4 text-[16px] font-semibold text-white';

/**
 * bd-fmf24g.8 — one class (v28 canvas ClassDetail): its title and chips, shortcuts to Attendance and to
 * that grade·subject's lesson plans, and its students (the existing roster routes: add by pasting
 * names, remove one after asking).
 */
export function ClassDetailPage() {
  const { classId = '' } = useParams();
  const [listState, retryList] = useLoad(() => classesApi.list(), 'teacher-classes');
  const [rosterState, reloadRoster] = useLoad(() => classesApi.students(classId), `roster:${classId}`);
  const [combosState] = useLoad(() => loadGradeSubjects('lessons'), 'gs:lessons');
  const list = dataOf(listState);
  const cls = list?.classes?.find((c) => c.classId === classId) ?? null;
  const roster = useMemo(() => rosterRows(dataOf(rosterState)?.students ?? []), [rosterState]);

  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [names, setNames] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [result, setResult] = useState<AddStudentsResponse | null>(null);
  const [removing, setRemoving] = useState<RosterRow | null>(null);

  const addStudents = async () => {
    if (!names.trim() || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await classesApi.addStudents(classId, names);
      if (!res || res.success !== true) throw new Error('not added');
      setResult(res);
      setAdding(false);
      setNames('');
      reloadRoster();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const removeStudent = async () => {
    if (!removing || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await classesApi.removeStudent(classId, removing.id);
      setRemoving(null);
      reloadRoster();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  if (!list || !cls) {
    return (
      <TeacherPage feature="classes" crumb={C.title} title="" backTo={CLASSES_HOME}>
        {list ? <LoadFailed onRetry={retryList} /> : <LoadState status={listState.status} onRetry={retryList} />}
      </TeacherPage>
    );
  }

  const [row] = classRows([cls], C);
  const shown = showAll ? roster : roster.slice(0, FIRST_STUDENTS);
  const resultChips = result
    ? [
        result.added ? C.added(result.added) : null,
        result.duplicates ? C.alreadyThere(result.duplicates) : null,
        result.dropped ? C.notAdded(result.dropped) : null,
      ].filter((x): x is string => !!x)
    : [];

  return (
    <TeacherPage feature="classes" crumb={C.title} title={classTitle(cls, C)} backTo={CLASSES_HOME}>
      <section aria-label={classTitle(cls, C)} className={cn(CARD, 'flex items-center gap-3 px-3 py-3.5')}>
        <SubjectTile subject={cls.subjects?.[0]?.label ?? ''} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[16px] font-semibold leading-[1.3]">{gradeSubjectLabel(row.grade, row.subject, row.section, C.grade)}</span>
          {row.sub && cls.subjects.length > 1 ? <span className="text-[13px] text-[#6b7280]">{cls.subjects.slice(1).map((s) => s.label).join(', ')}</span> : null}
          <span className="flex flex-wrap gap-1.5">
            {classChips(cls, list, C).map((chip) => <StatusChip key={chip} text={chip} />)}
          </span>
        </span>
      </section>

      <div className="[display:grid] grid-cols-2 gap-3">
        <Link to={teacherPath('attendance')} className={cn(SQUARE, FOCUS)}>
          <FeatureArt feature="attendance" size={64} />
          {C.attendance}
        </Link>
        <Link to={lessonPlansLink(cls, dataOf(combosState))} className={cn(SQUARE, FOCUS)}>
          <FeatureArt feature="lessons" size={64} />
          {C.lessonPlans}
        </Link>
      </div>

      <SectionHeading count={dataOf(rosterState) ? roster.length : undefined} countTestId="students-count">{C.students}</SectionHeading>
      {resultChips.length ? (
        <div role="status" className="flex flex-wrap gap-1.5 px-1">
          {resultChips.map((t, i) => <StatusChip key={t} text={t} tone={i === 0 && result?.added ? 'done' : 'info'} />)}
        </div>
      ) : null}
      {dataOf(rosterState) ? (
        roster.length ? (
          <div className={LIST_CARD}>
            <ul aria-label={C.students}>
              {shown.map((s, i) => (
                <li key={s.id} className={cn('flex min-h-[60px] items-center gap-3 py-1 pe-1 ps-3', i > 0 && ROW_DIVIDER)}>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#f3f4f6] text-[14px] font-bold tabular-nums text-[#33374a]">{s.roll}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[16px] font-semibold">{s.name}</span>
                    {s.father ? <span className="text-[13px] text-[#6b7280]">{s.father}</span> : null}
                  </span>
                  <button
                    type="button"
                    aria-label={C.removeNamed(s.name)}
                    onClick={() => { setFailed(false); setRemoving(s); }}
                    className={cn('flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-[#6b7280]', FOCUS)}
                  >
                    <Trash2 className="h-5 w-5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            {!showAll && roster.length > FIRST_STUDENTS ? (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className={cn('flex min-h-[56px] w-full items-center justify-center gap-2 text-[15px] font-semibold text-[#33374a]', ROW_DIVIDER, FOCUS)}
              >
                {C.showAll(roster.length)}
                <ChevronDown className="h-5 w-5" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ) : (
          <EmptyCard>{C.noStudentsYet}</EmptyCard>
        )
      ) : (
        <LoadState status={rosterState.status} onRetry={reloadRoster} />
      )}

      <button type="button" onClick={() => { setFailed(false); setAdding(true); }} className={cn(OUTLINE_WIDE, FOCUS)}>
        <UserPlus className="h-5 w-5" aria-hidden="true" />
        {C.addStudents}
      </button>

      <Tray open={adding} title={C.addStudents} onClose={() => setAdding(false)} closeLabel={C.close}>
        <div className="flex flex-col gap-3">
          <label htmlFor="add-students-names" className="px-1 text-[14px] font-semibold text-[#4b5563]">{C.studentNames}</label>
          <textarea
            id="add-students-names"
            value={names}
            onChange={(e) => setNames(e.target.value)}
            rows={6}
            className={cn('min-h-[140px] w-full rounded-2xl border border-[#d1d5db] bg-white p-3 text-[16px]', FOCUS)}
          />
          {failed ? <p role="alert" className="px-1 text-[14px] font-semibold text-[#c8331f]">{C.saveFailed}</p> : null}
          <button type="button" onClick={addStudents} disabled={!names.trim() || busy} className={cn(PRIMARY, FOCUS)}>
            {busy ? C.adding : C.add}
          </button>
        </div>
      </Tray>

      <Tray open={!!removing} title={C.removeStudent} onClose={() => setRemoving(null)} closeLabel={C.close}>
        <div className="flex flex-col gap-3">
          <p className="px-1 text-[17px] font-semibold">{removing?.name}</p>
          {failed ? <p role="alert" className="px-1 text-[14px] font-semibold text-[#c8331f]">{C.saveFailed}</p> : null}
          <div className="flex gap-2.5">
            <button type="button" onClick={() => setRemoving(null)} className={cn(OUTLINE_WIDE, 'flex-1', FOCUS)}>{C.keep}</button>
            <button type="button" onClick={removeStudent} disabled={busy} className={cn(DANGER, FOCUS)}>{C.remove}</button>
          </div>
        </div>
      </Tray>
    </TeacherPage>
  );
}

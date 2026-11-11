import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Check, ChevronDown, Pencil, Trash2, UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { classes as classesApi } from '../../services/api';
import { loadGradeSubjects } from '../../lib/gradeSubjects';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import TeacherPage from '../TeacherPage';
import { teacherPath } from '../routes';
import { FeatureArt } from '../icons';
import { StatusChip, Tray } from '../ui';
import { CARD, FOCUS, LIST_CARD, OUTLINE_WIDE, PRIMARY_WIDE, ROW_DIVIDER } from '../ui/styles';
import { CLASSES } from './copy';
import { useCopy } from '../i18n';
import { classChips, classTitle, gradeNumber, lessonPlansLink, rosterRows, type RosterRow } from './model';
import { ClassTile, EmptyCard, LoadFailed, LoadState, SectionHeading } from './parts';
import { CLASSES_HOME, addStudentsPath } from './paths';

/** How many children show before Show all. */
const FIRST_STUDENTS = 7;

const SQUARE = 'flex min-h-[150px] flex-col items-center justify-center gap-3 rounded-[20px] border border-[#e5e7eb] bg-white px-2.5 py-4 text-center text-[17px] font-semibold shadow-[0_1px_3px_rgba(16,24,40,0.08)]';
const DANGER = 'flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-2xl bg-[#c8331f] px-4 text-[16px] font-semibold text-white';
const SAVE = cn(PRIMARY_WIDE, 'text-[17px] disabled:bg-[#d1d5db] disabled:text-[#6b7280]');
const ROLL = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#f3f4f6] text-[14px] font-bold tabular-nums text-[#33374a]';

/**
 * bd-fmf24g.8 — one class (v28 canvas ClassDetail): its title and chips, shortcuts to Attendance and to
 * that grade·subject's lesson plans, and its students (the existing roster routes: remove one after
 * asking). bd-2dn4vu — Add students is its own page (AddStudentsPage: one row per child).
 *
 * bd-ql2j3p — Remove class, after asking: off her list, then back to My Classes.
 *
 * bd-mx822w — Edit a name (design picked 5 Nov 2026): each child is ONE tap target ending in a pencil. The
 * tray opens with the name box already focused, caret after the last letter; Save stays off until the
 * trimmed name changes, then the list shows the new name and "Name saved". Only the name changes (the roll
 * no and enrolment stay). Remove student lives lower in the same tray, after asking, so the bin is off the row.
 */
export function ClassDetailPage() {
  const C = useCopy(CLASSES);
  const navigate = useNavigate();
  const { classId = '' } = useParams();
  const [listState, retryList] = useLoad(() => classesApi.list(), 'teacher-classes');
  const [rosterState, reloadRoster] = useLoad(() => classesApi.students(classId), `roster:${classId}`);
  const [combosState] = useLoad(() => loadGradeSubjects('lessons'), 'gs:lessons');
  const list = dataOf(listState);
  const cls = list?.classes?.find((c) => c.classId === classId) ?? null;
  const read = useMemo(() => rosterRows(dataOf(rosterState)?.students ?? []), [rosterState]);

  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<RosterRow | null>(null);
  const [step, setStep] = useState<'edit' | 'remove'>('edit');
  const [draft, setDraft] = useState('');
  const [savedName, setSavedName] = useState<string | null>(null);
  /** Names fixed on this visit, by student id, so the list shows them without a re-read. */
  const [renamed, setRenamed] = useState<Record<string, string>>({});
  const [removingClass, setRemovingClass] = useState(false);
  const nameBox = useRef<HTMLTextAreaElement>(null);

  // After the Tray's own focus (it is a child, so its effect runs first): the name box, caret at the end.
  useEffect(() => {
    const box = nameBox.current;
    if (!editing || step !== 'edit' || !box) return;
    box.focus();
    const end = box.value.length;
    try { box.setSelectionRange(end, end); } catch { /* not every input type allows it */ }
  }, [editing, step]);

  const openEdit = (s: RosterRow) => {
    setFailed(false);
    setSavedName(null);
    setStep('edit');
    setDraft(s.name);
    setEditing(s);
  };
  const closeEdit = () => setEditing(null);

  const nextName = draft.trim();
  const canSave = !!editing && !!nextName && nextName !== editing.name && !busy;

  const saveName = async () => {
    if (!editing || !canSave) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await classesApi.renameStudent(classId, editing.id, nextName);
      if (!res || res.success !== true) throw new Error('not saved');
      const name = res.studentName || nextName;
      setRenamed((m) => ({ ...m, [editing.id]: name }));
      setSavedName(name);
      setEditing(null);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  // Enter saves (a name is one line); Shift+Enter is left alone.
  const onNameKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    void saveName();
  };

  const removeStudent = async () => {
    if (!editing || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await classesApi.removeStudent(classId, editing.id);
      setEditing(null);
      reloadRoster();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const removeClass = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await classesApi.removeClass(classId);
      if (!res || res.success !== true) throw new Error('not removed');
      navigate(CLASSES_HOME, { replace: true });
    } catch {
      setFailed(true);
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

  const roster = read.map((s) => (renamed[s.id] ? { ...s, name: renamed[s.id] } : s));
  const shown = showAll ? roster : roster.slice(0, FIRST_STUDENTS);

  return (
    <TeacherPage feature="classes" crumb={C.title} title={classTitle(cls, C)} backTo={CLASSES_HOME}>
      <section aria-label={classTitle(cls, C)} className={cn(CARD, 'flex items-center gap-3 px-3 py-3.5')}>
        <ClassTile grade={gradeNumber(cls.gradeCode)} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[16px] font-semibold leading-[1.3]">{classTitle(cls, C)}</span>
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
      {savedName ? (
        <p role="status" className="flex items-center gap-2 rounded-xl bg-[#eaf6ef] px-3.5 py-2.5 text-[15px] font-bold text-[#2f7a52]">
          <Check className="h-5 w-5 shrink-0" strokeWidth={2.6} aria-hidden="true" />
          {C.nameSaved}
        </p>
      ) : null}
      {dataOf(rosterState) ? (
        roster.length ? (
          <div className={LIST_CARD}>
            <ul aria-label={C.students}>
              {shown.map((s, i) => (
                <li key={s.id} className={cn(i > 0 && ROW_DIVIDER)}>
                  <button
                    type="button"
                    aria-label={C.editNamed(s.name)}
                    onClick={() => openEdit(s)}
                    className={cn('flex min-h-[60px] w-full items-center gap-3 py-1 pe-1 ps-3 text-start', FOCUS)}
                  >
                    <span className={ROLL}>{s.roll}</span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span dir="auto" className="text-[16px] font-semibold">{s.name}</span>
                      {s.father ? <span dir="auto" className="text-[13px] text-[#6b7280]">{s.father}</span> : null}
                    </span>
                    <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center text-[#6b7280]">
                      <Pencil className="h-5 w-5" />
                    </span>
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

      <Link to={addStudentsPath(classId)} className={cn(OUTLINE_WIDE, FOCUS)}>
        <UserPlus className="h-5 w-5" aria-hidden="true" />
        {C.addStudents}
      </Link>

      <button type="button" onClick={() => { setFailed(false); setRemovingClass(true); }} className={cn(OUTLINE_WIDE, FOCUS)}>
        <Trash2 className="h-5 w-5" aria-hidden="true" />
        {C.removeClass}
      </button>

      <Tray open={!!editing} title={step === 'edit' ? C.editStudent : C.removeStudent} onClose={closeEdit} closeLabel={C.close}>
        {step === 'edit' ? (
          <div className="flex flex-col gap-3">
            <div className="[display:grid] grid-cols-[48px_minmax(0,1fr)] items-start gap-2">
              <span aria-hidden="true" className="flex min-h-[56px] items-center justify-center">
                <span className={ROLL}>{editing?.roll}</span>
              </span>
              <textarea
                ref={nameBox}
                rows={1}
                dir="auto"
                placeholder={C.name}
                aria-label={editing?.roll ? C.nameOfRoll(editing.roll) : C.name}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onNameKey}
                className={cn('min-h-[56px] w-full min-w-0 resize-none overflow-hidden rounded-xl border border-[#d1d5db] bg-white px-3 py-3.5 text-[17px] leading-[1.6] [field-sizing:content]', FOCUS)}
              />
            </div>
            {failed ? <p role="alert" className="px-1 text-[14px] font-semibold text-[#c8331f]">{C.saveFailed}</p> : null}
            <button type="button" onClick={saveName} disabled={!canSave} className={cn(SAVE, FOCUS)}>
              {busy ? C.saving : C.save}
            </button>
            <button
              type="button"
              onClick={() => { setFailed(false); setStep('remove'); }}
              className={cn('mt-3 flex min-h-[56px] w-full items-center justify-center gap-2 border-t border-[#eef0f3] text-[16px] font-semibold text-[#c8331f]', FOCUS)}
            >
              <Trash2 className="h-5 w-5" aria-hidden="true" />
              {C.removeStudent}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p dir="auto" className="px-1 text-[17px] font-semibold">{editing?.name}</p>
            {failed ? <p role="alert" className="px-1 text-[14px] font-semibold text-[#c8331f]">{C.saveFailed}</p> : null}
            <div className="flex gap-2.5">
              <button type="button" onClick={() => { setFailed(false); setStep('edit'); }} className={cn(OUTLINE_WIDE, 'flex-1', FOCUS)}>{C.keep}</button>
              <button type="button" onClick={removeStudent} disabled={busy} className={cn(DANGER, FOCUS)}>{C.remove}</button>
            </div>
          </div>
        )}
      </Tray>

      <Tray open={removingClass} title={C.removeClass} onClose={() => setRemovingClass(false)} closeLabel={C.close}>
        <div className="flex flex-col gap-3">
          <p className="px-1 text-[17px] font-semibold">{classTitle(cls, C)}</p>
          {failed ? <p role="alert" className="px-1 text-[14px] font-semibold text-[#c8331f]">{C.saveFailed}</p> : null}
          <div className="flex gap-2.5">
            <button type="button" onClick={() => setRemovingClass(false)} className={cn(OUTLINE_WIDE, 'flex-1', FOCUS)}>{C.keep}</button>
            <button type="button" onClick={removeClass} disabled={busy} className={cn(DANGER, FOCUS)}>{C.remove}</button>
          </div>
        </div>
      </Tray>
    </TeacherPage>
  );
}

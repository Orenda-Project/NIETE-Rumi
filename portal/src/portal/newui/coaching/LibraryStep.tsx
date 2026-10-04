import { useEffect, useRef, useState } from 'react';
import { BookOpen, CircleAlert, Inbox, Layers, Loader2 } from 'lucide-react';
import { portal } from '../../services/api';
import type { LibraryGrade, LibraryLesson, LibraryOption } from '../../services/api';
import type { LibraryPick } from '../../lib/coachingSend';
import { COACHING_COPY } from '../copy';
import { List, Row } from '../List';
import { Chip } from '../Chip';
import { NumberGrid } from '../NumberGrid';
import { Hero } from '../Hero';
import { BottomButton } from '../BottomButton';

/**
 * bd-5rz1v.26 — "From the library" in the new UI: the lesson plan she taught from, one step at a
 * time — Grade (a NumberGrid), Subject, Chapter, Lesson (rows with ›). Today's LibraryPicker
 * rebuilt from the kit, the same reads (grades 1-5 and 6-12 are two catalogues behind one grid).
 * The page's InnerBar says the step and the crumb what she chose; its Back steps up.
 *
 * A grades 6-12 lesson not written yet ("Not written") is asked for when she taps it, and picked
 * once it is ready (the Curriculum page's request, polled with its back-off).
 */

export type LibraryStepInfo = { level: 0 | 1 | 2 | 3; crumb: string[] };
export type Picked = { pick: LibraryPick; title: string; chips: string[] };

type Step =
  | { level: 0 }
  | { level: 1; grade: LibraryGrade }
  | { level: 2; grade: LibraryGrade; subject: LibraryOption }
  | { level: 3; grade: LibraryGrade; subject: LibraryOption; chapter: LibraryOption };

const STEP_TITLES = [
  COACHING_COPY.steps.grade, COACHING_COPY.steps.subject, COACHING_COPY.steps.chapter, COACHING_COPY.steps.lesson,
] as const;

export function LibraryStep({ onPick, onStepChange, backSignal }: {
  onPick: (plan: Picked) => void;
  onStepChange: (info: LibraryStepInfo) => void;
  /** Bumped by the page's Back: go up one step. */
  backSignal: number;
}) {
  const [step, setStep] = useState<Step>({ level: 0 });
  const [grades, setGrades] = useState<LibraryGrade[] | null>(null);
  const [options, setOptions] = useState<LibraryOption[] | null>(null);
  const [lessons, setLessons] = useState<LibraryLesson[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [preparing, setPreparing] = useState<string | null>(null);
  const [prepFailed, setPrepFailed] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (poll.current) clearTimeout(poll.current); }, []);

  const crumb: string[] = [];
  if (step.level !== 0) crumb.push(COACHING_COPY.grade(step.grade.grade));
  if (step.level === 2 || step.level === 3) crumb.push(step.subject.label);
  if (step.level === 3) crumb.push(step.chapter.label);
  const crumbKey = crumb.join('|');
  useEffect(() => { onStepChange({ level: step.level, crumb }); },
    // The crumb is derived from the step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [step.level, crumbKey, onStepChange]);

  // The page's Back: one step up (the page leaves the library from the grades).
  const lastBack = useRef(backSignal);
  useEffect(() => {
    if (backSignal === lastBack.current) return;
    lastBack.current = backSignal;
    setStep((s) => {
      if (s.level === 3) return { level: 2, grade: s.grade, subject: s.subject };
      if (s.level === 2) return { level: 1, grade: s.grade };
      return { level: 0 };
    });
  }, [backSignal]);

  useEffect(() => {
    let live = true;
    setFailed(false);
    setOptions(null);
    setLessons(null);
    const load = async () => {
      if (step.level === 0) {
        if (!grades) { const g = await portal.getLibraryGrades(); if (live) setGrades(g); }
      } else if (step.level === 1) {
        const s = await portal.getLibrarySubjects(step.grade.grade, step.grade.lane);
        if (live) setOptions(s);
      } else if (step.level === 2) {
        const c = await portal.getLibraryChapters(step.grade.grade, step.grade.lane, step.subject.key);
        if (live) setOptions(c);
      } else {
        const l = await portal.getLibraryLessons(step.grade.grade, step.grade.lane, step.subject.key, step.chapter.key);
        if (live) setLessons(l);
      }
    };
    load().catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
    // `grades` is read, not watched: it loads once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, reload]);

  const pickLesson = (lesson: LibraryLesson) => {
    if (step.level !== 3) return;
    const chips = [COACHING_COPY.grade(step.grade.grade), step.subject.label];
    if (step.grade.lane === 'k5') { onPick({ pick: { lessonId: lesson.id }, title: lesson.label, chips }); return; }
    const picked: Picked = { pick: { segmentId: lesson.id, lang: 'en' }, title: lesson.label, chips };
    if (lesson.ready) { onPick(picked); return; }
    void prepare(lesson, picked);
  };

  /** Ask for a 6-12 lesson to be written, then pick it once it is ready. */
  const prepare = async (lesson: LibraryLesson, picked: Picked) => {
    setPreparing(lesson.id);
    setPrepFailed(null);
    const startedAt = Date.now();
    const finish = (ok: boolean) => {
      setPreparing(null);
      if (ok) onPick(picked); else setPrepFailed(lesson.id);
    };
    try {
      const r = await portal.requestLibraryLesson(lesson.id);
      if (r.state === 'ready') { finish(true); return; }
      if (r.state === 'failed') { finish(false); return; }
      const tick = async () => {
        try {
          const s = await portal.getLibraryLessonStatus(r.renderId);
          if (s.state === 'ready') { finish(true); return; }
          if (s.state === 'failed') { finish(false); return; }
        } catch {
          // A dropped poll is not a failed lesson: the job runs whether or not we can see it.
        }
        const waited = Date.now() - startedAt;
        poll.current = setTimeout(tick, waited < 30_000 ? 3_000 : waited < 120_000 ? 6_000 : 12_000);
      };
      poll.current = setTimeout(tick, 3_000);
    } catch {
      finish(false);
    }
  };

  if (failed) {
    return (
      <>
        <Hero title={COACHING_COPY.notLoaded} icon={CircleAlert} tone="error" live />
        <BottomButton tone="outline" onClick={() => setReload((n) => n + 1)}>{COACHING_COPY.retry}</BottomButton>
      </>
    );
  }
  const loading = <Hero title={COACHING_COPY.loading} icon={Loader2} spinning live />;
  const nothing = <Hero title={COACHING_COPY.nothingHere} icon={Inbox} />;

  if (step.level === 0) {
    if (!grades) return loading;
    // The page's bar already says "Grade": the grid needs no heading of its own.
    return (
      <NumberGrid
        label={COACHING_COPY.steps.grade}
        numbers={grades.map((g) => g.grade)}
        value={null}
        onChange={(n) => { const g = grades.find((x) => x.grade === n); if (g) setStep({ level: 1, grade: g }); }}
      />
    );
  }

  if (step.level === 1 || step.level === 2) {
    if (!options) return loading;
    if (!options.length) return nothing;
    return (
      <List label={STEP_TITLES[step.level]}>
        {options.map((o) => (
          <Row
            key={o.key}
            title={o.label}
            icon={step.level === 1 ? BookOpen : Layers}
            onClick={() => (step.level === 1
              ? setStep({ level: 2, grade: step.grade, subject: o })
              : setStep({ level: 3, grade: step.grade, subject: step.subject, chapter: o }))}
          />
        ))}
      </List>
    );
  }

  if (!lessons) return loading;
  if (!lessons.length) return nothing;
  return (
    <List label={STEP_TITLES[3]}>
      {lessons.map((l) => {
        const busy = preparing === l.id;
        return (
          <Row
            key={l.id}
            title={l.label}
            icon={BookOpen}
            onClick={preparing == null ? () => pickLesson(l) : undefined}
            state={preparing != null && !busy ? 'off' : undefined}
            chips={(
              <>
                {l.sub ? <Chip>{l.sub}</Chip> : null}
                {l.used ? <Chip tone="done">{COACHING_COPY.used}</Chip> : null}
                {!l.ready && !busy && prepFailed !== l.id ? <Chip tone="waiting">{COACHING_COPY.notWritten}</Chip> : null}
                {busy ? <Chip tone="waiting">{COACHING_COPY.preparing}</Chip> : null}
                {prepFailed === l.id ? <Chip tone="error">{COACHING_COPY.failed}</Chip> : null}
              </>
            )}
          />
        );
      })}
    </List>
  );
}

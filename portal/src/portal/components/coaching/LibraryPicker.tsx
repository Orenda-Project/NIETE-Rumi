import { useEffect, useRef, useState } from 'react';
import { BookOpen, ChevronRight, Loader2 } from 'lucide-react';
import { portal } from '../../services/api';
import type { LibraryGrade, LibraryLesson, LibraryOption, RecentLessonPlan } from '../../services/api';
import type { LibraryPick } from '../../lib/coachingSend';
import { SkeletonList } from '../Skeleton';

/**
 * bd-5rz1v — "From our library": the lesson plan she taught from, one big tap at
 * a time. Her recent plans come first (the WhatsApp list's own source) — most
 * teachers taught from one of those. Otherwise: Which grade? → Which subject? →
 * Which chapter? → Which lesson? Each answer stays at the top as a chip she can
 * tap to go back.
 *
 * Grades 1-5 and 6-12 are two catalogues behind one picker (as on the
 * Curriculum page). A 6-12 lesson that has not been written yet is got ready
 * first (the Curriculum page's request, ~3 minutes) and picked once it is.
 */

export type PickedPlan = { pick: LibraryPick; title: string; sub: string };

const COPY = {
  recent: 'Your recent plans',
  pick: 'Pick',
  orFind: 'or find it',
  questions: ['Which grade?', 'Which subject?', 'Which chapter?', 'Which lesson?'],
  used: '✓ You used this plan',
  notWritten: 'Not written yet. Tap to get it ready (about 3 minutes).',
  preparing: 'Getting it ready… you can wait here.',
  failed: 'That lesson could not be written. Try again, or take a photo of your plan.',
  loadFailed: 'Could not load this. Check the internet and try again.',
  retry: 'Try again',
  none: 'Nothing here yet.',
  fromLibrary: 'From the library',
};

type Step =
  | { level: 0 }
  | { level: 1; grade: LibraryGrade }
  | { level: 2; grade: LibraryGrade; subject: LibraryOption }
  | { level: 3; grade: LibraryGrade; subject: LibraryOption; chapter: LibraryOption };

function recentWhere(p: RecentLessonPlan): string {
  const bits = [
    p.grade != null ? `Grade ${p.grade}` : null,
    p.subject,
    [p.chapterNumber != null ? `Ch ${p.chapterNumber}` : null, p.dayLabel].filter(Boolean).join(', ') || null,
  ].filter(Boolean);
  return bits.join(' · ');
}

const LibraryPicker = ({ onPick, onStepChange, backSignal, loadRecent, recentTitle, showUsed = true }: {
  onPick: (plan: PickedPlan) => void;
  /** How deep she is (0 = grades), so the page's back arrow can step back first. */
  onStepChange?: (level: number) => void;
  /** Bumped by the page's back arrow: go up one step. */
  backSignal: number;
  /**
   * bd-5rz1v.6 — whose recent plans come first. Omitted: the signed-in teacher's
   * own. A coach observing a lesson passes the OBSERVED teacher's.
   */
  loadRecent?: () => Promise<{ plans: RecentLessonPlan[] }>;
  /** The heading above them (default "Your recent plans"). */
  recentTitle?: string;
  /**
   * "✓ You used this plan" marks a lesson the signed-in user downloaded. A coach
   * picking for a teacher would see her OWN downloads there, so she hides it.
   */
  showUsed?: boolean;
}) => {
  const [step, setStep] = useState<Step>({ level: 0 });
  const [recent, setRecent] = useState<RecentLessonPlan[]>([]);
  const [grades, setGrades] = useState<LibraryGrade[] | null>(null);
  const [options, setOptions] = useState<LibraryOption[] | null>(null);
  const [lessons, setLessons] = useState<LibraryLesson[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [preparing, setPreparing] = useState<string | null>(null);
  const [prepFailed, setPrepFailed] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (poll.current) clearTimeout(poll.current); }, []);

  useEffect(() => { onStepChange?.(step.level); }, [step.level, onStepChange]);

  // The page's back arrow: one step up (the page leaves the picker from step 0).
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
    (loadRecent ? loadRecent() : portal.getRecentLessonPlans())
      .then((r) => { if (live) setRecent((r && r.plans) || []); })
      .catch(() => { /* recent plans are a shortcut, not a requirement */ });
    return () => { live = false; };
    // Loaded once, like the grades: the page passes one loader for the picker's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let live = true;
    setFailed(false);
    setOptions(null);
    setLessons(null);
    const load = async () => {
      if (step.level === 0) {
        if (!grades) {
          const g = await portal.getLibraryGrades();
          if (live) setGrades(g);
        }
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

  const trail: { label: string; go: () => void }[] = [];
  if (step.level !== 0) {
    const { grade } = step;
    trail.push({ label: `Grade ${grade.grade}`, go: () => setStep({ level: 0 }) });
    if (step.level !== 1) {
      const { subject } = step;
      trail.push({ label: subject.label, go: () => setStep({ level: 1, grade }) });
      if (step.level === 3) trail.push({ label: step.chapter.label, go: () => setStep({ level: 2, grade, subject }) });
    }
  }

  const pickLesson = (lesson: LibraryLesson) => {
    if (step.level !== 3) return;
    const sub = `${COPY.fromLibrary} · Grade ${step.grade.grade} · ${step.subject.label}`;
    if (step.grade.lane === 'k5') {
      onPick({ pick: { lessonId: lesson.id }, title: lesson.label, sub });
      return;
    }
    const picked: PickedPlan = { pick: { segmentId: lesson.id, lang: 'en' }, title: lesson.label, sub };
    if (lesson.ready) { onPick(picked); return; }
    void prepare(lesson, picked);
  };

  /** Ask for a 6-12 lesson to be written, then pick it once it is ready. */
  const prepare = async (lesson: LibraryLesson, picked: PickedPlan) => {
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

  // bd-fxk3t8 — placeholder rows where the list will be, not a spinner.
  const loading = <SkeletonList rows={3} className="py-2" />;
  const failure = (
    <div className="flex flex-col items-start gap-3 rounded-xl bg-white p-4 text-[15px] text-[#3a3f4b]">
      <span>{COPY.loadFailed}</span>
      <button type="button" onClick={() => setReload((n) => n + 1)} className="h-11 rounded-[10px] border-2 border-primary px-4 font-bold text-primary">
        {COPY.retry}
      </button>
    </div>
  );

  return (
    <div className="flex flex-col gap-3.5">
      {trail.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {trail.map((t, i) => (
            <button key={t.label} type="button" onClick={t.go}
              className="h-9 rounded-full border border-primary bg-white px-3 text-sm font-semibold text-primary">
              {t.label}{i < trail.length - 1 ? ' ›' : ''}
            </button>
          ))}
        </div>
      )}

      {step.level === 0 && recent.length > 0 && (
        <>
          <div className="text-base font-bold text-primary">{recentTitle || COPY.recent}</div>
          {recent.slice(0, 3).map((p) => (
            <button key={p.assetId} type="button"
              onClick={() => onPick({ pick: { assetId: p.assetId }, title: p.topic || 'Lesson plan', sub: `${COPY.fromLibrary} · ${recentWhere(p)}` })}
              className="flex items-center gap-3 rounded-[14px] border-2 border-accent bg-white p-3.5 text-left">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#e3f4ea]">
                <BookOpen className="h-5 w-5 text-[#1b6b43]" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[17px] font-semibold" dir="auto">{p.topic || 'Lesson plan'}</span>
                <span className="text-sm text-[#5b6170]">{recentWhere(p)}</span>
              </span>
              <span className="shrink-0 text-[15px] font-bold text-[#1b6b43]" aria-hidden="true">{COPY.pick}</span>
            </button>
          ))}
          <div className="mt-1 flex items-center gap-3 text-[15px] text-muted-foreground">
            <span className="h-px flex-1 bg-[#d6d9de]" />
            <span>{COPY.orFind}</span>
            <span className="h-px flex-1 bg-[#d6d9de]" />
          </div>
        </>
      )}

      <div className="text-[22px] font-bold">{COPY.questions[step.level]}</div>

      {failed && failure}

      {!failed && step.level === 0 && (grades == null ? loading : (
        <div className="grid grid-cols-4 gap-2.5">
          {grades.map((g) => (
            <button key={`${g.lane}-${g.grade}`} type="button" onClick={() => setStep({ level: 1, grade: g })}
              className="h-16 rounded-xl border-2 border-primary bg-white text-2xl font-bold text-primary">
              {g.grade}
            </button>
          ))}
        </div>
      ))}

      {!failed && (step.level === 1 || step.level === 2) && (options == null ? loading : options.length === 0 ? (
        <div className="text-[15px] text-muted-foreground">{COPY.none}</div>
      ) : options.map((o) => (
        <button key={o.key} type="button"
          onClick={() => (step.level === 1
            ? setStep({ level: 2, grade: step.grade, subject: o })
            : setStep({ level: 3, grade: step.grade, subject: step.subject, chapter: o }))}
          className="flex min-h-[60px] items-center gap-3 rounded-xl border border-[#d6d9de] bg-white px-3.5 py-3 text-left">
          <span className="flex-1 text-[17px] font-semibold" dir="auto">{o.label}</span>
          <ChevronRight className="h-5 w-5 shrink-0 text-[#9aa0aa]" aria-hidden="true" />
        </button>
      )))}

      {!failed && step.level === 3 && (lessons == null ? loading : lessons.length === 0 ? (
        <div className="text-[15px] text-muted-foreground">{COPY.none}</div>
      ) : lessons.map((l) => {
        const busy = preparing === l.id;
        return (
          <button key={l.id} type="button" onClick={() => pickLesson(l)} disabled={preparing != null}
            className="flex min-h-[60px] items-center gap-3 rounded-xl border border-[#d6d9de] bg-white px-3.5 py-3 text-left disabled:opacity-70">
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-[17px] font-semibold" dir="auto">{l.label}</span>
              {l.sub && <span className="text-sm text-[#5b6170]">{l.sub}</span>}
              {showUsed && l.used && <span className="text-[13px] font-semibold text-[#1b6b43]">{COPY.used}</span>}
              {!l.ready && !busy && prepFailed !== l.id && <span className="text-[13px] text-[#7a5600]">{COPY.notWritten}</span>}
              {busy && <span className="flex items-center gap-1.5 text-[13px] text-[#5b6170]"><Loader2 className="h-3.5 w-3.5 animate-spin" />{COPY.preparing}</span>}
              {prepFailed === l.id && <span className="text-[13px] text-[#c62828]">{COPY.failed}</span>}
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-[#9aa0aa]" aria-hidden="true" />
          </button>
        );
      }))}
    </div>
  );
};

export default LibraryPicker;

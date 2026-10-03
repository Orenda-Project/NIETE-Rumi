import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  Atom, BookMarked, BookOpen, Calculator, CaseSensitive, ClipboardList, FileText, FlaskConical,
  Globe, Landmark, Languages, Monitor, RotateCcw, Sprout, TestTube,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useLessonPlanOpener } from '../../lib/lessonPlanOpen';
import { LESSONS_COPY } from '../copy';
import { lessonPlans, type LpLesson } from './lessonPlansApi';

/**
 * bd-5rz1v.14 — what the Lesson Plans pages share: where each page lives, loading a list, the
 * loading / failed / empty states, how a lesson is drawn (its badge, its name), and Open.
 */

/* ── where each page lives ───────────────────────────────────────────────── */

export const LESSON_PLANS_PATH = '/portal/curriculum';

/** The inner pages. The main page is the bare path. */
export type View = 'chapters' | 'lessons' | 'lesson' | 'preparing';

/** What an inner page needs to stand on its own (a reload, Back, a link straight to it). */
export type At = { grade: number; subject: string; chapter?: string; lesson?: string; render?: string };

export function pageUrl(view: View, at: At): string {
  const q = new URLSearchParams({ view, grade: String(at.grade), subject: at.subject });
  if (at.chapter) q.set('chapter', at.chapter);
  if (at.lesson) q.set('lesson', at.lesson);
  if (at.render) q.set('render', at.render);
  return `${LESSON_PLANS_PATH}?${q.toString()}`;
}

/* ── loading a list ──────────────────────────────────────────────────────── */

export type Loaded<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ok'; data: T };

/**
 * Load once per `key` (the arguments, as a string); null `load` is "nothing to load yet".
 * Returns the state and a retry.
 */
export function useLoad<T>(load: (() => Promise<T>) | null, key: string): [Loaded<T>, () => void] {
  const [state, setState] = useState<Loaded<T>>(load ? { status: 'loading' } : { status: 'idle' });
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(load);
  latest.current = load;
  useEffect(() => {
    const fn = latest.current;
    if (!fn) { setState({ status: 'idle' }); return undefined; }
    let live = true;
    setState({ status: 'loading' });
    fn().then(
      (data) => { if (live) setState({ status: 'ok', data }); },
      () => { if (live) setState({ status: 'error' }); },
    );
    return () => { live = false; };
  }, [key, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return [state, retry];
}

export const dataOf = <T,>(s: Loaded<T>): T | undefined => (s.status === 'ok' ? s.data : undefined);

/* ── how a subject and a lesson are drawn ────────────────────────────────── */

/** A subject's icon, from its name (neutral grey, like every row icon). Order matters: "Computer
 *  Science" is a computer, "General Science" a flask. */
const SUBJECT_ICONS: ReadonlyArray<readonly [RegExp, LucideIcon]> = [
  [/english/i, CaseSensitive],
  [/urdu|اردو/i, Languages],
  [/math/i, Calculator],
  [/computer/i, Monitor],
  [/physics/i, Atom],
  [/chemistry/i, TestTube],
  [/biology/i, Sprout],
  [/science/i, FlaskConical],
  [/geography/i, Globe],
  [/islam|religio|quran|seerah/i, BookMarked],
  [/pakistan|social|history|civics/i, Landmark],
];

export function subjectIcon(name?: string | null): LucideIcon {
  const n = String(name || '');
  return SUBJECT_ICONS.find(([re]) => re.test(n))?.[1] ?? BookOpen;
}

/** The row's badge: D3 for a day, 3 for a 6–12 lesson, an icon for a worksheet or a revision. */
export function lessonBadge(l: LpLesson): { lead?: string; icon?: LucideIcon } {
  if (l.kind === 'worksheet') return { icon: ClipboardList };
  if (l.kind === 'revision') return { icon: RotateCcw };
  if (l.number == null) return { icon: FileText };
  return { lead: l.kind === 'day' ? LESSONS_COPY.dayBadge(l.number) : String(l.number) };
}

/** The row's title: the lesson's own, except a worksheet and a revision, which say what they are. */
export function lessonRowTitle(l: LpLesson): string {
  if (l.kind === 'worksheet') return LESSONS_COPY.worksheet;
  if (l.kind === 'revision') return LESSONS_COPY.revision;
  return l.title;
}

/** Its short name, for the Ready page's heading and the viewer's breadcrumb: Day 3, Lesson 2. */
export function lessonName(l: LpLesson): string {
  if (l.kind === 'worksheet') return LESSONS_COPY.worksheet;
  if (l.kind === 'revision') return LESSONS_COPY.revision;
  if (l.number == null) return l.title;
  return l.kind === 'day' ? LESSONS_COPY.day(l.number) : LESSONS_COPY.lesson(l.number);
}

/** "1:10" — what is left of the expected wait. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* ── Open: one action, every grade ───────────────────────────────────────── */

/**
 * Open a lesson plan the one way, whichever grade: ready → the viewer; being written → the
 * Preparing page (which opens it by itself); held back → said. `replace` when the page it opens
 * from should not stay behind it (Preparing).
 */
export function useOpenLesson() {
  const openPlan = useLessonPlanOpener();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);

  const open = useCallback(async (lesson: LpLesson, at: At, opts: { replace?: boolean } = {}) => {
    setBusy(true);
    try {
      const r = await lessonPlans.open(lesson);
      if (r.state === 'ready') {
        const how = await openPlan(r.source, lesson.title, { crumb: LESSONS_COPY.crumb(lessonName(lesson)), replace: opts.replace });
        if (how === 'not_ready') toast({ title: LESSONS_COPY.notReady });
      } else if (r.state === 'preparing') {
        navigate(pageUrl('preparing', { ...at, lesson: lesson.id, render: r.renderId }), opts.replace ? { replace: true } : undefined);
      } else {
        toast({ title: LESSONS_COPY.notAvailable, variant: 'destructive' });
      }
    } catch {
      toast({ title: LESSONS_COPY.couldNotOpen, variant: 'destructive' });
    } finally {
      if (live.current) setBusy(false);
    }
  }, [navigate, openPlan, toast]);

  /** The grades 1–5 answer key, in the viewer. */
  const openAnswerKey = useCallback(async (lesson: LpLesson) => {
    const source = lessonPlans.answerKey(lesson);
    if (!source) return;
    try {
      const how = await openPlan(source, lesson.title, { crumb: LESSONS_COPY.crumb(lessonName(lesson), LESSONS_COPY.answerKey) });
      if (how === 'not_ready') toast({ title: LESSONS_COPY.notReady });
    } catch {
      toast({ title: LESSONS_COPY.couldNotOpen, variant: 'destructive' });
    }
  }, [openPlan, toast]);

  return { open, openAnswerKey, busy };
}

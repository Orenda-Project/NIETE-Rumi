import api from '../../services/api';
import type { LessonPlanSource } from '../../lib/lessonPlanOpen';

/**
 * bd-5rz1v.14 — ONE client for lesson plans, grades 1 to 12.
 *
 * Two services sit behind the Lesson Plans screens, and this file is the only place that knows:
 *
 *   grades 1–5   /api/portal/curriculum/*   pre-written PDFs; a lesson listed is a lesson there
 *   grades 6–12  /api/portal/lp612/*        segments written on request (~3 min) and then kept
 *
 * They answer in different dialects — a subject is a subject_key ('math') in one and a display
 * name ('Physics') in the other; a chapter is a number in one and a chapter_key in the other; a
 * 1–5 lesson is "there" while a 6–12 one may still have to be written. Everything below turns both
 * into ONE model (LpSubject, LpChapter, LpLesson) and one pair of actions (open, status), so the
 * screens walk grade 4 and grade 9 the same way and never ask which band a grade is in. That was
 * the bead's goal: no "1–5 ready, 6–12 on request".
 *
 * WHICH SERVICE A GRADE BELONGS TO is read off the grade lists, never inferred from the number (a
 * `grade <= 5` here would be a second, silent copy of a boundary the two services own).
 *
 * The routes are the ones the old Curriculum page used, so nothing changes on the server: lesson
 * plan opens are still logged where the PDF goes out (/curriculum/lp/:id/file, /lp612/file/:id —
 * the viewer's fetch, bd-5rz1v.15), and the 6–12 poll still never sends ?open=1.
 *
 * Kept for the session: the grade → service map, and each grade's subjects and each subject's
 * chapters (the catalogue, which does not change under her). NOT kept: lessons, which carry her
 * own ✓✓ Sent and whether a 6–12 plan has been written. A failed read is never kept.
 */

type Lane = 'k5' | 'g612';

export type LpSubject = { key: string; name: string; lessons: number };

export type LpChapter = {
  /** What the service wants back: a 1–5 chapter number, a 6–12 chapter_key. Opaque here. */
  key: string;
  number: number | null;
  title: string;
  pages: string | null;
  lessons: number;
};

/**
 *   day        a 1–5 lesson day ("Day 3", maybe "Day 4 · part 1")
 *   worksheet  a 1–5 chapter worksheet
 *   revision   a 1–5 chapter revision
 *   lesson     a 6–12 lesson, numbered by its place in the chapter
 */
export type LessonKind = 'day' | 'worksheet' | 'revision' | 'lesson';

export type LpLesson = {
  id: string;
  kind: LessonKind;
  /** The day (kind day) or the place in the chapter (kind lesson); null for the others. */
  number: number | null;
  /** "Day 4 · part 1" → 1. */
  part: number | null;
  title: string;
  pages: string | null;
  /** It reached her on WhatsApp (✓✓). */
  sent: boolean;
  /** There is an answer key to ask for (grades 1–5). */
  answerKey: boolean;
  /** Which service, for open() — the screens never read it. */
  lane: Lane;
};

/** What Open did: it can be read now, it is being written, or it cannot be had. */
export type OpenResult =
  | { state: 'ready'; source: LessonPlanSource }
  | { state: 'preparing'; renderId: string }
  | { state: 'unavailable' };

export type PrepareStatus =
  | { state: 'ready'; source: LessonPlanSource }
  | { state: 'preparing' }
  | { state: 'failed' };

/** Her most recent plan, for "Last: Day 2 · Plants". */
export type RecentPlan = { title: string | null; day: number | null; part: number | null; chapter: string | null };

/** The language a 6–12 plan is asked for in — English, as the Curriculum page always asked. */
const LANG_612 = 'en';

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const statusOf = (err: unknown) => (err as { response?: { status?: number } } | null)?.response?.status;

/** "Day 3" → { day: 3 }, "Day 4 · part 1" → { day: 4, part: 1 }; anything else → nothing. */
function parseDay(label: unknown): { day: number | null; part: number | null } {
  const m = String(label ?? '').match(/day\s*(\d+)(?:\D+?part\s*(\d+))?/i);
  return { day: m ? Number(m[1]) : null, part: m && m[2] ? Number(m[2]) : null };
}

function k5Kind(row: Row): LessonKind {
  if (row.lp_type === 'assessment') return 'worksheet';
  if (row.lp_type === 'revision') return 'revision';
  return 'day';
}

function k5Lesson(row: Row): LpLesson {
  const { day, part } = parseDay(row.day_label);
  const kind = k5Kind(row);
  return {
    id: String(row.lesson_id),
    kind,
    number: kind === 'day' ? day : null,
    part: kind === 'day' ? (num(row.part) ?? part) : null,
    title: str(row.topic) ?? str(row.section) ?? String(row.lesson_id),
    pages: str(row.pages_label),
    sent: row.downloaded === true,
    answerKey: true,
    lane: 'k5',
  };
}

function g612Lesson(row: Row, index: number): LpLesson {
  return {
    id: String(row.segment_id),
    kind: 'lesson',
    number: index + 1,
    part: null,
    title: str(row.title) ?? str(row.menu_title) ?? String(row.segment_id),
    pages: str(row.pages_label),
    // Delivered on WhatsApp, when the service says so.
    sent: row.sent === true,
    answerKey: false,
    lane: 'g612',
  };
}

export type LessonPlansApi = ReturnType<typeof createLessonPlansApi>;

export function createLessonPlansApi() {
  let lanes: Map<number, Lane> | null = null;
  /** The grade read in flight, so steps that ask at once share it. */
  let lanesLoading: Promise<unknown> | null = null;
  const subjectsByGrade = new Map<string, Promise<LpSubject[]>>();
  const chaptersBySubject = new Map<string, Promise<LpChapter[]>>();

  /** Kept until it fails: a failed read is asked again next time. */
  function kept<T>(store: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
    const hit = store.get(key);
    if (hit) return hit;
    const p = load();
    store.set(key, p);
    p.catch(() => { if (store.get(key) === p) store.delete(key); });
    return p;
  }

  /** Grades with lesson plans, both services, 1..12. One service down still lists the other's. */
  async function grades(): Promise<number[]> {
    const [k5, g612] = await Promise.allSettled([api.get('/curriculum/grades'), api.get('/lp612/grades')]);
    const map = new Map<number, Lane>();
    const add = (res: PromiseSettledResult<{ data?: { grades?: Row[] } }>, lane: Lane) => {
      if (res.status !== 'fulfilled') return;
      for (const g of res.value?.data?.grades || []) {
        const n = num(g.grade);
        if (n !== null && !map.has(n)) map.set(n, lane);
      }
    };
    add(k5, 'k5');
    add(g612, 'g612');
    if (k5.status === 'rejected' && g612.status === 'rejected') throw k5.reason;
    lanes = map;
    return [...map.keys()].sort((a, b) => a - b);
  }

  async function laneOf(grade: number): Promise<Lane | null> {
    if (!lanes) {
      lanesLoading ??= grades().finally(() => { lanesLoading = null; });
      await lanesLoading;
    }
    return lanes?.get(grade) ?? null;
  }

  async function subjects(grade: number): Promise<LpSubject[]> {
    const lane = await laneOf(grade);
    if (!lane) return [];
    return kept(subjectsByGrade, String(grade), async () => {
      const { data } = await api.get(lane === 'k5' ? '/curriculum/subjects' : '/lp612/subjects', { params: { grade } });
      return ((data?.subjects || []) as Row[]).map((s) => ({
        // 6–12 has no subject_key: its display name IS the key it wants back.
        key: String(s.subject_key ?? s.subject),
        name: String(s.subject ?? s.subject_key ?? ''),
        lessons: num(s.lesson_count) ?? 0,
      }));
    });
  }

  async function chapters(grade: number, subject: string): Promise<LpChapter[]> {
    const lane = await laneOf(grade);
    if (!lane) return [];
    return kept(chaptersBySubject, `${grade}\u0000${subject}`, async () => {
      const { data } = await api.get(lane === 'k5' ? '/curriculum/chapters' : '/lp612/chapters', { params: { grade, subject } });
      return ((data?.chapters || []) as Row[]).map((c) => ({
        // 1–5 addresses a chapter by number; 6–12 by chapter_key (one subject can span two books).
        key: String(c.chapter_key ?? c.chapter_number),
        number: num(c.chapter_number),
        title: String(c.chapter_title ?? ''),
        pages: str(c.pages_label),
        lessons: num(c.lesson_count) ?? 0,
      }));
    });
  }

  async function lessons(grade: number, subject: string, chapter: string): Promise<LpLesson[]> {
    const lane = await laneOf(grade);
    if (!lane) return [];
    if (lane === 'k5') {
      const { data } = await api.get('/curriculum/lps', { params: { grade, subject, chapter_number: chapter } });
      return ((data?.lessons || []) as Row[]).map(k5Lesson);
    }
    const { data } = await api.get('/lp612/lessons', { params: { grade, subject, chapter_key: chapter, lang: LANG_612 } });
    return ((data?.lessons || []) as Row[]).map(g612Lesson);
  }

  /**
   * Open a lesson plan, whichever grade. 1–5: it is written, open it. 6–12: ask for it — the
   * service answers "ready" (open it) or starts writing it ("preparing", poll status()). Held
   * back or not in the catalogue (403/404) is an answer, not a fault; anything else throws.
   */
  async function open(lesson: LpLesson): Promise<OpenResult> {
    if (lesson.lane === 'k5') {
      return { state: 'ready', source: { lane: 'k5', lessonId: lesson.id, assetKind: 'lesson' } };
    }
    try {
      const { data } = await api.post('/lp612/request', { segment_id: lesson.id, lang: LANG_612 });
      const renderId = str(data?.renderId);
      if (!renderId) throw new Error('lp612 request: no render id');
      return data?.state === 'ready'
        ? { state: 'ready', source: { lane: 'g612', renderId } }
        : { state: 'preparing', renderId };
    } catch (err) {
      const status = statusOf(err);
      if (status === 403 || status === 404) return { state: 'unavailable' };
      throw err;
    }
  }

  /** The answer key of a grades 1–5 lesson; null where there is none to ask for. */
  function answerKey(lesson: LpLesson): LessonPlanSource | null {
    return lesson.lane === 'k5' && lesson.answerKey ? { lane: 'k5', lessonId: lesson.id, assetKind: 'answer_key' } : null;
  }

  /** The poll while a plan is written. Not an open: no ?open=1. A dropped poll throws. */
  async function status(renderId: string): Promise<PrepareStatus> {
    try {
      const { data } = await api.get(`/lp612/status/${encodeURIComponent(renderId)}`);
      if (data?.state === 'ready') return { state: 'ready', source: { lane: 'g612', renderId } };
      if (data?.state === 'failed') return { state: 'failed' };
      return { state: 'preparing' };
    } catch (err) {
      // No such request (or not hers): nothing will ever open. Anything else, ask again.
      if (statusOf(err) === 404) return { state: 'failed' };
      throw err;
    }
  }

  /** Her most recent lesson plan (opened here or received on WhatsApp), or null. */
  async function recent(): Promise<RecentPlan | null> {
    const { data } = await api.get('/lesson-plans/recent', { params: { limit: 1 } });
    const p = (data?.plans || [])[0] as Row | undefined;
    if (!p) return null;
    const { day, part } = parseDay(p.dayLabel);
    return { title: str(p.title), day, part, chapter: str(p.chapterTitle) };
  }

  return { grades, subjects, chapters, lessons, open, answerKey, status, recent };
}

/** The one the screens use. */
export let lessonPlans: LessonPlansApi = createLessonPlansApi();

/* ── where she is in the flow, kept for the session ──────────────────────── */

/**
 * Her picks: grade → subject → chapter → lesson. The address carries what an inner page needs
 * (so a reload or Back lands on the same page); this keeps the latest picks, so the main page
 * shows all four whichever way she came back to it — as the old page kept her four dropdowns.
 * sessionStorage when it works (the tab, a reload), memory when it does not.
 */
export type Picks = { grade: number | null; subject: string | null; chapter: string | null; lesson: LpLesson | null };

export const NO_PICKS: Picks = { grade: null, subject: null, chapter: null, lesson: null };
const PICKS_KEY = 'nu-lesson-plans-picks';
let memoryPicks: Picks = NO_PICKS;

export function readPicks(): Picks {
  try {
    const raw = window.sessionStorage.getItem(PICKS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Picks>;
      return {
        grade: num(p.grade),
        subject: str(p.subject),
        chapter: str(p.chapter),
        lesson: p.lesson && typeof p.lesson === 'object' && typeof p.lesson.id === 'string' ? p.lesson as LpLesson : null,
      };
    }
  } catch { /* storage blocked: memory below */ }
  return memoryPicks;
}

export function writePicks(picks: Picks): Picks {
  memoryPicks = picks;
  try { window.sessionStorage.setItem(PICKS_KEY, JSON.stringify(picks)); } catch { /* memory only */ }
  return picks;
}

/** Tests only: a fresh client and no picks. */
export function resetLessonPlans(): void {
  lessonPlans = createLessonPlansApi();
  memoryPicks = NO_PICKS;
  try { window.sessionStorage.removeItem(PICKS_KEY); } catch { /* nothing kept */ }
}

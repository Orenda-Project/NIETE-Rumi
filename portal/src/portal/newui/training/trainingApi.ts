import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../services/api';
import type { UnitLock } from '../../lib/unitLock';

/**
 * bd-5rz1v.25 — what the new Training screens share. The endpoints are PortalTrainingV2's
 * (`/training/vendors`, `/levels`, `/courses`, `/modules`, `/module/:id`, …); nothing here holds
 * a training rule. Locks, gates and pass marks all come from the server, as they do for the old
 * page.
 */

/* ── the server's shapes (PortalTrainingV2's types) ──────────────────────── */

export type Vendor = {
  vendor_key: string;
  vendor_name: string;
  level_count: number;
  course_count: number;
  module_count: number;
  completed_module_count: number;
  certificate_count: number;
  avg_score_pct: number | null;
};

export type LevelState = 'locked' | 'certified' | 'ready_for_quiz' | 'in_progress' | 'not_started';

export type Level = {
  id: number;
  name: string;
  order_index: number;
  cpd_level: number | null;
  vendor_key?: string | null;
  unlock_logic?: string;
  state: LevelState;
  module_count: number;
  completed_count: number;
  courses_total: number;
  courses_completed: number;
  passed_at: string | null;
  cooldown_until: string | null;
  previous_level_order: number | null;
};

export type Course = {
  id: string;
  title: string;
  course_type?: string;
  order_index: number;
  module_count: number;
  completed_count: number;
};

export type ModuleSummary = {
  id: string;
  title: string;
  order_index: number;
  duration_seconds: number;
  has_video: boolean;
  has_audio: boolean;
  has_pdf: boolean;
  has_questions?: boolean;
  completed_at: string | null;
  lock?: UnitLock;
};

/** The I-SAPS module exam's gate, from GET /training/modules (ModuleExamPanel's ExamGate). */
export type ExamGate = { available: boolean; body: string; caption: string; cta: string; module_no: number | null };

export type ReadingItem = { title: string; author: string; type: string; description: string; url: string | null };
export type ReadingList = { available: ReadingItem[]; unavailable: ReadingItem[] };

export type QuizAttempt = { id: string; completed_at: string | null; score: number | null; max_score: number | null; quiz_kind: string };

/** GET /training/level/:id/grand-quiz → grand_quiz (LevelExamCard's gate). */
export type GrandQuizGate = {
  state: 'no_quiz' | 'passed' | 'cooldown' | 'courses_incomplete' | 'ready';
  question_count: number;
  exam_kind: 'grand_quiz' | 'capstone' | null;
  pass_mark_pct: number | null;
  cooldown_hours: number | null;
  cooldown_until: string | null;
  courses_total: number;
  courses_started: number;
  passed_at: string | null;
  certificate: { certificate_code: string; teacher_name: string; level_name: string; issued_at: string } | null;
};

/* ── providers ────────────────────────────────────────────────────────────── */

/**
 * The providers' names as teachers know them, and the order the main page lists them in
 * (deep-screens.html: NIETE, I-SAPS, Beacon House, Oxbridge). The server's vendor_name for
 * TALEEMABAD is not what she calls it; PortalTrainingV2's VENDOR_BRAND makes the same mapping.
 * `short` is for tight places: a certificate row, a filter chip.
 */
const PROVIDERS: Record<string, { label: string; short: string; initials: string; rank: number }> = {
  TALEEMABAD: { label: 'NIETE', short: 'NIETE', initials: 'N', rank: 0 },
  ISAPS: { label: 'I-SAPS', short: 'I-SAPS', initials: 'IS', rank: 1 },
  BEACONHOUSE: { label: 'Beacon House', short: 'Beacon', initials: 'BH', rank: 2 },
  OXBRIDGE: { label: 'Oxbridge', short: 'Oxbridge', initials: 'OX', rank: 3 },
};

export function providerLabel(key: string | null | undefined, vendors?: Vendor[] | null): string {
  const k = String(key || '');
  return PROVIDERS[k]?.label ?? vendors?.find((v) => v.vendor_key === k)?.vendor_name ?? k;
}

export function providerShort(key: string | null | undefined, vendorName?: string | null): string {
  const k = String(key || '');
  return PROVIDERS[k]?.short ?? vendorName ?? k;
}

/** "N", "IS", "BH" — the badge in a provider's row. */
export function providerInitials(key: string, name?: string | null): string {
  if (PROVIDERS[key]) return PROVIDERS[key].initials;
  return String(name || key).trim().split(/\s+/).slice(0, 2).map((w) => Array.from(w)[0] || '').join('').toUpperCase();
}

/** NIETE first, then I-SAPS, Beacon House, Oxbridge, then anything else in the server's order. */
export function sortVendors(vendors: Vendor[]): Vendor[] {
  const rank = (v: Vendor) => PROVIDERS[v.vendor_key]?.rank ?? 100;
  return vendors.map((v, i) => ({ v, i })).sort((a, b) => rank(a.v) - rank(b.v) || a.i - b.i).map((x) => x.v);
}

/**
 * Vendors assessed per module, with no level exam at all (PortalTrainingV2's
 * LEVEL_EXAMLESS_VENDORS, bd-60152): the level page shows no exam row for them, and their level
 * certificate is collected from its own row instead.
 */
export const LEVEL_EXAMLESS_VENDORS = new Set(['ISAPS']);

export const isExamless = (vendorKey?: string | null) => LEVEL_EXAMLESS_VENDORS.has(String(vendorKey || '').toUpperCase());

/** A ladder (NIETE: numbered, each unlocks the next) or a set of subjects (Beacon House). */
export const isLadder = (level: Pick<Level, 'unlock_logic'>) => (level.unlock_logic || 'chain') === 'chain';

export const percent = (done: number, total: number) => (total > 0 ? Math.round((Math.min(done, total) / total) * 100) : 0);

export const courseDone = (c: Course) => c.module_count > 0 && c.completed_count >= c.module_count;

/** The quick check's best attempt (PortalTrainingV2's bestAttempt). */
export function bestAttempt(attempts: QuizAttempt[] | null | undefined): QuizAttempt | null {
  const scored = (attempts || []).filter((a) => a.score != null && a.max_score != null);
  if (!scored.length) return null;
  return scored.reduce((best, a) => ((a.score ?? -1) >= (best.score ?? -1) ? a : best));
}

/**
 * The part to do next in a course: the first, in order, that is not done and not locked
 * (`lock` is the bot's, bd-vej4h). null when every part is done or locked.
 */
export function nextPart(modules: ModuleSummary[]): ModuleSummary | null {
  return [...modules].sort((a, b) => a.order_index - b.order_index).find((m) => !m.completed_at && m.lock !== 'locked') ?? null;
}

/**
 * The part after this one: the next in order that is not done and not locked; failing that, the
 * course's next part anywhere (nextPart). What "Continue" and "Up next" open after a part.
 */
export function partAfter(modules: ModuleSummary[], id: string): ModuleSummary | null {
  const list = [...modules].sort((a, b) => a.order_index - b.order_index);
  const at = list.findIndex((m) => m.id === id);
  const later = list.slice(at + 1).find((m) => !m.completed_at && m.lock !== 'locked');
  return later ?? list.find((m) => m.id !== id && !m.completed_at && m.lock !== 'locked') ?? null;
}

/* ── addresses ────────────────────────────────────────────────────────────── */

/** /portal/training, or /portal/training/v2 when she came in on the review URL (bd-60160). */
export function trainingBase(pathname: string): string {
  return pathname.startsWith('/portal/training/v2') ? '/portal/training/v2' : '/portal/training';
}

export function trainingPaths(base = '/portal/training') {
  const provider = (key: string) => `${base}/provider/${encodeURIComponent(key)}`;
  const level = (key: string, levelId: string | number) => `${provider(key)}/level/${levelId}`;
  return {
    home: base,
    certificates: `${base}/certificates`,
    grades: `${base}/grades`,
    provider,
    level,
    levelExam: (key: string, levelId: string | number) => `${level(key, levelId)}/exam`,
    course: (key: string, levelId: string | number, courseId: string) => `${level(key, levelId)}/course/${encodeURIComponent(courseId)}`,
    unit: (moduleId: string) => `${base}/unit/${encodeURIComponent(moduleId)}`,
    quiz: (moduleId: string) => `${base}/unit/${encodeURIComponent(moduleId)}/quiz`,
    exam: (courseId: string) => `${base}/exam/${encodeURIComponent(courseId)}`,
  };
}

/* ── reading ─────────────────────────────────────────────────────────────── */

export type Load<T> = { data: T | null; error: unknown; loading: boolean; reload: () => void };

/**
 * One GET, read when the screen opens and whenever `key` changes. `data` stays null until it
 * answers; a failure keeps `error` and never a made-up value. Each screen re-reads on arrival,
 * which is also what keeps counts fresh after work done elsewhere (bd-xga3l).
 */
export function useGet<T>(url: string | null, params?: Record<string, unknown>, pick?: (d: unknown) => T): Load<T> {
  const [state, setState] = useState<{ data: T | null; error: unknown; loading: boolean }>({ data: null, error: null, loading: Boolean(url) });
  const [tick, setTick] = useState(0);
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const key = url ? `${url}?${JSON.stringify(params ?? {})}` : null;

  useEffect(() => {
    if (!url) { setState({ data: null, error: null, loading: false }); return undefined; }
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    api.get(url, params ? { params } : undefined)
      .then(({ data }) => { if (live) setState({ data: (pickRef.current ? pickRef.current(data) : data) as T, error: null, loading: false }); })
      .catch((error) => { if (live) setState({ data: null, error, loading: false }); });
    return () => { live = false; };
    // `key` carries url and params.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

/** The HTTP status of a failed request, when it has one. */
export function statusOf(error: unknown): number | null {
  const s = (error as { response?: { status?: number } })?.response?.status;
  return typeof s === 'number' ? s : null;
}

/** previous_level_order from a 403 "level locked" refusal (0-based), when the server sent it. */
export function lockedBehind(error: unknown): number | null {
  const n = (error as { response?: { data?: { previous_level_order?: number } } })?.response?.data?.previous_level_order;
  return typeof n === 'number' ? n : null;
}

/** Best quick-check attempts for every part of a course, one request per part (as the old page). */
export function useAttempts(modules: ModuleSummary[] | null): Record<string, QuizAttempt[] | null> {
  const [byModule, setByModule] = useState<Record<string, QuizAttempt[] | null>>({});
  const ids = (modules || []).map((m) => m.id).join(',');
  useEffect(() => {
    if (!modules || !modules.length) { setByModule({}); return undefined; }
    let live = true;
    setByModule(Object.fromEntries(modules.map((m) => [m.id, null])));
    modules.forEach((m) => {
      api.get(`/training/module/${m.id}/attempts`)
        .then(({ data }) => { if (live) setByModule((p) => ({ ...p, [m.id]: data?.attempts || [] })); })
        .catch(() => { if (live) setByModule((p) => ({ ...p, [m.id]: [] })); });
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);
  return byModule;
}

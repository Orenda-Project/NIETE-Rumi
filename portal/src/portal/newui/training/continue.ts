import api from '../../services/api';
import {
  courseDone, nextPart, sortVendors, trainingPaths,
  type Course, type Level, type ModuleSummary, type Vendor,
} from './trainingApi';

/**
 * bd-5rz1v.25 — where "Continue <provider>" on the Training page takes her.
 *
 * No new API: the only timestamps the training endpoints carry are each part's `completed_at`
 * (GET /training/modules), so "where she was last" is the course holding her most recent
 * completion, and "continue" is the next part in it.
 *
 *   1. Open levels: not locked, and not finished — a certified level with parts left still counts
 *      (sandbox, bd-5rz1v.25.5: I-SAPS certified at 53/54, Module 9's last unit next). From
 *      GET /training/levels, already on the page. Started: an open level with something done in
 *      it (or its exam waiting).
 *   2. Nothing started: the first open level of the first provider, in the page's order
 *      (NIETE, I-SAPS, Beacon House, Oxbridge), at its first unfinished course.
 *   3. Otherwise, for each started level (four at most): its courses (GET /training/courses);
 *      the courses she is part-way through, or, if none, the last one she finished; and their
 *      parts (GET /training/modules, two courses a level at most). The latest `completed_at`
 *      among them names the course she was last on.
 *   4. The target, most specific first: that course's next part (not done, not locked —
 *      the bot's lock) → the part's page; no such part but another unfinished course in the
 *      level → that course's page; every course done → the level page, where the exam is.
 *
 * A failed request never blocks the button: that level's page is the answer instead.
 * Typical cost: one course list and one module list.
 */

export type ContinueTarget = { vendorKey: string; levelId: number; to: string };

type Get = <T>(url: string, params?: Record<string, unknown>) => Promise<T>;

const defaultGet: Get = async <T,>(url: string, params?: Record<string, unknown>) => {
  const { data } = await api.get(url, params ? { params } : undefined);
  return data as T;
};

const MAX_LEVELS = 4;
const MAX_COURSES_PER_LEVEL = 2;

const latest = (modules: ModuleSummary[]) =>
  modules.reduce((t, m) => {
    const at = m.completed_at ? Date.parse(m.completed_at) : NaN;
    return Number.isFinite(at) && at > t ? at : t;
  }, -Infinity);

const byOrder = <T extends { order_index: number }>(xs: T[]) => [...xs].sort((a, b) => a.order_index - b.order_index);

export async function findContinue(
  vendors: Vendor[],
  levels: Level[],
  base = '/portal/training',
  get: Get = defaultGet,
): Promise<ContinueTarget | null> {
  const paths = trainingPaths(base);
  const order = sortVendors(vendors).map((v) => v.vendor_key);
  const rank = (k?: string | null) => { const i = order.indexOf(String(k || '')); return i < 0 ? order.length : i; };

  const unfinished = (l: Level) => l.state !== 'certified' || (l.completed_count || 0) < (l.module_count || 0);
  const open = levels.filter((l) => l.vendor_key && l.state !== 'locked' && unfinished(l));
  if (!open.length) return null;

  const atLevel = (l: Level): ContinueTarget => ({ vendorKey: String(l.vendor_key), levelId: l.id, to: paths.level(String(l.vendor_key), l.id) });
  const atCourse = (l: Level, c: Course): ContinueTarget => ({ ...atLevel(l), to: paths.course(String(l.vendor_key), l.id, c.id) });
  const atPart = (l: Level, m: ModuleSummary): ContinueTarget => ({ ...atLevel(l), to: paths.unit(m.id) });

  const courses = (l: Level) => get<{ courses?: Course[] }>('/training/courses', { level_id: l.id }).then((d) => byOrder(d?.courses || []));
  const modules = (c: Course) => get<{ modules?: ModuleSummary[] }>('/training/modules', { course_id: c.id }).then((d) => d?.modules || []);

  /** In a level: the course she was in → its next part; else the next unfinished course; else the level. */
  const resolve = (l: Level, list: Course[], inCourse: Course | null, parts: ModuleSummary[] | null): ContinueTarget => {
    const part = parts ? nextPart(parts) : null;
    if (inCourse && part) return atPart(l, part);
    const unfinished = list.find((c) => !courseDone(c));
    if (unfinished) return atCourse(l, unfinished);
    return atLevel(l);
  };

  const started = open.filter((l) => (l.completed_count || 0) > 0 || (l.courses_completed || 0) > 0 || l.state === 'ready_for_quiz');

  try {
    if (!started.length) {
      const first = [...open].sort((a, b) => rank(a.vendor_key) - rank(b.vendor_key) || a.order_index - b.order_index)[0];
      const list = await courses(first).catch(() => null);
      if (!list) return atLevel(first);
      const course = list.find((c) => !courseDone(c)) ?? null;
      if (!course) return atLevel(first);
      const parts = await modules(course).catch(() => null);
      return resolve(first, list, course, parts);
    }

    type Probe = { level: Level; list: Course[] | null; course: Course | null; parts: ModuleSummary[] | null; at: number };
    const probes: Probe[] = (await Promise.all(
      started.slice(0, MAX_LEVELS).map(async (level): Promise<Probe[]> => {
        const list = await courses(level).catch(() => null);
        if (!list) return [{ level, list: null, course: null, parts: null, at: -Infinity }];
        const midway = list.filter((c) => c.completed_count > 0 && !courseDone(c));
        const touched = list.filter((c) => c.completed_count > 0);
        const look = (midway.length ? midway : touched.slice(-1)).slice(0, MAX_COURSES_PER_LEVEL);
        if (!look.length) return [{ level, list, course: null, parts: null, at: -Infinity }];
        return Promise.all(look.map(async (course) => {
          const parts = await modules(course).catch(() => null);
          return { level, list, course, parts, at: parts ? latest(parts) : -Infinity };
        }));
      }),
    )).flat();

    const best = probes.reduce((a, b) => (
      b.at > a.at || (b.at === a.at && (rank(b.level.vendor_key) < rank(a.level.vendor_key)
        || (rank(b.level.vendor_key) === rank(a.level.vendor_key) && b.level.order_index < a.level.order_index))) ? b : a
    ));
    if (!best.list) return atLevel(best.level);
    return resolve(best.level, best.list, best.course, best.parts);
  } catch {
    return atLevel(started[0] ?? open[0]);
  }
}

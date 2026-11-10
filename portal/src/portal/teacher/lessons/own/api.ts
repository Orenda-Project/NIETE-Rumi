import api from '../../../services/api';
import type { Focus, Level, Purpose, Resource, Size, Way } from './rules';
import type { Extend } from './extend';
import { CHANGE_PARTS, isRefusal, type Band, type Part, type Refusal } from './change';
import type { Section } from './PlanSections';

/**
 * bd-snkn32 — "Make my own": is it on for her (GET /config features.lpMakeOwn, fail-closed), and Make my plan
 * (POST /lp612/own). The answer is a render id the 6-12 Preparing poll and viewer already understand.
 * bd-snkn32.4 — a grades 1–5 day goes as `lesson_id` (its plan in the book's own language); a 6–12 lesson as `segment_id`.
 */
import type { LpLesson } from '../../../newui/lessons/lessonPlansApi';

export { useLpMakeOwn } from './flag';

/** A plan Make my own can start from: a 6–12 lesson, or a grades 1–5 day (not a worksheet or a revision). */
export const ownable = (l: Pick<LpLesson, 'lane' | 'kind'>) =>
  (l.lane === 'g612' && l.kind === 'lesson') || (l.lane === 'k5' && l.kind === 'day');

export type OwnBody = {
  size: Size | null; resources: Resource[]; level: Level | null; way: Way | null; note: string; purpose?: Purpose; focus?: Focus;
  /** /.19 — her book pages, when not the lesson's own (every band; 6–12 inside it or through the next). */
  pages?: { start: number; end: number };
  /** bd-snkn32.14 — grades 6–12: the next lesson's pages joined on, and how. */
  extend?: { next: string; shape: Extend };
};

/** What the bot answered: her new plan's id, a refusal she is told about (bd-snkn32.15), or null (could not reach it). */
export type OwnAnswer = { renderId: string } | { outcome: Refusal } | null;

/** bd-snkn32.13 — a Grade 9–12 lesson's FBISE SLOs, split when they mix Summative and Formative. Not mixed on any failure. */
export type SloMix = { mixed: boolean; summative: string[]; formative: string[] };
export async function fetchSloMix(segmentId: string): Promise<SloMix> {
  try {
    const { data } = await api.get(`/lp612/own/slo/${encodeURIComponent(segmentId)}`);
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    return { mixed: data?.mixed === true, summative: list(data?.summative), formative: list(data?.formative) };
  } catch {
    return { mixed: false, summative: [], formative: [] };
  }
}

async function postOwn(url: string, body: object): Promise<OwnAnswer> {
  try {
    const { data } = await api.post(url, body);
    return typeof data?.renderId === 'string' && data.renderId ? { renderId: data.renderId } : null;
  } catch (err) {
    const r = (err as { response?: { status?: number; data?: { outcome?: unknown } } } | null)?.response;
    return r?.status === 409 && isRefusal(r.data?.outcome) ? { outcome: r.data.outcome } : null;
  }
}

/** Make my plan: her fork's id, or the daily limit, or null (the page says "Couldn't make it"). */
export function makeOwnPlan(lesson: Pick<LpLesson, 'id' | 'lane'>, answers: OwnBody): Promise<OwnAnswer> {
  const at = lesson.lane === 'k5' ? { lesson_id: lesson.id } : { segment_id: lesson.id };
  return postOwn('/lp612/own', { ...at, answers });
}

/** bd-snkn32.15 — Change this plan: any id in her plan's chain, the part, her words. */
export function requestChange(ownId: string, part: string, text: string): Promise<OwnAnswer> {
  return postOwn(`/lp612/own/${encodeURIComponent(ownId)}/change`, { part, text });
}

/**
 * "From your book": the text of her pages (Supabase textbook_pages through the bot's
 * loadPageRangeContent). GET /lp612/own/pages?lesson_id|segment_id&from&to (the dashboard relay takes exactly one id:
 * `lesson_id` for a 1–5 day, `segment_id` for a 6–12 lesson) → { success, loaded, pages: [{ page, text }],
 * missing: [page] }. A book not imported (loaded false, or 404) is not loaded; any other failure is null.
 */
export type BookText = { loaded: boolean; pages: Array<{ page: number; text: string }>; missing: number[] };
export async function fetchBookPages(q: { lesson: string; lane: 'k5' | 'g612'; from: number; to: number }): Promise<BookText | null> {
  const none: BookText = { loaded: false, pages: [], missing: [] };
  const id = q.lane === 'k5' ? { lesson_id: q.lesson } : { segment_id: q.lesson };
  try {
    const { data } = await api.get('/lp612/own/pages', { params: { ...id, from: q.from, to: q.to } });
    if (data?.loaded !== true) return none;
    const pages = (Array.isArray(data.pages) ? data.pages : [])
      .filter((p: unknown): p is { page: number; text: string } => Number.isInteger((p as { page?: unknown })?.page) && typeof (p as { text?: unknown }).text === 'string')
      .map((p: { page: number; text: string }) => ({ page: p.page, text: p.text }));
    const missing = (Array.isArray(data.missing) ? data.missing : []).filter((n: unknown): n is number => Number.isInteger(n));
    return { loaded: true, pages, missing };
  } catch (err) {
    return (err as { response?: { status?: number } } | null)?.response?.status === 404 ? none : null;
  }
}

/**
 * her ready plan as section cards: GET /lp612/own/:id/sections (dashboard relay
 * → bot, read from the JSON stored beside the PDF) → { band, changed, sections: [{ part, text, before? }] }. Only parts
 * of her band pass (never a "whole" card). Any failure or no cards is null: the viewer keeps "Change this plan".
 */
export async function fetchSections(ownId: string, band: Band): Promise<{ changed: Part | null; sections: Section[] } | null> {
  const parts = CHANGE_PARTS[band] as readonly string[];
  try {
    const { data } = await api.get(`/lp612/own/${encodeURIComponent(ownId)}/sections`);
    const sections: Section[] = (Array.isArray(data?.sections) ? data.sections : [])
      .filter((s: { part?: unknown; text?: unknown }) => typeof s?.part === 'string' && parts.includes(s.part) && typeof s.text === 'string')
      .map((s: { part: Part; text: string; before?: unknown }) => ({ part: s.part, text: s.text, ...(typeof s.before === 'string' ? { before: s.before } : {}) }));
    if (!sections.length) return null;
    const changed = typeof data.changed === 'string' && parts.includes(data.changed) ? (data.changed as Part) : null;
    return { changed, sections };
  } catch {
    return null;
  }
}

/**
 * bd-snkn32.20 — "Your plans for this chapter": her own plans on these lessons, newest first (GET /lp612/own/mine,
 * dashboard relay → bot, always the session's user). `ownId` is the plan to open (the latest ready change, else the
 * plan itself). No lessons, a failure, or a malformed row: nothing.
 */
export type MyOwnPlan = {
  ownId: string; rootId: string; lesson: string; band: 'k5' | 'g612'; status: string; changesLeft: number; round: number; createdAt: string;
};
const isMine = (p: unknown): p is MyOwnPlan => {
  const r = p as Partial<MyOwnPlan> | null;
  return !!r && typeof r.ownId === 'string' && !!r.ownId && typeof r.lesson === 'string' && typeof r.status === 'string'
    && Number.isInteger(r.changesLeft) && (r.band === 'k5' || r.band === 'g612');
};
export async function fetchMyOwnPlans(keys: string[]): Promise<MyOwnPlan[]> {
  if (!keys.length) return [];
  try {
    const { data } = await api.get('/lp612/own/mine', { params: { keys: keys.join(',') } });
    return (Array.isArray(data?.plans) ? data.plans : []).filter(isMine);
  } catch {
    return [];
  }
}

/**
 * bd-snkn32.5 — "My own plans" on Lesson Plans home: her recent plans across every lesson, newest first, each with
 * where it lives (GET /lp612/own/recent, dashboard relay → bot, always the session's user), so the portal opens one
 * without going through Make my own. A failure, or a malformed row: nothing.
 */
export type RecentOwnPlan = MyOwnPlan & { grade: number; subject: string; chapter: string; title: string };
const isRecent = (p: unknown): p is RecentOwnPlan => {
  const r = p as Partial<RecentOwnPlan> | null;
  return isMine(p) && Number.isInteger(r!.grade) && typeof r!.subject === 'string' && !!r!.subject
    && typeof r!.chapter === 'string' && !!r!.chapter && typeof r!.title === 'string';
};
export async function fetchRecentOwnPlans(): Promise<RecentOwnPlan[]> {
  try {
    const { data } = await api.get('/lp612/own/recent');
    return (Array.isArray(data?.plans) ? data.plans : []).filter(isRecent);
  } catch {
    return [];
  }
}

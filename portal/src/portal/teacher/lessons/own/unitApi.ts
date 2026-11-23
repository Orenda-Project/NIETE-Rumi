import { useEffect, useState } from 'react';
import api from '../../../services/api';
import { readConfigShared } from '../../../lib/useNewUi';
import type { UnitDay } from './unitEdit';

/**
 * bd-snkn32.59.1 (queue #165) — "Make my own → A whole unit" (grades 1–5, from her book's chapters): is it on for her
 * (GET /config features.lpOwnUnit, list-only, fail-closed) and the unit routes (dashboard/routes/portal-lp-own-unit.routes.js).
 * Every rule is the server's; this only carries her picks.
 */

export const PACES = ['recommended', 'slower', 'faster'] as const;
export type Pace = (typeof PACES)[number];
export const PERIODS = [30, 35, 40, 45] as const;
export const MAX_CHAPTERS = 3;

export type UnitChapter = { number: number; title: string; days: number };
export type PaceCounts = { recommended: number; slower: number; faster: number | null };
export type UnitPlan = { ownId: string; status: string } | null;
export type UnitViewDay = UnitDay & { day: number; plan: UnitPlan };
/** bd-snkn32.59.4 — a goal unit (start_kind 'goals') has her goals' words and no book, no chapter. */
export type Unit = {
  id: string; grade: number; subject: string; book_stem: string | null; chapter_from: number | null; chapter_to: number | null;
  start_kind?: 'book' | 'goals'; goals?: string[] | null;
  period_minutes: number; pace: Pace; status: string; days: UnitViewDay[]; next: number;
};
export type UnitRow = Omit<Unit, 'days' | 'next'> & { days: number; created_at?: string };

/** null while /config is read, then true only for a real `true`. */
export function useLpOwnUnit(): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    readConfigShared()
      .then((cfg) => { if (live) setOn(cfg?.features?.lpOwnUnit === true); })
      .catch(() => { if (live) setOn(false); });
    return () => { live = false; };
  }, []);
  return on;
}

export async function unitChapters(grade: number, subject: string): Promise<{ chapters: UnitChapter[]; period: number | null }> {
  const { data } = await api.get('/lp/own/unit/chapters', { params: { grade, subject } });
  return { chapters: Array.isArray(data?.chapters) ? data.chapters : [], period: typeof data?.period === 'number' ? data.period : null };
}

export async function unitPaces(q: { grade: number; subject: string; from: number; to: number; period: number }): Promise<PaceCounts | null> {
  try {
    const { data } = await api.get('/lp/own/unit/paces', { params: q });
    return data?.counts ?? null;
  } catch {
    return null;
  }
}

export async function createUnit(b: { grade: number; subject: string; from: number; to: number; period: number; pace: Pace }): Promise<Unit | null> {
  try {
    const { data } = await api.post('/lp/own/units', b);
    return data?.unit ?? null;
  } catch {
    return null;
  }
}

/** bd-snkn32.59.4 — her goals as sent: words (and an official code when she picked one), never a book day. */
export type UnitGoal = { kind: 'outcome' | 'topic'; text: string; code?: string };
export const MIN_GOALS = 2;
export const MAX_GOALS = 8;

export async function goalPaces(q: { count: number; period: number }): Promise<PaceCounts | null> {
  try {
    const { data } = await api.get('/lp/own/unit/paces', { params: { start: 'goals', ...q } });
    return data?.counts ?? null;
  } catch {
    return null;
  }
}

export async function createGoalUnit(b: { grade: number; subject: string; goals: UnitGoal[]; period: number; pace: Pace }): Promise<Unit | null> {
  try {
    const { data } = await api.post('/lp/own/units', { start: 'goals', ...b });
    return data?.unit ?? null;
  } catch {
    return null;
  }
}

export async function listUnits(): Promise<UnitRow[]> {
  const { data } = await api.get('/lp/own/units');
  return Array.isArray(data?.units) ? data.units : [];
}

export async function readUnit(id: string): Promise<Unit | null> {
  const { data } = await api.get(`/lp/own/units/${encodeURIComponent(id)}`);
  return data?.unit ?? null;
}

/** Save her changed days (or pace/period). 'locked': a day's plan is made, the days no longer change. */
export async function saveUnit(id: string, b: { outline?: UnitDay[]; pace?: Pace; period?: number }): Promise<Unit | 'locked' | null> {
  try {
    const { data } = await api.put(`/lp/own/units/${encodeURIComponent(id)}`, b);
    return data?.unit ?? null;
  } catch (err) {
    return (err as { response?: { status?: number } })?.response?.status === 409 ? 'locked' : null;
  }
}

export type DayOpen = { kind: 'made'; ownId: string } | { kind: 'book'; lessonId: string } | { kind: 'refused'; outcome: string } | null;

/** Open one day: its plan is made now (one make), or the book's own review/test day, or the plan she already has. */
export async function openUnitDay(id: string, day: number, answers: object): Promise<DayOpen> {
  try {
    const { data } = await api.post(`/lp/own/units/${encodeURIComponent(id)}/days/${day}/open`, { answers });
    if (typeof data?.renderId === 'string') return { kind: 'made', ownId: data.renderId };
    if (data?.outcome === 'made' && typeof data.ownId === 'string') return { kind: 'made', ownId: data.ownId };
    if (data?.outcome === 'book' && typeof data.lessonId === 'string') return { kind: 'book', lessonId: data.lessonId };
    return null;
  } catch (err) {
    const r = (err as { response?: { status?: number; data?: { outcome?: unknown } } })?.response;
    return r?.status === 409 && typeof r.data?.outcome === 'string' ? { kind: 'refused', outcome: r.data.outcome } : null;
  }
}

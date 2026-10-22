/**
 * What the lesson list and its neighbours share: loading a catalogue, the top bar with Back,
 * the subject list, and where each list page lives.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { flnApi } from './api';
import type { FlnCatalogue, FlnPlacement, FlnRow } from './types';
import type { FlnSubjectKey } from './strings';
import { bdiRuns } from './Bdi';
import { lessonsBack } from '../teacher/lessons/paths';

export const FLN_SUBJECTS: readonly FlnSubjectKey[] = ['rh-en', 'rh-ur', 'num'];
// bd-4joiqz — the one way back to the lesson plans (teacher/lessons/paths lessonsBack): step 1, where the band is.
export const NEW_LESSON = lessonsBack('new');

export const isFlnSubject = (v: unknown): v is FlnSubjectKey => typeof v === 'string' && (FLN_SUBJECTS as readonly string[]).includes(v);

/** /portal/fln/list/<subject>?grade=<g>[&level=<n>] */
export function listUrl(subject: FlnSubjectKey, grade: number, level?: number | null): string {
  const q = new URLSearchParams({ grade: String(grade) });
  if (level) q.set('level', String(level));
  return `/portal/fln/list/${subject}?${q.toString()}`;
}

/** /portal/fln/p/<id>[?grade=<g>] — `grade` is the list's grade, so the plan shows that grade's place (QT-counts). */
export const planUrl = (id: number, grade?: number | null) => `/portal/fln/p/${id}${grade ? `?grade=${grade}` : ''}`;

export const isGuideRow = (r: FlnRow) => !!r.chips?.guide || r.label === 'guide' || r.pos === 0;

/** A catalogue's lesson count for its grade: the first numbered row's `count` (its own grade's rows), else the level's. */
export function rowsCount(cat: FlnCatalogue, level: number, strand = 0): number {
  const rows = (cat.strands[strand]?.chapters ?? []).flatMap((c) => c.plans);
  return rows.find((r) => !isGuideRow(r))?.count ?? cat.levels.find((l) => l.level === level)?.count ?? 0;
}

/** The placement row for the grade the plan was opened from; without one (or no match) the first row, as before. */
export function placementForGrade(placement: FlnPlacement[], grade: number | null): FlnPlacement | undefined {
  return (grade != null ? placement.find((p) => p.grade === grade) : undefined) ?? placement[0];
}

/** The grade whose book a level's list is drawn from (L1 → 1, L2 → 3, L3 → 5; SPEC v2 §3 / server brief). */
export const LEVEL_GRADE: Record<1 | 2 | 3, number> = { 1: 1, 2: 3, 3: 5 };

export type CatState = { k: 'loading' } | { k: 'off' } | { k: 'error' } | { k: 'ok'; cat: FlnCatalogue };

/** Load one catalogue answer; 404 → off, 401/503/5xx/network → error (the gate already handled sign-in). */
export function useCatalogue(q: { grade: number; subject: FlnSubjectKey; level?: number | null } | null): [CatState, () => void] {
  const [state, setState] = useState<CatState>({ k: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const key = q ? `${q.subject}|${q.grade}|${q.level ?? ''}` : '';
  useEffect(() => {
    if (!q) return undefined;
    let live = true;
    setState({ k: 'loading' });
    flnApi.catalogue(q).then(
      (cat) => { if (live) setState(cat ? { k: 'ok', cat } : { k: 'off' }); },
      () => { if (live) setState({ k: 'error' }); },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return [state, retry];
}

/** The page's top bar: a ≥48 px Back link (‹ / › by direction) and the title. */
export function TopBar({ back, backLabel, title, rtl }: { back: string; backLabel: string; title: string; rtl: boolean }) {
  return (
    <div className="fln-top">
      <Link className="fln-back" to={back} aria-label={backLabel}>
        <span aria-hidden="true">{rtl ? '›' : '‹'}</span>
      </Link>
      <span className="fln-top-title">{bdiRuns(title, rtl)}</span>
    </div>
  );
}

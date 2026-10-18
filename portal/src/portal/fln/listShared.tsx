/**
 * bd-t7zk3t.11 — what the level chooser and the lesson list share: loading a catalogue, the top bar with Back,
 * the subject list, and where each list page lives.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { flnApi } from './api';
import type { FlnCatalogue } from './types';
import type { FlnSubjectKey } from './strings';
import { bdiRuns } from './Bdi';

export const FLN_SUBJECTS: readonly FlnSubjectKey[] = ['rh-en', 'rh-ur', 'num'];
export const NEW_LESSON = '/portal/teacher/lessons/new';

export const isFlnSubject = (v: unknown): v is FlnSubjectKey => typeof v === 'string' && (FLN_SUBJECTS as readonly string[]).includes(v);

/** /portal/fln/list/<subject>?grade=<g>[&level=<n>] */
export function listUrl(subject: FlnSubjectKey, grade: number, level?: number | null): string {
  const q = new URLSearchParams({ grade: String(grade) });
  if (level) q.set('level', String(level));
  return `/portal/fln/list/${subject}?${q.toString()}`;
}

export const planUrl = (id: number) => `/portal/fln/p/${id}`;

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

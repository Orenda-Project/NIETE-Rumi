import { useEffect, useState } from 'react';
import INDEX_DATA from './manual.index';

/**
 * bd-3xf7vb.1 (queue #217) — the two indicator guides behind the "?" on the Observe pages, as DATA (language is data:
 * every text carries its en and ur). Grades 1–5 = FICO v6 (17 indicators), grades 6–12 = FICO M/H (23).
 *
 * The content is Dr Rifat Yasmeen's FICO Observer Manual (her canvas; the operator 23 Nov ~16:55: "This is the
 * artifact we want to attach as a guide for fico in the ? on the app"): per indicator what it measures, what to look
 * for, who sets it, how it is scored or where to look, levels 1–4 each with an example and why, and her watch-outs.
 * The name, section, level names and N/A are the form's own (rubric files; N/A as #216 approved: v6.1 C2 C3 C5 D4,
 * FICO-S v1.2 C2 C3), so a card reads like the form the observer is filling. Her full manual is one tap away
 * (`manualHref`), at the band's part or at the indicator.
 *
 * Built outside this repo (queue #217 work folder, workbench/make_manual_guides.py) from her canvas; re-read it and
 * rebuild when she edits it. The two data files are ~360 KB, so they load only when a guide opens (the coach's
 * first-open budget, budget/coachEntry.budget.test.ts); the form asks the small index whether a code has a card.
 */
export type Text = { en: string; ur: string };
export type GuideLevel = { n: number; text: Text; example: Text; why: Text };
export type GuideItem = {
  code: string;
  name: Text;
  means: Text;
  lookFor: Text[];
  /** v6: "dc" = the Digital Coach suggests and the observer checks; "hitl" = set from the room. FICO M/H: none. */
  who: 'dc' | 'hitl' | null;
  how: Text;
  levels: GuideLevel[];
  tips: Text[];
  na: { title: Text; when: Text } | null;
};
export type GuideSection = { key: string; name: Text; items: GuideItem[] };
export type Band = '1-5' | '6-12';
export type Guide = {
  id: string;
  band: Band;
  label: Text;
  level_labels: { en: Record<string, string>; ur: Record<string, string> };
  manual: { url: string; part: string };
  credit: Text;
  sections: GuideSection[];
  provenance: string;
};
type BandIndex = { id: string; label: Text; part: string; codes: readonly string[] };

export const BANDS: readonly Band[] = ['1-5', '6-12'];
export const INDEX = INDEX_DATA as unknown as { url: string; bands: Record<Band, BandIndex> };

const LOADERS: Record<Band, () => Promise<{ default: unknown }>> = {
  '1-5': () => import('./fico_v6.manual'),
  '6-12': () => import('./fico_mh.manual'),
};
const cache: Partial<Record<Band, Promise<Guide>>> = {};

/** A band's guide, loaded once (a failed load is forgotten, so opening it again tries again). */
export function loadGuide(band: Band): Promise<Guide> {
  cache[band] ??= LOADERS[band]().then(
    (m) => m.default as Guide,
    (e) => { delete cache[band]; throw e; },
  );
  return cache[band]!;
}

/** The guide for a band: null while it loads, 'failed' when it could not (no network for the chunk). */
export function useGuide(band: Band): Guide | null | 'failed' {
  const [state, setState] = useState<{ band: Band; guide: Guide | null | 'failed' }>({ band, guide: null });
  useEffect(() => {
    let live = true;
    loadGuide(band).then((g) => { if (live) setState({ band, guide: g }); }, () => { if (live) setState({ band, guide: 'failed' }); });
    return () => { live = false; };
  }, [band]);
  return state.band === band ? state.guide : null;
}

/** Rifat's manual (her live canvas) at a band's part, or at one indicator: "#v6-start", "#s-ind-C2". */
export function manualHref(band: Band, code?: string): string {
  const part = INDEX.bands[band].part;
  return `${INDEX.url}#${part}-${code ? `ind-${code}` : 'start'}`;
}

/** The band of a visit from its rubric id: FICO-S (fico_s_v…) is 6–12, FICO17 (fico17_…) is 1–5; anything else none. */
export function bandOfRubric(id: string | null | undefined): Band | undefined {
  const s = String(id || '');
  if (/^fico_s_v/.test(s)) return '6-12';
  if (/^fico17_/.test(s)) return '1-5';
  return undefined;
}

/** Whether a band's guide has this indicator code ("C2", "A3"): the form's "Examples" shows only then. */
export function hasIndicator(band: Band, code: string): boolean {
  return INDEX.bands[band].codes.includes(code);
}

const CODE = /^[a-f]\d{0,2}$/i;
const plain = (s: string) => s.replace(/[⁦-⁩]/g, '').toLowerCase();

/** Search: a code or code prefix ("C", "c2") matches codes only; otherwise every word must appear in either language. */
export function matches(it: GuideItem, q: string): boolean {
  const s = q.trim();
  if (!s) return true;
  if (CODE.test(s)) return it.code.toLowerCase().startsWith(s.toLowerCase());
  const hay = plain([it.code, it.name.en, it.name.ur, it.means.en, it.means.ur].join(' '));
  return plain(s).split(/\s+/).every((w) => hay.includes(w));
}

import v61 from './fico17_v6_1.guide';
import s12 from './fico_s_v1_2.guide';

/**
 * bd-3xf7vb.1 (queue #217) — the two indicator guides behind the "?" on the Observe pages, as DATA (language is data:
 * every text carries its en and ur). Grades 1–5 = FICO17 v6.1 (17 indicators), grades 6–12 = FICO 6-12 v1.2 (23).
 * Per indicator: what it looks at, one example with its level, levels 1–4 in plain words (the rubric's thresholds),
 * and N/A only where the operator approved it (#216, 21 Nov: v6.1 C2 C3 C5 D4; FICO-S v1.2 C2 C3).
 *
 * The JSON is built outside this repo (queue #217 work folder, workbench/build_guides.py) from the rubric files and
 * the reviewed guide text; names and level labels come from the rubric files, so they match the form. Urdu: draft for
 * native review. Latin atoms inside Urdu (C2, SOW) are already isolated (U+2066 … U+2069).
 */
export type Text = { en: string; ur: string };
export type GuideItem = {
  code: string;
  name: Text;
  means: Text;
  example: Text & { level: number };
  levels: Array<Text & { n: number }>;
  na: { title: Text; when: Text } | null;
  note: Text | null;
  star: boolean;
  where: Text | null;
};
export type GuideSection = { key: string; name: Text; items: GuideItem[] };
export type Guide = {
  id: string;
  label: Text;
  grades: Text;
  level_labels: { en: Record<string, string>; ur: Record<string, string> };
  intro: Text;
  legend: Text;
  sections: GuideSection[];
};
export type Band = '1-5' | '6-12';

export const GUIDES: Record<Band, Guide> = { '1-5': v61 as unknown as Guide, '6-12': s12 as unknown as Guide };
export const BANDS: readonly Band[] = ['1-5', '6-12'];

/** The band of a visit from its rubric id: FICO-S (fico_s_v…) is 6–12, FICO17 (fico17_…) is 1–5; anything else none. */
export function bandOfRubric(id: string | null | undefined): Band | undefined {
  const s = String(id || '');
  if (/^fico_s_v/.test(s)) return '6-12';
  if (/^fico17_/.test(s)) return '1-5';
  return undefined;
}

/** Whether a band's guide has this indicator code ("C2", "A3"): the form's "Examples" shows only then. */
export function hasIndicator(band: Band, code: string): boolean {
  return GUIDES[band].sections.some((s) => s.items.some((it) => it.code === code));
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

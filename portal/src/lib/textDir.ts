import { useCallback, useSyncExternalStore } from 'react';
import i18n from 'i18next';

/**
 * bd-fmf24g.62 — "even in Urdu mode … it remains LTR like it's supposed to" (operator). A string that comes from DATA — a
 * lesson title, a subject, a teacher's or a school's name, a number, a date — and holds no Urdu at all is its own LTR
 * paragraph on an Urdu page. The ELEMENT that draws it carries dir="ltr": its words and its "&" keep their order at
 * every wrap, and a clamp or truncate cuts its end with the ellipsis on the right (bd-fmf24g.48). An inline isolate
 * alone is not enough: inside an RTL line the ellipsis lands on the left and eats the start of the clamped line.
 *
 * Rule 20 / language-protocol §8: a dir attribute is an isolate (unicode-bidi: isolate) WITH a direction; text that
 * holds Urdu is left to inherit the page (its Latin atoms are isolated by the teacher kit's egress, bidi.ts).
 */

/** Any strong right-to-left character: Hebrew, Arabic (Urdu) and their presentation forms. */
const RTL_SCRIPT = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
/** Something that reads left to right: a Latin letter or a digit. */
const LTR_CONTENT = /[A-Za-z0-9\u00C0-\u024F]/;
/** Bidi isolate and mark controls (LRI, RLI, FSI, PDI, LRM, RLM) are not content. */
const CONTROLS = /[\u2066-\u2069\u200E\u200F]/g;

/** "ltr" for a string with Latin letters or digits and no Urdu (or other RTL script) in it; undefined otherwise. */
export function latinDir(text: unknown): 'ltr' | undefined {
  if (typeof text !== 'string' && typeof text !== 'number') return undefined;
  const s = String(text).replace(CONTROLS, '');
  return LTR_CONTENT.test(s) && !RTL_SCRIPT.test(s) ? 'ltr' : undefined;
}

function subscribe(onChange: () => void) {
  i18n.on('languageChanged', onChange);
  return () => { i18n.off('languageChanged', onChange); };
}
const isUrdu = () => String(i18n.language || '').toLowerCase().startsWith('ur');

/** The attributes an element that draws a data string takes: `dir="ltr"` and the `data-latin` marker, or nothing. */
export type LatinAttrs = { dir?: 'ltr'; 'data-latin'?: '' };

/**
 * `{ dir: "ltr", "data-latin": "" }` for an English (Latin/digit, no Urdu) string, `{}` otherwise. `data-latin` lets
 * index.css keep the run on its row's side on an Urdu page (text-align: right): it READS left to right, but it still
 * sits next to the row's tile or avatar like the Urdu rows around it. A clamp or truncate that overflows is start-aligned
 * by CSS, so it still cuts the END of the title, with the ellipsis on the right.
 */
export function latinAttrs(text: unknown): LatinAttrs {
  return latinDir(text) ? { dir: 'ltr', 'data-latin': '' } : {};
}

/**
 * For an element that draws a data string: `latinAttrs` on an Urdu page, nothing on an English page (untouched) or for
 * Urdu text (it inherits the page). A non-string (a React node) is left alone.
 */
export function useLatinAttrs(): (text: unknown) => LatinAttrs {
  const ur = useSyncExternalStore(subscribe, isUrdu, isUrdu);
  return useCallback((text: unknown) => (ur ? latinAttrs(text) : {}), [ur]);
}

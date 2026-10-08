import { useEffect, useSyncExternalStore } from 'react';
import i18n from 'i18next';
import { language as languageApi } from '../services/api';

/**
 * bd-fmf24g.13 — the teacher v2 language layer (language-protocol: NIETE is flat en/ur).
 *
 *   bilingual(en, ur)  a copy module in both languages. `ur` is typed to en's exact SHAPE (Words<T>): a
 *                      missing key, an extra key or a function with another signature fails the build.
 *   untranslated()     the keys whose Urdu is empty or still the English — each module's completeness test
 *                      runs it, so nothing falls back to English silently (protocol §6.3).
 *   useLang/useCopy    the page's language (i18n — it also sets <html lang dir> and the Nastaliq font,
 *                      src/i18n/config.ts) and that language's words; a switch re-renders every reader.
 *   useFollowPreferredLanguage
 *                      v2 screens follow her stored preferred_language (GET /me/language) EVEN WHEN SHE
 *                      DID NOT LOCK IT — teacher-addressed text reads the current preference (Rule 20).
 *                      Operator decision, provisional (2026-10-09), scoped to v2 screens: today's pages
 *                      follow only a locked choice (newui/DESIGN.md). Read only: setUserLanguage (PUT
 *                      /me/language, via More's Language row) stays the one writer.
 *
 * DATA is not copy: titles, names and subjects come from the API as they are.
 */

export type Lang = 'en' | 'ur';
export const OFFERED: readonly Lang[] = ['ur', 'en'];

export const langOf = (code?: string | null): Lang => (String(code || '').toLowerCase().startsWith('ur') ? 'ur' : 'en');
const isOffered = (code: unknown): code is Lang => code === 'ur' || code === 'en';

/** The shape a translation must have: every string a string, every function the same signature. */
export type Words<T> =
  T extends string ? string
    : T extends (...args: infer A) => infer R ? (...args: A) => Words<R>
      : T extends readonly (infer U)[] ? readonly Words<U>[]
        : T extends object ? { readonly [K in keyof T]: Words<T[K]> }
          : T;

export type Bilingual<T> = { readonly en: Words<T>; readonly ur: Words<T> };

export function bilingual<T>(en: T, ur: Words<T>): Bilingual<T> {
  return { en: en as unknown as Words<T>, ur };
}

export function copyIn<T>(m: Bilingual<T>, lang: Lang): Words<T> {
  return lang === 'ur' ? m.ur : m.en;
}

/** Sample arguments a copy function is called with to compare its two languages. */
const SAMPLE_ARGS = [3, 7, 9];

/**
 * Paths ("a.b", "months.2") whose Urdu is empty, missing, or identical to the English. `allow` lists the
 * paths that are rightly the same in both (a brand, "—", a separator).
 */
export function untranslated<T>(m: Bilingual<T>, allow: readonly string[] = []): string[] {
  const out: string[] = [];
  const walk = (en: unknown, ur: unknown, path: string) => {
    if (typeof en === 'function') {
      const e = String((en as (...a: unknown[]) => unknown)(...SAMPLE_ARGS));
      const u = typeof ur === 'function' ? String((ur as (...a: unknown[]) => unknown)(...SAMPLE_ARGS)) : '';
      if (!u.trim() || u === e) out.push(path);
      return;
    }
    if (typeof en === 'string') {
      if (typeof ur !== 'string' || !ur.trim() || ur === en) out.push(path);
      return;
    }
    if (en && typeof en === 'object') {
      for (const k of Object.keys(en as object)) {
        walk((en as Record<string, unknown>)[k], ur && typeof ur === 'object' ? (ur as Record<string, unknown>)[k] : undefined, path ? `${path}.${k}` : k);
      }
    }
  };
  walk(m.en, m.ur, '');
  return out.filter((p) => !allow.includes(p));
}

function subscribe(onChange: () => void) {
  i18n.on('languageChanged', onChange);
  return () => { i18n.off('languageChanged', onChange); };
}
const snapshot = (): Lang => langOf(i18n.language);

/** The page's language; re-renders the reader when it changes. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** This page's words, in its language. */
export function useCopy<T>(m: Bilingual<T>): Words<T> {
  return copyIn(m, useLang());
}

/* ── following her stored language ───────────────────────────────────────── */

let followed = false;

/** v2 only: take her stored preferred_language, locked or not, once per page load. Never writes. */
export function useFollowPreferredLanguage(ready: boolean): void {
  useEffect(() => {
    if (!ready || followed) return;
    followed = true;
    Promise.resolve()
      .then(() => languageApi.get())
      .then(({ language }) => {
        if (isOffered(language) && language !== snapshot()) void i18n.changeLanguage(language);
      })
      .catch(() => { /* the page keeps the language it has */ });
  }, [ready]);
}

/** Tests only. */
export function resetLanguageFollow(): void {
  followed = false;
}

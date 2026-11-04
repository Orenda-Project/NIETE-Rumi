import { useEffect, useState, useSyncExternalStore } from 'react';
import i18n from 'i18next';
import { language as languageApi } from '../services/api';
import { takeBoot } from '@/lib/bootReads';

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

/**
 * bd-43f1sk — the longest the gate holds a v2 page for her language (and, in Urdu, its font). Past it the page draws in
 * the language it has, and turns when the read lands, as before.
 */
export const LANGUAGE_WAIT_MS = 1500;

/** The Urdu face (index.css). Loading it before the page draws keeps a late font swap from growing the text. */
const URDU_FONT = '16px "NIETE Nastaliq"';
const URDU_SAMPLE = 'اردو';
/** The Latin face (index.html's Google Fonts link): names and schools in either language. A late swap re-wraps them. */
const LATIN_FONT = '500 16px "Plus Jakarta Sans"';
const LATIN_SAMPLE = 'Aa';

/** This page load's one read of her language, shared by every gate that asks (a page change re-mounts the gate). */
let following: Promise<void> | null = null;
let followedDone = false;

function follow(): Promise<void> {
  if (!following) {
    // bd-43f1sk — index.html's boot read of /me/language on the Home (taken once), else the read as before.
    const boot = takeBoot<{ language?: unknown }>('language');
    following = Promise.resolve()
      .then(() => (boot ? boot.then((b) => b ?? languageApi.get()) : languageApi.get()))
      .then((answer) => {
        const language = (answer as { language?: unknown } | null)?.language;
        if (isOffered(language) && language !== snapshot()) return i18n.changeLanguage(language).then(() => undefined);
        return undefined;
      })
      .then(() => {
        // The faces this page draws with, loaded before it draws (a late swap re-wraps the band's lines and moves it).
        const fonts = typeof document !== 'undefined' ? (document as Document & { fonts?: { load?: (f: string, t?: string) => Promise<unknown> } }).fonts : undefined;
        if (!fonts?.load) return undefined;
        const faces = [fonts.load(LATIN_FONT, LATIN_SAMPLE)];
        if (snapshot() === 'ur') faces.push(fonts.load(URDU_FONT, URDU_SAMPLE));
        return Promise.all(faces).then(() => undefined);
      })
      .catch(() => { /* the page keeps the language it has */ })
      .then(() => { followedDone = true; });
  }
  return following;
}

/**
 * v2 only: take her stored preferred_language, locked or not, once per page load. Never writes.
 * bd-43f1sk — returns true once her language is applied (and, for Urdu, the Nastaliq face has loaded), or after
 * LANGUAGE_WAIT_MS, or when it was already done on this page load: the gate draws the page then, so it is drawn once,
 * in her language, instead of in English and then turned.
 */
export function useFollowPreferredLanguage(ready: boolean): boolean {
  const [settled, setSettled] = useState(followedDone);
  useEffect(() => {
    if (!ready || settled) return undefined;
    let live = true;
    const done = () => { if (live) setSettled(true); };
    const cap = setTimeout(done, LANGUAGE_WAIT_MS);
    void follow().then(() => { clearTimeout(cap); done(); });
    return () => { live = false; clearTimeout(cap); };
  }, [ready, settled]);
  return settled || followedDone;
}

/** Tests only. */
export function resetLanguageFollow(): void {
  following = null;
  followedDone = false;
}

'use strict';
/**
 * The words around a recommended training clip — bd-gzfdu9 (VIDREC), SPEC §4.2. Pure.
 *
 * The strings live in the catalog (ux-strings.js, `videoReco*`); this file only fills them: whole minutes
 * (Urdu-Indic digits for ur), the clip's language by name, and the LLM's reason, whose English runs inside
 * an Urdu line are set in their own left-to-right isolates (U+2066…U+2069) so the line reads right to left.
 * Used by send.js (the WhatsApp message), the /cr card and the /v player.
 */
const { resolveUx, clampLanguage } = require('../../../config/ux-strings');
const { getLanguage } = require('../../../config/languages');

const BODY_MAX = 1024; // Meta's cap on an interactive body, in code points
const URDU_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const LRI = '⁦';
const PDI = '⁩';
const RLM = '‏';

/** The reader's language as NIETE offers it (flat en/ur, language-protocol): the catalog's own clamp. */
const lang = (l) => clampLanguage(l);
/** 'rtl' | 'ltr' from the language registry. */
const dirOf = (l) => (getLanguage(lang(l))?.direction === 'rtl' ? 'rtl' : 'ltr');
/** A row's per-language field (`title_ur`, `reason_ur`, …), falling back to the English one. */
const localized = (obj, field, l) => (obj && (obj[`${field}_${lang(l)}`] || obj[`${field}_en`])) || null;

/** Whole minutes for a clip of `s` seconds, never below 1. */
function minutesOf(s) {
  const n = Math.round((Number(s) || 0) / 60);
  return n < 1 ? 1 : n;
}

const urduDigits = (n) => String(n).replace(/[0-9]/g, (d) => URDU_DIGITS[Number(d)]);
const DIGITS = { ur: urduDigits };
const num = (n, l) => (DIGITS[l] || String)(n);

/** 95 → "1:35". */
function clock(s) {
  const t = Math.max(0, Math.floor(Number(s) || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

const LANG_KEY = { ur: 'videoRecoLangUr', en: 'videoRecoLangEn', mixed: 'videoRecoLangMixed' };
const clipLanguageName = (clipLanguage, l) => resolveUx(LANG_KEY[clipLanguage] || LANG_KEY.ur, { language: l });

/**
 * Each Latin phrase inside an Urdu line in its own isolate, and the line opened right to left. A phrase is
 * Latin words joined by spaces/hyphens/apostrophes; a bare number or clock ("12:40") is left alone.
 */
function isolateLatin(text) {
  const s = String(text || '');
  if (!s || /[⁦-⁩]/.test(s)) return s;
  const out = s.replace(/[A-Za-z][A-Za-z0-9'’-]*(?:\s+[A-Za-z0-9][A-Za-z0-9'’-]*)*/g, (run) => `${LRI}${run}${PDI}`);
  const first = [...out].find((ch) => /\p{L}/u.test(ch) && !/[⁦-⁩]/.test(ch));
  return first && /[؀-ۿ]/.test(first) ? out : `${RLM}${out}`;
}

// An Urdu line sets its English runs in isolates; other lines are as written.
const LINE = { ur: isolateLatin };

function cut(text, max) {
  const cps = [...text];
  return cps.length <= max ? text : `${cps.slice(0, Math.max(0, max - 1)).join('').trimEnd()}…`;
}

function buttonText({ minutes, language }) {
  const l = lang(language);
  return resolveUx('videoRecoButton', { language: l, params: { n: num(minutes, l) } });
}

function cardButton({ minutes, language }) {
  const l = lang(language);
  return resolveUx('videoRecoCardButton', { language: l, params: { n: num(minutes, l) } });
}

/** lead \n reason \n meta — the reason is cut first so the whole body stays ≤ 1024 code points. */
function messageBody({ minutes, reason, clipLanguage, language }) {
  const l = lang(language);
  const lead = resolveUx('videoRecoBodyLead', { language: l, params: { n: num(minutes, l) } });
  const meta = resolveUx('videoRecoBodyMeta', { language: l, params: { n: num(minutes, l), lang: clipLanguageName(clipLanguage, l) } });
  const r = String(reason || '').replace(/\s+/g, ' ').trim();
  if (!r) return `${lead}\n${meta}`;
  const room = BODY_MAX - [...lead].length - [...meta].length - 2;
  const line = cut((LINE[l] || String)(r), room);
  return `${lead}\n${line}\n${meta}`;
}

/** A plain catalog line in the reader's language (player + card labels). */
const word = (key, language, params) => resolveUx(key, { language: lang(language), params });

module.exports = {
  lang, dirOf, localized, num, minutesOf, urduDigits, clock, isolateLatin, buttonText, cardButton, messageBody, clipLanguageName, word, BODY_MAX,
};

'use strict';
/**
 * bd-v0toag.32 — a teacher's week summary → the template call whatsapp.service.sendTemplate makes. Pure.
 *
 * A week with nothing to count gets weekly_usage_quiet_v1: no numbers, said kindly. Otherwise
 * weekly_usage_v1 with seven body parameters (templates/weekly-usage.template). Language is the teacher's
 * preferred_language, clamped to the NIETE offer (en/ur, English floor).
 */

const { clampLanguage } = require('../../../config/ux-strings');
const { templateCodeFor } = require('../../../config/languages');
const { TEMPLATE, QUIET_TEMPLATE } = require('../../../templates/weekly-usage.template');
const { isQuietWeek } = require('./summarise');

const MONTHS = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  ur: ['جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر'],
};

const PHRASES = {
  en: {
    teacher: 'Teacher',
    notChecked: 'not checked yet',
    did: (did, of) => `done in ${did} of ${of} recordings`,
    partly: (n) => `, partly in ${n}`,
    notSeen: (of) => `not seen yet in ${of} recordings`,
    noAnswers: 'no answers yet',
    agreed: (up, of) => `${up} of ${of}`,
  },
  ur: {
    teacher: 'استاد',
    notChecked: 'ابھی جانچا نہیں گیا',
    did: (did, of) => `${of} میں سے ${did} ریکارڈنگ میں کیا`,
    partly: (n) => `، ${n} میں کچھ حد تک`,
    notSeen: (of) => `${of} ریکارڈنگز میں ابھی نظر نہیں آیا`,
    noAnswers: 'ابھی کوئی جواب نہیں',
    agreed: (up, of) => `${of} میں سے ${up}`,
  },
};

function dayMonth(dateStr) {
  const [, mo, d] = String(dateStr).split('-').map(Number);
  return { d, m: mo - 1 };
}

/** "12–16 Oct" / "12 تا 16 اکتوبر"; across a month end both months are named. */
function weekLabel({ weekStart, lastDay }, lang) {
  const a = dayMonth(weekStart);
  const b = dayMonth(lastDay);
  const months = MONTHS[lang] || MONTHS.en;
  if (lang === 'ur') {
    return a.m === b.m
      ? `${a.d} تا ${b.d} ${months[b.m]}`
      : `${a.d} ${months[a.m]} تا ${b.d} ${months[b.m]}`;
  }
  return a.m === b.m
    ? `${a.d}–${b.d} ${months[b.m]}`
    : `${a.d} ${months[a.m]} – ${b.d} ${months[b.m]}`;
}

function movePhrase(move, p) {
  if (!move || !move.checked) return p.notChecked;
  if (!move.did && !move.partly) return p.notSeen(move.checked);
  if (!move.did) return p.did(0, move.checked) + p.partly(move.partly);
  return p.did(move.did, move.checked) + (move.partly ? p.partly(move.partly) : '');
}

function thumbsPhrase(thumbs, p) {
  const of = (thumbs && thumbs.up + thumbs.down) || 0;
  return of ? p.agreed(thumbs.up, of) : p.noAnswers;
}

function firstName(name, p) {
  const first = String(name || '').trim().split(/\s+/)[0];
  return first || p.teacher;
}

const text = (v) => ({ type: 'text', text: String(v) });

/**
 * @returns {{template:string, languageCode:string, language:string, quiet:boolean, components:Array}}
 */
function buildMessage({ summary, week, teacher = {} }) {
  const language = clampLanguage(teacher.preferred_language);
  const p = PHRASES[language] || PHRASES.en;
  const quiet = isQuietWeek(summary);
  const head = [firstName(teacher.name, p), weekLabel(week, language)];
  const values = quiet ? head : [
    ...head,
    summary.lessonPlans,
    summary.daysUsed,
    summary.recordings,
    movePhrase(summary.move, p),
    thumbsPhrase(summary.thumbs, p),
  ];
  return {
    template: (quiet ? QUIET_TEMPLATE : TEMPLATE).name,
    languageCode: templateCodeFor(language),
    language,
    quiet,
    components: [{ type: 'body', parameters: values.map(text) }],
  };
}

module.exports = { buildMessage, weekLabel };

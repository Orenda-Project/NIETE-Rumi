'use strict';

/**
 * bd-ra8xu.38 — the teacher's self-recording report on FICO17 v6, option A (operator, 11 Nov): the 11 levels the
 * Digital Coach sets, then ONE line naming the six the coach scores in the room.
 *
 * BUILT, NOT WIRED. Nothing sends this today: the teacher's report stays V3 until the operator switches the DC (the
 * v10 coaching A/B test is read on V3 on 7 Dec). Switching means calling this from the report path for sessions
 * whose analysis is stamped rubric 'fico17_v6' — never for a V3 session.
 *
 * Rules: NA is left out (the thing never came up; it is not a low mark). IE ("couldn't tell") is one line, never a
 * level. Level titles and the v6 level text are English rubric data (fico17_v6.rubric.json); the rubric has no Urdu
 * yet, so an Urdu report frames them in Urdu and keeps the indicator names and level text in English inline (the
 * language-protocol convention for pedagogical terms). Every Urdu string here is a DRAFT for native review.
 */

const v6 = require('./index');

const STRINGS = {
  en: {
    head: 'Your lesson, as the Digital Coach heard it',
    level: (n, label) => `Level ${n} of 4 (${label})`,
    ie: "Couldn't tell from the recording",
    coachSix: (names) => `These six are scored when your coach visits: ${names}.`,
    none: 'The Digital Coach could not set any level from this recording.',
  },
  // DRAFT — native Urdu review pending (Rifat / a native speaker). Gender-neutral, Nastaliq; English terms inline.
  ur: {
    head: 'ڈیجیٹل کوچ نے آپ کے سبق میں کیا سنا',
    level: (n, label) => `درجہ ${n} از 4 (${label})`,
    ie: 'ریکارڈنگ سے معلوم نہیں ہو سکا',
    coachSix: (names) => `یہ چھ درجے کوچ کے دورے پر دیے جاتے ہیں: ${names}۔`,
    none: 'اس ریکارڈنگ سے ڈیجیٹل کوچ کوئی درجہ نہیں دے سکا۔',
  },
};
const DRAFT_LANGUAGES = ['ur'];

const resultOf = (row) => (row && typeof row === 'object' ? row.result : row);

/**
 * @param {object} levels  a v6 analysis's `levels` ({ C1: { result, because, evidence }, ... })
 * @param {{language?: string}} [opts]
 * @returns {{ rubric, language, draft, rows: object[], coach_codes: string[], text: string }}
 */
function buildTeacherReport(levels = {}, { language = 'en' } = {}) {
  const lang = STRINGS[language] ? language : 'en';
  const S = STRINGS[lang];
  const rows = [];
  for (const code of v6.DC_CODES) {
    const result = v6.normLevel(resultOf(levels[code]));
    if (result === null || result === 'NA') continue; // NA (and nothing) is left out
    const ind = v6.indicator(code);
    if (result === 'IE') {
      rows.push({ code, name: ind.name, result: 'IE', line: `${ind.name}: ${S.ie}` });
      continue;
    }
    rows.push({
      code,
      name: ind.name,
      result,
      title: v6.TITLES[code][result - 1],
      level_text: v6.levelText(code, result),
      line: `${ind.name}: ${S.level(result, v6.LEVEL_LABELS[result])} · ${v6.TITLES[code][result - 1]}\n${v6.levelText(code, result)}`,
    });
  }
  const coachNames = v6.COMBINED_CODES.map((c) => v6.indicator(c).name);
  const body = rows.length ? rows.map((r) => `• ${r.line}`).join('\n\n') : S.none;
  const text = `*${S.head}*\n\n${body}\n\n${S.coachSix(coachNames.join(', '))}`;
  return {
    ...v6.stamp('dc'),
    language: lang,
    draft: DRAFT_LANGUAGES.includes(lang),
    rows,
    coach_codes: v6.COMBINED_CODES.slice(),
    text,
  };
}

module.exports = { buildTeacherReport, STRINGS, DRAFT_LANGUAGES };

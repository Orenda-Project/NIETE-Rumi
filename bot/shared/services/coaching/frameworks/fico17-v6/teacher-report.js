'use strict';

/**
 * bd-ra8xu.38 — the teacher's self-recording report on FICO17 v6: the 11 levels the Digital Coach sets, then the six
 * room indicators (C3 C5 C7 D2 D3 D4) by name with what the recording showed and NO level (operator 11 Nov ~17:50,
 * with Ahwaz: "show evidence but do not grade"; this replaced option A's one line naming the six). The coach sets
 * those six in the room; the report only shows Rumi's evidence for them.
 *
 * BUILT, NOT WIRED. Nothing sends this today: the teacher's report stays V3 until the operator switches the DC (the
 * v10 coaching A/B test is read on V3 on 7 Dec). Switching means calling this from the report path for sessions
 * whose analysis is stamped rubric 'fico17_v6' — never for a V3 session.
 *
 * Rules: NA is left out (the thing never came up; it is not a low mark). IE ("couldn't tell") is one line, never a
 * level (spec §9.3). A broken transcript (the quality gate's status) gives no level at all, only the one line saying
 * so (spec §6.3). The two lines are the /observe2 report strings (CONTRACTS §6.5) when they exist. Level titles and the v6 level text are English rubric data (fico17_v6.rubric.json); the rubric has no Urdu
 * yet, so an Urdu report frames them in Urdu and keeps the indicator names and level text in English inline (the
 * language-protocol convention for pedagogical terms). Every Urdu string here is a DRAFT for native review.
 */

const v6 = require('./index');
const { observe2Strings } = require('../../../observe/observe2/strings');

const STRINGS = {
  en: {
    head: 'Your lesson, as the Digital Coach heard it',
    level: (n, label) => `Level ${n} of 4 (${label})`,
    ie: "The recording didn't cover this part of the lesson.",
    broken: "The recording couldn't be used, so this report has no levels from it.",
    none: 'The Digital Coach could not set any level from this recording.',
    sixHead: 'What the recording showed for six more (your coach sets these six in the room; no level here):',
    nothing: 'nothing in the recording for this.',
    noTalk: 'no child-to-child talk was found in the recording.',
    turns: (a, b) => `${a} student turns in the first half, ${b} in the second.`,
    sixCoach: (names) => `Your coach sets these six in the room: ${names}.`,
  },
  // DRAFT — native Urdu review pending (Rifat / a native speaker). Gender-neutral, Nastaliq; English terms inline.
  ur: {
    head: 'ڈیجیٹل کوچ نے آپ کے سبق میں کیا سنا',
    level: (n, label) => `درجہ ${n} از 4 (${label})`,
    ie: 'ریکارڈنگ میں سبق کا یہ حصہ نہیں آیا۔',
    broken: 'ریکارڈنگ استعمال نہیں ہو سکی، اس لیے اس رپورٹ میں اس سے کوئی درجہ نہیں۔',
    none: 'اس ریکارڈنگ سے ڈیجیٹل کوچ کوئی درجہ نہیں دے سکا۔',
    sixHead: 'مزید چھ کے لیے ریکارڈنگ میں کیا ملا (یہ چھ درجے کوچ کلاس میں دیتے ہیں؛ یہاں کوئی درجہ نہیں):',
    nothing: 'ریکارڈنگ میں اس کے لیے کچھ نہیں ملا۔',
    noTalk: 'ریکارڈنگ میں بچوں کی آپس میں بات چیت نہیں ملی۔',
    turns: (a, b) => `پہلے نصف میں بچوں کی ${a} باریاں، دوسرے میں ${b}۔`,
    sixCoach: (names) => `یہ چھ درجے کوچ کلاس میں دیتے ہیں: ${names}۔`,
  },
};
const DRAFT_LANGUAGES = ['ur'];

const resultOf = (row) => (row && typeof row === 'object' ? row.result : row);

/**
 * @param {object} levels  a v6 analysis's `levels` ({ C1: { result, because, evidence }, ... })
 * @param {{language?: string, transcriptQuality?: {status: string}|null}} [opts]
 *   transcriptQuality  the analysis's transcript_quality; 'broken' → no level rows, the one line
 * @returns {{ rubric, language, draft, rows: object[], coach_codes: string[], text: string }}
 */
// The quotes shown per room indicator, at most: the coach reads the rest in their own review.
const EVIDENCE_ITEMS = 3;
const QUOTE_CAP = 120;
const clipQuote = (q) => v6.clip(String(q || '').trim(), QUOTE_CAP);

/** One room indicator's evidence row: never a level, only what the recording showed (or a plain line). */
function evidenceRow(code, ev, S) {
  const name = v6.indicator(code).name;
  if (code === 'D2') {
    const a = ev && Number(ev.student_turns_first_half);
    const b = ev && Number(ev.student_turns_second_half);
    const line = Number.isFinite(a) && Number.isFinite(b) ? S.turns(a, b) : S.nothing;
    return { code, name, line: `${name}: ${line}`, items: [] };
  }
  const result = ev && ev.result;
  const items = ((ev && Array.isArray(ev.items)) ? ev.items : []).filter((i) => i && i.quote).slice(0, EVIDENCE_ITEMS)
    .map((i) => ({ time: i.time || '', quote: clipQuote(i.quote), kind: i.kind || null }));
  let line;
  if (result === 'IE') line = S.ie;
  else if (result === 'NA') line = S.noTalk;
  else if (!items.length) line = S.nothing;
  else line = items.map((i) => `${i.time} "${i.quote}"`).join(' · ');
  return { code, name, line: `${name}: ${line}`, items: result === 'IE' || result === 'NA' ? [] : items };
}

/**
 * @param {object} levels  a v6 analysis's `levels` ({ C1: { result, because, evidence }, ... })
 * @param {{language?: string, transcriptQuality?: {status: string}|null, combinedEvidence?: object|null}} [opts]
 *   combinedEvidence  the analysis's `combined_evidence` (C3 C5 C7 D3 D4 items, D2 turn counts)
 */
function buildTeacherReport(levels = {}, { language = 'en', transcriptQuality = null, combinedEvidence = null } = {}) {
  const lang = STRINGS[language] ? language : 'en';
  const O = observe2Strings(lang);
  const S = { ...STRINGS[lang], ie: O.v6_report_ie || STRINGS[lang].ie, broken: O.v6_report_broken || STRINGS[lang].broken };
  const broken = Boolean(transcriptQuality && transcriptQuality.status === 'broken');
  const rows = [];
  for (const code of broken ? [] : v6.DC_CODES) {
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
  const ce = combinedEvidence || {};
  const evidenceRows = broken ? [] : v6.COMBINED_CODES.map((code) => evidenceRow(code, ce[code], S));
  const body = broken ? S.broken : rows.length ? rows.map((r) => `• ${r.line}`).join('\n\n') : S.none;
  // A broken recording has no evidence to show; the six are still named, as the coach's.
  const six = evidenceRows.length
    ? `\n\n${S.sixHead}\n${evidenceRows.map((r) => `• ${r.line}`).join('\n')}`
    : `\n\n${S.sixCoach(v6.COMBINED_CODES.map((c) => v6.indicator(c).name).join(', '))}`;
  const text = `*${S.head}*\n\n${body}${six}`;
  return {
    ...v6.stamp('dc'),
    language: lang,
    draft: DRAFT_LANGUAGES.includes(lang),
    rows,
    evidence_rows: evidenceRows,
    coach_codes: v6.COMBINED_CODES.slice(),
    text,
  };
}

module.exports = { buildTeacherReport, STRINGS, DRAFT_LANGUAGES };

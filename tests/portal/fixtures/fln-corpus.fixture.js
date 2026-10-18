'use strict';
/**
 * bd-t7zk3t.11 — a SYNTHETIC FLN corpus bundle with the shape of contracts/plan-json.md v2 and the hazards of the
 * real one (a guide at pos 0, a screener with its note, hidden and additional rows, an Urdu header with a trailing
 * Latin token, mixed Urdu/Latin digits, `**bold**`). No text here comes from the real corpus; the ids are made up.
 */

const VERSION = 'v1-20261018-0badc0de';

const audio = (label, extra = {}) => ({ kind: 'audio', src: `https://media.example.test/fln/audio/${label}.mp3`, orig: `https://orig.example.test/${label}.mp3`, ok: true, role: 'sound', label, label_en: label, ...extra });

function plan(id, { subject, lang = 'en', title, total = 30, slo = ['Learners say three practice sounds aloud.'], sections = null }) {
  return {
    id,
    key: `fln:${id}`,
    subject,
    lang,
    dir: lang === 'ur' ? 'rtl' : 'ltr',
    title,
    slo,
    resources: [],
    minutes: { total, opening: 5, explain: 10, practice: 10, conclusion: total - 25 },
    sections: sections || [{ kind: 'opening', minutes: 5, groups: [{ header: null, level: null, items: [{ kind: 'say', text: 'Say **zz** together.', media: [audio('zz')] }] }] }],
    source_grade: 1,
    programme: 'p25',
    audio_summary: { sounds: 1, words: 0, narration: false },
  };
}

const row = (o) => ({ programme: 'p25', audio: { sounds: 0, words: 0, narration: false, video: false }, ...o });

function build() {
  const plans = {
    900001: plan(900001, { subject: 'rh-en', title: 'Practice guide for teachers', total: 20 }),
    900002: plan(900002, { subject: 'rh-en', title: 'Practice screener', total: 53 }),
    900003: plan(900003, { subject: 'rh-en', title: 'Sounds of q, x, z', slo: ['Learners **hear** and say the sounds of q, x and z in 3 short words, then blend them.'] }),
    900004: plan(900004, { subject: 'rh-en', title: 'Sounds of v, w, y' }),
    900005: plan(900005, { subject: 'rh-en', title: 'Sounds of j, k, l' }),
    900006: plan(900006, { subject: 'rh-en', title: 'Extra blending practice' }),
    900007: plan(900007, { subject: 'rh-en', title: 'A hidden draft' }),
    900008: plan(900008, { subject: 'rh-en', title: 'Level two practice' }),
    900009: plan(900009, { subject: 'rh-en', title: 'Level three practice' }),
    900010: plan(900010, {
      subject: 'rh-ur', lang: 'ur', title: 'حروف کی مشق ۲ اور 3',
      slo: ['طلبہ <b>&</b> حروف پہچانیں گے'],
      sections: [{ kind: 'opening', minutes: 5, groups: [{ header: 'حروف کا تعارف SLO', level: null, items: [{ kind: 'say', text: 'کہیں **ب** — مشق ۱ اور 2', media: [audio('ب', { label_ur: 'ب' })] }] }] }],
    }),
    900011: plan(900011, { subject: 'num', title: 'Counting to 20' }),
    900012: plan(900012, { subject: 'num', title: 'Shapes around us' }),
  };
  const placement = [
    // RH-EN grade 1: guide (pos 0), screener, 3 core with sound clips, one additional, one hidden.
    row({ subject: 'rh-en', level: 1, grade: 1, strand: 'daily', chapter_no: 1, chapter_title_en: 'Getting started', chapter_title_ur: 'آغاز', pos: 0, lp_id: 900001, shelf: 'core', label: 'guide' }),
    row({ subject: 'rh-en', level: 1, grade: 1, strand: 'daily', chapter_no: 1, chapter_title_en: 'Getting started', chapter_title_ur: 'آغاز', pos: 1, lp_id: 900002, shelf: 'core', label: 'screener', note_en: 'Ask each learner to read the row aloud.', note_ur: 'ہر بچے سے قطار پڑھوائیں۔', audio: { sounds: 4, words: 0, narration: false, video: false } }),
    row({ subject: 'rh-en', level: 1, grade: 1, strand: 'daily', chapter_no: 2, chapter_title_en: 'Sounds', pos: 2, lp_id: 900003, shelf: 'core', audio: { sounds: 3, words: 2, narration: true, video: false }, used_by: 12 }),
    row({ subject: 'rh-en', level: 1, grade: 1, strand: 'daily', chapter_no: 2, chapter_title_en: 'Sounds', pos: 3, lp_id: 900004, shelf: 'core', audio: { sounds: 3, words: 0, narration: false, video: false } }),
    row({ subject: 'rh-en', level: 1, grade: 1, strand: 'daily', chapter_no: 2, chapter_title_en: 'Sounds', pos: 4, lp_id: 900005, shelf: 'core', label: 'needs_textbook', audio: { sounds: 3, words: 0, narration: false, video: true } }),
    row({ subject: 'rh-en', level: 1, grade: 1, strand: 'daily', chapter_no: 3, chapter_title_en: 'More practice', pos: 5, lp_id: 900006, shelf: 'additional', label: 'additional_practice' }),
    row({ subject: 'rh-en', level: 1, grade: 1, strand: 'daily', chapter_no: 3, chapter_title_en: 'More practice', pos: 6, lp_id: 900007, shelf: 'hidden' }),
    // grades 3 and 5, so G6-12 levels resolve (L2 -> grade 3, L3 -> grade 5); explicit count on one.
    row({ subject: 'rh-en', level: 2, grade: 3, strand: 'daily', chapter_no: 1, chapter_title_en: 'Level two', pos: 1, lp_id: 900008, shelf: 'core', count: 40 }),
    row({ subject: 'rh-en', level: 3, grade: 5, strand: 'daily', chapter_no: 1, chapter_title_en: 'Level three', pos: 1, lp_id: 900009, shelf: 'core' }),
    // RH-UR grade 1.
    row({ subject: 'rh-ur', level: 1, grade: 1, strand: 'daily', chapter_no: 1, chapter_title_en: 'Letters', chapter_title_ur: 'حروف', pos: 1, lp_id: 900010, shelf: 'core', audio: { sounds: 1, words: 0, narration: false, video: false } }),
    // NUM grade 2: extended listed first in the data, daily must still come first.
    row({ subject: 'num', level: 2, grade: 2, strand: 'extended', chapter_no: 4, chapter_title_en: 'Shapes', pos: 1, lp_id: 900012, shelf: 'core' }),
    row({ subject: 'num', level: 2, grade: 2, strand: 'daily', chapter_no: 1, chapter_title_en: 'Numbers', pos: 1, lp_id: 900011, shelf: 'core' }),
  ];
  return {
    version: VERSION,
    built_at: '2026-10-18T00:00:00Z',
    subjects: [
      { key: 'rh-en', subject_id: 1, name_en: 'Reading Hour · English', name_ur: 'ریڈنگ آور — انگریزی', lang: 'en', dir: 'ltr' },
      { key: 'rh-ur', subject_id: 2, name_en: 'Reading Hour · Urdu', name_ur: 'ریڈنگ آور — اردو', lang: 'ur', dir: 'rtl' },
      { key: 'num', subject_id: 3, name_en: 'Numeracy', name_ur: 'بنیادی حساب', lang: 'en', dir: 'ltr' },
    ],
    levels: [
      { subject: 'rh-en', level: 1, label_en: 'Level 1', label_ur: 'سطح ۱', desc_en: 'First sounds', desc_ur: 'پہلی آوازیں', grades: [1], screener_id: 900002, guide_id: 900001 },
      { subject: 'rh-en', level: 2, label_en: 'Level 2', label_ur: 'سطح ۲', desc_en: 'Blends', desc_ur: 'ملاپ', grades: [2, 3], screener_id: null },
      { subject: 'rh-en', level: 3, label_en: 'Level 3', label_ur: 'سطح ۳', desc_en: 'Reading', desc_ur: 'پڑھائی', grades: [4, 5], screener_id: null },
      { subject: 'rh-ur', level: 1, label_en: 'Level 1', label_ur: 'سطح ۱', desc_en: 'Letters', desc_ur: 'حروف', grades: [1], screener_id: null },
      { subject: 'num', level: 2, label_en: 'Level 2', label_ur: 'سطح ۲', desc_en: 'Numbers', desc_ur: 'اعداد', grades: [2, 3], screener_id: null },
    ],
    placement,
    plans,
  };
}

module.exports = { VERSION, build };

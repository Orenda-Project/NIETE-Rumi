'use strict';
/**
 * FBISE (Federal Board, Pakistan) header, legend and file lines for the board chrome (board/chrome.js reads
 * this as BOARDS.FBISE). Four exam kinds, one per grade: SSC-I (9), SSC-II (10), HSSC-I (11), HSSC-II (12).
 * Wording follows BLUEPRINTS §4-§7 and P7-P9: "Examination Paper", never "Model Question Paper". An off-year
 * TERM variant prints "Term Examination (FBISE <part> pattern)" and never the board's examination header.
 * Pure data and pure functions. Reads words.js only (chrome.js requires this file, so no cycle back).
 */
const { GRADE_WORD, timeEn, timeUr } = require('./words');

const EXAM_KINDS = ['ssc1', 'ssc2', 'hssc1', 'hssc2'];
const GRADE_OF = { ssc1: 9, ssc2: 10, hssc1: 11, hssc2: 12 };
const PART = { ssc1: 'SSC-I', ssc2: 'SSC-II', hssc1: 'HSSC-I', hssc2: 'HSSC-II' };
const SESSION = '2027';
const NAME = { en: 'FBISE board pattern', ur: 'FBISE بورڈ pattern' };
const FILES = { en: 'Paper + marking scheme · two PDFs', ur: 'پرچہ + مارکنگ اسکیم · دو PDF' }; // ur: needs fluent-Urdu review
const WAIT = { en: '~3 min', ur: 'تقریباً 3 منٹ' }; // ur: needs fluent-Urdu review

const BOARD_EN = 'Federal Board';
const BOARD_UR = 'وفاقی بورڈ'; // ur: needs fluent-Urdu review
const PAPER_EN = 'Examination Paper';
const PAPER_UR = 'امتحانی پرچہ'; // ur: needs fluent-Urdu review
const isTerm = (V) => V.variant_id === 'term';

function examName(grade, kind) {
  if (GRADE_OF[kind] !== grade) throw new Error(`FBISE ${PART[kind] || kind} is grade ${GRADE_OF[kind]}, not grade ${grade}`);
  return `${BOARD_EN} ${PART[kind]} Examination`;
}
const termEn = (kind) => `Term Examination (FBISE ${PART[kind]} pattern)`;
const termUr = (kind) => `سمسٹر امتحان (FBISE ${PART[kind]} pattern)`; // ur: needs fluent-Urdu review

function timeParts(V) {
  const en = timeEn(V.total_time_min);
  const ur = timeUr(V.total_time_min);
  return { en: en ? `Time Allowed: ${en}` : '', ur: ur ? `وقت: ${ur}` : '' }; // ur: needs fluent-Urdu review
}

function header(grade, kind, S, V) {
  const g = GRADE_WORD[grade];
  const t = timeParts(V);
  return {
    title_en: `${g.en} · ${S.name_en} · ${isTerm(V) ? termEn(kind) : examName(grade, kind)}`,
    title_ur: `${g.ur} · ${S.name_ur} · ${isTerm(V) ? termUr(kind) : `${BOARD_UR} ${PART[kind]}`}`, // ur: needs fluent-Urdu review
    time_line_en: t.en,
    time_line_ur: t.ur,
    total_line_en: `Total Marks: {t:${V.total_marks}}`,
    total_line_ur: `کل نمبر: {t:${V.total_marks}}`, // ur: needs fluent-Urdu review
    school_line_en: 'School: ____________',
    school_line_ur: 'اسکول: ____________', // ur: needs fluent-Urdu review
    note_en: null,
    note_ur: null,
  };
}

function examHeader(grade, kind, S, V) {
  const t = timeParts(V);
  const total = `Total Marks: {t:${V.total_marks}}`;
  const totalUr = `کل نمبر: {t:${V.total_marks}}`; // ur: needs fluent-Urdu review
  const top = isTerm(V) ? [termEn(kind), termUr(kind)] : [examName(grade, kind), `${BOARD_UR} ${PART[kind]}`]; // ur: needs fluent-Urdu review
  const label = V.label_en ? [`(${V.label_en})`] : [];
  return {
    lines_en: [top[0], `${S.name_en} · ${PAPER_EN}`, ...label, [t.en, total].filter(Boolean).join(' · ')],
    lines_ur: [top[1], `${S.name_ur} · ${PAPER_UR}`, ...label, [t.ur, totalUr].filter(Boolean).join(' · ')], // ur: needs fluent-Urdu review
  };
}

// BLUEPRINTS §4: "pass 40%" (SSC). HSSC states none in the source notes; legendFor() is not told the exam kind.
const PASS_EN = 'Pass = 40%.';
const COMMON_EN = [
  'MCQs: 1 mark for the filled bubble. Two bubbles or an overwritten answer = 0.',
  '"Attempt any N": tell children to answer exactly N. If more are answered, mark all and keep the best N.',
  'Where a question shows OR, the child answers one of the two.',
];
const COMMON_UR = [
  'معروضی: درست بھرے دائرے پر نمبر۔ دو دائرے یا اوور رائٹنگ = 0۔',
  '«کوئی سے N»: بچوں کو بالکل N سوال حل کرنے کو کہیں۔ زیادہ حل ہوں تو سب جانچ کر بہترین N رکھیں۔',
  'جہاں «یا» لکھا ہو، بچہ دونوں میں سے ایک حل کرے۔',
]; // ur: needs fluent-Urdu review
const STYLE_EN = {
  analytic_points: 'Mark each answer point by point; one mark per valid point, up to the marks shown.',
  holistic_bands: 'Mark each answer against its band descriptor; give the band that best fits the whole answer.',
};
const STYLE_UR = {
  analytic_points: 'ہر جواب نکتہ بہ نکتہ جانچیں؛ ہر درست نکتے پر ایک نمبر، دکھائے گئے نمبروں تک۔',
  holistic_bands: 'ہر جواب کو اس کے بینڈ کے بیان سے جانچیں؛ پورے جواب پر سب سے موزوں بینڈ دیں۔',
}; // ur: needs fluent-Urdu review

function legendFor(subject, style) {
  return {
    subject,
    title_en: 'How to mark',
    title_ur: 'جانچنے کا طریقہ', // ur: needs fluent-Urdu review
    lines_en: [...COMMON_EN, STYLE_EN[style], PASS_EN],
    lines_ur: [...COMMON_UR, STYLE_UR[style], 'پاس = 40٪'], // ur: needs fluent-Urdu review
  };
}

module.exports = { EXAM_KINDS, GRADE_OF, SESSION, NAME, FILES, WAIT, examName, header, examHeader, legendFor };

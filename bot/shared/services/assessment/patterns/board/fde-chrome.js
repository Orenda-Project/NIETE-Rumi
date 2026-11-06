'use strict';
/**
 * FDE header, legend and file lines for the board chrome (board/chrome.js reads this as BOARDS.FDE).
 * G6-7 are school term papers (no crest); G8 is the centralised Annual Examination (BLUEPRINTS §1-§3).
 * Pure data and pure functions. Never requires the G5 pattern or the mid chrome.
 */
// chrome.js requires this file at load, so its words and time helpers are read lazily (circular require).
const { GRADE_WORD, timeEn, timeUr } = require('./words');

const EXAM_KINDS = ['term', 'annual'];
const SESSION = '2026-27';
const NAME = { en: 'FDE board pattern', ur: 'FDE بورڈ pattern' };
const FILES = { en: 'Paper + marking scheme · two PDFs', ur: 'پرچہ + مارکنگ اسکیم · دو PDF' }; // ur: needs fluent-Urdu review
const WAIT = { en: '~3 min', ur: 'تقریباً 3 منٹ' }; // ur: needs fluent-Urdu review

const FDE_EN = 'Federal Directorate of Education';
const FDE_UR = 'وفاقی نظامتِ تعلیمات، اسلام آباد';
const KIND_EN = { term: 'Term Examination', annual: 'Annual Examination' };
const KIND_UR = { term: 'سمسٹر امتحان', annual: 'سالانہ امتحان' }; // ur: needs fluent-Urdu review

const examName = (grade, kind) => (kind === 'term'
  ? `${KIND_EN.term} · FDE 2023-24 model pattern`
  : `${FDE_EN} · ${KIND_EN.annual} · ${GRADE_WORD[grade].en}`);

function timeParts(V) {
  const en = timeEn(V.total_time_min);
  const ur = timeUr(V.total_time_min);
  return { en: en ? `Time Allowed: ${en}` : '', ur: ur ? `وقت: ${ur}` : '' }; // ur: needs fluent-Urdu review
}

function header(grade, kind, S, V) {
  const g = GRADE_WORD[grade];
  const t = timeParts(V);
  return {
    title_en: `${g.en} · ${S.name_en} · ${KIND_EN[kind]}`,
    title_ur: `${g.ur} · ${S.name_ur} · ${KIND_UR[kind]}`,
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
  const g = GRADE_WORD[grade];
  const t = timeParts(V);
  const total = `Total Marks: {t:${V.total_marks}}`;
  const totalUr = `کل نمبر: {t:${V.total_marks}}`; // ur: needs fluent-Urdu review
  if (kind === 'term') {
    return {
      lines_en: [examName(grade, kind), `${g.en} · ${S.name_en}`, [t.en, total].filter(Boolean).join(' · ')],
      lines_ur: [`${KIND_UR.term} · FDE 2023-24 model pattern`, `${g.ur} · ${S.name_ur}`, [t.ur, totalUr].filter(Boolean).join(' · ')],
    };
  }
  return {
    lines_en: [FDE_EN, `${KIND_EN.annual} · ${g.en}`, [S.name_en, t.en, total].filter(Boolean).join(' · ')],
    lines_ur: [FDE_UR, `${KIND_UR.annual} · ${g.ur}`, [S.name_ur, t.ur, totalUr].filter(Boolean).join(' · ')],
  };
}

const PASS_EN = 'Pass = 40%.';
const COMMON_EN = [
  'MCQs: 1 mark for the letter. Two circles or an overwritten answer = 0.',
  '"Attempt any N": tell children to answer exactly N. If more are answered, mark all and keep the best N.',
];
const COMMON_UR = [
  'معروضی: درست حرف پر 1 نمبر۔ دو دائرے یا اوور رائٹنگ = 0۔',
  '«کوئی سے N»: بچوں کو بالکل N سوال حل کرنے کو کہیں۔ زیادہ حل ہوں تو سب جانچ کر بہترین N رکھیں۔',
]; // ur: needs fluent-Urdu review
const STYLE_EN = {
  holistic_bands: 'Mark each answer against its band descriptor; give the band that best fits the whole answer.',
  analytic_points: 'Mark each answer point by point; one mark per valid point, up to the marks shown.',
};
const STYLE_UR = {
  holistic_bands: 'ہر جواب کو اس کے بینڈ کے بیان سے جانچیں؛ پورے جواب پر سب سے موزوں بینڈ دیں۔',
  analytic_points: 'ہر جواب نکتہ بہ نکتہ جانچیں؛ ہر درست نکتے پر ایک نمبر، دکھائے گئے نمبروں تک۔',
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

module.exports = { EXAM_KINDS, SESSION, NAME, FILES, WAIT, examName, header, examHeader, legendFor };

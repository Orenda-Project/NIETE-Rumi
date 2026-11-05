'use strict';
/**
 * D15 readability (contract 8 part 2 section 4; rubric D15 / A2d). Report-only: every issue is soft, the
 * member never produces a shortfall, `ok` is always true. It fills `readability` (record.readability).
 *   English: Flesch-Kincaid grade per section (board) / per type (free) over stems, options, instructions
 *            (syllables by vowel-group count); notes FK_HIGH (> grade - 2), SENTENCE_LONG, STEM_LONG (MCQ).
 *   Urdu:    average sentence length per section; note SENTENCE_LONG. Sentences split on ۔ ؟ ! .
 * Every threshold is a proposal (rubric_g6_12.md:101-107); R5's first calibration run sets them.
 * RULINGS: an option counts as one sentence in FK but not in the average sentence length. The Urdu
 * out-of-book vocabulary rate is listed in `skipped` (design_pending: no NBF word list exists). Pure.
 */
const { leaves } = require('./_walk-local');
const { stripLabel, wordCount, str, issue } = require('./_text-norm');

const ID = 'D15';
const LIMITS = {
  fkSlack: 2, // proposal: section FK above grade - 2
  sentence: { '6_8': 14, '9_10': 17, '11_12': 20 }, // proposal: average sentence words, English
  stem: { '6_8': 25, '9_10': 35, '11_12': 45 }, // proposal: MCQ stem words, English
  urSentence: { '6_8': 14, '9_10': 18, '11_12': 22 }, // proposal: average sentence words, Urdu
};

const sentences = (text) => str(text).split(/[.?!؟۔]+/).filter((s) => wordCount(s) > 0);
const syllables = (w) => Math.max(1, (w.toLowerCase().match(/[aeiouy]+/g) || []).length);
const bandOf = (sc) => {
  if (sc.band && LIMITS.sentence[sc.band]) return sc.band;
  const g = Number(sc.grade);
  if (!g) return null;
  return g <= 8 ? '6_8' : g <= 10 ? '9_10' : '11_12';
};

function sectionStats(group) {
  const prose = []; // stems + instructions, sentence units
  const units = []; // prose + each option
  group.forEach((n) => {
    [n.item.main_question, n.item.question].forEach((t) => prose.push(...sentences(t)));
    (Array.isArray(n.item.options) ? n.item.options : []).forEach((o) => { const b = stripLabel(str(o)); if (wordCount(b)) units.push(b); });
  });
  const all = [...prose, ...units];
  const words = all.reduce((s, u) => s + wordCount(u), 0);
  const proseWords = prose.reduce((s, u) => s + wordCount(u), 0);
  const syl = all.reduce((s, u) => s + str(u).split(/\s+/).filter(Boolean).reduce((a, w) => a + syllables(w), 0), 0);
  const fk = all.length && words ? 0.39 * (words / all.length) + 11.8 * (syl / words) - 15.59 : undefined;
  return { avg: prose.length ? proseWords / prose.length : 0, fk };
}

function run(examJson, ctx = {}) {
  const sc = (ctx && ctx.subjectConfig) || {};
  const groups = new Map();
  leaves(examJson).forEach((n) => {
    const key = n.sectionId || `type:${n.item.type}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(n);
  });
  const issues = [];
  const skipped = [];
  const sections = {};
  const band = bandOf(sc);
  const en = sc.medium === 'en';
  const ur = sc.medium === 'ur';
  if (!en && !ur) skipped.push({ id: 'D15:medium', why: 'subjectConfig.medium is not en|ur: stats only, no notes' });
  else if (!band) skipped.push({ id: 'D15:band', why: 'no band or grade: stats only, no notes' });
  if (ur) skipped.push({ id: 'D15:urdu-vocab', why: 'design_pending: needs the grade NBF book word list and the SLO term list; no file exists' });
  const judge = (en || ur) && band;
  groups.forEach((group, key) => {
    const st = sectionStats(group);
    sections[key] = { avg_sentence: Math.round(st.avg * 100) / 100 };
    if (st.fk !== undefined && en) sections[key].fk = Math.round(st.fk * 100) / 100;
    if (!judge) return;
    const ref = `section:${key}`;
    const limit = en ? LIMITS.sentence[band] : LIMITS.urSentence[band];
    if (st.avg > limit) issues.push(issue(ID, 'SENTENCE_LONG', ref, `average sentence ${sections[key].avg_sentence} words, proposal limit ${limit}`, false));
    if (en && st.fk !== undefined && Number(sc.grade) && st.fk > Number(sc.grade) - LIMITS.fkSlack) issues.push(issue(ID, 'FK_HIGH', ref, `Flesch-Kincaid ${sections[key].fk}, above grade ${sc.grade} - ${LIMITS.fkSlack}`, false));
    if (en) group.forEach((n) => { if (Array.isArray(n.item.options) && wordCount(n.item.question) > LIMITS.stem[band]) issues.push(issue(ID, 'STEM_LONG', n.ref, `MCQ stem ${wordCount(n.item.question)} words, proposal limit ${LIMITS.stem[band]}`, false)); });
  });
  return { ok: true, issues, skipped, readability: { sections } };
}

module.exports = { id: ID, name: 'readability', hard: false, modes: ['free', 'board'], LIMITS, run };

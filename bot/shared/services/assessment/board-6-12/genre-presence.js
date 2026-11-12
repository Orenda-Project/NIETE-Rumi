'use strict';
/**
 * bd-qyi45h.1: the G11/G12 Urdu board papers (FBISE HSSC-I/II) carry fixed poem (نظم) and ghazal (غزل) slots. When
 * the chosen pages hold no poem or no ghazal the model has nothing to quote and the paper failed PATTERN_SHORT_SLOT.
 * `forContent` leaves those slots out of the variant the writer uses; the printed totals (section lines, the exam
 * header) are recomputed so the paper adds up to what it prints. Other subjects, other slots, and Urdu pages that do
 * carry the genre get the very same variant back. Pure: no I/O, the pattern objects are never changed.
 *
 * The book text carries no genre field, so presence is read from markers the G11/G12 Urdu books print. Checked on
 * the cleaned corpus (pages.jsonl): every ghazal and nazm chapter hits, no prose page does. Bare نظم / غزل / حمد /
 * نعت / مطلع are NOT used: they appear in prose SLO boilerplate ("نظم و نثر", "نظم/غزل کے اشعار"). When unsure the
 * genre counts as present, which keeps today's paper. Empty content counts as both present, and so does a choice of
 * fewer than MIN_PAGES distinct book pages: 1-2 pages from inside a poem/ghazal chapter often carry no marker (corpus:
 * G12 ghazal single pages miss 14/28), while every 3+ page window was read right.
 */
const { resolveUx } = require('../../../config/ux-strings');

const MIN_PAGES = 3;
const GHAZAL = [
  /اس\s+غزل/, /(?<!\S)کی\s+غزل/, /^#\s*غزل/m, /غزل\s+(?:کے|کا)\s+مطلع/, /\(\s*(?:مقطع|مطلع)\s*\)/, /درج\s+ذیل\s+غزل/,
  /کوئی\s+(?:اور\s+|سی\s+)?غزل/, /(?<!\/\s*)غزل\s+کے\s+(?:درج\s+ذیل\s+|ان\s+)?اشعار/, /غزل\s+کی\s+شاعری/, /حصہ\s+غزل/, /غزل\s*[۰-۹0-9]/,
];
const NAZM = [
  /(?:اس|کی)\s+نظم(?!\s*(?:و|یا)\s)/, /^#\s*(?:نظم|حمد|نعت)/m, /\(\s*نظم\s*\)/, /نظم\s*پار/,
  /نظم\s*['"«“‘]|['"»”’]\s*نظم/,
];
const VERSES = /اشعار/; // a nazm page that names no genre (G11 Rahman Baba) still asks about its verses

const any = (list, text) => list.some((re) => re.test(text));

/** Which genres the chosen pages carry: {poem, ghazal}. */
function presence(content) {
  const text = String(content || '');
  const pages = new Set([...text.matchAll(/=== Page (\S+) ===/g)].map((m) => m[1])).size;
  if (pages < MIN_PAGES) return { poem: true, ghazal: true };
  const ghazal = any(GHAZAL, text);
  return { poem: any(NAZM, text) || (!ghazal && VERSES.test(text)), ghazal };
}

/** 'poem' | 'ghazal' | null for a board slot. */
function genreOf(slot) {
  if (slot.type === 'explanation_poem') return 'poem';
  if (slot.type === 'explanation_ghazal') return 'ghazal';
  if (slot.type === 'comprehension') return (/\bpoem\b/i.exec(slot.slot) || /\bghazal\b/i.exec(slot.slot) || [null])[0];
  return null;
}

const totalLine = (t) => ({ en: `Total Marks: {t:${t}}`, ur: `کل نمبر: {t:${t}}` });

function retotal(header, from, to) {
  if (!header) return header;
  const a = totalLine(from);
  const b = totalLine(to);
  const swap = (lines) => (Array.isArray(lines) ? lines.map((l) => String(l).split(a.en).join(b.en).split(a.ur).join(b.ur)) : lines);
  return { ...header, lines_en: swap(header.lines_en), lines_ur: swap(header.lines_ur) };
}

/**
 * The kept slots with their printed numbers run on: a dropped whole question (Q5) moves every later one up (Q6 -> Q5),
 * a dropped part (Q2c) moves the later parts of that question up (Q2d -> Q2c). Only label_en / label_ur change: the
 * slot id (`slot`), which replies, checks and the scheme key on, stays the pattern's. Untouched slots are the same
 * objects. Labels that are neither `Q<n>` nor `Q<n><letter>...` are left as they are.
 */
function renumber(sections, drop) {
  let shift = 0;
  const gone = {};
  return sections.map((sec) => {
    const slots = sec.slots.flatMap((s) => {
      const whole = /^Q(\d+)$/.exec(s.label_en);
      const part = /^Q(\d+)([a-z])(.*)$/.exec(s.label_en);
      if (drop(s)) {
        if (whole) shift += 1;
        else if (part) gone[part[1]] = (gone[part[1]] || 0) + 1;
        return [];
      }
      let label = s.label_en;
      if (whole) label = `Q${+whole[1] - shift}`;
      else if (part) label = `Q${+part[1] - shift}${String.fromCharCode(part[2].charCodeAt(0) - (gone[part[1]] || 0))}${part[3]}`;
      if (label === s.label_en) return [s];
      const label_ur = s.label_ur === s.label_en ? label : String(s.label_ur).replace(/\d+/, /\d+/.exec(label)[0]);
      return [{ ...s, label_en: label, label_ur }];
    });
    return slots.length === sec.slots.length && slots.every((x, i) => x === sec.slots[i]) ? sec : { ...sec, slots };
  });
}

const NOTE_KEYS = { poem: 'assessmentNoPoemNote', ghazal: 'assessmentNoGhazalNote' };

/** The board legend (printed on the teacher's marking scheme) plus one line per left-out genre, poem first. */
function withNotes(legend, has) {
  const L = legend || {};
  const keys = ['poem', 'ghazal'].filter((g) => !has[g]).map((g) => NOTE_KEYS[g]);
  const lines = (lang) => [...(L[`lines_${lang}`] || []), ...keys.map((k) => resolveUx(k, { language: lang }))];
  return { ...L, lines_en: lines('en'), lines_ur: lines('ur') };
}

/**
 * The variant with the absent genres' slots left out (Urdu only), the rest renumbered and a note on the legend; the
 * same object when nothing goes.
 */
function forContent(V, subject, content) {
  if (!V || subject !== 'urdu') return V;
  const has = presence(content);
  const drop = (s) => { const g = genreOf(s); return g != null && !has[g]; };
  if (!V.sections.some((sec) => sec.slots.some(drop))) return V;
  const sections = renumber(V.sections, drop).map((sec, i) => {
    if (sec.slots.length === V.sections[i].slots.length) return sec;
    const m4 = sec.slots.reduce((n, s) => n + s.total_x4, 0);
    const t = totalLine(m4 / 4);
    return { ...sec, marks: m4 / 4, marks_x4: m4, marks_en: t.en, marks_ur: t.ur };
  }).filter((sec) => sec.slots.length > 0);
  const all = sections.flatMap((s) => s.slots);
  const total4 = sections.reduce((n, s) => n + s.marks_x4, 0);
  const tm4 = all.filter((s) => s.teacher_marked).reduce((n, s) => n + s.total_x4, 0);
  const mcq4 = all.filter((s) => s.type === 'mcq').reduce((n, s) => n + s.total_x4, 0);
  return {
    ...V, sections, total_marks: total4 / 4, generated_marks: (total4 - tm4) / 4, teacher_marked_marks: tm4 / 4,
    mcq_share_x100: Math.round((10000 * mcq4) / total4), exam_header: retotal(V.exam_header, V.total_marks, total4 / 4),
    legend: withNotes(V.legend, has),
  };
}

module.exports = { presence, genreOf, forContent };

'use strict';
/**
 * bd-snkn32.58.1 (queue #155 A) — grades 1–5 learning goals, SKILL-sized and grouped by skill (Amena 19 Nov: "learning
 * goals could be 2 digit with 1 digit addition or multiplication, reading poems or grammatical concepts").
 *
 * The matrix (assessment_topics) is one row per chapter-sized topic, each carrying several official SLOs. A goal here is
 * one SLO: deduped by code, then by text; matrix working notes ("[DERIVED …]") are page notes, not skills, and are
 * hidden. The code's strand (M-03-MU-04 → MU) names the group; the labels live in the portal (goalCopy, en + ur), so
 * this module hands back keys only. Each goal is written over the day of the FIRST topic (book order) that carries it.
 *
 * Pure: no I/O. Rows come out in lp612-own-goal's row shape (one slo_description each) plus `slo_code` and `group`.
 */
const { dayFor } = require('./lp-k5-own-goal');

/** Strand → group, per matrix subject. Our grouping, not official wording. */
const GROUPS = {
  maths: {
    NS: 'numbers', PV: 'numbers', FM: 'numbers',
    AD: 'add_sub', AS: 'add_sub', SU: 'add_sub',
    MU: 'mul_div', DV: 'mul_div', DI: 'mul_div', MD: 'mul_div', UM: 'mul_div',
    FR: 'fractions', DE: 'fractions', DP: 'fractions', PC: 'fractions',
    ME: 'measure', LE: 'measure', MA: 'measure', CA: 'measure', CT: 'measure', TE: 'measure', AP: 'measure',
    TI: 'time_money', TM: 'time_money', MN: 'time_money', MO: 'time_money',
    GE: 'shapes', DA: 'data', DH: 'data', PA: 'patterns', WP: 'word_problems',
  },
  english: {
    RD: 'reading', TX: 'reading', PH: 'phonics', PA: 'phonics', VO: 'words',
    GR: 'grammar', LG: 'grammar', VG: 'grammar', OC: 'speaking', LS: 'speaking', LC: 'speaking', EM: 'speaking', WR: 'writing',
  },
  urdu: { RD: 'reading', CO: 'comprehension', PH: 'phonics', VO: 'words', GR: 'grammar', OC: 'speaking', WR: 'writing' },
  science: { LS: 'living', PS: 'matter', ES: 'earth', SI: 'tools', TE: 'tools' },
};

function strandOf(code) {
  const m = /^[A-Z]+-\d+-([A-Z]+)-/.exec(String(code || ''));
  return m ? m[1] : null;
}

function groupOf(subject, code) {
  const table = GROUPS[subject];
  const strand = strandOf(code);
  return (table && strand && table[strand]) || 'other';
}

const DERIVED = /\[\s*DERIVED/i;

/** An outcome as she reads it: no bracketed working note, no "I can" lead-in, first letter up. */
function tidy(text) {
  const t = String(text || '').replace(/\s*\[[^\]]*\]/g, '').replace(/^\s*I can\s+/i, '').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

const nums = (a) => (Array.isArray(a) ? a.map(Number).filter(Number.isFinite) : []);
const firstDay = (t) => Math.min(...nums(t.days), Infinity);

/** The matrix rows as skill-sized goal rows, in book order; [] without a book or topics. */
function skillRows(topics, book, subject) {
  if (!Array.isArray(topics) || !book || !Array.isArray(book.chapters)) return [];
  const all = book.chapters.flatMap((c) => c.lessons || []);
  const ordered = [...topics].sort((a, b) => (Number(a.chapter_number) - Number(b.chapter_number))
    || (firstDay(a) - firstDay(b)) || ((Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)));
  const codes = new Set();
  const texts = new Set();
  const out = [];
  for (const t of ordered) {
    const descs = Array.isArray(t.slo_descriptions) ? t.slo_descriptions : [];
    const cs = Array.isArray(t.slo_codes) ? t.slo_codes : [];
    const paired = cs.length === descs.length; // codes and texts that do not line up: texts only
    let day;
    descs.forEach((raw, i) => {
      if (DERIVED.test(String(raw || ''))) return;
      const text = tidy(raw);
      const code = paired ? cs[i] || null : null;
      if (!text || texts.has(text.toLowerCase()) || (code && codes.has(code))) return;
      if (day === undefined) day = dayFor(t, book);
      if (!day) return;
      if (code) codes.add(code);
      texts.add(text.toLowerCase());
      out.push({
        segment_id: day.lesson_id,
        chapter_number: Number(t.chapter_number),
        chapter_title: t.chapter_title || (book.chapters.find((c) => Number(c.number) === Number(t.chapter_number)) || {}).title || null,
        order_index: all.indexOf(day) * 1000 + out.length,
        menu_title: t.name || null,
        subtopic_title: t.name || null,
        slo_descriptions: [text],
        slo_code: code,
        group: groupOf(subject, code),
      });
    });
  }
  return out;
}

module.exports = { GROUPS, strandOf, groupOf, tidy, skillRows };

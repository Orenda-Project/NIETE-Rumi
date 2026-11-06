'use strict';
/**
 * bd-5jmnfj.38.31 — the checks a G6-12 free paper is held to, measured the way the review panel of
 * 2026-11-06 measures them. Pure: reads the paper, never changes it, no I/O.
 *
 *   marking-points   A7c  a constructed item has no marking points, or they do not sum to its marks
 *   scheme           A7c  a written item lacks its 2-3 level band, accept line or do-not-accept line
 *   long-stem        A2d  an MCQ stem over the band's word limit
 *   long-sentence    A2d  an item (an MCQ too) whose longest sentence is over the band's word limit
 *   longest-key      A7a  the key is clearly the longest option
 *   absolute-option  A7a  always / never / only / all or none of the above in an option
 *   cross-leak       A5b  one item gives away another's answer, or a key term of it, in its stem or its
 *                        word/option lists (`avoid` lists the other)
 *   lesson-subject        no item names the lesson (n is 0: it is about the whole paper)
 *
 * estimateMinutes is the panel's load model (A5g); printedMinutes is the time a paper prints so that
 * load fills at most 85% of it.
 */

const { bandOf, LOAD_SHARE } = require('./free-secondary-rules');
const { keyIndex, textOf, isMcq } = require('./free-secondary-keys');
const { schemeIssue } = require('./free-secondary-scheme');

const ABSOLUTE = /\b(always|never|only)\b|all of the above|none of the above|ہمیشہ|کبھی نہیں|صرف|مندرجہ بالا تمام|ان میں سے کوئی نہیں/i;
const STOP = new Set(['which', 'what', 'when', 'where', 'name', 'does', 'that', 'this', 'from', 'with',
  'their', 'there', 'they', 'into', 'during', 'about', 'write', 'give', 'explain', 'describe', 'state']);
const URDU_SCRIPT = /[؀-ۿ]/;
const READ_WPM = { en: 90, ur: 100 };
const WRITE_WPM = 8;
const REVIEW_MINUTES = 5;
const LEAK_MIN_CHARS = 6;
// An Urdu word is short: a key of this many letters leaks when another stem prints it as a whole word.
const URDU_LEAK_MIN_CHARS = 4;

/** Every item in paper order, numbered from 1. A stimulus group contributes its items. */
function items(examJson) {
  const out = [];
  const visit = (node, type) => {
    if (Array.isArray(node)) { node.forEach((x) => visit(x, type)); return; }
    if (!node || typeof node !== 'object') return;
    if (typeof node.question === 'string' || typeof node.answer === 'string') {
      out.push({ n: out.length + 1, item: node, type, isMcq: isMcq(node) });
      return;
    }
    Object.entries(node).forEach(([k, v]) => visit(v, Array.isArray(v) ? k : type));
  };
  visit(examJson, null);
  return out;
}

function words(text) {
  return String(text || '').split(/\s+/).filter(Boolean);
}

function sentences(text) {
  return String(text || '').split(/[.!?؟۔]+/).map((s) => words(s).length).filter((n) => n > 0);
}

function norm(text) {
  return String(text || '').toLowerCase().replace(/[.۔،,!?؟"'“”()]/g, ' ').replace(/\s+/g, ' ').trim();
}

function contentWords(text) {
  return new Set(norm(text).split(' ').filter((w) => w.length >= 4 && !STOP.has(w)));
}

/** The text a student would write or pick as the answer: the key option for an MCQ. */
function answerText(e) {
  if (e.isMcq) {
    const i = keyIndex(e.item);
    return i >= 0 ? textOf(e.item.options[i]) : '';
  }
  return String(e.item.answer || '');
}

function markingIssue(e) {
  const marks = Number(e.item.marks) || 0;
  if (e.isMcq || marks < 2) return null;
  const pts = e.item.marking_points;
  const sum = Array.isArray(pts) ? pts.reduce((s, p) => s + (Number(p && p.marks) || 0), 0) : 0;
  if (!Array.isArray(pts) || !pts.length) return 'has a model answer but no marking points';
  if (sum !== marks) return `marking points add up to ${sum}, not the item's ${marks} marks`;
  return null;
}

function lengthIssue(e, band) {
  if (e.isMcq) {
    const n = words(e.item.question).length;
    if (n > band.mcqStem) return ['long-stem', `the stem is ${n} words; keep it to ${band.mcqStem} words or fewer`];
  }
  const top = Math.max(0, ...sentences(e.item.question));
  if (top <= band.sentence) return null;
  return ['long-sentence', `its longest sentence is ${top} words; keep every sentence to ${band.sentence} words or fewer`];
}

function optionIssues(e) {
  if (!e.isMcq) return [];
  const out = [];
  const texts = e.item.options.map(textOf);
  const k = keyIndex(e.item);
  if (k >= 0) {
    const longestOther = Math.max(...texts.filter((_, i) => i !== k).map((t) => t.length));
    const key = texts[k].length;
    if (key > longestOther * 1.2 && key - longestOther >= 3) {
      out.push(['longest-key', 'the key is the longest option; make the options the same length']);
    }
  }
  if (texts.some((t) => ABSOLUTE.test(t))) {
    out.push(['absolute-option', 'an option uses always, never, only, or all/none of the above']);
  }
  return out;
}

/** The words an item is about: its stem and its answer (the key, for an MCQ). */
function sharedIdeas(a, b) {
  const wa = contentWords(`${a.item.question} ${answerText(a)}`);
  let shared = 0;
  contentWords(`${b.item.question} ${answerText(b)}`).forEach((w) => { if (wa.has(w)) shared += 1; });
  return shared;
}

/** The terms of a short answer (an MCQ key, or a written answer of four words or fewer) not already in its stem. */
function keyTerms(e) {
  const ans = answerText(e);
  if (!e.isMcq && words(ans).length > 4) return [];
  const own = contentWords(e.item.question);
  return [...contentWords(ans)].filter((w) => !own.has(w));
}

const hasWord = (text, w) => ` ${text} `.includes(` ${w} `);

const LIST_FIELDS = ['options', 'words', 'column_a', 'column_b'];

/** What an item prints besides its answer: the stem, and for a written item its word or option lists. */
function printed(e) {
  if (e.isMcq) return String(e.item.question || '');
  const lists = LIST_FIELDS.flatMap((f) => (Array.isArray(e.item[f]) ? e.item[f].map(textOf) : []));
  return [e.item.question || '', ...lists].join(' ');
}

/**
 * A one-word key that two or more other stems print (G7 Q1 "Stem") is the chapter's own vocabulary, not
 * a give-away: soft, as the board leak rule treats a short one-token key. Only its stem leaks are waived.
 */
function chapterWord(all, a, ans) {
  if (!a.isMcq || ans.includes(' ')) return false;
  return all.filter((b) => b !== a && hasWord(norm(printed(b)), ans)).length >= 2;
}

/**
 * Items that give another item's answer away, keyed by the item to rewrite: the later of the two when
 * a stem prints an answer (whole, or a key term on the same idea), the MCQ when its key is a written
 * item's expected answer. Each carries the items it must not overlap (`avoid`).
 */
function leaks(all) {
  const out = new Map();
  const add = (n, other, text) => {
    const cur = out.get(n) || { text, avoid: new Set() };
    cur.avoid.add(other);
    out.set(n, cur);
  };
  all.forEach((a) => {
    const raw = answerText(a);
    const ans = norm(raw);
    if (ans.length < 4) return;
    const vocab = chapterWord(all, a, ans);
    const terms = vocab ? [] : keyTerms(a);
    all.forEach((b) => {
      if (a === b) return;
      if (a.isMcq && !b.isMcq) {
        const given = norm(b.item.answer);
        if ((given.includes(ans) || terms.some((t) => hasWord(given, t))) && sharedIdeas(a, b) >= 2) {
          add(a.n, b.n, `its key ("${raw}") gives away the answer to Q${b.n}`);
          return;
        }
      }
      const stem = norm(printed(b));
      const whole = URDU_SCRIPT.test(ans) && ans.length >= URDU_LEAK_MIN_CHARS && hasWord(stem, ans);
      const termInStem = terms.some((t) => hasWord(stem, t)) && sharedIdeas(a, b) >= 2;
      if (!vocab && ((ans.length >= LEAK_MIN_CHARS && stem.includes(ans)) || whole || termInStem)) {
        const later = Math.max(a.n, b.n);
        add(later, Math.min(a.n, b.n), later === b.n
          ? `its stem gives away the answer to Q${a.n} ("${raw}")`
          : `Q${b.n}'s stem already gives away this answer ("${raw}")`);
      }
    });
  });
  return out;
}

/** True when some item's stem names the lesson: any word of four letters or more from its title. */
function namesLesson(all, title) {
  const keys = norm(title).split(' ').filter((w) => w.length >= 4);
  if (!keys.length) return true;
  return all.some((e) => { const q = norm(e.item.question); return keys.some((k) => q.includes(k)); });
}

/** Every rule a paper breaks, as {n, check, text}, in question order; a whole-paper problem last, as n 0. */
function paperIssues(examJson, { grade, lessonTitle } = {}) {
  const band = bandOf(grade);
  const all = items(examJson);
  const leaked = leaks(all);
  const out = [];
  all.forEach((e) => {
    const add = (check, text) => out.push({ n: e.n, check, text });
    const mark = markingIssue(e);
    if (mark) add('marking-points', mark);
    const scheme = schemeIssue(e);
    if (scheme) add('scheme', scheme);
    const len = lengthIssue(e, band);
    if (len) add(...len);
    optionIssues(e).forEach((o) => add(...o));
    if (leaked.has(e.n)) {
      const { text, avoid } = leaked.get(e.n);
      out.push({ n: e.n, check: 'cross-leak', text, avoid: [...avoid].sort((x, y) => x - y) });
    }
  });
  if (lessonTitle && !namesLesson(all, lessonTitle)) {
    out.push({ n: 0, check: 'lesson-subject', text: `no item asks about the lesson itself ("${lessonTitle}") by name; add two that do` });
  }
  return out;
}

function readMinutes(text) {
  const wpm = URDU_SCRIPT.test(text) ? READ_WPM.ur : READ_WPM.en;
  return words(text).length / wpm;
}

/** Minutes a Grade 6-8 student needs: reading, writing at 8 wpm, the panel's floors, and review. */
function estimateMinutes(examJson) {
  return items(examJson).reduce((sum, e) => {
    const q = e.item;
    if (e.isMcq) return sum + Math.max(1, readMinutes(`${q.question} ${q.options.join(' ')}`));
    const floor = (Number(q.marks) || 0) >= 6 ? 10 : 2;
    const work = readMinutes(q.question) + words(q.answer).length / WRITE_WPM;
    return sum + Math.max(floor, work);
  }, REVIEW_MINUTES);
}

/** The time to print: the load fills at most LOAD_SHARE of it, rounded up to 5 minutes. */
function printedMinutes(loadMinutes) {
  return Math.ceil(loadMinutes / LOAD_SHARE / 5) * 5;
}

module.exports = { items, answerText, paperIssues, estimateMinutes, printedMinutes };

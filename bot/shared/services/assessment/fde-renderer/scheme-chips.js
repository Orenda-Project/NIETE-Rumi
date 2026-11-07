'use strict';
// Part of assessment-paper-fde.renderer.js (see its header); split for the 300-line limit, bd-5jmnfj.37.
const Cover = require('../fde-scheme-cover');
const MidMatch = require('../fde-mid-match');
const Patterns = require('../patterns');
const PickKey = require('../fde-pick-key');
const { acceptText } = require('../fde-accept-line');
const { adjustCriteria, keyStemHidden } = require('../fde-g5-criteria'); // bd-5jmnfj.4.58.4
const { letterOrder } = require('../fde-order-block');
const { matchOrder, bankOrder, matchTable, matchAnswer, matchStem, MATCH_CSS } = require('../fde-match-block');
const { prepLines } = require('../fde-oral-prep');
const { urduNote } = require('../fde-urdu-notes');
const { URDU_LETTERS, bareOption, itemNumber } = require('./counts-options');
const { esc, fmt, textOf } = require('./fonts-digits');
const { BOOK_SOURCE, fill, pictured, shortLabel } = require('./render-paper');

function beforeExamBox(L, live, ctx, examJson) {
  const lang = ctx.medium;
  const B = L.before_exam;
  const lines = [...B[`lines_${lang}`]];
  const pages = L.pages && Number.isInteger(L.pages.paper) ? L.pages.paper : null;
  if (pages === null) {
    lines[0] = lines[0].replace(lang === 'ur' ? ' ({n} صفحات)' : ' ({n} pages)', '');
    lines[1] = lang === 'ur' ? lines[1].replace('تمام {n} صفحات', 'تمام صفحات') : lines[1].replace('all {n} pages', 'every page');
  }
  // The box names the paper, never a file (bd-5jmnfj.4.50.5).
  lines[0] = fill(lines[0], { file: Cover.PAPER_NAME[lang], n: pages });
  lines[1] = fill(lines[1], { n: pages });
  // You add.
  const frameSupply = (L.supplies || []).find((s) => s.kind !== 'naat' && !pictured(live, s));
  if (frameSupply) {
    const slot = L.sections.flatMap((s) => s.slots).find((s) => s.slot === frameSupply.slot);
    const p = L.frame_pages && L.frame_pages[frameSupply.slot];
    const source = !frameSupply.book_page && BOOK_SOURCE[frameSupply.kind];
    const duty = source ? source[lang] : slot.frame[`duty_${lang}`];
    let line = fill(lines[2], { duty, p: p || B[`unknown_pages_${lang}`], b: frameSupply.book_page });
    if (!frameSupply.book_page) line = line.replace(lang === 'ur' ? / \(کتاب ص \{b\}\)/ : / \(book p\. \{b\}\)/, '');
    // An unknown page sends the teacher to the paper; Urdu then names the paper once.
    if (!p) line = line.replace(lang === 'ur' ? 'سوالیہ پرچہ صفحہ ' : 'page ', '');
    lines[2] = line;
  } else {
    lines[2] = null; // Nothing to add: no line (bd-5jmnfj.4.50.5).
  }
  // The teacher adds the picture BEFORE photocopying, so that step comes first (v24 review).
  if (lines[2] !== null) [lines[1], lines[2]] = [lines[2], lines[1]];
  // Tell the class: the parts by the names the paper prints.
  const onPaper = L.sections.filter((s) => s.answer_on === 'question_paper');
  const onSheet = L.sections.filter((s) => s.answer_on !== 'question_paper');
  const where = [
    onPaper.length ? fill(B[`on_paper_${lang}`], { sections: Cover.joinParts(onPaper, lang) }) : null,
    onSheet.length ? fill(B[`on_sheet_${lang}`], { sections: Cover.joinParts(onSheet, lang) }) : null,
  ].filter(Boolean).join(lang === 'ur' ? '؛ ' : '; ');
  // Every choice the paper offers, in paper order: between items (attempt < generate),
  // inside one item (seven words, any five), or between two alternatives (Urdu Q6).
  const attempts = L.sections.flatMap((s) => s.slots).map((slot) => {
    const label = lang === 'ur' ? slot.label_ur : shortLabel(slot.label_en);
    if (slot.alternatives && slot.alternatives.some((a) => a.kind === 'fixed')) return fill(B[`either_${lang}`], { label });
    if (slot.attempt < slot.generate) {
      const n = live.get(slot.slot).length;
      // A group cut to its attempt count (or emptied) offers no choice: nothing to tell.
      return n > slot.attempt ? fill(B[`attempt_${lang}`], { label, n: slot.attempt, g: n }) : null;
    }
    if (slot.in_item_choice) return fill(B[`attempt_${lang}`], { label, n: slot.in_item_choice.n, g: slot.in_item_choice.g });
    return null;
  }).filter(Boolean);
  if (!attempts.length) lines[3] = lines[3].replace(lang === 'ur' ? '؛ {attempts}' : '; {attempts}', '');
  lines[3] = fill(lines[3], { sections: where, attempts: attempts.join(lang === 'ur' ? '؛ ' : '; ') });
  lines[4] = fill(lines[4], { t: L[`total_time_${lang}`] || (lang === 'ur' ? '3 گھنٹے' : '3 hrs') });
  lines.push(...prepLines(L.oral, lang)); // a child-made project the teacher has the class prepare (bd-5jmnfj.4.58.4)
  return `<div class="box before"><div class="bt">${textOf(B[`title_${lang}`], ctx)}</div><ol>${lines.filter((l) => l !== null).map((l) => `<li>${textOf(l, ctx)}</li>`).join('')}</ol></div>`;
}

/*
 * The subject's legend. A paper laid out before legends were per subject
 * carries the shared one (no `subject`): it takes its subject's from the pattern.
 */
function legendOf(L) {
  const G = L.legend || {};
  if (G.subject) return G;
  const S = Patterns.subjectOf(L.preset_id || 'fde_g5_2027', L.subject);
  return (S && S.legend) || G;
}

const CHIP_ORDER = ['M', 'A', 'U', 'K', 'L'];

// `kinds`: the chip letters the scheme prints (a Set). Outside Maths the key lists only those.
function legendBox(L, ctx, kinds) {
  const lang = ctx.medium;
  const G = legendOf(L);
  const lines = G[`lines_${lang}`].map((l, i) => {
    if (lang === 'ur' && i === G.bands_line) {
      return `<li>${textOf(G.bands_lead_ur, ctx)}: <span class="ascii">${esc(l)}</span></li>`;
    }
    if (G.key_from_chips && i === G.key_line) {
      const names = G[`key_names_${lang}`] || {};
      const keyed = CHIP_ORDER.filter((k) => kinds.has(k) && names[k]).map((k) => `${k} = ${names[k]}`);
      if (!keyed.length) return '';
      return `<li>${textOf(lang === 'ur' ? keyed.join('، ') : `${keyed.join(' · ')}.`, ctx)}</li>`;
    }
    if (!L.oral && /oral|زبانی/i.test(l)) return ''; // a frozen legend can still name an oral part the paper lacks
    return `<li>${textOf(l, ctx)}</li>`;
  });
  return `<div class="box legend"><div class="bt">${textOf(G[`title_${lang}`], ctx)}</div><ul>${lines.join('')}</ul></div>`;
}

function suppliesBox(L, ctx, live) {
  const lang = ctx.medium;
  const supplies = (Array.isArray(L.supplies) ? L.supplies : []).filter((s) => !pictured(live, s));
  if (!supplies.length) return '';
  const title = lang === 'ur' ? 'استاد مہیا کریں' : 'Teacher supplies'; // ur: needs fluent-Urdu review
  const lineOf = (s) => {
    const source = !s.book_page && BOOK_SOURCE[s.kind];
    return source ? `${s[`line_${lang}`]} (${source[lang]})` : s[`line_${lang}`];
  };
  return `<div class="box supplies"><div class="bt">${textOf(title, ctx)}</div><ul>${supplies.map((s) => `<li>${textOf(lineOf(s), ctx)}</li>`).join('')}</ul></div>`;
}

/*
 * The letter a key names. A key that IS an option's text («a dog», «A bird»,
 * «بکری») is that option, read first: only then is a leading letter a letter,
 * and only when punctuation or the end follows it, or the rest is that
 * option's own text («b garden»).
 */
function answerLetter(q, slot) {
  const a = String(q.answer ?? '').trim();
  const opts = (q.options || []).map(bareOption);
  const letters = slot.option_labels === 'ur' || slot.option_labels === 'ur_paren' ? URDU_LETTERS : ['a', 'b', 'c', 'd'];
  const byText = a ? opts.findIndex((o) => o && o === a) : -1;
  if (byText >= 0) return letters[byText];
  const at = (i, rest) => i >= 0 && (rest === null || (rest && opts[i] === rest));
  const m = /^\(?([a-dA-D])(?:\)?[.):](?:\s|$)|\)?$|\s+(.+)$)/.exec(a);
  if (m) {
    const i = m[1].toLowerCase().charCodeAt(0) - 97;
    if (at(i, m[2] === undefined ? null : m[2].trim())) return letters[i];
  }
  const u = /^\(?(الف|ب|ج|د)(?:\)?\s*[.):۔]|\)?\s*$|\s+(.+)$)/.exec(a);
  if (u) {
    const i = URDU_LETTERS.indexOf(u[1]);
    if (at(i, u[2] === undefined ? null : u[2].trim())) return u[1];
  }
  const idx = opts.findIndex((o) => o && (o === bareOption(a)));
  return idx >= 0 ? letters[idx] : '—';
}

function mcqStrip(slot, list, ctx) {
  const lang = ctx.medium;
  const live = list.filter((q) => q.removed !== true);
  const sep = lang === 'ur' ? '، ' : ' · ';
  const midKeys = MidMatch.midMatchStripKeys(slot, live, lang); // G3/G4 match: "letter) text" (bd-5jmnfj.33.4)
  const key = (q, i) => (midKeys ? midKeys[i] : slot.shape === 'match' ? matchAnswer(q) : answerLetter(q, slot));
  const cells = live.map((q, i) => `${itemNumber(slot, i, lang).replace(/[)۔.]$/, '')} ${key(q, i)}`);
  const label = lang === 'ur' ? slot.label_ur : shortLabel(slot.label_en);
  // A line may break only between answers, and a separator never starts or ends a line alone.
  const last = cells.length - 1;
  const strip = cells.map((c, i) => `<span class="sc">${textOf(i < last ? `${c}${sep.trimEnd()}` : c, ctx)}</span>`).join(' ');
  return `<div class="strip" data-row="${esc(slot.slot)}"><span class="sl">${textOf(label, ctx)}</span> ${strip}</div>`;
}

function pointsHtml(q, ctx, Criteria, slot, idx, marks = null) {
  const lang = ctx.medium;
  const out = [];
  const s = q.scheme && typeof q.scheme === 'object' ? q.scheme : null;
  if (slot.shape === 'composition' || (slot.shape === 'frame' && slot.frame && slot.frame.kind === 'picture')) {
    const kind = Criteria.kindFor(slot, idx);
    const rows = kind ? adjustCriteria(Criteria.criteriaFor(kind, slot.marks_each, lang), slot) : [];
    rows.forEach((r) => out.push(`<span class="crit"><span class="crit-m">${textOf(fmt(r.marks), ctx)}</span> ${textOf(r.name, ctx)}${r.look_for ? ` — ${textOf(r.look_for, ctx)}` : ''}</span>`));
  }
  if (s && Array.isArray(s.points) && !out.length) {
    s.points.forEach((p, k) => out.push(`<span class="pt"><span class="chip">${esc(`${p.kind || ''}${fmt(Number(p.marks))}`)}</span> ${textOf(lang === 'ur' ? urduNote(p.text, 'point', slot.type, k) : p.text, ctx)}</span>`));
  }
  // No points from the model: the row still says what it is worth (DESIGN §5 rule 3).
  if (!out.length && Number.isFinite(marks) && marks > 0) out.push(`<span class="chip">${textOf(fmt(marks), ctx)}</span>`);
  const accepts = s && Array.isArray(s.accept) ? acceptText(q.answer, s.accept.map((a) => (lang === 'en' ? letterOrder(q, a) : a)), lang) : '';
  if (accepts) out.push(`<span class="acc">${textOf(`${lang === 'ur' ? 'یہ بھی درست:' : 'accept:'} ${accepts}`, ctx)}</span>`); // ur: needs fluent-Urdu review
  if (s && typeof s.common_error === 'string' && s.common_error) out.push(`<span class="err">${textOf(`${lang === 'ur' ? 'عام غلطی:' : 'common error:'} ${lang === 'ur' ? urduNote(s.common_error, 'error', slot.type, 0) : s.common_error}`, ctx)}</span>`); // ur: needs fluent-Urdu review
  return out.join('');
}

// The "checked" badge was an internal state (bd-5jmnfj.4.51.6): a teacher marking the key has no use for it.
function checkedChip() {
  return '';
}

function hasScheme(s) {
  return Boolean(s && typeof s === 'object' && ((Array.isArray(s.points) && s.points.length)
    || (Array.isArray(s.accept) && s.accept.length) || (typeof s.common_error === 'string' && s.common_error)));
}

/**
 * Part k of an answer the model wrote on the parent as «a) … b) … c) …»
 * (or «(a) …»): the text after letter k up to the next letter. null when the
 * answer carries no such letter.
 */
function partOfAnswer(answer, k) {
  const text = String(answer ?? '');
  const re = /(^|[\s;.])\(?([a-cA-C])\)\s*/g;
  const marks = [];
  let m;
  while ((m = re.exec(text))) marks.push({ letter: m[2].toLowerCase(), start: m.index + m[1].length, body: m.index + m[0].length });
  const at = marks.findIndex((x) => x.letter === String.fromCharCode(97 + k));
  if (at < 0) return null;
  const end = at + 1 < marks.length ? marks[at + 1].start : text.length;
  return text.slice(marks[at].body, end).trim() || null;
}

// A question shown beside its answer: whole, or cut at the last word that fits.
function cutAtWord(text, max) {
  const chars = [...String(text || '')];
  if (chars.length <= max) return chars.join('');
  const cut = chars.slice(0, max).join('');
  const at = cut.lastIndexOf(' ');
  return `${(at > max / 2 ? cut.slice(0, at) : cut).replace(/[\s,;:]+$/, '')}…`;
}

function comprehensionRows(slot, q, ctx) {
  const lang = ctx.medium;
  const rows = [];
  const parts = Array.isArray(q.parts) ? q.parts : [];
  for (const spec of slot.parts_spec || []) {
    const part = parts.find((p) => p && p.key === spec.key) || {};
    if (spec.pick) {
      const kinds = Object.keys(spec.pick);
      for (const kind of kinds) {
        const words = (part.pick && part.pick[kind]) || [];
        // Model words + open rule; the common error prints below (bd-5jmnfj.4.58.9.3).
        rows.push(`<tr data-row="${esc(slot.slot)}"><td class="n">${textOf(spec.label, ctx)}</td><td class="ans"><b>${textOf(kind, ctx)}:</b> ${textOf(PickKey.pickKeyText(kind, words, part.scheme, lang), ctx)}</td><td class="pts"><span class="chip">${esc(`K${fmt(spec.marks_each)}`)}</span> ${textOf(lang === 'ur' ? 'ہر درست لفظ' : 'each correct word', ctx)}</td></tr>`); // ur: needs fluent-Urdu review
      }
      const pickErr = PickKey.pickKeyError(part.scheme);
      if (pickErr) rows.push(`<tr data-row="${esc(slot.slot)}"><td class="n"></td><td class="ans"><span class="err">${textOf(`${lang === 'ur' ? 'عام غلطی:' : 'common error:'} ${pickErr}`, ctx)}</span></td><td class="pts"></td></tr>`); // ur: needs fluent-Urdu review
    } else if (spec.key === 'antonyms') {
      // «جلدی: دیر», as the model writes the pair; v22 printed «جلدی ← دیر» (bd-5jmnfj.4.50.1).
      (part.antonyms || []).forEach((pair) => {
        rows.push(`<tr data-row="${esc(slot.slot)}"><td class="n"></td><td class="ans"><b>${textOf(Array.isArray(pair) ? `${pair[0]}: ${pair[1]}` : pair, ctx)}</b></td><td class="pts"><span class="chip">${esc(`A${fmt(spec.marks_each)}`)}</span></td></tr>`);
      });
    } else {
      (part.questions || []).forEach((sub, k) => {
        const n = itemNumber({ numbering: spec.numbering || 'urdu' }, k, lang);
        rows.push(`<tr data-row="${esc(slot.slot)}"><td class="n">${textOf(`${spec.label} ${n}`, ctx)}</td><td class="ans"><b>${textOf(sub && sub.answer, ctx)}</b></td><td class="pts">${pointsHtml(sub || {}, ctx, { kindFor: () => null, criteriaFor: () => [] }, slot, k)}</td></tr>`);
      });
    }
  }
  return rows;
}

module.exports = {
  beforeExamBox, checkedChip, comprehensionRows, cutAtWord, hasScheme, legendBox, mcqStrip, partOfAnswer,
  pointsHtml, suppliesBox,
};

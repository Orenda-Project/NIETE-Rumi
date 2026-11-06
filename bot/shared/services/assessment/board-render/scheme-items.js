'use strict';
/**
 * One section of the marking scheme plus the class record. Per item: key (MCQ) or model answer, the scheme
 * (analytic points or holistic bands), and Bloom's level / official SLO when the item carries a tag. Slot and
 * section totals are printed as data-slot-total / data-section-total so they can be checked against _layout.
 *
 * design_pending: item.scheme = {points:[{text,marks}]} | {bands:[{marks,descriptor}]}; the project slot's
 * rubric is project.criteria_en / criteria_ur (a list of strings); the class record has a blank row per learner.
 */
const { textOf, marksText, fmtMarks, bareOption } = require('./text');
const OT = require('../board-checks/option-text');
const { slotsOf, firstNo } = require('./layout');
const { marksLine, orWord, PART } = require('./items');

const WORDS = {
  en: { section: 'Section', total: 'Total', record: 'Class record', name: 'Name / Roll No', key: 'Key', answer: 'Model answer', bloom: "Bloom's level", slo: 'Official SLO', criteria: 'Criteria', marks: 'Marks' },
  // ur: needs fluent-Urdu review (design_pending)
  ur: { section: 'حصہ', total: 'کل', record: 'کلاس ریکارڈ', name: 'نام / رول نمبر', key: 'درست جواب', answer: 'نمونہ جواب', bloom: 'بلوم کی سطح', slo: 'سرکاری SLO', criteria: 'معیار', marks: 'نمبر' },
};
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

function tagLine(q, ctx) {
  const t = q.tag;
  if (!t || (!t.blooms && !t.official_slo)) return '';
  const w = WORDS[ctx.lang];
  const bits = [t.blooms ? `${w.bloom}: ${t.blooms}` : '', t.official_slo ? `${w.slo}: ${t.official_slo}` : ''].filter(Boolean);
  return `<div class="meta">${textOf(bits.join(' · '), ctx.rtl)}</div>`;
}

// A band's marks: its own `marks` text, else lo-hi from the prompt contract's {hi, lo} (one number when equal).
const bandMarks = (b) => (b.marks != null ? b.marks : b.lo === b.hi || b.lo == null ? `{t:${b.hi}}` : `{t:${b.lo}}–{t:${b.hi}}`);

/** Points then bands: an ERQ under analytic_points carries both (bd-5jmnfj.38.30 r9). */
function schemeTable(scheme, ctx) {
  const rtl = ctx.rtl;
  const s = scheme || {};
  const points = Array.isArray(s.points) ? `<table class="points">${s.points.map((p) => `<tr><td>${textOf(p.text, rtl)}</td><td>${marksText(`{t:${p.marks}}`, rtl)}</td></tr>`).join('')}</table>` : '';
  const bands = Array.isArray(s.bands) ? `<table class="bands">${s.bands.map((b) => `<tr><td>${marksText(bandMarks(b), rtl)}</td><td>${textOf(b.descriptor, rtl)}</td></tr>`).join('')}</table>` : '';
  return points + bands;
}

function itemRow(slot, q, i, ctx) {
  const { rtl, lang } = ctx;
  const w = WORDS[lang];
  let body;
  if (slot.type === 'mcq' || slot.type === 'scenario') {
    // The writer keys an MCQ by its labelled answer ("B) x") and sets no `key`; the letter then comes from that.
    const idx = q.key != null ? LETTERS.indexOf(String(q.key).toUpperCase()) : OT.keyIndex(q);
    const opt = idx >= 0 && q.options ? ` — ${textOf(bareOption(q.options[idx], idx), rtl)}` : '';
    const letter = q.key != null ? q.key : (idx >= 0 ? LETTERS[idx] : '');
    body = `<div class="key">${w.key}: ${textOf(letter, rtl)}${opt}</div>`;
  } else {
    return `<div class="q"><span class="qn">${textOf(`${i + 1}.`, rtl)}</span> ${answerHtml(q, ctx)}</div>`;
  }
  return `<div class="q"><span class="qn">${textOf(`${i + 1}.`, rtl)}</span> ${textOf(q.question, rtl)}${body}${tagLine(q, ctx)}</div>`;
}

/** A constructed item in the scheme: stem, model answer, points/bands, tag; an OR pair's choices and a parts
 * item's (a)/(b) each get their own (the writer's tree, bd-5jmnfj.38.30 round 8). */
function answerHtml(q, ctx) {
  const { rtl, lang } = ctx;
  if (Array.isArray(q.or)) return q.or.map((b) => `<div class="branch">${answerHtml(b, ctx)}</div>`).join(`<div class="or">${orWord(rtl)}</div>`);
  const lead = q.question ? textOf(q.question, rtl) : '';
  if (Array.isArray(q.parts)) {
    return lead + q.parts.map((p, k) => `<div class="sub"><span class="pl">(${PART[k]})</span> ${answerHtml(p, ctx)}</div>`).join('') + tagLine(q, ctx);
  }
  const ans = q.answer ? `<div><b>${WORDS[lang].answer}:</b> ${textOf(q.answer, rtl)}</div>` : '';
  return `${lead}${ans}${schemeTable(q.scheme, ctx)}${tagLine(q, ctx)}`;
}

function slotScheme(slot, by, ctx) {
  const { rtl, lang } = ctx;
  const label = (rtl && slot.label_ur) || slot.label;
  const head = `<div class="slot-head"><span>${textOf(label, rtl)}</span><span class="ml">${marksText(marksLine(slot), rtl)}</span></div>`;
  let body;
  if (slot.teacher_marked) {
    const p = slot.project || {};
    const crit = p[`criteria_${lang}`] || p.criteria_en || [];
    body = `<div>${textOf(p[`instruction_${lang}`] || p.instruction_en || '', rtl)}</div>`
      + (crit.length ? `<div><b>${WORDS[lang].criteria}:</b><ul>${crit.map((c) => `<li>${textOf(c, rtl)}</li>`).join('')}</ul></div>` : '');
  } else {
    body = (by.get(slot.slot) || []).map((q, i) => itemRow(slot, q, firstNo(slot) - 1 + i, ctx)).join('');
  }
  return `<div class="scheme-slot" data-slot-total="${slot.marks}">${head}${body}</div>`;
}

function schemeSection(layout, sec, by, ctx) {
  const w = WORDS[ctx.lang];
  const head = `<div class="sec-head"><span>${w.section} ${textOf(sec.id, ctx.rtl)}</span><span>${w.marks}: ${marksText(`{t:${sec.marks}}`, ctx.rtl)}</span></div>`;
  return `<section class="sec" data-section-total="${sec.marks}">${head}${slotsOf(layout, sec.id).map((s) => slotScheme(s, by, ctx)).join('')}</section>`;
}

function classRecord(layout, ctx, rows = 10) {
  const { rtl, lang } = ctx;
  const w = WORDS[lang];
  const total = layout.sections.reduce((n, s) => n + s.marks, 0);
  const cols = layout.sections.map((s) => `<th>${w.section} ${textOf(s.id, rtl)}<br>${textOf(fmtMarks(s.marks), rtl)}</th>`).join('');
  const blank = `<tr class="rec-row"><td>&nbsp;</td>${layout.sections.map(() => '<td></td>').join('')}<td></td></tr>`;
  return `<section class="record"><h3>${w.record}</h3><table><tr><th>${w.name}</th>${cols}<th>${w.total}<br>${textOf(fmtMarks(total), rtl)}</th></tr>${blank.repeat(rows)}</table></section>`;
}

module.exports = { schemeSection, classRecord, _schemeTable: schemeTable };

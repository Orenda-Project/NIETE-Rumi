'use strict';
/**
 * One section of the marking scheme plus the class record. Per item: key (MCQ) or model answer, the scheme
 * (analytic points or holistic bands), and Bloom's level / official SLO when the item carries a tag. Slot and
 * section totals are printed as data-slot-total / data-section-total so they can be checked against _layout.
 *
 * design_pending: item.scheme = {points:[{text,marks}]} | {bands:[{marks,descriptor}]}; the project slot's
 * rubric is project.criteria_en / criteria_ur (a list of strings); the class record has a blank row per learner.
 */
const { textOf, marksText, fmtMarks } = require('./text');
const { slotsOf } = require('./layout');
const { marksLine } = require('./items');

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

function schemeTable(scheme, ctx) {
  const rtl = ctx.rtl;
  if (scheme && Array.isArray(scheme.bands)) {
    return `<table class="bands">${scheme.bands.map((b) => `<tr><td>${marksText(b.marks, rtl)}</td><td>${textOf(b.descriptor, rtl)}</td></tr>`).join('')}</table>`;
  }
  if (scheme && Array.isArray(scheme.points)) {
    return `<table class="points">${scheme.points.map((p) => `<tr><td>${textOf(p.text, rtl)}</td><td>${marksText(`{t:${p.marks}}`, rtl)}</td></tr>`).join('')}</table>`;
  }
  return '';
}

function itemRow(slot, q, i, ctx) {
  const { rtl, lang } = ctx;
  const w = WORDS[lang];
  let body;
  if (slot.type === 'mcq' || slot.type === 'scenario') {
    const idx = LETTERS.indexOf(String(q.key).toUpperCase());
    const opt = idx >= 0 && q.options ? ` — ${textOf(q.options[idx], rtl)}` : '';
    body = `<div class="key">${w.key}: ${textOf(q.key, rtl)}${opt}</div>`;
  } else {
    body = `${q.answer ? `<div><b>${w.answer}:</b> ${textOf(q.answer, rtl)}</div>` : ''}${schemeTable(q.scheme, ctx)}`;
  }
  return `<div class="q"><span class="qn">${textOf(`${i + 1}.`, rtl)}</span> ${textOf(q.question, rtl)}${body}${tagLine(q, ctx)}</div>`;
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
    body = (by.get(slot.slot) || []).map((q, i) => itemRow(slot, q, i, ctx)).join('');
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

module.exports = { schemeSection, classRecord };

'use strict';
// Part of assessment-paper-fde.renderer.js (see its header); split for the 300-line limit, bd-5jmnfj.37.
const Cover = require('../fde-scheme-cover');
const TeacherSlot = require('../fde-teacher-slot'); // bd-5jmnfj.39.1: Islamiat Q3, written by the teacher
const { adjustCriteria, keyStemHidden } = require('../fde-g5-criteria'); // bd-5jmnfj.4.58.4
const { answeredParts } = require('../fde-sub-answers');
const { letterOrder } = require('../fde-order-block');
const { oralSheet, childCard, ORAL_CSS } = require('../fde-oral-sheet');
const { assertCounts, choiceLine, itemNumber, itemsBySlot, layoutOf, sectionCtx, sectionTotal, slotFlag } = require('./counts-options');
const { esc, faces, fmt, refuseReviewText, substitute, textOf } = require('./fonts-digits');
const { bareSub, withoutOwnLabel } = require('./item-blocks');
const { KEY_ECHO, contextFor, css, fill, shortLabel } = require('./render-paper');
const { beforeExamBox, checkedChip, comprehensionRows, cutAtWord, hasScheme, legendBox, mcqStrip, partOfAnswer, pointsHtml, suppliesBox } = require('./scheme-chips');

function writtenRows(slot, list, ctx, Criteria) {
  const lang = ctx.medium;
  const live = list.filter((q) => q.removed !== true);
  const rows = [];
  live.forEach((q, i) => {
    const n = itemNumber(slot, i, lang) || (lang === 'ur' ? slot.label_ur : shortLabel(slot.label_en));
    if (slot.shape === 'comprehension') {
      rows.push(...comprehensionRows(slot, q, ctx));
      return;
    }
    if (slot.shape === 'situation') {
      const subs = q.questions || [];
      let anyOwn = false;
      subs.forEach((sub, k) => {
        const each = sub && Number(sub.marks) > 0 ? Number(sub.marks) : (slot.item_parts && slot.item_parts.marks_each) || slot.marks_each / (subs.length || 1);
        const own = sub && sub.answer !== undefined && sub.answer !== null && String(sub.answer).trim() !== '' ? sub.answer : partOfAnswer(q.answer, k);
        if (own !== null && own !== undefined && String(own).trim() !== '') anyOwn = true;
        rows.push(`<tr data-row="${esc(slot.slot)}"><td class="n">${textOf(`${n} ${String.fromCharCode(97 + k)})`, ctx)}</td><td class="ans"><b>${textOf(own, ctx)}</b></td><td class="pts">${pointsHtml(sub || {}, ctx, Criteria, slot, i, each)}</td></tr>`);
      });
      // The situation's own scheme (points, accept, common error) once, under its parts;
      // a parent answer no part could take (no a)/b)/c) letters) prints there too.
      const parentAnswer = !anyOwn && q.answer !== undefined && q.answer !== null && String(q.answer).trim() !== ''
        ? `<b>${textOf(q.answer, ctx)}</b>` : '';
      if (hasScheme(q.scheme) || parentAnswer) {
        rows.push(`<tr data-row="${esc(slot.slot)}"><td class="n"></td><td class="ans">${parentAnswer}</td><td class="pts">${pointsHtml(q, ctx, Criteria, slot, i, null)}</td></tr>`);
      }
      return;
    }
    // A passage's answers sit on its parts: a row per part, lettered as the paper letters them (bd-5jmnfj.4.50.2).
    const parts = answeredParts(q);
    if (parts) {
      parts.forEach((sub, k) => {
        const label = `${n} ${itemNumber({ numbering: slot.sub_numbering || 'alpha_paren' }, k, lang)}`;
        const stem = sub && sub.question ? `<div class="q-line">${textOf(cutAtWord(bareSub(sub.question), KEY_ECHO), ctx)}</div>` : '';
        const each = sub && Number(sub.marks) > 0 ? Number(sub.marks) : slot.marks_each / parts.length;
        rows.push(`<tr data-row="${esc(slot.slot)}"><td class="n">${textOf(label, ctx)}</td><td class="ans"><b>${textOf(sub && sub.answer, ctx)}</b>${stem}</td><td class="pts">${pointsHtml(sub || {}, ctx, { kindFor: () => null, criteriaFor: () => [] }, slot, k, each)}</td></tr>`);
      });
      return;
    }
    const answer = q.answer !== undefined && q.answer !== null ? `<b>${textOf(lang === 'en' ? letterOrder(q, q.answer) : q.answer, ctx)}</b>` : '';
    // An English key names a picture the answer is not (bd-5jmnfj.4.48): v21 Q6 keyed "mat" for a bat.
    const pic = lang === 'en' && q.picture && q.picture.name && String(q.picture.name).trim().toLowerCase() !== String(q.answer ?? '').trim().toLowerCase()
      ? `Picture: ${String(q.picture.name).trim()}. ` : '';
    // A picture-only slot prints no stem on the paper, so its key repeats none (v26 G1 Urdu Q10 x5, bd-5jmnfj.4.58.2).
    const qText = slotFlag(slot, 'picture_only') || keyStemHidden(slot) ? '' : cutAtWord(withoutOwnLabel(q.question || '', slot), KEY_ECHO);
    // The question is often just the picture's name: say it once (bd-5jmnfj.4.51.2).
    const sameAsPic = pic && qText.trim().toLowerCase() === String(q.picture.name).trim().toLowerCase();
    const stemHtml = textOf(sameAsPic ? pic.replace(/\.\s*$/, '') : pic + qText, ctx).replace(/☐/g, '<span class="sq"></span>');
    const stem = (q.question && !keyStemHidden(slot)) || pic ? `<div class="q-line">${stemHtml}</div>` : '';
    rows.push(`<tr data-row="${esc(slot.slot)}"><td class="n">${textOf(n, ctx)}</td><td class="ans">${answer}${checkedChip(q, ctx)}${stem}</td><td class="pts">${pointsHtml(q, ctx, Criteria, slot, list.indexOf(q), Number(q.marks) || slot.marks_each)}</td></tr>`);
  });
  if (slot.alternatives) {
    const fixed = slot.alternatives.find((a) => a.kind === 'fixed');
    if (fixed) {
      const split = (fixed.split || []).join('، ');
      const text = lang === 'ur'
        ? `نعت (سبق ${fixed.book_lesson}، ص ${fixed.book_page}): استاد کتاب سے جانچیں — تقسیم ${split}` // needs fluent-Urdu review
        : `Naat (lesson ${fixed.book_lesson}, p. ${fixed.book_page}): mark from the textbook — split ${(fixed.split || []).join(', ')}`;
      rows.unshift(`<tr data-row="${esc(slot.slot)}-fixed"><td class="n">${textOf(lang === 'ur' ? '(الف)' : '(a)', ctx)}</td><td class="ans" colspan="2">${textOf(text, ctx)}</td></tr>`);
    }
  }
  // The slot's own head first, so a marker can tell which question a row answers.
  if (rows.length) {
    const label = lang === 'ur' ? slot.label_ur : shortLabel(slot.label_en);
    const ins = choiceLine(slot, live.length, lang, live).instruction;
    rows.unshift(`<tr class="slot-row" data-slot-head="${esc(slot.slot)}"><td colspan="3"><b>${textOf(label, ctx)}</b>${ins ? ` ${textOf(ins, ctx)}` : ''}</td></tr>`);
  }
  return rows;
}

function notesBlock(L, all, ctx) {
  const lang = ctx.medium;
  const notes = Array.isArray(L.notes) ? L.notes : [];
  const lines = [];
  for (const note of notes) {
    const slot = L.sections.flatMap((s) => s.slots).find((s) => s.slot === note.slot);
    if (!slot) continue;
    const list = all.get(slot.slot) || [];
    const q = Number.isInteger(note.index) ? list[note.index] : null;
    if (q && q.removed === true) continue;
    const pos = q ? list.filter((x) => x.removed !== true).indexOf(q) : -1;
    const label = lang === 'ur' ? slot.label_ur : shortLabel(slot.label_en);
    const num = pos >= 0 ? itemNumber(slot, pos, lang).replace(/[)۔.]$/, '') : '';
    const n = num ? `${label} (${num})` : label;
    const template = lang === 'ur' ? L.header.note_replaced_ur : L.header.note_replaced_en;
    lines.push(`<li>${textOf(fill(template, { n, value: note.model }), ctx)}</li>`);
  }
  if (!lines.length) return '';
  return `<div class="notes"><div class="bt"><b>${textOf(L.header[`notes_title_${lang}`], ctx)}</b></div><ul>${lines.join('')}</ul></div>`;
}

// 40 rows do not fit one A4 page at a writable height with a header, so the
// record is two tables of 20 side by side: one page, rows 9 mm.
function recordPage(L, live, ctx) {
  const lang = ctx.medium;
  const H = L.header;
  const cols = [...H[`record_cols_${lang}`]];
  // Each part as the paper names it, then the oral part, so the total is the paper's whole (bd-5jmnfj.4.50.5).
  const marks = Cover.recordColumns(L, lang, (sec) => sectionTotal(sec, live));
  const secCols = marks.map((c) => `${c.head} /${fmt(c.marks)}`);
  const total = marks.reduce((s, c) => s + c.marks, 0);
  const head = [...cols, ...secCols, `${H[`record_total_${lang}`]} /${fmt(total)}`, H[`record_grade_${lang}`]];
  const table = (from) => {
    const rows = Array.from({ length: 20 }, (_, i) => `<tr class="rec-row"><td>${textOf(String(from + i), ctx)}</td><td class="name"></td>${secCols.map(() => '<td></td>').join('')}<td></td><td></td></tr>`).join('');
    return `<table class="rec"><tr>${head.map((h) => `<th>${textOf(h, ctx)}</th>`).join('')}</tr>${rows}</table>`;
  };
  return `<section class="record" style="break-before:page"><div class="s-head">${textOf(H[`record_title_${lang}`], ctx)}</div><div class="rec-pair">${table(1)}${table(21)}</div></section>`;
}

function renderMarkingScheme({ examJson, grade, subject, allowShort = false }) {
  const L = layoutOf(examJson);
  refuseReviewText(examJson, 'marking scheme');
  const { all, live } = itemsBySlot(examJson, L);
  assertCounts(L, all, { allowShort });
  const ctx = contextFor(L, subject, false);
  const lang = ctx.medium;
  const Criteria = require('../composition-criteria');
  const H = L.header;
  const ur = lang === 'ur';

  // One bracket deep, one full stop (bd-5jmnfj.4.50.5).
  const coversScope = Cover.coversLine(L.scope || {}, H[`covers_${lang}`], lang);

  // Sections flow one after another (rows never split, a head never ends a
  // page): a forced break per section left near-empty pages in the proof render.
  const sections = L.sections.map((sec) => {
    const parts = [];
    const total = sectionTotal(sec, live);
    const head = `${sec[`label_${lang}`] ? substitute(sec[`label_${lang}`], sectionCtx(sec, live), lang) : `Section ${sec.id}`} (${fmt(total)})`;
    parts.push(`<div class="s-head">${textOf(head, ctx)}</div>`);
    const rows = [];
    for (const slot of sec.slots) {
      const list = all.get(slot.slot);
      if (slot.teacher_fills) { rows.push(TeacherSlot.keyRow(slot, lang === 'ur' ? slot.label_ur : shortLabel(slot.label_en), ctx, textOf)); continue; }
      // A strip prints in its question's place: the rows above it close first (bd-5jmnfj.4.49).
      if (slot.shape === 'mcq' || slot.shape === 'match') {
        if (rows.length) parts.push(`<table class="rows">${rows.splice(0).join('')}</table>`);
        parts.push(mcqStrip(slot, list, ctx));
      } else rows.push(...writtenRows(slot, list, ctx, Criteria));
    }
    if (rows.length) parts.push(`<table class="rows">${rows.join('')}</table>`);
    return `<section class="s-sec" data-section="${esc(sec.id)}">${parts.join('')}</section>`;
  }).join('\n');
  // The chip letters the rows above print: the legend keys those and no others.
  const kinds = new Set([...sections.matchAll(/<span class="chip">([MAUKL])/g)].map((m) => m[1]));

  const top = `<div class="band">${textOf(H[`band_${lang}`], ctx)}</div>
<div class="school">${textOf(H[`school_line_${lang}`], ctx)}</div>
<div class="title">${textOf(H[`title_${lang}`], ctx)}</div>
<div class="scheme-title">${textOf(H[`scheme_title_${lang}`], ctx)}</div>
<div class="covers">${textOf(coversScope, ctx)}</div>
${beforeExamBox(L, live, ctx, examJson)}
${legendBox(L, ctx, kinds)}
${suppliesBox(L, ctx, live)}`;

  const notes = notesBlock(L, all, ctx);
  const record = recordPage(L, live, ctx);
  // The Grade 1-2 oral teacher sheet (bd-5jmnfj.4.4); '' for a paper with no oral part.
  const oral = oralSheet(L.oral, { medium: lang, text: (s) => textOf(s, ctx) });
  // The read-aloud words on a page of their own, so the child never sees the teacher's sheet (v27, bd-5jmnfj.4.58.3).
  const card = childCard(L.oral, { medium: lang, text: (s) => textOf(s, ctx) });
  return `<!DOCTYPE html>
<html lang="${lang}"${ur ? ' dir="rtl"' : ''}>
<head><meta charset="utf-8"><title>${esc(H[`scheme_title_${lang}`])}</title>
<style>${css(lang, 'scheme')}</style></head>
<body data-grade="${esc(grade)}">
${top}
${sections}
${notes}
${oral}
${card}
${record}
</body></html>`;
}

// ── PDF options and the frame pages ────────────────────────────────────────

/**
 * Playwright page.pdf() options: A4, backgrounds, and a footer with
 * Chromium's own page number and total. The footer's <style> repeats the
 * page's @font-face rules so its fonts load (see the module comment).
 */
function pdfOptions(examJson, kind = 'paper') {
  const L = layoutOf(examJson);
  const ur = L.medium === 'ur';
  const H = L.header;
  const style = `<style>${faces(L.medium).join('')}</style>`;
  let body;
  if (ur) {
    const digits = "font-family:'FdeUrduDigits'";
    const page = esc(H.footer_page_ur)
      .replace('{n}', `<span class="pageNumber" style="${digits}"></span>`)
      .replace('{N}', `<span class="totalPages" style="${digits}"></span>`);
    const prefix = kind === 'scheme' ? `${esc(H.scheme_title_ur)} · ` : '';
    body = `<div dir="rtl" style="width:100%;font-family:'PaperUrdu';font-size:8.5pt;line-height:1.7;text-align:center;color:#333;padding:0 12mm">`
      + `<div>${prefix}${page}</div></div>`;
  } else {
    const prefix = kind === 'scheme' ? `${esc(H.scheme_title_en)} · ` : '';
    const page = esc(H.footer_page_en)
      .replace('{n}', '<span class="pageNumber"></span>')
      .replace('{N}', '<span class="totalPages"></span>');
    body = `<div style="width:100%;font-family:'PaperLatin';font-size:7.5pt;text-align:center;color:#333;padding:0 12mm">${prefix}${page}</div>`;
  }
  return {
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: style + body,
    margin: { top: '12mm', right: '12mm', bottom: ur ? '22mm' : '18mm', left: '12mm' },
  };
}

module.exports = {
  pdfOptions, renderMarkingScheme,
};

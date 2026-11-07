'use strict';
// Part of assessment-paper-fde.renderer.js (see its header); split for the 300-line limit, bd-5jmnfj.37.
const Fit = require('../fde-slot-fit');
const MidMatch = require('../fde-mid-match');
const TeacherSlot = require('../fde-teacher-slot'); // bd-5jmnfj.39.1: Islamiat Q3, written by the teacher
const V37 = require('../fde-render-v37'); // round 6 layout: marks, alphabet strip, ruled lines, passage reprint
const { ORDER_TASK } = require('../fde-order-check'); // bd-5jmnfj.4.58.2
const { frameBank } = require('../fde-frame-bank');
const { matchOrder, bankOrder, matchTable, matchAnswer, matchStem, MATCH_CSS } = require('../fde-match-block');
const { pictureBlock, bubbleBlock, PICTURE_CSS } = require('../fde-picture-block');
const { taskLine } = require('../fde-task-line');
const { choiceLine, codePoints, itemNumber, optionsBlock, printsField, printsWords, sectionCtx, slotFlag, tableBlock, wordList, workSpace } = require('./counts-options');
const { esc, substitute, textOf } = require('./fonts-digits');

// `pic`: a drawn picture (G5 Urdu Q7, English Q10) prints inside the frame, in place of its "teacher adds" title.
function frameBlock(q, slot, ctx, pic) {
  const lang = ctx.medium;
  const title = String(slot.frame[`title_${lang}`] || '').replace('{q}', String(q.question || '').trim());
  const lines = Array.from({ length: slot.frame.lines || 0 }, (_, i) => `<div class="label-line"><span class="num-l">${textOf(String(i + 1), ctx)}.</span></div>`).join('');
  const id = `fde-frame-${slot.slot}`;
  // A frame with no drawn picture names the teacher's duty in words, so an empty frame is never read
  // as a missing diagram (v27 G5 Science Q1 b, bd-5jmnfj.4.58.3).
  const book = slot.frame.book_page;
  const duty = pic ? '' : `<div class="frame-duty">${textOf(lang === 'ur'
    ? `استاد: ${slot.frame.duty_ur || 'تصویر'} یہاں بنائیں یا چسپاں کریں${book ? ` (کتاب ص ${book})` : ''}، فوٹو کاپی سے پہلے۔` // needs fluent-Urdu review
    : `Teacher: draw or paste ${slot.frame.duty_en || 'the picture'} here${book ? ` (book p. ${book})` : ''} before photocopying.`, ctx)}</div>`;
  // A frame that prints no `words` still prints the item's own instruction and bank (bd-5jmnfj.4.50.4).
  const own = slot.frame.word_bank ? { line: '', words: q.words } : frameBank(q, slot[`instruction_${lang}`]);
  const lead = own.line ? `<div class="frame-ins">${textOf(own.line, ctx)}</div>` : '';
  const bank = wordList(own.words, ctx, true);
  return `${lead}${bank}<div class="frame" id="${esc(id)}" style="height:${slot.frame.height_mm}mm">`
    + `<a class="frame-anchor" href="#${esc(id)}"></a>`
    + (pic || `<div class="frame-title">${textOf(title, ctx)}</div>${duty}`)
    + (lines ? `<div class="label-lines">${lines}</div>` : '')
    + '</div>';
}

// A model sometimes letters or numbers a sub-question itself («a) Why…», «(ب) …», «1. Finally…»);
// the renderer letters it. A numeral counts only when a space follows, so «3.5 kg» stays.
function bareSub(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/^\s*\(?[a-cA-C]\)\s*/, '').replace(/^\s*\(?(الف|ب|ج)\)\s*/, '')
    .replace(/^\s*\(?[0-9۰-۹]{1,2}[.)۔]\s+/, '');
}

// A Latin roman label (iv) in an Urdu paper is isolated LTR, or its ')' mirrors to '(iv' (v25 item 2).
function labelHtml(num, ctx) {
  return ctx.medium === 'ur' && typeof num === 'string' && /[A-Za-z]/.test(num) ? `<bdi class="ltr" dir="ltr">${esc(num)}</bdi>` : textOf(num, ctx);
}

function subQuestions(list, numbering, ctx, slotLike, space, reprint) {
  if (!Array.isArray(list)) return '';
  const again = reprint ? V37.reprintAt(list.length) : 0; // v37 G2 English Q1: the passage is in view for (h)-(j)
  return list.map((sub, i) => {
    const text = bareSub(typeof sub === 'string' ? sub : sub && sub.question);
    const num = itemNumber({ numbering }, i, ctx.medium) || `${String.fromCharCode(97 + i)})`;
    const opts = sub && Array.isArray(sub.options) && sub.options.length ? optionsBlock(sub, slotLike || {}, ctx) : '';
    // Its own writing space, sized by its own lines (bd-5jmnfj.4.51.8).
    const box = space && !opts ? `<div class="write-box" style="height:${12 + 8 * Math.max(0, ((sub && sub.lines) || 1) - 1)}mm"></div>` : '';
    const subHtml = `<div class="sub"><span class="n">${labelHtml(num, ctx)}</span> ${textOf(text, ctx)}${opts}</div>`;
    const one = box ? `<div class="subq">${subHtml}${box}</div>` : subHtml; // a question never parts from its box (G2 English Q1 h)
    return again && i === again ? V37.passageAgain(reprint, ctx.medium) + one : one;
  }).join('');
}

function comprehensionBlock(q, slot, ctx) {
  const lang = ctx.medium;
  const out = [`<div class="passage">${textOf(q.passage, ctx)}</div>`];
  const parts = Array.isArray(q.parts) ? q.parts : [];
  for (const spec of slot.parts_spec || []) {
    const part = parts.find((p) => p && p.key === spec.key) || {};
    // FDE groups some sub-parts under one lettered header (Urdu p.57 «ب: …»); the
    // sub-parts under it then print their own line and marks, without the letter.
    const g = spec.group_head;
    const groupHead = g ? `<div class="part-head"><span class="lab">${textOf(g.label, ctx)}</span> <span class="ins">${textOf(g[`instruction_${lang}`], ctx)}</span><span class="ml">${textOf(V37.marksText(g[`marks_line_${lang}`]), ctx)}</span></div>` : '';
    const lab = g ? '' : `<span class="lab">${textOf(spec.label, ctx)}</span> `;
    const head = `<div class="part-head">${lab}<span class="ins">${textOf(spec[`instruction_${lang}`], ctx)}</span><span class="ml">${textOf(V37.marksText(spec[`marks_line_${lang}`]), ctx)}</span></div>`;
    let body = '';
    if (spec.pick && ctx.onSheet) {
      body = Object.entries(spec.pick).map(([kind, n]) => `<div class="pick-row"><span class="pick-k">${textOf(kind, ctx)}:</span> ${textOf(String(n), ctx)}</div>`).join(''); // labels and counts only; the child writes on the answer copy (G5 Urdu B and C)
    } else if (spec.pick) {
      body = Object.entries(spec.pick).map(([kind, n]) => `<div class="pick-row"><span class="pick-k">${textOf(kind, ctx)}:</span>${Array.from({ length: n }, (_, i) => `<span class="blank">${textOf(String(i + 1), ctx)}</span>`).join('')}</div>`).join('');
    } else if (spec.key === 'antonyms') {
      body = (part.antonyms || []).map((pair) => `<span class="ant">${textOf(Array.isArray(pair) ? pair[0] : pair, ctx)} ${ctx.onSheet ? '' : '<span class="blank"></span>'}</span>`).join('');
      body = `<div class="ant-row">${body}</div>`;
    } else {
      body = subQuestions(part.questions, spec.numbering || 'urdu', ctx, slot);
    }
    out.push(`<div class="part">${groupHead}${head}${body}</div>`);
  }
  return out.join('');
}

function situationBlock(q, slot, i, ctx) {
  const lang = ctx.medium;
  const ip = slot.item_parts || {};
  const head = `<div class="sit"><span class="n">${textOf(itemNumber(slot, i, lang), ctx)}</span> <b>Situation:</b> ${textOf(q.question, ctx)}</div>`;
  const lead = ip[`line_${lang}`] ? `<div class="part-head"><span class="ins">${textOf(ip[`line_${lang}`], ctx)}</span><span class="ml">${textOf(ip[`marks_line_${lang}`] || '', ctx)}</span></div>` : '';
  return head + lead + subQuestions(q.questions, 'alpha_paren', ctx).replace(/\((a|b|c)\)/g, '$1)');
}

// v37 G2 Urdu Q7-Q9: five sentences or turns asked, five numbered ruled lines given (not one unruled box).
function ruledFor(q, slot, ctx) {
  const n = slotFlag(slot, 'answer_box') && !(q.questions && q.questions.length) ? V37.lineCount(slot) : 0;
  return n ? V37.ruledLines(n, (d) => textOf(d, ctx)) : '';
}

/** The body of one item (its number and stem are added by the caller where they apply). */
function itemBody(q, slot, i, ctx, inlineQ) {
  const shape = slot.shape;
  // A Grade 1-2 picture (bd-5jmnfj.4.3) prints above the body, whatever its shape.
  const pic = pictureBlock(q);
  if (pic && slotFlag(slot, 'bubble')) return bubbleBlock(pic);
  if (shape === 'mcq') return pic + tableBlock(q.table, ctx) + optionsBlock(q, slot, ctx); // a table the stem refers to prints (G5 Maths Q1 (a) xviii)
  if (shape === 'frame') return frameBlock(q, slot, ctx, pic);
  if (shape === 'comprehension') return pic + comprehensionBlock(q, slot, ctx);
  const parts = pic ? [pic] : [];
  if (Array.isArray(q.options) && q.options.length) parts.push(optionsBlock(q, slot, ctx));
  if (q.table) parts.push(tableBlock(q.table, ctx));
  if (q.passage && shape !== 'comprehension') parts.push(`<div class="${shape === 'words' || shape === 'fixed' ? 'verse' : 'passage'}">${textOf(q.passage, ctx)}</div>`);
  if (Array.isArray(q.topics) && q.topics.length && printsField(slot, 'topics')) {
    parts.push(`<div class="topics">${q.topics.map((t, k) => `<span class="topic">${textOf(itemNumber({ numbering: 'alpha_paren' }, k, ctx.medium), ctx)} ${textOf(t, ctx)}</span>`).join('')}</div>`);
  }
  if (printsWords(slot) && !slotFlag(slot, 'answer_box') && Array.isArray(q.words) && q.words.length) parts.push(wordList(q.words, ctx, ctx.medium !== 'ur'));
  // A written answer under each sub-question of an answer-box slot (G2 reading): one box each, none after the set.
  const eachBox = ctx.answerLines !== false && slotFlag(slot, 'answer_box') && Array.isArray(q.questions) && q.questions.length > 0 && slot.type !== 'Story Order';
  if (Array.isArray(q.questions) && q.questions.length) parts.push(subQuestions(q.questions, slot.sub_numbering || 'alpha_paren', ctx, undefined, eachBox, eachBox && q.passage ? textOf(q.passage, ctx) : ''));
  if (ctx.answerLines !== false && slot.type === 'Story Order') parts.push('<div class="write-box" style="height:12mm"></div>'); // one line for the letters (bd-5jmnfj.4.58.2)
  else if (ctx.answerLines !== false && !eachBox) parts.push(ruledFor(q, slot, ctx) || workSpace(q, slot));
  return parts.join('');
}

// A slot that letters its items (a), (b) prints the letter itself, so a letter the model wrote
// at the head of the item would print twice: «(a) (a) Write an application…». The stored item
// keeps its text; only the print drops it.
const OWN_LABEL = /^\(?[a-d]\)\s*/;
function withoutOwnLabel(text, slot) {
  return slot.numbering === 'alpha_paren' && typeof text === 'string' ? text.replace(OWN_LABEL, '') : text;
}

function stemOf(q, slot, inlineQ) {
  if (inlineQ) return '';
  // A picture-naming item is the picture and a box: the instruction above already asks (bd-5jmnfj.4.19).
  if (slotFlag(slot, 'picture_only')) return '';
  if (slot.shape === 'frame' || slot.shape === 'comprehension') return '';
  if (slot.shape === 'words' && !q.question) return '';
  const task = taskLine(q, slot); // bd-5jmnfj.4.58.2
  if (slot.type === 'Story Order') return `${q.question || ''} ${ORDER_TASK}`.trim();
  return withoutOwnLabel(task ? `${task} ${q.question || ''}` : (q.question || ''), slot);
}

// Verses given from a lesson the paper does not cover name it under them, as English Q5 names its
// unit. A page range is written «۶۳ تا ۶۴»: a hyphen after an Urdu word prints the range reversed.
function verseSource(ctx) {
  const src = ctx.verseSource;
  if (!src || !src.lesson) return '';
  const pages = String(src.pages || '').split('-').map((n) => n.trim()).filter(Boolean);
  const line = ctx.medium === 'ur'
    ? `(سبق ${src.lesson}، ص ${pages.join(' تا ')})` // needs fluent-Urdu review
    : `(Lesson ${src.lesson}, ${pages.length > 1 ? 'pp.' : 'p.'} ${pages.join('–')})`;
  return `<div class="verse verse-src">${textOf(line, ctx)}</div>`;
}

// Urdu Q6: the lesson-7 lines, after a fixed instruction-only alternative when the pattern has one.
function fixedAlternatives(slot, q, ctx) {
  const lang = ctx.medium;
  const fixed = slot.alternatives.find((a) => a.kind === 'fixed');
  const seen = slot.alternatives.find((a) => a.kind === 'seen_verses');
  const out = [];
  if (fixed) out.push(`<div class="alt">${textOf(fixed[`instruction_${lang}`] || fixed.instruction_ur, ctx)}</div>`);
  if (q && seen) {
    if (fixed) out.push(`<div class="or">${textOf(lang === 'ur' ? 'یا' : 'OR', ctx)}</div>`);
    out.push(`<div class="q" data-slot="${esc(slot.slot)}"><div class="alt">${textOf(seen[`instruction_${lang}`] || seen.instruction_ur, ctx)}</div><div class="verse">${textOf(q.passage, ctx)}</div>${verseSource(ctx)}</div>`);
  }
  return out.join('');
}

function slotBlock(slot, sec, list, ctx) {
  // A section the teacher note sends to the answer copy prints no writing space on the paper.
  if (sec.answer_on === 'answer_sheet') ctx = { ...ctx, answerLines: false, onSheet: true };
  const lang = ctx.medium;
  const live = list.filter((q) => q.removed !== true);
  // A blank is as long as the longest box word (G1 Urdu Q5).
  const blankLen = Math.max(0, ...live.flatMap((q) => (Array.isArray(q.words) ? q.words : []).map((w) => codePoints(String(w)))));
  const line = choiceLine(slot, live.length, lang, live);
  const inlineQ = /\{q\}/.test(slot[`instruction_${lang}`] || '') && live.length === 1;
  const instruction = line.instruction;
  const cont = /^continue:/.test(slot.numbering || '');
  const label = cont ? '' : slot[`label_${lang}`];
  const head = (label || instruction || line.marksLine)
    ? `<div class="slot-head">${label ? `<span class="lab">${textOf(label, ctx)}</span> ` : ''}${instruction ? `<span class="ins">${textOf(instruction, ctx)}</span>` : ''}${line.marksLine ? `<span class="ml">${textOf(line.marksLine, ctx)}</span>` : ''}</div>`
    : '';
  if (slot.teacher_fills) return TeacherSlot.paperBlock(slot, head, ctx, textOf); // bd-5jmnfj.39.1
  if (slot.shape === 'match') {
    // Two columns for the child to join with a line; Column B never follows the stems (bd-5jmnfj.4.23).
    // Column A is the item's own column_a when it has one (bd-5jmnfj.33.2), else its stem as before.
    const stems = live.map((q, i) => `<span class="n">${labelHtml(itemNumber(slot, i, lang), ctx)}</span> ${textOf(Array.isArray(q.column_a) ? matchStem(q) : stemOf(q, slot, false), ctx)}`);
    const column = matchOrder(live.map(matchAnswer)).map((a) => textOf(a, ctx));
    const table = MidMatch.isMidMatch(slot) ? MidMatch.midMatchTable(stems, column, lang) : matchTable(stems, column); // G3/G4: heads, letters, boxes (bd-5jmnfj.33.4)
    return `<div class="slot">${head}<div class="q" data-slot="${esc(slot.slot)}">${table}</div></div>`;
  }
  const body = [];
  const strip = lang === 'ur' && slot.type === 'Alphabetical Order' ? V37.alphabetStrip() : ''; // v37 G2 Urdu Q2
  const pair = !slotFlag(slot, 'sentence_box') && Fit.sceneGrid(live, { frame: slot.shape === 'frame', bubble: slotFlag(slot, 'bubble'), mcq: slot.shape === 'mcq' }); // v29 G1 Maths Q8
  const grid = slotFlag(slot, 'picture_only') || pair;
  const soloScene = Fit.soloScene(live, { frame: slot.shape === 'frame', bubble: slotFlag(slot, 'bubble') });
  const or = lang === 'ur' ? 'یا' : 'OR';
  live.forEach((q, i) => {
    if (slot.or && i > 0) body.push(`<div class="or">${textOf(or, ctx)}</div>`);
    const lead = Array.isArray(slot[`or_parts_${lang}`]) ? slot[`or_parts_${lang}`][list.indexOf(q)] : null;
    if (slot.shape === 'situation') {
      body.push(`<div class="q" data-slot="${esc(slot.slot)}">${situationBlock(q, slot, i, ctx)}</div>`);
      return;
    }
    if (slot.alternatives) {
      body.push(fixedAlternatives(slot, q, ctx));
      return;
    }
    const num = itemNumber(slot, i, lang);
    const stem = blankLen > 3 ? String(stemOf(q, slot, inlineQ)).replace(/_{3,}/g, (m) => '_'.repeat(Math.max(m.length, blankLen))) : stemOf(q, slot, inlineQ);
    const numHtml = num ? `<span class="n">${labelHtml(num, ctx)}</span>` : '';
    const leadHtml = lead ? `<div class="or-lead">${textOf(lead, ctx)}</div>` : '';
    const stemHtml = stem ? ` ${textOf(stem, ctx).replace(/☐/g, '<span class="sq"></span>')}` : '';
    body.push(`<div class="q${cont ? ' qcont' : ''}${slot.shape === 'comprehension' ? ' comp' : ''}${grid ? ` pic-cell${pair ? ' pair' : ''}${slotFlag(slot, 'sentence_box') ? ' wide' : ''}` : ''}${soloScene ? ' solo-scene' : ''}" data-slot="${esc(slot.slot)}">${numHtml}${leadHtml}${stemHtml}${itemBody(q, slot, i, ctx, inlineQ)}</div>`);
  });
  if (slot.alternatives && !live.length) body.push(fixedAlternatives(slot, null, ctx));
  // An either/or question is read as one choice: never split across a page.
  const either = slot.or || slot.alternatives ? ' either' : '';
  // A short slot (six items or fewer, not a passage) moves whole, so its items never leave their
  // instruction at a page break (v27 G1 Maths Q2, G2 English Q1 h, bd-5jmnfj.4.58.3).
  // A slot taller than a page is never kept whole: it would jump to a fresh page and split there (bd-5jmnfj.33.8.1).
  const boxMm = slotFlag(slot, 'answer_box') ? 12 + 8 * Math.max(0, (slot.lines || 1) - 1) : ((slot.lines || 0) >= 2 ? Math.max(16, slot.lines * 8) : 0);
  const fits = grid || Fit.writeSlotFits({ stems: live.map((q) => q.question), boxMm, ur: lang === 'ur' });
  const short = live.length <= 6 && fits && !['comprehension', 'passage'].includes(slot.shape) ? ' short' : '';
  // A Grade 1-2 slot prints its words once, boxed, above its items (bd-5jmnfj.4.20). The bank is
  // dealt so no word sits at its own item: a model lists them as it wrote them (bd-5jmnfj.4.50.9).
  const words = bankOrder([...new Set(live.flatMap((q) => (Array.isArray(q.words) ? q.words : [])))], live.map(matchAnswer));
  const bank = printsWords(slot) && slotFlag(slot, 'answer_box') && words.length
    ? `<div class="word-box bank">${words.map((w) => `<span class="w">${textOf(w, ctx)}</span>`).join('')}</div>` : '';
  const wide = grid && slotFlag(slot, 'sentence_box');
  const fit = short ? Fit.fitAttr(live, { grid, wide, pair, bubble: slotFlag(slot, 'bubble') }) : ''; // bd-5jmnfj.4.58.4
  if (grid) return `<div class="slot${either}${short}"${fit}>${head}${strip}${bank}<div class="pic-grid">${Fit.groupRows(body, wide ? 1 : (pair ? Fit.PAIR : Fit.PER_ROW))}</div></div>`;
  return `<div class="slot${either}${short}"${fit}>${head}${strip}${bank}${body.join('')}</div>`;
}

function sectionHead(sec, live, ctx) {
  const lang = ctx.medium;
  const sctx = sectionCtx(sec, live);
  const cell = (k, cls) => {
    const v = substitute(sec[`${k}_${lang}`], sctx, lang);
    return `<span class="${cls}">${v ? textOf(v, ctx) : ''}</span>`;
  };
  const note = sec[`note_${lang}`] ? `<div class="sec-note">${textOf(substitute(sec[`note_${lang}`], sctx, lang), ctx)}</div>` : '';
  return `<div class="sec-head">${cell('time', 't')}${cell('label', 'l')}${cell('marks', 'm')}</div>${note}`;
}

module.exports = {
  bareSub, sectionHead, slotBlock, withoutOwnLabel,
};

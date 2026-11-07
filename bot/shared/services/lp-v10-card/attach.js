'use strict';
/**
 * The v10 card on a GB lesson written on request (bd-rj6w0n.14.16.6), made the way the 838 live ones were made
 * offline: moves from the v9 lesson, the card written and checked by ICT's gates, printed at 520x2000, and joined
 * ahead of the v9 PDF (gb_v10_manifest.join). Revision and assessment days get no card (gb_v10.NO_CARD).
 */
const fs = require('fs');
const path = require('path');
const { addIds } = require('./anchor');
const { render } = require('./render');
const { gates, withVideo } = require('./gates');
const { extractMoves } = require('./moves');
const { authorCard } = require('./author');

const NO_CARD = new Set(['revision', 'assessment']);
const MAX_PRINT = 2000;

const cardDay = (segment) => !NO_CARD.has(segment.skill_type) && !NO_CARD.has(segment.lp_type);

// ICT's rules know English/Urdu/Maths only; a GB Science card is checked by the English rules (it is taught in
// English) while the card itself keeps "Science" (gb_v10.science_as_english).
const asEnglish = (card) => (card.header && card.header.subject === 'Science'
  ? { ...card, header: { ...card.header, subject: 'English' } } : card);

const fail = (code, message, extra) => Object.assign(new Error(message), { code }, extra);

// pdf-lib is bot-only; loaded here so a flag-off worker (and the root suite, run before bot deps install) never needs it.
async function join(cardPdf, v9Pdf, dest) {
  const { PDFDocument } = require('pdf-lib');
  const out = await PDFDocument.create();
  for (const f of [cardPdf, v9Pdf]) {
    const src = await PDFDocument.load(await fs.promises.readFile(f));
    (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p));
  }
  await fs.promises.writeFile(dest, await out.save());
  return out.getPageCount();
}

async function attachCard({ lpDoc, v9HtmlPath, v9PdfPath, segment, lang, stem, outDir, deadlineMs, onRefused }, deps = {}) {
  const { client, model, printCard = require('./print').printCard } = deps;
  const started = Date.now();
  const v9 = addIds(await fs.promises.readFile(v9HtmlPath, 'utf8'));

  let moves;
  try {
    moves = await extractMoves({ lpDoc, lessonId: segment.segment_id, client, model, sourcePath: v9HtmlPath });
  } catch (e) { throw fail('MOVES_FAILED', e.message, { cause: e }); }
  const moves_ms = Date.now() - started;
  const must = moves.moves.filter((m) => m.bucket === 'must_happen').map((m) => m.move_id);

  let html = '';
  const check = (card) => {
    html = render(withVideo(card, v9));
    return gates(asEnglish(card), html, v9, must);
  };
  const t1 = Date.now();
  const { card, reasons } = await authorCard({ v9Html: v9, moves, stem, subject: segment.subject, lang, validate: check,
    client, model, deadlineMs: Math.max(1, deadlineMs - (t1 - started)), onRefused });
  const card_ms = Date.now() - t1;
  html = render(withVideo(card, v9)); // the card sent may be an earlier round's than the last one checked

  const t2 = Date.now();
  const cardHtml = path.join(outDir, `${stem}.v10-card.html`);
  const cardPdf = path.join(outDir, `${stem}.v10-card.pdf`);
  await fs.promises.writeFile(cardHtml, html);
  const { printPx } = await printCard(html, cardPdf);
  if (!(printPx <= MAX_PRINT)) throw fail('card_too_long', `v10 card prints ${printPx}px, over ${MAX_PRINT}`);
  const pdfPath = path.join(outDir, `${stem}.v10.pdf`);
  const pageCount = await join(cardPdf, v9PdfPath, pdfPath);
  return { pdfPath, pageCount, card, moves, reasons, timings: { moves_ms, card_ms, render_ms: Date.now() - t2 } };
}

module.exports = { attachCard, cardDay, asEnglish, join };

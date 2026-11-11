'use strict';
// bd-rj6w0n.14.16.6 — the card's print PDF as ICT's shots.js makes it: one 520x2000 page under print media, and the
// printed height of .page so the caller can refuse a card over 2000. Real Chromium; skipped where none launches.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { printCard } = require('../../shared/services/lp-v10-card/print');
const { render } = require('../../shared/services/lp-v10-card/render');
const { withVideo } = require('../../shared/services/lp-v10-card/gates');
const L = require('../fixtures/lp-v10-card/load');

let canLaunch = true;
beforeAll(async () => {
  try { await (await require('playwright-core').chromium.launch(process.platform === 'darwin' ? { channel: 'chrome' } : {})).close(); }
  catch (_) { canLaunch = false; }
}, 30000);

test('the prototype card prints on one 520x2000 page and fits', async () => {
  if (!canLaunch) return;
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'v10print-')), 'card.pdf');
  const { printPx } = await printCard(render(withVideo(L.card(), L.V9)), out);
  expect(printPx).toBeGreaterThan(500);
  expect(printPx).toBeLessThanOrEqual(2000);
  const pdf = await PDFDocument.load(fs.readFileSync(out));
  expect(pdf.getPageCount()).toBe(1);
  const { width, height } = pdf.getPage(0).getSize();
  expect([Math.round(width), Math.round(height)]).toEqual([390, 1500]); // 520x2000 css px at 72/96
}, 60000);

// Sandbox 7 Nov: a 2941px card was dropped. It prints whole, on one page as long as the card.
test('a card longer than 2000px prints whole on one longer page', async () => {
  if (!canLaunch) return;
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'v10print-')), 'tall.pdf');
  const { printPx } = await printCard('<html><body style="margin:0"><div class="page" style="height:2941px">x</div></body></html>', out);
  expect(printPx).toBe(2941);
  const pdf = await PDFDocument.load(fs.readFileSync(out));
  expect(pdf.getPageCount()).toBe(1);
  expect(Math.round(pdf.getPage(0).getSize().height)).toBe(Math.round(2941 * 0.75));
}, 60000);

// bd-snkn32.23 — the card's own CSS fixes @page at 520x2000; a longer card was cut into two pages with a big blank
// in We Do. It still prints on one page as long as the card.
test('a card longer than 2000px with the card @page rule still prints on one page', async () => {
  if (!canLaunch) return;
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'v10print-')), 'tallcss.pdf');
  const html = '<html><head><style>@page{size:520px 2000px;margin:0}</style></head><body style="margin:0">'
    + '<div class="page"><div style="height:1900px">a</div><div style="height:900px;break-inside:avoid">b</div></div></body></html>';
  const { printPx } = await printCard(html, out);
  expect(printPx).toBe(2800);
  const pdf = await PDFDocument.load(fs.readFileSync(out));
  expect(pdf.getPageCount()).toBe(1);
  expect(Math.round(pdf.getPage(0).getSize().height)).toBe(Math.round(2800 * 0.75));
}, 60000);

test('a page with no .page reports no height, so the caller refuses it', async () => {
  if (!canLaunch) return;
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'v10print-')), 'x.pdf');
  expect((await printCard('<html><body>x</body></html>', out)).printPx).toBeNull();
}, 60000);

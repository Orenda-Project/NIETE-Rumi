'use strict';
// bd-rj6w0n.14.16.6 — the v10 card added to a GB lesson written on request, the way the 838 live ones were made
// offline: moves from the v9 lesson, the card written and checked by ICT's gates (a GB Science card under the
// English rules, keeping "Science" on its header), printed at 520x2000, and joined ahead of the v9 PDF
// (gb_v10_manifest.join). The model is faked; the gates, render and PDF join are real.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const L = require('../fixtures/lp-v10-card/load');
const MISSING = require('../fixtures/lp-v10-card/goldens/mut_missing_g2_ch10_English_seg1.golden.json');
const { attachCard, cardDay } = require('../../shared/services/lp-v10-card/attach');

const STEM = 'g2_ch10_English_seg1';
const SEG = { segment_id: 'gb_g2_english.c10.s001', grade: 2, subject: 'English', skill_type: 'reading', lp_type: 'content' };
const MOVES = { moves: L.MUST.map((id) => ({ move_id: id, bucket: 'must_happen', phase: 'we_do', text: id })) };

const reply = (obj) => ({ choices: [{ message: { content: JSON.stringify(obj) } }], usage: {} });
function fakeClient(cards, { cardDelayMs = 0 } = {}) {
  const calls = [];
  return {
    calls,
    chat: { completions: { create: async (req) => {
      calls.push(req);
      if (req.job === 'lp.v10moves') return reply(MOVES);
      if (cardDelayMs) await new Promise((r) => setTimeout(r, cardDelayMs));
      return reply(cards.shift());
    } } },
  };
}

async function pdfOf(pages, file) {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage([200, 200]);
  fs.writeFileSync(file, await d.save());
}

let dir;
let opts;
const printOk = jest.fn(async (html, outPdf) => { await pdfOf(1, outPdf); return { printPx: 1800 }; });
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v10attach-'));
  fs.writeFileSync(path.join(dir, 'v9.html'), L.V9);
  await pdfOf(3, path.join(dir, 'v9.pdf'));
  printOk.mockClear();
  opts = { lpDoc: { title: 'x' }, v9HtmlPath: path.join(dir, 'v9.html'), v9PdfPath: path.join(dir, 'v9.pdf'),
    segment: SEG, lang: 'en', stem: STEM, outDir: dir, deadlineMs: 60000, correlationId: 'c-1' };
});

describe('attachCard', () => {
  test('the card goes on page 1, the v9 plan after it, as offline', async () => {
    const client = fakeClient([L.card()]);
    const out = await attachCard(opts, { client, model: 'm', printCard: printOk });
    expect(out.pageCount).toBe(4);
    const merged = await PDFDocument.load(fs.readFileSync(out.pdfPath));
    expect(merged.getPageCount()).toBe(4);
    expect(out.card.header.subject).toBe('English');
    expect(out.moves.moves.map((m) => m.move_id)).toEqual(L.MUST);
    expect(client.calls.map((c) => c.job)).toEqual(['lp.v10moves', 'lp.v10card']);
    expect(printOk.mock.calls[0][0]).toMatch(/<html/);
    expect(out.timings).toEqual({ moves_ms: expect.any(Number), card_ms: expect.any(Number), render_ms: expect.any(Number) });
  });

  test('the card model gets the v9 page with its section anchors', async () => {
    const client = fakeClient([L.card()]);
    await attachCard(opts, { client, model: 'm', printCard: printOk });
    expect(client.calls[1].messages[1].content).toMatch(/id="/);
  });

  test('a card the gates refuse goes back once with the gate\'s reasons', async () => {
    const client = fakeClient([MISSING.card, L.card()]);
    const out = await attachCard(opts, { client, model: 'm', printCard: printOk });
    expect(client.calls).toHaveLength(3);
    expect(client.calls[2].messages.at(-1).content).toMatch(/REFUSED/);
    expect(out.pageCount).toBe(4);
  });

  test('a refused round reaches the caller with its reasons', async () => {
    const refused = [];
    const client = fakeClient([MISSING.card, L.card()]);
    await attachCard({ ...opts, onRefused: (r) => refused.push(r) }, { client, model: 'm', printCard: printOk });
    expect(refused).toHaveLength(1);
    expect(refused[0].round).toBe(1);
    expect(refused[0].reasons.length).toBeGreaterThan(0);
  });

  test('a card still queried after the last round is joined ahead of v9 anyway, with its reasons', async () => {
    const client = fakeClient([MISSING.card, MISSING.card, MISSING.card, MISSING.card]);
    const out = await attachCard(opts, { client, model: 'm', printCard: printOk });
    expect(out.pageCount).toBe(4);
    expect(out.reasons.length).toBeGreaterThan(0);
  });

  test('a GB Science card is checked by the English rules and keeps "Science" on its header', async () => {
    const sci = L.card();
    sci.header.subject = 'Science';
    const client = fakeClient([sci]);
    const out = await attachCard({ ...opts, segment: { ...SEG, subject: 'Science' } }, { client, model: 'm', printCard: printOk });
    expect(out.card.header.subject).toBe('Science');
    expect(printOk.mock.calls[0][0]).toMatch(/SCIENCE|Science/);
  });

  // Sandbox 7 Nov, G3 English c03 s002: the card printed 2941px and was dropped, so v9 went alone. Amena: the card
  // goes with v9. A long card prints on one longer page (print.js) and is joined.
  test('a card that prints longer than 2000px is still joined ahead of v9', async () => {
    const tall = jest.fn(async (html, outPdf) => { await pdfOf(1, outPdf); return { printPx: 2941 }; });
    const out = await attachCard(opts, { client: fakeClient([L.card()]), model: 'm', printCard: tall });
    expect(out.pageCount).toBe(4);
  });

  test('a card with no printable page is an error', async () => {
    const none = jest.fn(async (html, outPdf) => { await pdfOf(1, outPdf); return { printPx: null }; });
    await expect(attachCard(opts, { client: fakeClient([L.card()]), model: 'm', printCard: none }))
      .rejects.toMatchObject({ code: 'card_unprintable' });
  });

  test('moves that fail are an error the worker can name', async () => {
    const client = { chat: { completions: { create: async () => reply({ moves: [] }) } } };
    await expect(attachCard(opts, { client, model: 'm', printCard: printOk })).rejects.toMatchObject({ code: 'MOVES_FAILED' });
  });

  test('the card writer gets only what is left of the deadline', async () => {
    const client = fakeClient([L.card()], { cardDelayMs: 500 });
    await expect(attachCard({ ...opts, deadlineMs: 100 }, { client, model: 'm', printCard: printOk }))
      .rejects.toMatchObject({ code: 'card_timeout' });
  });
});

describe('cardDay', () => {
  test('revision and assessment days get no card, as offline', () => {
    expect(cardDay(SEG)).toBe(true);
    expect(cardDay({ ...SEG, skill_type: 'revision' })).toBe(false);
    expect(cardDay({ ...SEG, skill_type: 'assessment' })).toBe(false);
    expect(cardDay({ ...SEG, lp_type: 'revision' })).toBe(false);
  });
});

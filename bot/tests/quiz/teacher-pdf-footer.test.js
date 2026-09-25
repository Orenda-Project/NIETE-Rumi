'use strict';
/**
 * The teacher's pre-send quiz PDF must never end on a page that holds only its
 * footer.
 *
 * Seen on an eight-question Urdu quiz: the last card fitted at the foot of page
 * 3, the footer (the NIETE mark and one line) did not, and page 4 carried the
 * footer and nothing else. Whether it happens depends only on how far down page
 * 3 the last card ends, so this suite does not pin one lucky length: it grows
 * the last question's stem a clause at a time (each step shorter than the
 * footer is tall) and prints every step through the real renderPdf() and a real
 * Chromium. Somewhere in that sweep the last card still fits and the footer
 * does not — that step must still end on a page with the last card on it.
 */

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
// The figure engine loads a molecule renderer at module scope whose ESM build
// Jest cannot parse; this PDF has no molecules in it. (The root suite maps the
// same package to a stub for the same reason.)
jest.mock('openchemlib', () => ({}));

const Gen = require('../../shared/services/quiz/transcript-quiz-generate.service');
const { closeBrowser } = require('../../shared/utils/html-to-pdf');
const { teacherPdfArgs } = require('./fixtures/teacher-pdf-synthetic');
const { pageInk, renderOptOut, hasPoppler } = require('./helpers/pdf-layout');

const run = renderOptOut() ? describe.skip : describe;

jest.setTimeout(180000);

afterAll(async () => { await closeBrowser(); });

run('the teacher quiz PDF keeps its footer with the last card', () => {
  beforeAll(() => {
    if (!hasPoppler()) throw new Error('pdftoppm (poppler) is needed to read the printed pages back');
  });

  test('no length of the last question leaves the footer alone on the last page', async () => {
    const footerOnly = [];
    let crossed = false;
    let crossedAt = null;
    let pagesBefore = null;
    // The sweep finds the page boundary itself rather than pinning a window of
    // clause counts: where the last card crosses a page depends on how tall
    // every card above it is, and that moved when the Urdu lines were given the
    // room Nastaliq needs (the crossing went from 8->9 clauses to 5->6). It
    // walks on a few steps past the crossing — past the lengths where the
    // footer used to strand — and stops well short of a last question taller
    // than a page (~14 clauses here, over three times the longest real stem).
    for (let clauses = 0; clauses <= 12 && !(crossed && clauses > crossedAt + 4); clauses += 1) {
      const pages = pageInk(await Gen.renderPdf(teacherPdfArgs(clauses)));
      if (pagesBefore !== null && pages.length > pagesBefore && !crossed) { crossed = true; crossedAt = clauses; }
      pagesBefore = pages.length;
      // A stranded footer is one line of type at the top of the sheet: its ink
      // ends about 5% of the way down. A page with the last card on it reaches
      // far further.
      const last = pages[pages.length - 1];
      if (last.lastInk <= 0.1) footerOnly.push({ clauses, pages: pages.length, lastPageEnds: Number(last.lastInk.toFixed(2)) });
    }
    // The sweep did walk the last card over a page boundary, so it passed
    // through the lengths where the footer used to strand.
    expect(crossed).toBe(true);
    expect(footerOnly).toEqual([]);
  });
});

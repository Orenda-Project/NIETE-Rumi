/**
 * The guardrail the brief documents and the code never had.
 *
 * `brief_segment_v2.md` states: *"Hard maximum: 25 pages… A segment past that cannot be served at
 * all — the author pipeline refuses the page range."* **That refusal was never implemented.** An
 * exhaustive grep for MAX_PAGES / PAGE_CAP / maxPages / `25.*page` across the repo found nothing:
 * `fetchPages()` had no length check, the importer had no page-span check, and the migration
 * declares printed_page_start/end with no CHECK.
 *
 * The only real bound was `PAGE_TRUTH_MAX_CHARS = 90000`, applied as
 *
 *     out.length <= maxChars ? out : out.slice(0, maxChars) + '\n…[truncated]'
 *
 * — no throw, no log, no persisted state, nothing the teacher ever sees. Measured, that bites at
 * roughly 44 pages (mean English) and 29 (p90 Urdu), so a long chapter silently loses its tail and
 * the lesson is authored from a book that stops mid-sentence. That is a Rule 24(b) regression
 * mask: the failure is invisible at every layer that could report it.
 *
 * It is live on the menu path today — 119 of the 5,482 segments exceed 25 pages, the largest 63.
 *
 * Both fixes are asserted here, and BOTH are refusals rather than repairs: a lesson authored from
 * two thirds of its source is worse than an honest "this one is too long", because the teacher
 * cannot tell the difference by looking at it.
 */

const path = require('path');

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
const { logToFile } = require('../../bot/shared/utils/logger');

const { fetchPages, MAX_SEGMENT_PAGES } = require('../../bot/shared/services/lp612-pagetruth.service');
const { compactPageTruth, PAGE_TRUTH_MAX_CHARS } = require('../../bot/shared/services/lp612-author.service');

const pages = (n) => Array.from({ length: n }, (_, i) => i + 1);

describe('the 25-page cap the brief always claimed existed', () => {
  test('it is the documented number, not an invented one', () => {
    expect(MAX_SEGMENT_PAGES).toBe(25);
  });

  test('a page range over the cap is REFUSED, with a distinct code', async () => {
    // Not truncated, not best-effort. The one choke point with one caller.
    await expect(fetchPages({ bookStem: 'grade_11_computer_science', pages: pages(63) }))
      .rejects.toMatchObject({ code: 'PAGE_RANGE_TOO_LARGE' });
  });

  test('the refusal says how many pages were asked for and what the limit is', async () => {
    // A code alone sends the next engineer back to the source. The numbers belong in the message.
    await expect(fetchPages({ bookStem: 'b', pages: pages(63) }))
      .rejects.toThrow(/63[\s\S]*25|25[\s\S]*63/);
  });

  test('it is LOGGED, so an over-long segment is answerable by query and not by guesswork', async () => {
    logToFile.mockClear();
    await fetchPages({ bookStem: 'b', pages: pages(40) }).catch(() => {});
    expect(logToFile).toHaveBeenCalled();
    const said = logToFile.mock.calls.map((c) => JSON.stringify(c)).join(' ');
    expect(said).toMatch(/too (large|long)|PAGE_RANGE_TOO_LARGE/i);
  });

  test('exactly the cap is allowed — the boundary is not off by one', async () => {
    // 25 must pass the cap check. It fails later on missing page-truth, which is a DIFFERENT code.
    await expect(fetchPages({ bookStem: 'nope', pages: pages(25) }))
      .rejects.not.toMatchObject({ code: 'PAGE_RANGE_TOO_LARGE' });
  });

  test('an ordinary segment is untouched', async () => {
    await expect(fetchPages({ bookStem: 'nope', pages: [7, 8] }))
      .rejects.not.toMatchObject({ code: 'PAGE_RANGE_TOO_LARGE' });
  });

  test('the empty-pages guard still fires — the new check does not shadow it', async () => {
    await expect(fetchPages({ bookStem: 'b', pages: [] })).rejects.toMatchObject({ code: 'PAGE_TRUTH_MISSING' });
  });
});

describe('the 90k truncation must never be silent again', () => {
  const bigPages = (chars) => ([{
    printed_page_number: 1, pdf_page_index: 1, page_type: 'content',
    blocks: [{ t: 'prose', text: 'x'.repeat(chars) }],
  }]);

  test('page-truth over the character bound is REFUSED, not quietly sliced', () => {
    expect(() => compactPageTruth(bigPages(PAGE_TRUTH_MAX_CHARS + 5000))).toThrow();
  });

  test('the refusal names the size and the bound, not just a code', () => {
    // The code is what the worker keys on; the NUMBERS are what stop the next engineer having to
    // go back to the source to find out how far over it was.
    expect(() => compactPageTruth(bigPages(PAGE_TRUTH_MAX_CHARS + 5000)))
      .toThrow(new RegExp(String(PAGE_TRUTH_MAX_CHARS)));
  });

  test('the thrown error carries a distinct code the worker can persist', () => {
    try {
      compactPageTruth(bigPages(PAGE_TRUTH_MAX_CHARS + 5000));
      throw new Error('should have thrown');
    } catch (e) {
      expect(e.code).toBe('PAGE_TRUTH_TOO_LARGE');
    }
  });

  test('it NEVER returns a string ending in the old truncation marker', () => {
    // The exact shape of the old silent bite, asserted as gone.
    let out = null;
    try { out = compactPageTruth(bigPages(PAGE_TRUTH_MAX_CHARS + 5000)); } catch (e) { /* expected */ }
    expect(out).toBeNull();
  });

  test('page-truth inside the bound is returned whole and unmarked', () => {
    const out = compactPageTruth(bigPages(500));
    expect(out).toContain('PRINTED PAGE 1');
    expect(out).not.toContain('[truncated]');
    expect(out.length).toBeLessThan(PAGE_TRUTH_MAX_CHARS);
  });
});

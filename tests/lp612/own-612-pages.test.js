'use strict';
/**
 * bd-snkn32.19 (unified spec item 14) — her own book pages for a grades 6–12 "Make my own": inside the lesson, or
 * through the next lesson's last page when she joins it. The portal's checkPages612 is the same rule.
 */
const { parse612Pages, pagesLine612, bookRange } = require('../../bot/shared/services/lp612-own-pages');
const { createOwnService } = require('../../bot/shared/services/lp612-own.service');
const { parseOwnAnswers, buildOwnInstruction } = require('../../bot/shared/services/lp612-own-instruction');

const LESSON = { start: 42, end: 45 };
const NEXT = { start: 46, end: 48 };

describe('parse612Pages', () => {
  it('no pages is no change', () => {
    expect(parse612Pages(undefined, LESSON, null)).toEqual({ ok: true, pages: null });
  });
  it('inside the lesson is kept; the lesson\'s own range is no change', () => {
    expect(parse612Pages({ start: 43, end: 44 }, LESSON, null)).toEqual({ ok: true, pages: { start: 43, end: 44 } });
    expect(parse612Pages({ start: '42', end: '42' }, LESSON, null)).toEqual({ ok: true, pages: { start: 42, end: 42 } });
    expect(parse612Pages({ start: 42, end: 45 }, LESSON, null)).toEqual({ ok: true, pages: null });
  });
  it('through the next lesson only when she joined it, and only to its last page', () => {
    expect(parse612Pages({ start: 44, end: 48 }, LESSON, NEXT)).toEqual({ ok: true, pages: { start: 44, end: 48 } });
    expect(parse612Pages({ start: 42, end: 48 }, LESSON, NEXT)).toEqual({ ok: true, pages: null });
    expect(parse612Pages({ start: 44, end: 48 }, LESSON, null).ok).toBe(false);
    expect(parse612Pages({ start: 44, end: 47 }, LESSON, NEXT).ok).toBe(false);
    expect(parse612Pages({ start: 43, end: 44 }, LESSON, NEXT).ok).toBe(false);
  });
  it('refuses a start outside the lesson, a reversed range, and non-numbers', () => {
    expect(parse612Pages({ start: 41, end: 45 }, LESSON, null).ok).toBe(false);
    expect(parse612Pages({ start: 46, end: 46 }, LESSON, null).ok).toBe(false);
    expect(parse612Pages({ start: 45, end: 43 }, LESSON, null).ok).toBe(false);
    expect(parse612Pages({ start: 'x', end: 43 }, LESSON, null).ok).toBe(false);
    expect(parse612Pages([42, 43], LESSON, null).ok).toBe(false);
    expect(parse612Pages({ start: 42, end: 43 }, null, null).ok).toBe(false);
  });
});

describe('the line and the book range', () => {
  it('a pages line names her range; none without one', () => {
    expect(pagesLine612({ start: 43, end: 44 })).toMatch(/Book pages: she will teach pages 43-44.*Teach exactly these pages/);
    expect(pagesLine612({ start: 43, end: 43 })).toMatch(/page 43 of the book/);
    expect(pagesLine612(null)).toBe('');
  });
  it('the book text is read for her pages when she set them, else the lesson\'s', () => {
    const seg = { printed_page_start: 42, printed_page_end: 45 };
    expect(bookRange({ pages: { start: 43, end: 44 } }, seg)).toEqual({ from: 43, to: 44 });
    expect(bookRange({}, seg)).toEqual({ from: 42, to: 45 });
    expect(bookRange(null, seg)).toEqual({ from: 42, to: 45 });
  });
  it('the 6–12 instruction carries the pages line only when she set pages', () => {
    const ctx = { segmentId: 'grade_8_science.c02.p042-045' };
    const a = parseOwnAnswers({ size: '51_70', resources: ['board'], level: 'mixed', way: 'worked', purpose: 'new' }, ctx).answers;
    expect(buildOwnInstruction({ ...a, pages: { start: 43, end: 44 } }, ctx)).toMatch(/she will teach pages 43-44/);
    expect(buildOwnInstruction(a, ctx)).not.toMatch(/Book pages:/);
  });
});

describe('requestOwn with 6–12 pages', () => {
  const SEG = 'grade_8_science.c02.p042-045';
  const NEXT_ID = 'grade_8_science.c02.p046-048';
  const ANSWERS = { size: '51_70', resources: ['board'], level: 'mixed', way: 'worked', purpose: 'new', note: '' };
  const rows = [
    { segment_id: SEG, book_stem: 'g8', chapter_key: 'c02', order_index: 1, printed_page_start: 42, printed_page_end: 45 },
    { segment_id: NEXT_ID, book_stem: 'g8', chapter_key: 'c02', order_index: 2, printed_page_start: 46, printed_page_end: 48 },
  ];
  function harness() {
    const inserts = [];
    const deps = {
      templateVersion: () => 'v9.1',
      segmentExists: jest.fn(async () => true),
      loadSegment: jest.fn(async (id) => rows.find((r) => r.segment_id === id) || null),
      chapterSegments: jest.fn(async () => rows),
      readStoredDoc: jest.fn(async () => ({ sections: {} })),
      requestParent: jest.fn(async () => ({ outcome: 'queued' })),
      insertOwn: jest.fn(async (row) => { inserts.push(row); return { id: 'own-1' }; }),
      patchOwn: jest.fn(async () => {}),
      queueJob: jest.fn(async () => {}),
      selectOwn: jest.fn(async () => null),
      listChain: jest.fn(async () => []),
      countToday: jest.fn(async () => 0),
      now: () => Date.now(),
      log: jest.fn(),
    };
    return { svc: createOwnService(deps), deps, inserts };
  }
  it('keeps her range inside the lesson on her answers', async () => {
    const { svc, inserts } = harness();
    const out = await svc.requestOwn({ userId: 'u1', segmentId: SEG, answers: { ...ANSWERS, pages: { start: 43, end: 44 } } });
    expect(out.outcome).toBe('queued');
    expect(inserts[0].answers.pages).toEqual({ start: 43, end: 44 });
  });
  it('through the next lesson with extend', async () => {
    const { svc, inserts } = harness();
    const out = await svc.requestOwn({ userId: 'u1', segmentId: SEG,
      answers: { ...ANSWERS, pages: { start: 44, end: 48 }, extend: { next: NEXT_ID, shape: 'double' } } });
    expect(out.outcome).toBe('queued');
    expect(inserts[0].answers).toMatchObject({ pages: { start: 44, end: 48 }, extend: { next: NEXT_ID, shape: 'double' } });
  });
  it('refuses pages outside the lesson, writing nothing', async () => {
    const { svc, deps } = harness();
    const out = await svc.requestOwn({ userId: 'u1', segmentId: SEG, answers: { ...ANSWERS, pages: { start: 44, end: 48 } } });
    expect(out.outcome).toBe('bad_request');
    expect(deps.insertOwn).not.toHaveBeenCalled();
  });
  it('the lesson\'s own pages, or none, store no pages', async () => {
    const { svc, inserts } = harness();
    await svc.requestOwn({ userId: 'u1', segmentId: SEG, answers: { ...ANSWERS, pages: { start: 42, end: 45 } } });
    await svc.requestOwn({ userId: 'u1', segmentId: SEG, answers: ANSWERS });
    expect(inserts[0].answers.pages).toBeUndefined();
    expect(inserts[1].answers.pages).toBeUndefined();
  });
});

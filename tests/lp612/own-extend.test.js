/**
 * bd-snkn32.14 — "Add the next lesson's pages" (Make my own, grades 6–12).
 *
 *   Given a lesson and the NEXT lesson in the SAME chapter
 *   When she asks to cover more in one period   both stored plans + both page ranges are rewritten into ONE period
 *   When she asks for a double period           ...into two periods' length
 *   But a lesson that is not the adjacent next one in the same chapter is refused before anything is written.
 *
 * Pure rules (lp612-own-extend) first, then the request (lp612-own.service) and the job (lp612-own.worker) with every
 * dependency injected, so the call chain the change sits on actually runs.
 */

jest.mock('../../bot/shared/config/supabase', () => ({ from: () => ({}) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const X = require('../../bot/shared/services/lp612-own-extend');
const { createOwnService } = require('../../bot/shared/services/lp612-own.service');
const { createOwnWorker } = require('../../bot/workers/lp612-own.worker');

const A = {
  segment_id: 'g8sci.c02.p010-013', book_stem: 'g8sci', chapter_key: 'c02', order_index: 4,
  printed_page_start: 10, printed_page_end: 13, pages_covered: [10, 11, 12, 13],
  subtopic_title: 'Cells', menu_title: 'Cells', slo_codes: ['S1'], slo_descriptions: ['know cells'],
  prev_segment_id: 'g8sci.c02.p008-009', next_segment_id: 'g8sci.c02.p014-015',
};
const B = {
  segment_id: 'g8sci.c02.p014-015', book_stem: 'g8sci', chapter_key: 'c02', order_index: 5,
  printed_page_start: 14, printed_page_end: 15, pages_covered: [],
  subtopic_title: 'Tissues', menu_title: 'Tissues', slo_codes: ['S1', 'S2'], slo_descriptions: ['know cells', 'know tissues'],
  prev_segment_id: A.segment_id, next_segment_id: 'g8sci.c03.p016-018',
};
const C3 = { ...B, segment_id: 'g8sci.c03.p016-018', chapter_key: 'c03', order_index: 6, printed_page_start: 16, printed_page_end: 18 };
const ANSWERS = { size: '51_70', resources: ['board'], level: 'behind', way: 'practical', note: '' }; // a Grade 8 lesson: a 6–12 way (bd-snkn32.13)

describe('parseExtend', () => {
  it('no extend is the ordinary plan', () => {
    expect(X.parseExtend(undefined)).toEqual({ ok: true, extend: null });
    expect(X.parseExtend(null)).toEqual({ ok: true, extend: null });
  });
  it('takes a next lesson id and one of the two shapes', () => {
    expect(X.parseExtend({ next: ` ${B.segment_id} `, shape: 'one_period' })).toEqual({ ok: true, extend: { next: B.segment_id, shape: 'one_period' } });
    expect(X.parseExtend({ next: B.segment_id, shape: 'double' }).ok).toBe(true);
  });
  it('refuses anything else', () => {
    expect(X.parseExtend({ next: B.segment_id, shape: 'triple' }).ok).toBe(false);
    expect(X.parseExtend({ shape: 'double' }).ok).toBe(false);
    expect(X.parseExtend({ next: 'x'.repeat(201), shape: 'double' }).ok).toBe(false);
    expect(X.parseExtend('double').ok).toBe(false);
  });
});

describe('nextInChapter', () => {
  it('is the next lesson by the book order, in the same book and chapter', () => {
    expect(X.nextInChapter(A, [C3, B, A]).segment_id).toBe(B.segment_id);
  });
  it('is nothing on the last lesson of a chapter', () => {
    expect(X.nextInChapter(B, [A, B, C3])).toBeNull();
  });
  it('skips a lesson that is two ahead: only the adjacent one', () => {
    const mid = { ...B, segment_id: 'mid', order_index: 4.5 };
    expect(X.nextInChapter(A, [A, B, mid]).segment_id).toBe('mid');
  });
});

describe('joinSegments', () => {
  it('spans both page ranges, keeps the first id, and sets the period length by shape', () => {
    const one = X.joinSegments(A, B, 'one_period');
    expect(one.segment_id).toBe(A.segment_id);
    expect(one.printed_page_start).toBe(10);
    expect(one.printed_page_end).toBe(15);
    expect(one.pages_covered).toEqual([10, 11, 12, 13, 14, 15]);
    expect(one.next_segment_id).toBe(B.next_segment_id);
    expect(one.prev_segment_id).toBe(A.prev_segment_id);
    expect(one.slo_codes).toEqual(['S1', 'S2']);
    expect(one.period_minutes).toBe(40);
    expect(X.joinSegments(A, B, 'double').period_minutes).toBe(80);
  });
});

describe('buildExtendInstruction', () => {
  it('names both page ranges, the shape and timing, and carries the next stored plan', () => {
    const t = X.buildExtendInstruction({ first: A, next: B, nextDoc: { sections: { warmup: 'TISSUE-PLAN' } }, shape: 'one_period' });
    expect(t).toMatch(/pages 10-13/);
    expect(t).toMatch(/pages 14-15/);
    expect(t).toMatch(/ONE period of 40 minutes/);
    expect(t).toContain('TISSUE-PLAN');
    const d = X.buildExtendInstruction({ first: A, next: B, nextDoc: {}, shape: 'double' });
    expect(d).toMatch(/TWO periods back to back, 80 minutes/);
  });
});

function svcHarness(over = {}) {
  const calls = { inserts: [], requested: [] };
  const deps = {
    templateVersion: () => 'v9.1',
    segmentExists: jest.fn(async () => true),
    countToday: jest.fn(async () => 0), // bd-snkn32.15: under the daily limit
    loadSegment: jest.fn(async (id) => [A, B, C3].find((s) => s.segment_id === id) || null),
    chapterSegments: jest.fn(async () => [A, B]),
    readStoredDoc: jest.fn(async () => ({ sections: {} })),
    requestParent: jest.fn(async (args) => { calls.requested.push(args); return { outcome: 'queued' }; }),
    insertOwn: jest.fn(async (row) => { calls.inserts.push(row); return { id: 'own-1' }; }),
    patchOwn: jest.fn(),
    queueJob: jest.fn(async () => {}),
    selectOwn: jest.fn(),
    log: jest.fn(),
    ...over,
  };
  return { svc: createOwnService(deps), deps, calls };
}

describe('requestOwn with the next lesson', () => {
  it('stores the next lesson and the shape on her answers', async () => {
    const { svc, calls } = svcHarness();
    const out = await svc.requestOwn({ userId: 'u1', segmentId: A.segment_id, answers: { ...ANSWERS, extend: { next: B.segment_id, shape: 'double' } } });
    expect(out.outcome).toBe('queued');
    expect(calls.inserts[0].answers.extend).toEqual({ next: B.segment_id, shape: 'double' });
  });

  it('asks for the next lesson\'s shared plan when it is not written yet', async () => {
    const { svc, calls } = svcHarness({ readStoredDoc: jest.fn(async ({ segmentId }) => (segmentId === A.segment_id ? {} : null)) });
    await svc.requestOwn({ userId: 'u1', segmentId: A.segment_id, answers: { ...ANSWERS, extend: { next: B.segment_id, shape: 'one_period' } } });
    expect(calls.requested.map((r) => r.segmentId)).toEqual([B.segment_id]);
  });

  it('refuses a lesson from another chapter, or not the adjacent next one, before writing anything', async () => {
    const { svc, deps } = svcHarness({ chapterSegments: jest.fn(async () => [A, B, C3]) });
    const far = await svc.requestOwn({ userId: 'u1', segmentId: A.segment_id, answers: { ...ANSWERS, extend: { next: C3.segment_id, shape: 'double' } } });
    expect(far.outcome).toBe('bad_request');
    const last = await svc.requestOwn({ userId: 'u1', segmentId: B.segment_id, answers: { ...ANSWERS, extend: { next: C3.segment_id, shape: 'double' } } });
    expect(last.outcome).toBe('bad_request');
    expect(deps.insertOwn).not.toHaveBeenCalled();
  });

  it('refuses a bad shape, and a grades 1–5 day with an extend', async () => {
    const { svc, deps } = svcHarness();
    expect((await svc.requestOwn({ userId: 'u1', segmentId: A.segment_id, answers: { ...ANSWERS, extend: { next: B.segment_id, shape: 'x' } } })).outcome).toBe('bad_request');
    expect((await svc.requestOwn({ userId: 'u1', lessonId: 'k5-1', answers: { ...ANSWERS, extend: { next: B.segment_id, shape: 'double' } } })).outcome).toBe('bad_request');
    expect(deps.insertOwn).not.toHaveBeenCalled();
  });
});

describe('the job joins both plans', () => {
  const ROW = {
    id: 'own-1', user_id: 'u1', segment_id: A.segment_id, lang: 'en', template_version: 'v9.1', status: 'authoring',
    answers: { ...ANSWERS, resources: ['textbook'], extend: { next: B.segment_id, shape: 'one_period' } },
  };
  function wHarness(over = {}) {
    const patches = [];
    const deps = {
      claimOwn: jest.fn(async () => ({ ...ROW })),
      loadSegment: jest.fn(async (id) => [A, B, C3].find((s) => s.segment_id === id) || null),
      chapterSegments: jest.fn(async () => [A, B, C3]),
      readStoredDoc: jest.fn(async ({ segmentId }) => ({ sections: { warmup: `DOC-${segmentId}` } })),
      revise: jest.fn(async () => ({ accepted: true, lpDoc: { sections: {} }, model: 'm1' })),
      render: jest.fn(async () => ({ pdfPath: '/tmp/x.pdf' })),
      readFile: jest.fn(async () => Buffer.from('%PDF')),
      upload: jest.fn(async () => {}),
      patchOwn: jest.fn(async (id, f) => { patches.push(f); }),
      sleep: jest.fn(async () => {}),
      now: (() => { let t = 0; return () => (t += 1000); })(),
      parentWaitMs: 10_000,
      log: jest.fn(),
      ...over,
    };
    return { worker: createOwnWorker(deps), deps, patches };
  }

  it('rewrites from the first plan with the joined pages, the next plan and the shape in the instruction', async () => {
    const { worker, deps, patches } = wHarness();
    await worker.process({ ownId: 'own-1' });
    const args = deps.revise.mock.calls[0][0];
    expect(args.doc.sections.warmup).toBe(`DOC-${A.segment_id}`);
    expect(args.segment.printed_page_end).toBe(15);
    expect(args.segment.period_minutes).toBe(40);
    expect(args.instruction).toContain(`DOC-${B.segment_id}`);
    expect(args.instruction).toMatch(/ONE period of 40 minutes/);
    expect(patches[patches.length - 1].status).toBe('ready');
  });

  it('a next lesson that is no longer the adjacent one fails her row with a reason, and nothing is rewritten', async () => {
    const { worker, deps, patches } = wHarness({ chapterSegments: jest.fn(async () => [A, { ...B, order_index: 9 }, { ...C3, chapter_key: 'c02', order_index: 5 }]) });
    await worker.process({ ownId: 'own-1' });
    expect(deps.revise).not.toHaveBeenCalled();
    expect(patches[patches.length - 1]).toEqual(expect.objectContaining({ status: 'failed', error_code: 'BAD_EXTEND' }));
  });
});

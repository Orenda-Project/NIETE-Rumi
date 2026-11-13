'use strict';
/**
 * bd-snkn32.19 — the "Make my own" worker (unified spec items 12 and 13):
 *   - her book's page text feeds the rewrite, 1–5 and 6–12 (a make; a change starts from her own plan);
 *   - a 6–12 rewrite that loses or empties I do, We do or You do is refused, never stored: the gradual release stays.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: () => ({}) }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({}));
jest.mock('../../bot/shared/services/lp-shelf.service', () => ({ pushToShelf: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { createOwnWorker } = require('../../bot/workers/lp612-own.worker');
const BASE = require('./__fixtures__/v9_gate_base.lp.json');

const ROW = {
  id: 'own-1', user_id: 'u1', segment_id: 'grade_8_science.c02.p010-013', lang: 'en', template_version: 'v9.1',
  status: 'authoring', answers: { size: '51_70', resources: ['board'], level: 'mixed', way: 'worked', note: '' },
};
const SEGMENT = { segment_id: ROW.segment_id, grade: 8, subject: 'General Science', curriculum: 'ict', book_stem: 'g8sci', printed_page_start: 10, printed_page_end: 13 };
const DAY = {
  script: { goal: 'Count', meta: { day: 3 }, hook: { say: 'h' }, iDo: { steps: ['a'] }, weDo: { say: 'w' }, youDo: { say: 'y' }, wrap: { say: 'z' } },
  lang: 'en', grade: 3, subject: 'math', subjectName: 'Maths', pages: { start: 24, end: 25 },
};
const clone = (o) => JSON.parse(JSON.stringify(o));
/** The base plan with one phase block taken out. */
function without(id) {
  const doc = clone(BASE);
  for (const s of doc.sections) s.blocks = (s.blocks || []).filter((b) => b.id !== id);
  return doc;
}

function harness(over = {}) {
  const patches = [];
  const puts = [];
  const deps = {
    claimOwn: jest.fn(async () => ({ ...ROW })),
    loadSegment: jest.fn(async () => ({ ...SEGMENT })),
    readStoredDoc: jest.fn(async () => clone(BASE)),
    revise: jest.fn(async () => ({ accepted: true, lpDoc: clone(BASE), model: 'm1' })),
    render: jest.fn(async () => ({ pdfPath: '/tmp/x.pdf' })),
    readFile: jest.fn(async () => Buffer.from('%PDF')),
    upload: jest.fn(async (buf, key) => { puts.push(key); }),
    patchOwn: jest.fn(async (id, fields) => { patches.push(fields); }),
    loadK5: jest.fn(async () => clone(DAY)),
    rewriteK5: jest.fn(async () => ({ script: DAY.script, model: 'm2' })),
    renderK5: jest.fn(async () => Buffer.from('%PDF')),
    bookText: jest.fn(async () => '=== Page 10 ===\nPressure is force per area.'),
    sleep: jest.fn(async () => {}),
    now: (() => { let t = 0; return () => (t += 1000); })(),
    parentWaitMs: 10_000,
    log: jest.fn(),
    ...over,
  };
  return { worker: createOwnWorker(deps), deps, patches, puts };
}

describe('her book feeds the rewrite (item 13)', () => {
  it('a 6–12 make: the segment\'s pages are read and their text is in the instruction', async () => {
    const { worker, deps } = harness();
    await worker.process({ ownId: 'own-1' });
    expect(deps.bookText).toHaveBeenCalledWith({ grade: 8, subject: 'General Science', from: 10, to: 13, curriculum: 'ict' });
    expect(deps.revise.mock.calls[0][0].instruction).toMatch(/From her book[\s\S]*Pressure is force per area\./);
  });
  it('a 6–12 make with her own pages (item 14): those pages are read and named in the instruction', async () => {
    const row = { ...ROW, answers: { ...ROW.answers, pages: { start: 11, end: 12 } } };
    const { worker, deps } = harness({ claimOwn: jest.fn(async () => row) });
    await worker.process({ ownId: 'own-1' });
    expect(deps.bookText).toHaveBeenCalledWith({ grade: 8, subject: 'General Science', from: 11, to: 12, curriculum: 'ict' });
    expect(deps.revise.mock.calls[0][0].instruction).toMatch(/she will teach pages 11-12/);
  });
  it('no text (book not imported): the instruction has no book line and the plan is still made', async () => {
    const { worker, deps, patches } = harness({ bookText: jest.fn(async () => null) });
    await worker.process({ ownId: 'own-1' });
    expect(deps.revise.mock.calls[0][0].instruction).not.toMatch(/From her book/);
    expect(patches[patches.length - 1].status).toBe('ready');
  });
  it('a book read that throws never fails her plan', async () => {
    const { worker, deps, patches } = harness({ bookText: jest.fn(async () => { throw new Error('db down'); }) });
    await worker.process({ ownId: 'own-1' });
    expect(deps.revise.mock.calls[0][0].instruction).not.toMatch(/From her book/);
    expect(patches[patches.length - 1].status).toBe('ready');
  });
  it('a 1–5 day: her own range, else the day\'s pages, goes to the rewrite as text', async () => {
    const k5Row = { ...ROW, segment_id: null, lesson_id: 'g3_maths_d4', answers: { ...ROW.answers, way: 'tarl', pages: { start: 26, end: 27 } } };
    const { worker, deps } = harness({ claimOwn: jest.fn(async () => k5Row) });
    await worker.process({ ownId: 'own-1' });
    expect(deps.bookText).toHaveBeenCalledWith({ grade: 3, subject: 'math', from: 26, to: 27 });
    expect(deps.rewriteK5.mock.calls[0][0].bookText).toBe('=== Page 10 ===\nPressure is force per area.');

    const plain = harness({ claimOwn: jest.fn(async () => ({ ...k5Row, answers: { ...k5Row.answers, pages: undefined } })) });
    await plain.worker.process({ ownId: 'own-1' });
    expect(plain.deps.bookText).toHaveBeenCalledWith({ grade: 3, subject: 'math', from: 24, to: 25 });
  });
  it('no book reader wired (older deploy shape): nothing is read, nothing breaks', async () => {
    const { worker, deps, patches } = harness({ bookText: undefined });
    await worker.process({ ownId: 'own-1' });
    expect(deps.revise.mock.calls[0][0].instruction).not.toMatch(/From her book/);
    expect(patches[patches.length - 1].status).toBe('ready');
  });
});

describe('the gradual release stays (item 12)', () => {
  it.each([['ido', 'I do'], ['wedo', 'We do'], ['youdo', 'You do']])('a rewrite without %s is refused and not stored', async (id, name) => {
    const { worker, patches, puts, deps } = harness({ revise: jest.fn(async () => ({ accepted: true, lpDoc: without(id), model: 'm1' })) });
    await worker.process({ ownId: 'own-1' });
    expect(deps.render).not.toHaveBeenCalled();
    expect(puts).toEqual([]);
    const last = patches[patches.length - 1];
    expect(last.status).toBe('failed');
    expect(last.error_code).toBe('GRR_DROPPED');
    expect(last.error_detail).toContain(name);
  });
  it('a rewrite that keeps all three is stored', async () => {
    const { worker, patches } = harness();
    await worker.process({ ownId: 'own-1' });
    expect(patches[patches.length - 1].status).toBe('ready');
  });
});

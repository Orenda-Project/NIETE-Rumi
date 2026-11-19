'use strict';
/**
 * bd-snkn32.56 — the job for a goal start: the closest lesson's plan is still the base (its pages ground the facts), but
 * her class has no book, so no book text is read for the class and the instruction carries her goal.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: () => ({}) }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({}));
jest.mock('../../bot/shared/services/lp-shelf.service', () => ({ pushToShelf: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { createOwnWorker } = require('../../bot/workers/lp612-own.worker');
const BASE = require('./__fixtures__/v9_gate_base.lp.json');

const ROW = {
  id: 'own-1', user_id: 'u1', segment_id: 'grade_8_science.c02.p010-013', lang: 'en', template_version: 'v9.1', status: 'authoring',
  answers: { size: '51_70', resources: ['board'], level: 'mixed', way: 'worked', note: '', goal: { kind: 'topic', text: 'Air pressure around us' } },
};
const SEGMENT = { segment_id: ROW.segment_id, grade: 8, subject: 'General Science', curriculum: 'ict', book_stem: 'g8sci', printed_page_start: 10, printed_page_end: 13 };
const clone = (o) => JSON.parse(JSON.stringify(o));

function harness() {
  const patches = [];
  const deps = {
    claimOwn: jest.fn(async () => clone(ROW)),
    loadSegment: jest.fn(async () => ({ ...SEGMENT })),
    readStoredDoc: jest.fn(async () => clone(BASE)),
    revise: jest.fn(async () => ({ accepted: true, lpDoc: clone(BASE), model: 'm1' })),
    render: jest.fn(async () => ({ pdfPath: '/tmp/x.pdf' })),
    readFile: jest.fn(async () => Buffer.from('%PDF')),
    upload: jest.fn(async () => {}),
    patchOwn: jest.fn(async (id, fields) => { patches.push(fields); }),
    bookText: jest.fn(async () => 'BOOK PAGE TEXT'),
    sleep: jest.fn(async () => {}),
    now: (() => { let t = 0; return () => (t += 1000); })(),
    log: jest.fn(),
  };
  return { worker: createOwnWorker(deps), deps, patches };
}

it('writes over the closest lesson, with her goal and no book text for the class', async () => {
  const { worker, deps, patches } = harness();
  await worker.process({ ownId: 'own-1' });
  expect(deps.readStoredDoc).toHaveBeenCalled();
  expect(deps.bookText).not.toHaveBeenCalled();
  const { instruction } = deps.revise.mock.calls[0][0];
  expect(instruction).toContain('"Air pressure around us"');
  expect(instruction).toMatch(/NO TEXTBOOK/);
  expect(instruction).not.toContain('BOOK PAGE TEXT');
  expect(patches.at(-1).status).toBe('ready');
});

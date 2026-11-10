'use strict';
/**
 * bd-snkn32.16 — the own-plan job hands a READY row to the AI reviewer, after her row is ready (so she never waits
 * for it), on both lanes (6-12 fork, grades 1-5 day). A failed row is never reviewed, and a reviewer that throws
 * changes nothing about her plan.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: () => ({}) }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({}));
jest.mock('../../bot/shared/services/lp-shelf.service', () => ({ pushToShelf: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { createOwnWorker } = require('../../bot/workers/lp612-own.worker');

const ROW = {
  id: 'own-1', user_id: 'u1', segment_id: 'grade_8_science.c02.p010-013', lang: 'en', template_version: 'v9.1',
  status: 'authoring', answers: { size: '51_70', resources: ['textbook'], level: 'mixed', way: 'tarl', note: '' },
};
const DAY = { hook: { say: 'a' }, iDo: { steps: ['b'] }, weDo: { say: 'c' }, youDo: { say: 'd' }, wrap: { say: 'e' } };

function harness(over = {}) {
  const order = [];
  const deps = {
    claimOwn: jest.fn(async () => ({ ...ROW })),
    loadSegment: jest.fn(async () => ({ segment_id: ROW.segment_id })),
    readStoredDoc: jest.fn(async () => ({ sections: {} })),
    revise: jest.fn(async () => ({ accepted: true, lpDoc: { sections: { warmup: 'mine' } }, model: 'm1' })),
    render: jest.fn(async () => ({ pdfPath: '/tmp/x.pdf' })),
    readFile: jest.fn(async () => Buffer.from('%PDF')),
    upload: jest.fn(async () => {}),
    patchOwn: jest.fn(async (id, f) => { order.push(`patch:${f.status}`); }),
    review: jest.fn(async () => { order.push('review'); }),
    loadK5: jest.fn(async () => ({ script: DAY, lang: 'ur', grade: 3, subject: 'urdu', subjectName: 'Urdu' })),
    rewriteK5: jest.fn(async () => ({ script: DAY, model: 'm2' })),
    renderK5: jest.fn(async () => Buffer.from('%PDF')),
    sleep: jest.fn(async () => {}),
    now: () => 0,
    log: jest.fn(),
    ...over,
  };
  return { worker: createOwnWorker(deps), deps, order };
}

test('a ready 6-12 fork is reviewed, after her row is ready', async () => {
  const { worker, deps, order } = harness();
  await worker.process({ ownId: 'own-1', correlationId: 'c1' });
  expect(deps.review).toHaveBeenCalledWith('own-1', 'c1');
  expect(order).toEqual(['patch:ready', 'review']);
});

test('a ready grades 1-5 day is reviewed too', async () => {
  const { worker, deps, order } = harness({
    claimOwn: jest.fn(async () => ({ ...ROW, segment_id: null, lesson_id: 'grade_3_urdu_ch1_seg2' })),
  });
  await worker.process({ ownId: 'own-1' });
  expect(deps.review).toHaveBeenCalledWith('own-1', null);
  expect(order).toEqual(['patch:ready', 'review']);
});

test('a failed row is never reviewed', async () => {
  const { worker, deps } = harness({ revise: jest.fn(async () => ({ accepted: false })) });
  await worker.process({ ownId: 'own-1' });
  expect(deps.review).not.toHaveBeenCalled();
});

test('a reviewer that throws leaves her plan ready and the job settled', async () => {
  const { worker, deps, order } = harness({ review: jest.fn(async () => { throw new Error('boom'); }) });
  await expect(worker.process({ ownId: 'own-1' })).resolves.toBeUndefined();
  expect(order).toEqual(['patch:ready']);
  expect(deps.patchOwn).toHaveBeenCalledTimes(1);
});

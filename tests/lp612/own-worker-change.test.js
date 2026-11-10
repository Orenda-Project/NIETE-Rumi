'use strict';
/**
 * bd-snkn32.15 — the job for a CHANGE row (lp612-own.worker): it starts from her latest READY plan in the chain (its
 * stored document beside the PDF), never the shared plan and never her class answers, and applies her one change.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: () => ({}) }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({}));
jest.mock('../../bot/shared/services/lp-shelf.service', () => ({ pushToShelf: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { createOwnWorker } = require('../../bot/workers/lp612-own.worker');

const ANSWERS = { size: '51_70', resources: ['textbook'], level: 'mixed', way: 'tarl', note: '' };
const SEG = 'grade_8_science.c02.p010-013';
const ROOT = { id: 'root', user_id: 'u1', segment_id: SEG, status: 'ready', parent_own_id: null, r2_key: `lp612/v9.1/en/edits/${SEG}/aaa.pdf` };
const R1 = { id: 'r1', user_id: 'u1', segment_id: SEG, status: 'ready', parent_own_id: 'root', edit_round: 1, r2_key: `lp612/v9.1/en/edits/${SEG}/bbb.pdf` };
const ROW = {
  id: 'r2', user_id: 'u1', segment_id: SEG, lang: 'en', template_version: 'v9.1', status: 'authoring', answers: ANSWERS,
  parent_own_id: 'root', edit_round: 2, edit_request: { part: 'activity', text: 'Use a role play with four groups' },
};
const DOCS = { [`lp612/v9.1/en/edits/${SEG}/aaa.lp.json`]: { v: 'root' }, [`lp612/v9.1/en/edits/${SEG}/bbb.lp.json`]: { v: 'r1' } };

function harness(over = {}) {
  const puts = [];
  const patches = [];
  const deps = {
    claimOwn: jest.fn(async () => ({ ...ROW })),
    listChain: jest.fn(async () => [ROOT, R1, { ...ROW }]),
    readJson: jest.fn(async (key) => DOCS[key] || null),
    loadSegment: jest.fn(async () => ({ segment_id: SEG })),
    readStoredDoc: jest.fn(async () => ({ v: 'shared' })),
    revise: jest.fn(async () => ({ accepted: true, lpDoc: { v: 'r2' }, model: 'm1' })),
    render: jest.fn(async () => ({ pdfPath: '/tmp/x.pdf' })),
    readFile: jest.fn(async () => Buffer.from('%PDF')),
    upload: jest.fn(async (buf, key, type) => { puts.push({ key, type }); }),
    patchOwn: jest.fn(async (id, f) => { patches.push(f); }),
    sleep: jest.fn(async () => {}), now: () => 0, log: jest.fn(),
    ...over,
  };
  return { worker: createOwnWorker(deps), deps, puts, patches };
}

test('6–12: her change is applied to her latest ready plan, not the shared one, stored as a new fork', async () => {
  const { worker, deps, puts, patches } = harness();
  await worker.process({ ownId: 'r2', correlationId: 'c1' });
  expect(deps.listChain).toHaveBeenCalledWith('root', 'u1');
  expect(deps.readStoredDoc).not.toHaveBeenCalled();
  const args = deps.revise.mock.calls[0][0];
  expect(args.doc).toEqual({ v: 'r1' });
  expect(args.instruction).toMatch(/only the Activity section/);
  expect(args.instruction).toMatch(/role play with four groups/);
  expect(args.instruction).not.toMatch(/51 to 70/);
  expect(puts[0].key).toMatch(new RegExp(`^lp612/v9.1/en/edits/${SEG}/[0-9a-f]+\\.pdf$`));
  expect(puts[0].key).not.toBe(R1.r2_key);
  expect(patches[patches.length - 1]).toMatchObject({ status: 'ready', r2_key: puts[0].key });
});

test('the round itself (still being written) is never its own starting point; a failed round is skipped', async () => {
  const { worker, deps } = harness({ listChain: jest.fn(async () => [ROOT, { ...R1, status: 'failed' }, { ...ROW, status: 'ready' }]) });
  await worker.process({ ownId: 'r2' });
  expect(deps.revise.mock.calls[0][0].doc).toEqual({ v: 'root' });
});

test('no ready plan to start from, or its document is gone: the round fails, nothing paid for', async () => {
  for (const over of [{ listChain: jest.fn(async () => [{ ...ROW }]) }, { readJson: jest.fn(async () => null) }]) {
    const { worker, deps, patches } = harness(over);
    await worker.process({ ownId: 'r2' });
    expect(deps.revise).not.toHaveBeenCalled();
    expect(patches[patches.length - 1]).toMatchObject({ status: 'failed', error_code: 'NO_PARENT' });
  }
});

test('grades 1–5: the latest ready script is rewritten with her one change, keeping the day\'s meta', async () => {
  const LESSON = 'grade_3_urdu_ch1_seg2';
  const k5 = (r) => ({ ...r, segment_id: null, lesson_id: LESSON, r2_key: r.r2_key && `lp612/own-k5/ur/${LESSON}/${r.id}.pdf` });
  const SCRIPT = { goal: 'g', hook: { story: 'h' }, iDo: { steps: [{ say: 'a' }] }, weDo: { action: 'r1' }, youDo: { action: 'y' }, wrap: { homework: ['hw'] } };
  const rewriteK5 = jest.fn(async () => ({ script: { ...SCRIPT, weDo: { action: 'r2' } }, model: 'm-k5' }));
  const { worker, puts, patches } = harness({
    claimOwn: jest.fn(async () => ({ ...k5(ROW), lang: 'ur', edit_request: { part: 'we_do', text: 'کنکروں سے گنتی کروائیں جوڑوں میں' } })),
    listChain: jest.fn(async () => [k5(ROOT), k5(R1), k5(ROW)]),
    readJson: jest.fn(async (key) => (key === `lp612/own-k5/ur/${LESSON}/r1.json` ? SCRIPT : null)),
    loadK5: jest.fn(async () => ({ script: { stale: true }, lang: 'ur', grade: 3, subject: 'urdu', subjectName: 'اردو' })),
    rewriteK5,
    renderK5: jest.fn(async () => Buffer.from('%PDF-k5')),
  });
  await worker.process({ ownId: 'r2' });
  expect(rewriteK5).toHaveBeenCalledWith(expect.objectContaining({
    script: SCRIPT, edit: { part: 'we_do', text: 'کنکروں سے گنتی کروائیں جوڑوں میں' }, lang: 'ur', grade: 3,
  }));
  expect(puts[0].key).toMatch(new RegExp(`^lp612/own-k5/ur/${LESSON}/[0-9a-f]{16}\\.pdf$`));
  expect(patches[patches.length - 1]).toMatchObject({ status: 'ready' });
});

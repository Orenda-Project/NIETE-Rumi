/**
 * bd-snkn32 — the "Make my own" job (lp612-own.worker): shared document → her instruction → reviseLessonPlan →
 * render → her fork under lp612/…/edits/ → her row ready. Every dependency injected (createOwnWorker).
 *
 * The rules pinned here, most expensive first:
 *   - the shared document and its key are NEVER written: only the edits/ key is put;
 *   - a rewrite the gates reject is a failed fork, never a PDF of the rejected document;
 *   - a row already done (a redelivered message) costs nothing.
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
const PARENT = { sections: { warmup: 'x' } };

function harness(over = {}) {
  const puts = [];
  const patches = [];
  const deps = {
    claimOwn: jest.fn(async () => ({ ...ROW })),
    loadSegment: jest.fn(async () => ({ segment_id: ROW.segment_id, book_stem: 'g8sci' })),
    readStoredDoc: jest.fn(async () => PARENT),
    revise: jest.fn(async () => ({ accepted: true, lpDoc: { sections: { warmup: 'mine' } }, model: 'm1' })),
    render: jest.fn(async () => ({ pdfPath: '/tmp/x.pdf' })),
    readFile: jest.fn(async () => Buffer.from('%PDF')),
    upload: jest.fn(async (buf, key, type) => { puts.push({ key, type }); }),
    patchOwn: jest.fn(async (id, fields) => { patches.push(fields); }),
    sleep: jest.fn(async () => {}),
    now: (() => { let t = 0; return () => (t += 1000); })(),
    parentWaitMs: 10_000,
    log: jest.fn(),
    ...over,
  };
  return { worker: createOwnWorker(deps), deps, puts, patches };
}

test('a row it cannot claim (gone, or already done) costs nothing', async () => {
  const { worker, deps } = harness({ claimOwn: jest.fn(async () => null) });
  await worker.process({ ownId: 'own-1' });
  expect(deps.revise).not.toHaveBeenCalled();
  expect(deps.upload).not.toHaveBeenCalled();
});

test('her answers become the instruction, applied to the shared English document', async () => {
  const { worker, deps } = harness();
  await worker.process({ ownId: 'own-1', correlationId: 'c1' });
  const args = deps.revise.mock.calls[0][0];
  expect(args.doc).toBe(PARENT);
  expect(args.lang).toBe('en');
  expect(args.segment.book_stem).toBe('g8sci');
  expect(args.instruction).toMatch(/51 to 70 children/);
  expect(args.instruction).toMatch(/Teach at the right level/);
  expect(deps.readStoredDoc).toHaveBeenCalledWith(expect.objectContaining({
    segmentId: ROW.segment_id, lang: 'en', tv: 'v9.1',
  }));
});

test('bd-snkn32.13: a 6–12 row gets its band\'s way and its purpose in the instruction', async () => {
  const answers = { ...ROW.answers, way: 'worked', purpose: 'reteach' };
  const { worker, deps } = harness({
    claimOwn: jest.fn(async () => ({ ...ROW, answers })),
    loadSegment: jest.fn(async () => ({ segment_id: ROW.segment_id, grade: 8, book_stem: 'g8sci' })),
  });
  await worker.process({ ownId: 'own-1' });
  const { instruction } = deps.revise.mock.calls[0][0];
  expect(instruction).toMatch(/Teaching way: Worked examples/);
  expect(instruction).toMatch(/did not understand/);
  expect(instruction).toMatch(/may reorder or replace activities/);
});

test('the fork is stored ONLY under the edits/ path, PDF and its document, and her row is ready', async () => {
  const { worker, puts, patches } = harness();
  await worker.process({ ownId: 'own-1' });
  expect(puts.map((p) => p.key)).toEqual([
    expect.stringMatching(/^lp612\/v9\.1\/en\/edits\/grade_8_science\.c02\.p010-013\/[0-9a-f]{16}\.pdf$/),
    expect.stringMatching(/^lp612\/v9\.1\/en\/edits\/grade_8_science\.c02\.p010-013\/[0-9a-f]{16}\.lp\.json$/),
  ]);
  const last = patches[patches.length - 1];
  expect(last).toEqual(expect.objectContaining({ status: 'ready', r2_key: puts[0].key, model_used: 'm1' }));
  expect(last.edit_hash).toMatch(/^[0-9a-f]{16}$/);
});

test('a rewrite the gates reject is a failed fork, and nothing is stored', async () => {
  const { worker, deps, patches } = harness({ revise: jest.fn(async () => ({ accepted: false, lpDoc: PARENT })) });
  await worker.process({ ownId: 'own-1' });
  expect(deps.render).not.toHaveBeenCalled();
  expect(deps.upload).not.toHaveBeenCalled();
  expect(patches[patches.length - 1]).toEqual(expect.objectContaining({ status: 'failed', error_code: 'NOT_ACCEPTED' }));
});

test('it waits for the shared document while it is being written, then goes on', async () => {
  const reads = [null, null, PARENT];
  const { worker, deps } = harness({ readStoredDoc: jest.fn(async () => reads.shift()) });
  await worker.process({ ownId: 'own-1' });
  expect(deps.sleep).toHaveBeenCalledTimes(2);
  expect(deps.revise).toHaveBeenCalled();
});

test('a shared document that never comes is a failed fork, not a hang', async () => {
  const { worker, deps, patches } = harness({ readStoredDoc: jest.fn(async () => null) });
  await worker.process({ ownId: 'own-1' });
  expect(deps.revise).not.toHaveBeenCalled();
  expect(patches[patches.length - 1]).toEqual(expect.objectContaining({ status: 'failed', error_code: 'NO_PARENT' }));
});

test('a missing segment fails the fork', async () => {
  const { worker, patches } = harness({ loadSegment: jest.fn(async () => null) });
  await worker.process({ ownId: 'own-1' });
  expect(patches[patches.length - 1]).toEqual(expect.objectContaining({ status: 'failed', error_code: 'NO_SEGMENT' }));
});

test('a long-only render is still her plan (a lesson is never lost for being long)', async () => {
  const err = Object.assign(new Error('render'), { infra: false, problems: ['PAGE COUNT: teach needs 6'], pdfPath: '/tmp/x.pdf' });
  const { worker, patches } = harness({ render: jest.fn(async () => { throw err; }) });
  await worker.process({ ownId: 'own-1' });
  expect(patches[patches.length - 1].status).toBe('ready');
});

test('a broken render (overflow, or the renderer crashed) fails the fork', async () => {
  for (const err of [
    Object.assign(new Error('r'), { infra: false, problems: ['OVERFLOW: clipped'], pdfPath: '/tmp/x.pdf' }),
    Object.assign(new Error('r'), { infra: true, problems: ['chromium'] }),
  ]) {
    const { worker, deps, patches } = harness({ render: jest.fn(async () => { throw err; }) });
    await worker.process({ ownId: 'own-1' });
    expect(deps.upload).not.toHaveBeenCalled();
    expect(patches[patches.length - 1]).toEqual(expect.objectContaining({ status: 'failed', error_code: 'RENDER_FAILED' }));
  }
});

test('anything that throws is a failed fork with the reason, never an unhandled job', async () => {
  const { worker, patches } = harness({ revise: jest.fn(async () => { throw Object.assign(new Error('llm'), { code: 'LLM_DOWN' }); }) });
  await expect(worker.process({ ownId: 'own-1' })).resolves.toBeUndefined();
  expect(patches[patches.length - 1]).toEqual(expect.objectContaining({ status: 'failed', error_code: 'LLM_DOWN' }));
});

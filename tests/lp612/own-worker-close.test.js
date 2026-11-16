/**
 * bd-snkn32.48 — the "Make my own" job adds "Before they write" to her accepted 6–12 plan before it is printed and
 * stored, and a Science lesson's instruction asks for Urdu key-word names.
 */

jest.mock('../../bot/shared/config/supabase', () => ({ from: () => ({}) }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({}));
jest.mock('../../bot/shared/services/lp-shelf.service', () => ({ pushToShelf: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { createOwnWorker } = require('../../bot/workers/lp612-own.worker');
const { SCIENCE_GLOSS_LINE } = require('../../bot/shared/services/lp612-own-gloss');

const SEG = 'grade_9_physics.c02.p037-038';
const ROW = {
  id: 'own-1', user_id: 'u1', segment_id: SEG, lang: 'en', template_version: 'v9.1', status: 'authoring',
  answers: { size: '51_70', resources: ['textbook'], level: 'mixed', way: 'worked', note: '' },
};
const ACCEPTED = {
  objectives: { items: [{ text: 'You can name a motion.' }] },
  sections: [{ id: 'conclusion', exit_ticket: [], blocks: [{ type: 'keywords', items: [{ word: 'axis', meaning: 'a line' }] }] }],
};

function harness() {
  const docs = [];
  const deps = {
    claimOwn: jest.fn(async () => ({ ...ROW })),
    loadSegment: jest.fn(async () => ({ segment_id: SEG, grade: 9, subject: 'Physics', book_stem: 'grade_9_physics' })),
    readStoredDoc: jest.fn(async () => ({ sections: [] })),
    revise: jest.fn(async () => ({ accepted: true, lpDoc: ACCEPTED, model: 'm1' })),
    render: jest.fn(async () => ({ pdfPath: '/tmp/x.pdf' })),
    readFile: jest.fn(async () => Buffer.from('%PDF')),
    upload: jest.fn(async (buf, key) => { if (key.endsWith('.lp.json')) docs.push(JSON.parse(buf.toString('utf8'))); }),
    patchOwn: jest.fn(async () => {}),
    sleep: jest.fn(async () => {}),
    now: (() => { let t = 0; return () => (t += 1000); })(),
    log: jest.fn(),
  };
  return { worker: createOwnWorker(deps), deps, docs };
}

test('the printed and stored plan both carry the close step; the accepted one is not changed', async () => {
  const { worker, deps, docs } = harness();
  await worker.process({ ownId: 'own-1' });
  const printed = deps.render.mock.calls[0][0].lpDoc.sections[0].blocks;
  expect(printed.map((b) => b.title || b.type)).toEqual(['keywords', 'Before they write']);
  expect(docs[0].sections[0].blocks[1].items[0]).toBe('Read the success criteria aloud: You can name a motion.');
  expect(ACCEPTED.sections[0].blocks).toHaveLength(1);
});

test('a Science lesson is asked for Urdu key-word names, and a key word left without one is counted', async () => {
  const { worker, deps } = harness();
  await worker.process({ ownId: 'own-1' });
  expect(deps.revise.mock.calls[0][0].instruction).toContain(SCIENCE_GLOSS_LINE);
  expect(deps.log).toHaveBeenCalledWith('LP 6-12 own: Science key words without Urdu', expect.objectContaining({ missing: 1 }));
});

/**
 * v34 g1-urdu and g2-urdu came back ORAL_SHORT on the poem task (bd-5jmnfj.4.58.6.1): the v29 Urdu oral checks
 * (fde-early-urdu-oral) were folded into `missing`, so a poem whose model answers opened «نظم میں» was asked once
 * more, came back the same, and the writer threw before urduOralFixes could strip the opening. A task the model
 * filled is never missing: it is flagged, asked again once with a note, and what stays flagged is logged and mended.
 * One wrong item is better than no paper for the teacher.
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');
const Prompt = require('../../bot/shared/services/assessment/fde-early-prompt');
const { run } = require('./helpers/early-writer-harness');

const P = Patterns.subjectOf('fde_g1_2026', 'urdu');
const ASKS = ['نظم میں کس کو بنایا گیا؟', 'پھول کس نے بنائے؟', 'چاند کس نے بنایا؟', 'ہم کس کا شکر ادا کرتے ہیں؟', 'نظم کا عنوان کیا ہے؟'];
const STEM = ASKS.map((ask) => ({ ask, answer: 'نظم میں سب کو میرے خدا نے بنایا' })); // every model answer opens «نظم میں»
// v37 (round 6): two poem answers may not be the same (urduOralBad repeats-answer), so the third differs, and no ask prints another's answer (the first ask no longer names خدا).
const CLEAN = ASKS.map((ask, i) => ({ ask, answer: ['سب کو', 'ستارا ہی', 'بناتا ہے', 'ستارا کا', 'میرا ستارا'][i] })); // round 4: the poem is never religious, so no خدا in the fixture
const TASKS = ['read_words', 'likes', 'mother', 'poem', 'project'];

/** A G1 Urdu oral reply with every task filled; the poem's items are the test's. `drop` leaves a task out. */
const tree = (poem, drop = []) => ({
  oral: P.oral.tasks.filter((t) => !drop.includes(t.id)).map((t) => ({
    id: t.id, script: 'میرا ستارا سب کو بناتا ہے۔ ستارا ہی ستارا کا',
    items: t.id === 'poem' ? poem : Array.from({ length: t.n }, (_, i) => ({ ask: `ask ${i + 1}`, answer: 'yes' })),
  })),
});
const poemOf = (out) => out.examJson._layout.oral.content.find((c) => c.id === 'poem');

describe('oralContent: a present task with its Urdu wording off is flagged, not missing', () => {
  test('v34 G1 Urdu poem: every model answer opens «نظم میں»', () => {
    const r = Prompt.oralContent(tree(STEM), P.oral, { saidCheck: false });
    expect(r.missing).toEqual([]);
    expect(r.flagged).toEqual(['poem']);
    expect(r.content.map((c) => c.id)).toEqual(TASKS);
  });
  test('a clean poem is neither missing nor flagged', () => {
    expect(Prompt.oralContent(tree(CLEAN), P.oral, { saidCheck: false })).toMatchObject({ missing: [], flagged: [] });
  });
  test('a task with nothing written is still missing, not flagged', () => {
    const r = Prompt.oralContent(tree(CLEAN, ['poem']), P.oral, { saidCheck: false });
    expect(r.missing).toEqual(['poem']);
    expect(r.flagged).toEqual([]);
  });
});

describe('mergeOral: which reply each task is kept from after the re-ask', () => {
  const tasks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const first = { content: [{ id: 'a', items: [1] }, { id: 'b', items: [1] }], missing: ['c'], flagged: ['b'] };
  const next = { content: [{ id: 'b', items: [2] }, { id: 'c', items: [2] }], missing: ['a'], flagged: [] };
  test('a redo task takes the second reply, the rest keep the first, the second fills what the first left out', () => {
    const out = Prompt.mergeOral(tasks, first, next, new Set(['b']));
    expect(out.content).toEqual([{ id: 'a', items: [1] }, { id: 'b', items: [2] }, { id: 'c', items: [2] }]);
    expect(out.missing).toEqual([]);
    expect(out.flagged).toEqual([]);
  });
  test('a redo task the second reply left out keeps the first reply\'s version and its flag; a task neither filled is missing', () => {
    const out = Prompt.mergeOral(tasks, first, { content: [], missing: ['a', 'b', 'c'], flagged: [] }, new Set(['b']));
    expect(out.content.map((c) => c.id)).toEqual(['a', 'b']);
    expect(out.missing).toEqual(['c']);
    expect(out.flagged).toEqual(['b']);
  });
  test('a redo task the second reply also flagged stays flagged', () => {
    const out = Prompt.mergeOral(tasks, first, { ...next, flagged: ['b'] }, new Set(['b']));
    expect(out.flagged).toEqual(['b']);
  });
});

describe('the writer: a flagged oral task is asked again once and never fails the paper', () => {
  test('v34 g1-urdu: the poem answers open «نظم میں» twice; the paper ships, the second ask names the poem, the opening is stripped', async () => {
    const { calls, d, go } = run(1, 'urdu', { oralReplies: [tree(STEM), tree(STEM)] });
    const out = await go();
    expect(calls.oral).toHaveLength(2);
    expect(calls.oral[1][1].content).toMatch(/Rewrite these tasks: poem\./);
    expect(calls.oral[1][1].content).toMatch(/نظم میں/);
    expect(out.examJson._layout.oral.content.map((c) => c.id)).toEqual(TASKS);
    expect(poemOf(out).items).toHaveLength(5);
    expect(poemOf(out).items.every((it) => !/^\s*نظم\s+میں/u.test(it.answer))).toBe(true);
    expect(d.logToFile.mock.calls.some(([m, x]) => m === '[assessment] oral task kept flagged' && x.flagged.includes('poem'))).toBe(true);
  });
  test('a clean second reply is the one kept, and nothing is logged as kept flagged', async () => {
    const { calls, d, go } = run(1, 'urdu', { oralReplies: [tree(STEM), tree(CLEAN)] });
    const out = await go();
    expect(calls.oral).toHaveLength(2);
    expect(poemOf(out).items.map((it) => it.answer)).toEqual(CLEAN.map((it) => it.answer));
    expect(d.logToFile.mock.calls.some(([m]) => m === '[assessment] oral task kept flagged')).toBe(false);
  });
  test('a clean first reply is not asked again', async () => {
    const { calls, go } = run(1, 'urdu', { oralReplies: [tree(CLEAN)] });
    await go();
    expect(calls.oral).toHaveLength(1);
  });
  test('a task with nothing written after its re-ask still fails ORAL_SHORT', async () => {
    const half = tree(CLEAN, ['poem']);
    const { go } = run(1, 'urdu', { oralReplies: [half, half] });
    const err = await go().catch((e) => e);
    expect(err.code).toBe('ORAL_SHORT');
    expect(err.missing).toEqual(['poem']);
  });
});

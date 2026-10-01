/**
 * A crop that never arrived is invisible in Axiom. bd-7wr3f (§1.8 thread 2).
 *
 * `stageFigures` is the last thing between the authored document and the render, and when a
 * book crop fails to come down the lesson still ships — with an empty framed box where the
 * picture was. That degradation is meant to be explicable afterwards. It was not:
 *
 *   - the miss was reported through `logToFile` free text, so `where event == "…"` never
 *     matched it and the 49-name lp612 event vocabulary had a hole in it;
 *   - `catch (_)` threw away WHY, so 'not on disk', 'empty' and an R2 failure were one
 *     indistinguishable outcome;
 *   - no `segmentId` or `renderId` went with it, so a miss could not be walked back to the
 *     lesson a teacher actually received.
 *
 * These tests drive the real function against a real directory — no network, and nothing
 * stubbed inside the module under change — and then push the emitted row through the real
 * `normalizeForAxiom`, because an id that lands in `data_json` is delivered but not queryable,
 * which is the whole defect being fixed.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const events = [];
jest.mock('../../shared/utils/structured-logger', () => {
  const actual = jest.requireActual('../../shared/utils/structured-logger');
  return { ...actual, logEvent: (name, data) => { events.push({ name, data }); } };
});

const { normalizeForAxiom, AXIOM_CORE_FIELDS } = jest.requireActual(
  '../../shared/utils/structured-logger');
const { stageFigures } = require('../../shared/services/lp612-pagetruth.service');

const BOOK = 'pk-g6-ict-2026';
let truthDir; let outDir; let prevTruthDir;

/** A page-truth tree holding exactly the crops named, each with the given bytes. */
function givenCrops(crops) {
  for (const [name, bytes] of Object.entries(crops)) {
    const p = path.join(truthDir, BOOK, 'figures', `${name}.jpg`);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, bytes);
  }
}

beforeEach(() => {
  events.length = 0;
  truthDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-truth-'));
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-out-'));
  prevTruthDir = process.env.LP612_PAGE_TRUTH_DIR;
  process.env.LP612_PAGE_TRUTH_DIR = truthDir;
});

afterEach(() => {
  if (prevTruthDir === undefined) delete process.env.LP612_PAGE_TRUTH_DIR;
  else process.env.LP612_PAGE_TRUTH_DIR = prevTruthDir;
  fs.rmSync(truthDir, { recursive: true, force: true });
  fs.rmSync(outDir, { recursive: true, force: true });
});

describe('a missing book crop is queryable and explicable (bd-7wr3f)', () => {
  test('the miss is emitted as the lp612.figures.missing EVENT, not as free text', async () => {
    givenCrops({ present: Buffer.from('jpegbytes') });

    const res = await stageFigures({
      refs: [`${BOOK}/present`, `${BOOK}/absent`],
      outDir, correlationId: 'corr-1', segmentId: 'seg-77', renderId: 'rnd-88',
    });

    expect(res.staged).toEqual([`${BOOK}/present`]);
    expect(res.missing).toEqual([`${BOOK}/absent`]);

    const miss = events.find((e) => e.name === 'lp612.figures.missing');
    expect(miss).toBeDefined();
  });

  test('it carries the ids that walk it back to the lesson the teacher received', async () => {
    const res = await stageFigures({
      refs: [`${BOOK}/absent`],
      outDir, correlationId: 'corr-2', segmentId: 'seg-77', renderId: 'rnd-88',
    });
    expect(res.missing).toHaveLength(1);

    const { data } = events.find((e) => e.name === 'lp612.figures.missing');
    expect(data.segmentId).toBe('seg-77');
    expect(data.renderId).toBe('rnd-88');
    expect(data.correlationId).toBe('corr-2');
    expect(data.missingCount).toBe(1);
    expect(data.stagedCount).toBe(0);
  });

  test('WHY it went missing survives — "not on disk" and "empty" are told apart', async () => {
    givenCrops({ hollow: Buffer.alloc(0) });

    await stageFigures({
      refs: [`${BOOK}/hollow`, `${BOOK}/absent`],
      outDir, correlationId: 'corr-3', segmentId: 'seg-77', renderId: 'rnd-88',
    });

    const { data } = events.find((e) => e.name === 'lp612.figures.missing');
    // The distinction is the point: an empty crop is a bad upload, an absent one is a bad
    // reference, and they are fixed in completely different places.
    expect(data.reasons[`${BOOK}/hollow`]).toMatch(/empty/i);
    expect(data.reasons[`${BOOK}/absent`]).toMatch(/not on disk/i);
  });

  test('a fully staged set says nothing — no event, no noise', async () => {
    givenCrops({ a: Buffer.from('x'), b: Buffer.from('y') });

    const res = await stageFigures({
      refs: [`${BOOK}/a`, `${BOOK}/b`], outDir, correlationId: 'corr-4',
    });

    expect(res.missing).toEqual([]);
    expect(events.filter((e) => e.name === 'lp612.figures.missing')).toHaveLength(0);
  });
});

describe('the ids survive into Axiom COLUMNS, not into data_json (bd-7wr3f, bd-jsong)', () => {
  test('segmentId and renderId are promoted', () => {
    // An id stringified into data_json is delivered but not filterable or joinable, which is
    // indistinguishable from absent at the point anyone asks the question.
    expect(AXIOM_CORE_FIELDS.has('segmentId')).toBe(true);
    expect(AXIOM_CORE_FIELDS.has('renderId')).toBe(true);
  });

  test('a real emitted miss row keeps its ids at top level', async () => {
    await stageFigures({
      refs: [`${BOOK}/absent`], outDir,
      correlationId: 'corr-5', segmentId: 'seg-77', renderId: 'rnd-88',
    });
    const { name, data } = events.find((e) => e.name === 'lp612.figures.missing');

    const row = normalizeForAxiom({
      level: 'info', time: 'now', service: 'rumi-bot', env: 'sandbox',
      event: name, feature: 'lp612', action: 'figures', result: 'missing', ...data,
    });

    expect(row.event).toBe('lp612.figures.missing');
    expect(row.segmentId).toBe('seg-77');
    expect(row.renderId).toBe('rnd-88');
    // and specifically NOT buried
    expect(JSON.parse(row.data_json || '{}').renderId).toBeUndefined();
  });
});

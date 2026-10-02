/**
 * bd-s1oo0.16 / bd-s1oo0.21 (L16) — one prefill rule and one diff for both channels.
 *
 * The app's check (app-api.service buildCheckPrefill / diffMarks / toCoachMarks) had its own copy of
 * L6's rule, and it had drifted: it read scoring/thresholds.js as a flat table, found none of its field
 * names there, and fell back to one 0.7 bar for every field — so the app pre-filled the Urdu story count,
 * quick sums and the fallback that WhatsApp never pre-fills, and kept its own edit paths.
 *
 * Here the same ai_marks go through both channels, in strict and in assist, and what arrives filled must
 * match field by field: the WhatsApp side is the Flow screen L6 renders (renderScreen's *_i values and
 * chip lists), the app side is the prefill sessionStatus returns. Real: both services, L6's planner, L5's
 * bars, the item bank. The store is the fake L7's own tests inject (it stands for the DB boundary).
 */

const P = require('../../../bot/shared/services/child-test/check-flow/prefill');
const CheckFlow = require('../../../bot/shared/services/child-test/check-flow');
const Svc = require('../../../bot/shared/services/child-test/app/app-api.service');
const F = require('../L6/fixtures/ai-marks');

const items = CheckFlow.formItems('3', 'A');
const COACH = '11111111-1111-4111-8111-111111111111';
const SESSION = '55555555-5555-4555-8555-555555555555';

function withMode(mode, fn) {
  const before = process.env.CHILD_TEST_PREFILL_MODE;
  if (mode == null) delete process.env.CHILD_TEST_PREFILL_MODE; else process.env.CHILD_TEST_PREFILL_MODE = mode;
  const done = () => { if (before === undefined) delete process.env.CHILD_TEST_PREFILL_MODE; else process.env.CHILD_TEST_PREFILL_MODE = before; };
  try {
    const out = fn();
    if (out && typeof out.then === 'function') return out.finally(done);
    done();
    return out;
  } catch (e) { done(); throw e; }
}

/** What the WhatsApp check shows filled, per field: null = arrives empty. */
function whatsappFilled(block, aiMarks) {
  const plan = P.planBlock(block, { aiMarks, items });
  const d = P.renderScreen(block, { aiMarks, items, lang: 'en', child: { label: 'roll 14' }, aiStatus: 'scored' }).data;
  const v = (s) => (s === '' || s == null ? null : s);
  const out = {};
  const section = (name, rows, key, chipKey) => {
    const chipIds = new Set(chipKey && d[`${chipKey}_v`] ? d[`${chipKey}_opts`].map((o) => o.id) : []);
    // every row has a slot in bank order; a chip row's slot is hidden and its chip carries the mark
    rows.forEach((r, i) => {
      out[`${name}[${r.id}]`] = chipIds.has(r.id) ? r.mark.verdict : v(d[`${key}${i + 1}_i`]);
    });
  };
  if (block === 'maths') {
    section('maths.numbers', plan.numbers.rows, 'n', 'numc');
    out['maths.quick_sums.correct'] = v(d.qc_i) == null ? null : Number(d.qc_i);
    plan.written.forEach((r, i) => { out[`maths.written[${r.id}]`] = v(d[`w${i + 1}_i`]); });
    if (plan.wordProblem) out['maths.word_problem'] = v(d.wp_i);
    return out;
  }
  out['story.words_correct'] = d.story_v ? (v(d.wc_i) == null ? null : Number(d.wc_i)) : undefined;
  out['story.flagged'] = d.flag_v ? [...d.flag_on].sort() : (d.sw_v ? (d.sw_i === 'wrong' ? [`w${plan.flags.shown[0].idx}`] : []) : []);
  plan.questions.forEach((r, i) => { out[`questions[${r.id}]`] = v(d[`q${i + 1}_i`]); });
  plan.firstSounds.forEach((r, i) => { out[`first_sounds[${r.id}]`] = v(d[`fs${i + 1}_i`]); });
  section('nonwords', plan.nonwords.rows, 'nw', 'nwc');
  return out;
}

/** What the app's check form starts from, per field (the portal's draft reads exactly these). */
function appFilled(block, prefill) {
  const out = {};
  const each = (name, list) => (list || []).forEach((x) => { out[`${name}[${x.id}]`] = x.verdict == null ? null : x.verdict; });
  if (block === 'maths') {
    const m = prefill.maths || {};
    each('maths.numbers', m.numbers);
    out['maths.quick_sums.correct'] = m.quick_sums && typeof m.quick_sums.correct === 'number' ? m.quick_sums.correct : null;
    each('maths.written', m.written);
    if (m.word_problem) out['maths.word_problem'] = m.word_problem.verdict == null ? null : m.word_problem.verdict;
    return out;
  }
  const s = prefill.story;
  out['story.words_correct'] = s ? (typeof s.words_correct === 'number' ? s.words_correct : null) : undefined;
  out['story.flagged'] = s ? s.flagged.map((f) => `w${f.idx}`).sort() : [];
  each('questions', prefill.questions);
  each('first_sounds', prefill.first_sounds);
  each('nonwords', prefill.nonwords);
  return out;
}

const CASES = [
  ['urdu', F.urduConfident],
  ['urdu', F.urduUnsureStory],
  ['english', F.englishConfident],
  ['maths', F.mathsConfident],
];

describe.each(['strict', 'assist'])('the same ai_marks pre-fill the same fields on WhatsApp and in the app (%s)', (mode) => {
  test.each(CASES)('%s · %p', (block, make) => withMode(mode, () => {
    const ai = make();
    const wa = whatsappFilled(block, ai);
    const app = appFilled(block, Svc.buildCheckPrefill(ai, { block, grade: 3, form: 'A' }));
    expect(app).toEqual(wa);
  }));
});

test('strict: the app no longer pre-fills what WhatsApp holds back (Urdu story count, quick sums)', () => withMode(null, () => {
  expect(Svc.buildCheckPrefill(F.urduConfident(), { block: 'urdu', grade: 3, form: 'A' }).story.words_correct).toBeNull();
  expect(Svc.buildCheckPrefill(F.mathsConfident(), { block: 'maths', grade: 3, form: 'A' }).maths.quick_sums.correct).toBeNull();
}));

test('assist: the app marks the same fields unsure as WhatsApp lists', () => withMode('assist', () => {
  const pre = Svc.buildCheckPrefill(F.urduConfident(), { block: 'urdu', grade: 3, form: 'A' });
  expect(pre.story.unsure).toBe(true);
  expect(pre.questions.find((q) => q.id === 'u3A-q3').unsure).toBe(true);
  expect(pre.questions.find((q) => q.id === 'u3A-q1').unsure).toBe(false);
  expect(pre.nonwords.find((q) => q.id === 'u3A-nw4')).toMatchObject({ verdict: 'wrong', unsure: true });
}));

// ---- through the service, as the portal calls it ----------------------------------------------------

function deps(blocks) {
  const session = { id: SESSION, coach_user_id: COACH, grade: 3, form: 'A', status: 'completed', timings: {} };
  const rows = {};
  for (const [block, ai] of Object.entries(blocks)) rows[block] = { session_id: SESSION, block, ai_marks: ai, ai_status: 'scored', checked_at: null };
  return {
    store: {
      getSession: jest.fn(async () => ({ ok: true, session })),
      listBlocks: jest.fn(async () => ({ ok: true, blocks: Object.values(rows) })),
      getBlock: jest.fn(async (_s, b) => ({ ok: true, block: rows[b] || null })),
      recordTiming: jest.fn(async () => ({ ok: true })),
      saveCoachMarks: jest.fn(async ({ block, coachMarks, coachEdits }) => { Object.assign(rows[block], { coach_marks: coachMarks, coach_edits: coachEdits, checked_at: 'now' }); return { ok: true }; }),
    },
    enabled: async () => true,
    log: () => {},
    logError: jest.fn(),
    now: () => new Date('2026-10-02T06:10:00Z'),
    _rows: rows,
  };
}

test.each(['strict', 'assist'])('sessionStatus (%s) returns the shared rule\'s prefill for each block', (mode) => withMode(mode, async () => {
  const d = deps({ urdu: F.urduConfident(), maths: F.mathsConfident() });
  const out = await Svc.sessionStatus({ userId: COACH, sessionId: SESSION }, d);
  expect(out.status).toBe('ok');
  for (const block of ['urdu', 'maths']) {
    const b = out.blocks.find((x) => x.block === block);
    expect(appFilled(block, b.prefill)).toEqual(whatsappFilled(block, block === 'urdu' ? F.urduConfident() : F.mathsConfident()));
  }
}));

test('submitCheck: coach_edits is L6\'s diff, meta uses L6\'s paths and records the mode', () => withMode('assist', async () => {
  const ai = F.urduConfident();
  const d = deps({ urdu: ai });
  const form = JSON.parse(JSON.stringify(Svc.buildCheckPrefill(ai, { block: 'urdu', grade: 3, form: 'A' })));
  form.first_sounds.forEach((f) => { if (f.verdict == null) f.verdict = 'none'; });
  form.nonwords.forEach((n) => { if (n.verdict == null) n.verdict = 'correct'; });
  form.story.words_correct = 39;
  form.nonwords.find((n) => n.id === 'u3A-nw4').verdict = 'correct';
  const out = await Svc.submitCheck({ userId: COACH, sessionId: SESSION, block: 'urdu', coachMarks: form }, d);
  expect(out.status).toBe('ok');
  const saved = d._rows.urdu;
  expect(saved.coach_edits).toEqual(CheckFlow.diffMarks('urdu', ai, saved.coach_marks));
  expect(saved.coach_edits).toEqual(expect.arrayContaining([
    { path: 'story.words_correct', ai: 41, coach: 39 },
    { path: 'nonwords[u3A-nw4].verdict', ai: 'wrong', coach: 'correct' },
  ]));
  expect(saved.coach_marks.meta).toMatchObject({ source: 'ai', prefill_mode: 'assist' });
  expect(saved.coach_marks.meta.shown_empty).toEqual(['first_sounds[u3A-fs4]']);
  expect(saved.coach_marks.meta.shown_unsure).toEqual(expect.arrayContaining(['story.words_correct', 'questions[u3A-q3]', 'nonwords[u3A-nw4]']));
}));

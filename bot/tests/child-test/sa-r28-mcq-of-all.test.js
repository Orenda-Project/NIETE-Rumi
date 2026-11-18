'use strict';

/**
 * Round 28 (sa_r28_mcq): the story MCQ is read on the questions of the variant the phone SERVED. A story variant may
 * carry 5 questions (the other stories 6); the phone's result says so in `of_all` (the rotated variant's question count,
 * before the lost-clip filter), and the ladder reads correct of (of_all − lost). The 5-question variant stays at 5.
 *
 * These tests run the real phone engine (finish()) on a rotated 5-question variant and hand its result to level.js,
 * so the shape under test is the one the phone writes, never a hand-written row. Fixtures are synthetic.
 */

const core = require('../../../dashboard/sa/sa-core.js');
const { rotate } = require('../../../dashboard/sa/sa-page.js');
const level = require('../../shared/services/child-test/sa/level');
const sa = require('../../shared/services/child-test/app/sa-api.service');

const q = (vid, n, key) => ({
  id: `ur.story_w3.q${n}.${vid}`,
  prompt: { text: `question ${n}`, audio: `sa/v5/ur/syn_${vid}_q${n}.mp3` },
  options: [`a${n}`, `b${n}`, `c${n}`, `d${n}`],
  option_audio: [1, 2, 3, 4].map((k) => `sa/v5/ur/syn_${vid}_q${n}_o${k}.mp3`),
  target_index: key - 1, key, src: 'synthetic',
});
const SIX = [1, 2, 3, 4, 5, 6].map((n) => q('six', n, 1 + (n % 4)));
const FIVE = [1, 2, 3, 4, 5].map((n) => q('five', n, 1 + (n % 4)));
const mcqTask = () => ({
  id: 'ur.story_mcq_w3', w3: true, r28: 'mcq', replaces: 'ur.story_comp_w3', kind: 'mcq', response: 'tap',
  subtask: 'reading_comprehension', lang: 'ur', title: { en: 'Story questions', ur: 'کہانی کے سوال' }, time_limit_s: null,
  stop: {}, replay_at_s: 10, next_at_s: 15, items: SIX,
  variants: [{ id: 'six', items: SIX }, { id: 'five', items: FIVE }],
});

/** The battery rotated to the variant `vid` (sa-page.js rotate, as the phone does). */
function served(vid) {
  for (let i = 0; i < 500; i += 1) {
    const b = rotate({ battery_id: 'b', ui: { r28_mcq: true }, tasks: [mcqTask()] }, `seed-${i}`);
    if (b.tasks[0].variant.id === vid) return b;
  }
  throw new Error(`no seed rotates to ${vid}`);
}

/** Runs the served MCQ: `right` questions answered right, the rest wrong, `lost` questions (from the end) lost. */
function runMcq(vid, { right, lost = 0 }) {
  let t = 0;
  const b = served(vid);
  const items = b.tasks[0].items;
  const r = core.createRunner({ battery: b, now: () => t, onEvent: () => {}, r28_mcq: true });
  r.start(); r.instructionDone(); r.begin();
  items.forEach((it, i) => {
    if (i >= items.length - lost) { r.clipLost(it.id, 'prompt'); return; }
    r.promptDone(); t += 2000;
    r.answer(i < right ? it.target_index : (it.target_index + 1) % 4);
  });
  return r.results().find((x) => x.task_id === 'ur.story_mcq_w3');
}

// the rungs below comprehension, met, so the walk reaches the MCQ part
const spoken = (block, marks) => ({ block, response_mode: 'record', lang: 'ur', ai_status: 'scored', ai_marks: marks, responses: [{ kind: 'result', mode: 'record', stop_reason: 'complete' }] });
const below = () => [spoken('ur.letter_names5', { correct: 5, attempted: 5 }), spoken('ur.words4', { correct: 4, attempted: 4 }), spoken('ur.story_w3', { correct: 30, attempted: 32 })];
const row = (res) => ({ block: 'ur.story_mcq_w3', response_mode: 'tap', lang: 'ur', ai_status: 'pending', ai_marks: null, responses: [{ kind: 'result', ...res }] });
const ITEMS = { 'ur.letter_names5': 5, 'ur.words4': 4, 'ur.story_mcq_w3': 6 }; // the bank's base task: 6 questions
const ur = (res) => level.levelsOf([...below(), row(res)], [], { itemsOf: (id) => ITEMS[id] ?? null }).find((x) => x.subject === 'ur');

describe('sa_r28_mcq: of_all is the served variant\'s question count (finish() → level.js)', () => {
  test('the 5-question variant: the result carries of_all 5; the 6-question one of_all 6', () => {
    expect(runMcq('five', { right: 4 }).of_all).toBe(5);
    expect(runMcq('six', { right: 4 }).of_all).toBe(6);
  });
  test('of_all is counted before the lost-clip filter: 1 lost of 5 → of_all 5, presented 4, unavailable 1', () => {
    expect(runMcq('five', { right: 3, lost: 1 })).toMatchObject({ of_all: 5, presented: 4, unavailable: 1 });
  });
  test('4 of 5 meets the comprehension rung; 3 of 5 does not', () => {
    expect(ur(runMcq('five', { right: 4 })).level).toBe('comprehension');
    expect(ur(runMcq('five', { right: 3 })).level).toBe('story');
  });
  test('5-question variant, 1 clip lost, 3 right: read as 3 of 4 (met), never 3 of 6 − 1 = 5', () => {
    expect(ur(runMcq('five', { right: 3, lost: 1 })).level).toBe('comprehension');
  });
  test('6-question variant, 1 clip lost, 3 right: 3 of 5, unmet (unchanged)', () => {
    expect(ur(runMcq('six', { right: 3, lost: 1 })).level).toBe('story');
  });
});

describe('sa_r28_mcq: shapeTask passes of_all on a tap task (as ofAll); nothing on other tasks', () => {
  const SID = 'cccccccc-0000-4000-8000-0000000000a4';
  const COACH = 'aaaaaaaa-0000-4000-8000-0000000000a4';
  function world(blocks) {
    const session = { id: SID, coach_user_id: COACH, student_id: 'st-1', draw_id: 'd-1', school_id: 'sch-1', grade: 3, form: 'A',
      item_bank_version: 'sa-battery', status: 'completed', started_at: '2026-10-21T05:00:00Z', finished_at: '2026-10-21T05:20:00Z', device: { block: 'B1' } };
    return {
      enabled: async () => true, supabase: { from: () => { throw new Error('no direct reads'); } },
      store: { getSession: async (id) => ({ ok: true, session: id === SID ? session : null }), listBlocks: async (id) => ({ ok: true, blocks: id === SID ? blocks : [] }) },
      saStore: { findByClient: async () => ({ ok: true, sessionId: null }) }, bank: null, now: () => new Date('2026-10-21T06:00:00Z'), log: () => {},
    };
  }
  const tapRow = (res) => ({ block: 'ur.story_mcq_w3', response_mode: 'tap', lang: 'ur', created_at: '2026-10-21T05:02:00Z', ai_status: 'scored',
    ai_marks: { tap_correct: 4, tap_attempted: 5, options_n: 4, stop_reason: 'complete' }, responses: [{ kind: 'result', ...res }] });
  test('the phone\'s 5-question result → ofAll 5 on the Results task', async () => {
    const out = await sa.saResults({ userId: COACH, sessionId: SID }, world([tapRow(runMcq('five', { right: 4 }))]));
    expect(out.tasks[0]).toMatchObject({ ofAll: 5, presented: 5 });
  });
  test('a tap result without of_all and a spoken row carrying one: no ofAll key (byte-identical)', async () => {
    const old = await sa.saResults({ userId: COACH, sessionId: SID }, world([tapRow({ mode: 'tap', correct: 4, attempted: 5 })]));
    expect('ofAll' in old.tasks[0]).toBe(false);
    const oral = await sa.saResults({ userId: COACH, sessionId: SID }, world([{ ...spoken('ur.story_comp_w3', { correct: 2, of: 4 }), created_at: '2026-10-21T05:03:00Z',
      audio_r2_key: 'k', response_mode: 'oral', responses: [{ kind: 'result', mode: 'oral', of_all: 6 }] }]));
    expect('ofAll' in oral.tasks[0]).toBe(false);
  });
});

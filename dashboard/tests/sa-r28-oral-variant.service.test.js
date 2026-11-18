'use strict';
/**
 * Round 28, ledger O-19: the spoken (switch-OFF) comprehension result records the story variant the phone rotated to,
 * but ONLY under sa_r28_story_clock ON (the other story-path row); OFF the result is byte-identical to today's (no key).
 * And the item-analysis guard (O-10 by delivery): a picker or MCQ item the child let time out is recorded as
 * value 'timeout', ok false, and counted among the items presented. Synthetic batteries only.
 */
const core = require('../sa/sa-core');
const { rotate } = require('../sa/sa-page');

function clock() { let t = 0; return { now: () => t, add: (ms) => { t += ms; } }; }
const q = (i, key, extra) => Object.assign({ id: `ur.story_w3.q${i}`, prompt: { text: `q${i}` }, options: ['a', 'b', 'c', 'd'], target_index: key - 1, key }, extra || {});
const QS = [q(1, 2), q(2, 3)];
const vq = (vid) => QS.map((x) => Object.assign({}, x, { id: `${x.id}.${vid}` }));
const VARIANTS = ['rwp2026', 'select2024'];
const oral = (extra) => Object.assign({ id: 'ur.story_comp_w3', subtask: 'reading_comprehension', response: 'oral', items: QS }, extra || {});
const pick = () => ({ id: 'ur.letter_pick10', w3: true, r28: 'letter_pick', kind: 'pick', response: 'tap', subtask: 'letter_sound_identification', lang: 'ur',
  time_limit_s: null, stop: {}, replay_at_s: 10, next_at_s: 15, item_timeout_s: 12,
  items: [{ id: 'ur.letter_pick10.01', options: ['ت', 'ب', 'پ', 'ٹ', 'ن'], target: 'ب', prompt_audio: 'sa/v5/ur/x.mp3', prompt_text: 'بَ' }, { id: 'ur.letter_pick10.02', options: ['د', 'ر', 'ز', 'و', 'ک'], target: 'د', prompt_audio: 'sa/v5/ur/y.mp3', prompt_text: 'دَ' }] });
const mcq = () => ({ id: 'ur.story_mcq_w3', w3: true, r28: 'mcq', kind: 'mcq', response: 'tap', subtask: 'reading_comprehension', lang: 'ur',
  time_limit_s: null, stop: {}, replay_at_s: 10, next_at_s: 15, item_timeout_s: 12, depends_on: null, items: QS });

function runOral(battery, opts) {
  const c = clock();
  const r = core.createRunner(Object.assign({ battery, now: c.now, onEvent: () => {} }, opts || {}));
  r.start(); r.instructionDone(); r.begin();
  for (let i = 0; i < 12 && r.view().phase === 'running'; i += 1) { r.promptDone(); c.add(5 * 60 * 1000); r.tick(); }
  return r.results().find((x) => x.task_id === 'ur.story_comp_w3');
}

describe('O-19: the spoken comprehension result records its variant only under sa_r28_story_clock', () => {
  const rotating = () => ({ battery_id: 'b', ui: {}, tasks: [oral({ variants: VARIANTS.map((id) => ({ id, items: vq(id) })) })] });
  test('story_clock ON, rotated: the oral result carries variant = the rotated id', () => {
    const b = rotate(rotating(), 'seed-7');
    const id = b.tasks[0].variant && b.tasks[0].variant.id;
    expect(VARIANTS).toContain(id);
    const m = runOral(b, { story_clock: true });
    expect(m).toHaveProperty('variant', id);
  });
  test('story_clock ON, no rotation: variant null (the key present)', () => {
    const m = runOral({ battery_id: 'b', ui: {}, tasks: [oral()] }, { story_clock: true });
    expect(m).toHaveProperty('variant', null);
  });
  test('OFF (no story_clock): the oral result is as today, no variant key', () => {
    const m = runOral(rotate(rotating(), 'seed-7'));
    expect(m).not.toHaveProperty('variant');
  });
});

describe('O-10 by delivery: a timed-out picker or MCQ item is recorded as timeout, ok false, and counted as presented', () => {
  function runTimeout(task, opts) {
    const c = clock();
    const r = core.createRunner(Object.assign({ battery: { battery_id: 'b', ui: {}, tasks: [task] }, now: c.now, onEvent: () => {} }, opts));
    r.start(); r.instructionDone(); r.begin();
    r.promptDone(); r.answer(0);           // item 1 answered
    r.promptDone(); c.add(13 * 1000); r.tick(); // item 2 times out (item_timeout_s 12)
    for (let i = 0; i < 5 && r.view().phase === 'running'; i += 1) { r.promptDone(); c.add(13 * 1000); r.tick(); }
    return r.results().find((x) => x.task_id === task.id);
  }
  test('picker: answers[1] = { value: timeout, ok: false }; presented counts both items', () => {
    const m = runTimeout(pick(), { r28_letter_pick: true });
    expect(m.answers[1]).toMatchObject({ value: 'timeout', ok: false });
    expect(m.presented).toBe(2);
  });
  test('MCQ: answers[1] = { value: timeout, ok: false }; presented counts both questions', () => {
    const m = runTimeout(mcq(), { r28_mcq: true });
    expect(m.answers[1]).toMatchObject({ value: 'timeout', ok: false });
    expect(m.presented).toBe(2);
  });
});

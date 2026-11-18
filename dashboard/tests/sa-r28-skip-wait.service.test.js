'use strict';
/**
 * Round 28 (sa_r28_letter_pick, sa_r28_mcq): the served picker and MCQ have no per-item time-out, so a child who never
 * taps ends as `skipped` (the coach's Next, or the auto Next in RDF auto). The skipped answer says how long the child had:
 * wait_ms, from the end of the last play of the sound (the picker) or of the fourth option (the MCQ read-out) to the
 * skip. A stuck child in RDF auto reads ≥ 30 000; a coach's quick Next a few seconds. Other tap tasks: no new key.
 * Fixtures are synthetic.
 */
const core = require('../sa/sa-core');

function clock() { let t = 0; return { now: () => t, at: (ms) => { t = ms; } }; }
const pickItems = Array.from({ length: 10 }, (_, i) => ({
  id: `ur.letter_pick10.${String(i + 1).padStart(2, '0')}`, options: ['ت', 'ب', 'پ', 'ٹ', 'ن'], target: 'ب',
  prompt_audio: `sa/v5/ur/syn_${i + 1}.mp3`, prompt_text: 'بَ', src: 'synthetic',
}));
const pickTask = () => ({
  id: 'ur.letter_pick10', w3: true, r28: 'letter_pick', kind: 'pick', response: 'tap', subtask: 'letter_sound_identification',
  lang: 'ur', title: { en: 'Listen and pick', ur: 'سنیں اور چنیں' }, time_limit_s: null, stop: {}, replay_at_s: 10, next_at_s: 15, items: pickItems,
});
const mcqItems = [1, 2, 3, 4, 5, 6].map((n) => ({
  id: `ur.story_w3.q${n}`, prompt: { text: `q${n}`, audio: `sa/v5/ur/syn_q${n}.mp3` }, options: ['a', 'b', 'c', 'd'],
  option_audio: [1, 2, 3, 4].map((k) => `sa/v5/ur/syn_q${n}_o${k}.mp3`), target_index: 1, key: 2, src: 'synthetic',
}));
const mcqTask = () => ({
  id: 'ur.story_mcq_w3', w3: true, r28: 'mcq', kind: 'mcq', response: 'tap', subtask: 'reading_comprehension', lang: 'ur',
  title: { en: 'Story questions', ur: 'کہانی کے سوال' }, time_limit_s: null, stop: {}, replay_at_s: 10, next_at_s: 15, items: mcqItems,
});
const plainTap = () => ({ id: 'ma.plain', mode: 'tap', time_limit_s: null, next_at_s: 15, items: [{ id: 'm1', target: '1', options: ['1', '2'] }, { id: 'm2', target: '2', options: ['1', '2'] }] });

function run(task, opts) {
  const c = clock();
  const events = [];
  const r = core.createRunner(Object.assign({ battery: { battery_id: 'b', tasks: [task] }, now: c.now, onEvent: (e) => events.push(e) }, opts || {}));
  r.start(); r.instructionDone(); r.begin();
  return { r, c, events };
}
/** Answers every item still open (promptDone first, as the MCQ needs), so the task finishes and results() has it. */
function finishAll(r) {
  for (let i = 0; i < 20 && r.view().phase === 'running'; i += 1) { r.promptDone(); r.answer(r.view().item ? 0 : 0); }
  return r.results()[0];
}

describe('sa_r28 picker: a skipped answer carries wait_ms from the end of the last play of the sound', () => {
  test('RDF auto: the sound ends at 1 s, the Next at 32 s → { value: skipped, ok: false, wait_ms ≥ 30000 }', () => {
    const { r, c } = run(pickTask(), { r28_letter_pick: true });
    const id = pickItems[0].id;
    r.clipPlaying(id, true); c.at(1000); r.clipPlaying(id, false);
    c.at(32000);
    r.skip();
    const a = finishAll(r).answers[0];
    expect(a).toMatchObject({ item_id: id, value: 'skipped', ok: false });
    expect(a.wait_ms).toBeGreaterThanOrEqual(30000);
    expect(a.wait_ms).toBe(31000);
  });
  test('coach-led: a replay ends at 5 s, the coach\'s Next at 8 s → wait_ms 3000 (from the end of the LAST play)', () => {
    const { r, c } = run(pickTask(), { r28_letter_pick: true, manual: true });
    const id = pickItems[0].id;
    r.clipPlaying(id, true); c.at(1000); r.clipPlaying(id, false);
    c.at(4000); r.clipPlaying(id, true); c.at(5000); r.clipPlaying(id, false);
    c.at(8000);
    r.skip();
    expect(finishAll(r).answers[0]).toMatchObject({ value: 'skipped', ok: false, wait_ms: 3000 });
  });
  test('an answered item carries no wait_ms', () => {
    const { r, c } = run(pickTask(), { r28_letter_pick: true });
    c.at(2000);
    r.answer('ب');
    expect(finishAll(r).answers[0]).not.toHaveProperty('wait_ms');
  });
});

describe('sa_r28 MCQ: a skipped answer carries wait_ms from the end of the fourth option', () => {
  test('RDF auto: the read-out ends at 5 s, the Next at 36 s → wait_ms 31000', () => {
    const { r, c } = run(mcqTask(), { r28_mcq: true });
    c.at(5000); r.promptDone();
    c.at(36000);
    r.skip();
    expect(finishAll(r).answers[0]).toMatchObject({ item_id: 'ur.story_w3.q1', value: 'skipped', ok: false, wait_ms: 31000 });
  });
  test('coach-led: the coach\'s Next 3 s after the read-out → wait_ms 3000', () => {
    const { r, c } = run(mcqTask(), { r28_mcq: true, manual: true });
    c.at(6000); r.promptDone();
    c.at(9000);
    r.skip();
    expect(finishAll(r).answers[0]).toMatchObject({ value: 'skipped', ok: false, wait_ms: 3000 });
  });
});

describe('OFF identity: other tap tasks and the switches off get no wait_ms', () => {
  test('a plain tap task: skipped as today, no wait_ms key', () => {
    const { r, c } = run(plainTap());
    c.at(20000);
    r.skip();
    expect(finishAll(r).answers[0]).toEqual({ item_id: 'm1', value: 'skipped', ok: false });
  });
  test('the picker task with sa_r28_letter_pick off: no wait_ms', () => {
    const { r, c } = run(pickTask());
    c.at(20000);
    r.skip();
    expect(finishAll(r).answers[0]).not.toHaveProperty('wait_ms');
  });
  test('the MCQ task with sa_r28_mcq off: no wait_ms', () => {
    const { r, c } = run(mcqTask());
    c.at(20000);
    r.skip();
    expect(finishAll(r).answers[0]).not.toHaveProperty('wait_ms');
  });
});

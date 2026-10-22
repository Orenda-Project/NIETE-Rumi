'use strict';
/**
 * Round 4: the comprehension after the RDF passage asked only one question (the questions were cut by the last word tapped).
 * Switch sa_comp_all_questions (default OFF): the Rawalpindi instrument's rule for the passage's questions. The passage
 * not stopped on its first line and at least 10 words read → every question is asked; fewer → none (skipped, as today).
 * OFF, the per-question gate.min_words cut stays, byte for byte.
 */
const core = require('../sa/sa-core');
const { SWITCHES, applySwitches } = require('../routes/sa-battery-switches');

function clock() { let t = 0; return { now: () => t, add: (ms) => { t += ms; } }; }
const words = Array.from({ length: 60 }, (_, i) => ({ id: 'w' + (i + 1), target: 'w' + (i + 1), line: 1 }));
const q = (id, min) => ({ id, prompt: id, gate: { read_past: null, min_words: min } });
const QS = [q('q1', 1), q('q2', 12), q('q3', 20), q('q4', 48), q('q5', 55), q('q6', 60)];
function battery() {
  return { battery_id: 'b', tasks: [
    { id: 'en.story_w3', subtask: 'oral_reading_fluency', response: 'record', time_limit_s: 60, passage: { text: 'x' }, items: words },
    { id: 'en.story_comp_w3', subtask: 'reading_comprehension', depends_on: { task: 'en.story_w3', upto_item: 'last_word_tap' }, items: QS },
  ] };
}
function readTo(lastIndex, opts) {
  const c = clock();
  const r = core.createRunner(Object.assign({ battery: battery(), now: c.now, mic: () => 'ok' }, opts || {}));
  r.start(); r.instructionDone(); r.begin(); r.done(); r.lastWord(lastIndex); r.next();
  return r;
}
function asked(r) {
  r.instructionDone(); r.begin();
  const out = [];
  while (r.view().phase === 'running') { out.push(r.view().item.id); r.answer('spoken'); }
  return out;
}

describe('sa_comp_all_questions ON (comp_all_questions)', () => {
  test('12 words read (the live case that got one question): all six are asked', () => {
    expect(asked(readTo(11, { comp_all_questions: true }))).toEqual(['q1', 'q2', 'q3', 'q4', 'q5', 'q6']);
  });
  test('exactly 10 words read: all six', () => {
    expect(asked(readTo(9, { comp_all_questions: true }))).toHaveLength(6);
  });
  test('fewer than 10 words read: none asked (skipped_no_first_line)', () => {
    const r = readTo(8, { comp_all_questions: true });
    expect(r.view().result.stop_reason).toBe('skipped_no_first_line');
  });
  test('no word tapped: skipped', () => {
    expect(readTo(-1, { comp_all_questions: true }).view().result.stop_reason).toBe('skipped_no_first_line');
  });
});

describe('OFF: the per-question cut, unchanged', () => {
  test('12 words read: q1 and q2 only', () => {
    expect(asked(readTo(11))).toEqual(['q1', 'q2']);
  });
});

describe('the switch reaches the battery as ui.comp_all_questions', () => {
  const b = { battery_id: 'b', tasks: [{ id: 't' }] };
  test('the switch is named sa_comp_all_questions', () => {
    expect(SWITCHES.compAllQuestions).toBe('sa_comp_all_questions');
  });
  test('ON adds ui.comp_all_questions = true', () => {
    expect(applySwitches(b, { compAllQuestions: true, rdfW3Forms: true }).ui).toEqual({ comp_all_questions: true });
  });
  test('OFF: no ui key (byte-identical)', () => {
    expect(JSON.stringify(applySwitches(b, { rdfW3Forms: true }))).toBe(JSON.stringify(b));
  });
});

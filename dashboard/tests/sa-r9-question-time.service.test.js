'use strict';
/**
 * Round 9 item 4 (switch sa_r9_question_time, OFF by default): the time a question waits before it moves on by itself
 * was still too short for the children. ON: every per-question wait is doubled and never under 30 s; Next (or an
 * answer) still moves on at once. A part with its own clock (the one-minute reads and sums: the measure) keeps every
 * timing it has. Measured here on the served RDF forms with prod's switches, the way the page's animation loop ticks.
 */
const fs = require('fs');
const path = require('path');
const core = require('../sa/sa-core');
const { applySwitches } = require('../routes/sa-battery-switches');

const DIR = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa');
const load = (n) => JSON.parse(fs.readFileSync(path.join(DIR, n), 'utf8'));
// prod's switches on 2 Nov (every round 7b / round 8 one ON), the round 9 one as given
const PROD = {
  rdfW3Forms: true, oneAtATime: true, passagePunct: true, rdfManual: true, compAllQuestions: true, cellPace: true,
  sectionRecording: true, cellNextOnly: true, autoNoLastWord: true, r8CompWaitNext: true, r8Counts: true,
};

function clock() { let t = 0; return { now: () => t, add: (ms) => { t += ms; } }; }
/** The runner on one task of a served battery, as the engine builds it for RDF auto (or manual). */
function runOne(battery, id, manual) {
  const ui = battery.ui || {};
  const t = { ...battery.tasks.find((x) => x.id === id) };
  delete t.depends_on;
  const c = clock();
  const r = core.createRunner({
    battery: { ...battery, tasks: [t] }, now: c.now, mic: () => 'ok', manual: !!manual,
    one_at_a_time: ui.one_at_a_time === true, cell_pace: ui.cell_pace === true, cell_next_only: ui.cell_next_only === true,
    section_recording: ui.section_recording === true, comp_all_questions: ui.comp_all_questions === true,
  });
  r.start();
  for (let n = 0; n < 50 && r.view().phase !== 'running'; n++) {
    const v = r.view();
    if (v.phase === 'instruction') r.instructionDone();
    else if (v.phase === 'practice') r.practiceAnswer(v.practice.target);
    else if (v.phase === 'ready') r.begin();
    else if (v.phase === 'oral_practice') r.oralPracticeDone(true);
    else if (v.phase === 'keypad_warmup') r.keypadWarmupDone(3);
    else if (v.phase === 'audio_check') r.audioCheck(true);
    else if (v.phase === 'mic_check') r.micChecked(true, 0.2);
    else if (v.phase === 'warmup') r.warmupDone(3, 1000);
    else if (v.phase === 'battery_intro') r.start();
  }
  expect(r.view().phase).toBe('running');
  return { r, c };
}
/** Seconds until the first question (or cell) moves on with nobody touching anything; null: not within 200 s. */
function movesOnAt(battery, id, manual) {
  const { r, c } = runOne(battery, id, manual);
  const at = (v) => [v.phase, v.item_index, v.cell_index].join('|');
  const was = at(r.view());
  for (let ms = 0; ms < 200000; ms += 100) {
    c.add(100);
    r.tick();
    if (at(r.view()) !== was) return Math.round(c.now() / 100) / 10;
  }
  return null;
}

const FORMS = ['sa.coach.G3.A.ur.json', 'sa.coach.G3.A.en.json', 'sa.coach.G1.A.ur.json', 'sa.coach.G5.A.en.json'];
// RDF auto, prod today → with sa_r9_question_time. null = never by itself (Next only).
const RDF = {
  'ur.story_comp_w3': [15, 30], 'en.story_comp_w3': [15, 30],
  'ma.add2i': [10, 30], 'ma.sub2i': [10, 30], 'ma.mul2i': [10, 30],
  // the measure: one-minute parts keep their pace (5 s of quiet, cell pace)
  'ma.number_id8': [5, 5], 'ma.fluency1m': [5, 5],
  // a letter or word moves on only on Next (cell_next_only); the part's one-minute clock is what ends it
  'ur.letter_names5': [60, 60], 'en.words4': [60, 60],
  // a tap question waits for the tap
  'ma.discrimination2': [null, null],
};

describe('sa_r9_question_time on the RDF forms (RDF auto, prod switches)', () => {
  for (const f of FORMS) {
    const off = applySwitches(load(f), PROD);
    const on = applySwitches(load(f), { ...PROD, r9QuestionTime: true });
    test(`${f}: the served battery says so only when ON`, () => {
      expect(on.ui.r9_question_time).toBe(true);
      expect(off.ui.r9_question_time).toBeUndefined();
    });
    for (const [id, [today, wanted]] of Object.entries(RDF)) {
      if (!off.tasks.some((t) => t.id === id)) continue;
      test(`${f} ${id}: OFF ${today} s (today), ON ${wanted} s`, () => {
        expect(movesOnAt(off, id)).toBe(today);
        expect(movesOnAt(on, id)).toBe(wanted);
      });
    }
  }
});

describe('sa_r9_question_time on the other forms (game, legacy coach blocks)', () => {
  const OTHER = {
    'ur.listening': [10, 30], 'en.segmentation': [10, 30], 'ur.story_comp': [10, 30], 'ma.word_problems': [60, 120],
    // timed one-minute parts keep their per-item pace
    'ur.letters': [10, 10], 'ma.add1': [10, 10],
  };
  const base = { ...PROD, rdfW3Forms: false, r8Counts: false, r8CompWaitNext: false };
  for (const f of ['sa.coach.G3.A.ur.json', 'sa.game.G23.en.json']) {
    const off = applySwitches(load(f), base);
    const on = applySwitches(load(f), { ...base, r9QuestionTime: true });
    for (const [id, [today, wanted]] of Object.entries(OTHER)) {
      if (!off.tasks.some((t) => t.id === id)) continue;
      test(`${f} ${id}: OFF ${today} s, ON ${wanted} s`, () => {
        expect(movesOnAt(off, id)).toBe(today);
        expect(movesOnAt(on, id)).toBe(wanted);
      });
    }
  }
});

describe('sa_r9_question_time: Next still moves on at once; coach-led unchanged', () => {
  const on = applySwitches(load('sa.coach.G3.A.ur.json'), { ...PROD, r9QuestionTime: true });
  test('a story question answered at 2 s moves on at 2 s', () => {
    const { r, c } = runOne(on, 'ur.story_comp_w3');
    for (let i = 0; i < 20; i++) { c.add(100); r.tick(); }
    r.answer('spoken');
    expect(r.view().item_index).toBe(1);
  });
  test('a mental sum: Next at 2 s moves on at 2 s', () => {
    const { r, c } = runOne(on, 'ma.add2i');
    for (let i = 0; i < 20; i++) { c.add(100); r.tick(); }
    r.nextCell('tap');
    expect(r.view().cell_index).toBe(1);
  });
  test('a voice heard does not hold a mental sum past its 30 s', () => {
    const { r, c } = runOne(on, 'ma.add2i');
    let moved = null;
    for (let ms = 0; ms < 60000 && moved == null; ms += 100) {
      c.add(100);
      if (ms % 1000 === 0) r.voice();
      r.tick();
      if (r.view().cell_index === 1) moved = c.now() / 1000;
    }
    expect(moved).toBe(30);
  });
  test('RDF manual: nothing moves on by itself, ON or OFF', () => {
    expect(movesOnAt(on, 'ur.story_comp_w3', true)).toBe(null);
    expect(movesOnAt(on, 'ma.add2i', true)).toBe(null);
  });
});

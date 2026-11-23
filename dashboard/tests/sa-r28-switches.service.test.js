'use strict';
require('./fixtures/binds-loopback');
/**
 * Round 28 (the operator and the 17 Nov evaluation meeting): three switches, each OFF by default, on the battery route.
 *
 *   sa_r28_letter_pick  a listen-and-tap letter-sound task (kind 'pick', r28: 'letter_pick') takes the place of the
 *                       read-aloud letter sounds in the RDF lists; battery.ui.r28_letter_pick = true for the engine.
 *   sa_r28_mcq          the story questions as four spoken options to tap (kind 'mcq', r28: 'mcq') take the place of
 *                       the spoken story questions; battery.ui.r28_mcq = true.
 *   sa_r28_ceiling      a timed task's items past today's first N (`ext: true`, the task's `base_n`) stay in the served
 *                       battery, so the child keeps getting items until the clock ends; battery.ui.r28_ceiling = true.
 *
 * The built battery file carries the r28 tasks, the extension items and the round's own lines (`lines_r28`); the route
 * strips every one of them while its switch is OFF, so a phone with the switches OFF receives today's battery byte for
 * byte (sa-r28-off-identity.service.test.js proves it on the real files; this file proves the swap on fixtures).
 */
const express = require('express');
const { SWITCHES, applySwitches } = require('../routes/sa-battery-switches');

const R28 = {
  r28LetterPick: ['sa_r28_letter_pick', 'r28_letter_pick'],
  r28Mcq: ['sa_r28_mcq', 'r28_mcq'],
  r28Ceiling: ['sa_r28_ceiling', 'r28_ceiling'],
  r28StoryClock: ['sa_r28_story_clock', 'r28_story_clock'],
  // the coach's hold menu's Urdu End this task (sa-r28-end-task-copy.service.test.js proves the menu)
  r28EndTaskCopy: ['sa_r28_end_task_copy', 'r28_end_task_copy'],
};
// The r28 tasks are W3 tasks (the RDF forms), so the fixtures run with sa_rdf_w3_forms ON, as sandbox and prod do.
const OFF = { rdfW3Forms: true, ...Object.fromEntries(Object.keys(R28).map((k) => [k, false])) };

const sounds = { id: 'ur.letter_sounds5', w3: true, response: 'record', present: 'one_at_a_time', items: [{ id: 'ur.letter_sounds5.01', show: 'ب' }] };
const pick = { id: 'ur.letter_pick10', w3: true, r28: 'letter_pick', replaces: 'ur.letter_sounds5', kind: 'pick', response: 'tap',
  items: [{ id: 'ur.letter_pick10.01', options: ['ت', 'ب', 'پ', 'ٹ', 'ن'], target: 'ب', prompt_audio: 'sa/v5/ur/x.mp3' }] };
const comp = { id: 'ur.story_comp_w3', w3: true, response: 'oral', items: [{ id: 'ur.story_w3.q1' }], depends_on: { task: 'ur.story_w3', upto_item: 'last_word_tap' } };
const mcq = { id: 'ur.story_mcq_w3', w3: true, r28: 'mcq', replaces: 'ur.story_comp_w3', kind: 'mcq', response: 'tap',
  items: [{ id: 'ur.story_w3.q1', options: ['a', 'b', 'c', 'd'], target_index: 1 }], depends_on: { task: 'ur.story_w3', upto_item: 'last_word_tap' } };
const words = { id: 'ur.words4', w3: true, response: 'record', present: 'one_at_a_time', time_limit_s: 60, base_n: 2,
  grid: ['بچہ', 'گھر'],
  items: [{ id: 'ur.words4.01', show: 'بچہ', target: 'بچہ' }, { id: 'ur.words4.02', show: 'گھر', target: 'گھر' }],
  ext_items: [{ id: 'ur.words4.03', show: 'پانی', target: 'پانی', ext: true, src: 'x' }, { id: 'ur.words4.04', show: 'کتاب', target: 'کتاب', ext: true, src: 'x' }],
  ext_stop: { type: 'first_row', n: 5 } };
const story = { id: 'ur.story_w3', w3: true, response: 'record', passage: { text: 'x' }, items: [] };
const BUILT = {
  battery_id: 'b', lang: 'ur',
  rdf_auto: ['ur.letter_sounds5', 'ur.words4', 'ur.story_w3', 'ur.story_comp_w3'],
  rdf_manual: ['ur.letter_sounds5', 'ur.words4', 'ur.story_w3', 'ur.story_comp_w3'],
  lines: { welcome: { text: 'hi', audio: 'sa/v1/ur/a.mp3' } },
  lines_r28: { lp_intro: { text: 'listen', audio: 'sa/v5/ur/b.mp3', r28: 'letter_pick' }, mcq_intro: { text: 'four', audio: 'sa/v5/ur/c.mp3', r28: 'mcq' } },
  r28_tasks: ['ur.letter_pick10', 'ur.story_mcq_w3'],
  tasks: [sounds, pick, words, story, comp, mcq],
};
// What a phone received before round 28: no r28 task or list, no extension item, no `base_n`, no round-28 line.
const { base_n: _bn, ext_items: _ei, ext_stop: _es, ...wordsToday } = words;
const TODAY = {
  battery_id: 'b', lang: 'ur',
  rdf_auto: ['ur.letter_sounds5', 'ur.words4', 'ur.story_w3', 'ur.story_comp_w3'],
  rdf_manual: ['ur.letter_sounds5', 'ur.words4', 'ur.story_w3', 'ur.story_comp_w3'],
  lines: { welcome: { text: 'hi', audio: 'sa/v1/ur/a.mp3' } },
  tasks: [sounds, wordsToday, story, comp],
};
const ids = (b, key = 'tasks') => (key === 'tasks' ? b.tasks.map((t) => t.id) : b[key]);

describe('round 28 battery switches (sa-battery-switches.js)', () => {
  for (const [name, [key, flag]] of Object.entries(R28)) {
    test(`${key}: named, and ON puts battery.ui.${flag}`, () => {
      expect(SWITCHES[name]).toBe(key);
      expect(applySwitches({ battery_id: 'b', tasks: [{ id: 'x', items: [] }] }, { [name]: true }).ui).toEqual({ [flag]: true });
    });
  }

  test('all OFF: the r28 tasks, the extension items, base_n and the round-28 lines are stripped; the lists stay', () => {
    const out = applySwitches(BUILT, OFF);
    expect(out).toEqual(TODAY);
    expect(out.ui).toBeUndefined();
    expect(out.r28_tasks).toBeUndefined();
  });

  test('all OFF on a battery with nothing of round 28: the battery as before (the round adds no key)', () => {
    const plain = { battery_id: 'b', tasks: [sounds, story], rdf_auto: ['ur.letter_sounds5'], lines: { welcome: { text: 'hi' } } };
    expect(applySwitches(plain, OFF)).toEqual(plain);
    expect(applySwitches(plain, { ...OFF, r28LetterPick: true, r28Mcq: true, r28Ceiling: true, r28StoryClock: true })).toEqual({ ...plain, ui: { r28_letter_pick: true, r28_mcq: true, r28_ceiling: true, r28_story_clock: true } });
  });

  test('sa_r28_letter_pick ON: the picker takes the place of the read-aloud letter sounds in both RDF lists; its line comes along', () => {
    const out = applySwitches(BUILT, { ...OFF, r28LetterPick: true });
    expect(ids(out, 'rdf_auto')).toEqual(['ur.letter_pick10', 'ur.words4', 'ur.story_w3', 'ur.story_comp_w3']);
    expect(ids(out, 'rdf_manual')).toEqual(['ur.letter_pick10', 'ur.words4', 'ur.story_w3', 'ur.story_comp_w3']);
    expect(ids(out)).toEqual(['ur.letter_pick10', 'ur.words4', 'ur.story_w3', 'ur.story_comp_w3']);
    expect(out.tasks.find((t) => t.id === 'ur.letter_pick10')).toEqual(pick);
    expect(out.lines).toEqual({ welcome: BUILT.lines.welcome, lp_intro: { text: 'listen', audio: 'sa/v5/ur/b.mp3' } });
    expect(out.lines_r28).toBeUndefined();
    expect(out.ui).toEqual({ r28_letter_pick: true });
    // the other two stay stripped
    expect(out.tasks.find((t) => t.id === 'ur.words4').items).toHaveLength(2);
  });

  test('sa_r28_mcq ON: the MCQ takes the place of the spoken story questions, keeping its depends_on', () => {
    const out = applySwitches(BUILT, { ...OFF, r28Mcq: true });
    expect(ids(out, 'rdf_auto')).toEqual(['ur.letter_sounds5', 'ur.words4', 'ur.story_w3', 'ur.story_mcq_w3']);
    expect(ids(out)).toEqual(['ur.letter_sounds5', 'ur.words4', 'ur.story_w3', 'ur.story_mcq_w3']);
    expect(out.tasks.find((t) => t.id === 'ur.story_mcq_w3').depends_on).toEqual(comp.depends_on);
    expect(out.lines.mcq_intro).toEqual({ text: 'four', audio: 'sa/v5/ur/c.mp3' });
    expect(out.lines.lp_intro).toBeUndefined();
    expect(out.ui).toEqual({ r28_mcq: true });
  });

  test('sa_r28_ceiling ON: the extension items and base_n stay, the grid is the whole list, the lists are untouched', () => {
    const out = applySwitches(BUILT, { ...OFF, r28Ceiling: true });
    const w = out.tasks.find((t) => t.id === 'ur.words4');
    expect(w.items.map((i) => i.id)).toEqual(['ur.words4.01', 'ur.words4.02', 'ur.words4.03', 'ur.words4.04']);
    expect(w.grid).toEqual(['بچہ', 'گھر', 'پانی', 'کتاب']);
    expect(w.base_n).toBe(2);
    expect(w.ext_items).toBeUndefined();
    expect(w.ext_stop).toBeUndefined();
    expect(out.r28_tasks).toBeUndefined();
    expect(ids(out)).toEqual(['ur.letter_sounds5', 'ur.words4', 'ur.story_w3', 'ur.story_comp_w3']);
    expect(out.ui).toEqual({ r28_ceiling: true });
  });

  test('all three ON: every swap at once, every flag', () => {
    const out = applySwitches(BUILT, { ...OFF, r28LetterPick: true, r28Mcq: true, r28Ceiling: true });
    expect(ids(out, 'rdf_auto')).toEqual(['ur.letter_pick10', 'ur.words4', 'ur.story_w3', 'ur.story_mcq_w3']);
    expect(out.tasks.find((t) => t.id === 'ur.words4').items).toHaveLength(4);
    expect(out.ui).toEqual({ r28_letter_pick: true, r28_mcq: true, r28_ceiling: true });
    expect(applySwitches(BUILT, { ...OFF, r28StoryClock: true }).ui).toEqual({ r28_story_clock: true });
    expect(Object.keys(out.lines).sort()).toEqual(['lp_intro', 'mcq_intro', 'welcome']);
  });

  test('ON leaves the input battery untouched (pure)', () => {
    const before = JSON.stringify(BUILT);
    applySwitches(BUILT, { ...OFF, r28LetterPick: true, r28Mcq: true, r28Ceiling: true });
    applySwitches(BUILT, OFF);
    expect(JSON.stringify(BUILT)).toBe(before);
  });

  test('the W3 strip (sa_rdf_w3_forms OFF) also drops the r28 tasks (they are W3 tasks)', () => {
    const out = applySwitches(BUILT, { rdfW3Forms: false, r28LetterPick: true, r28Mcq: true, r28Ceiling: true });
    expect(out.tasks.some((t) => t.r28)).toBe(false);
    expect(out.rdf_auto).toBeUndefined();
  });
});

describe('the engine route reads the round 28 switches', () => {
  async function served(readers) {
    const { createSaEngineRouter } = require('../routes/sa-engine.routes');
    const off = () => false;
    const app = express();
    app.use(createSaEngineRouter({ on: () => true, practiceAllMaths: off, passageRotation: off, voiceV2: off, rdfW3Forms: () => true, ...readers }));
    const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    try {
      const res = await fetch(`http://127.0.0.1:${srv.address().port}/sa/batteries/sa.coach.G3.A.ur.json`);
      expect(res.status).toBe(200);
      const body = await res.json();
      return body;
    } finally {
      srv.close();
    }
  }
  for (const [name, [key, flag]] of Object.entries(R28)) {
    test(`${key} ON on the route → ui.${flag} on the served battery; OFF → no flag`, async () => {
      const on = await served({ [name]: () => true });
      expect(on.ui && on.ui[flag]).toBe(true);
      const off = await served({ [name]: () => false });
      expect(off.ui && off.ui[flag]).toBeUndefined();
    });
  }
});

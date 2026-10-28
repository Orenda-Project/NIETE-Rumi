'use strict';
/**
 * Round 8, item 35 (switch sa_r8_counts, OFF by default): the content owner's practice / scored counts per subsection
 * of the RDF forms, and 15 s per story question. OFF: the served battery is today's, byte for byte.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const { SWITCHES, applySwitches } = require('../routes/sa-battery-switches');

const DIR = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa');
const FILES = fs.readdirSync(DIR).filter((n) => /^sa\.coach\.G[1-5]\.A\.(ur|en)\.json$/.test(n));
const load = (n) => JSON.parse(fs.readFileSync(path.join(DIR, n), 'utf8'));
const task = (b, id) => b.tasks.find((t) => t.id === id);

// [practice, scored] per RDF subsection, as the content owner asked (28 Oct)
const WANTED = {
  'ur.letter_names5': [1, 5], 'ur.letter_sounds5': [1, 5], 'ur.words4': [2, 5],
  'en.letter_names5': [1, 5], 'en.letter_sounds5': [1, 5], 'en.words4': [2, 5],
  'ma.number_id8': [1, 8], 'ma.discrimination2': [1, 3], 'ma.missing4': [2, 4],
  'ma.add2i': [1, 5], 'ma.sub2i': [1, 5], 'ma.mul2i': [1, 4], 'ma.fluency1m': [1, 20],
};
const ON = { rdfW3Forms: true, r8Counts: true };

describe('sa_r8_counts (sa-battery-switches.js)', () => {
  test('named sa_r8_counts', () => expect(SWITCHES.r8Counts).toBe('sa_r8_counts'));

  test.each(FILES)('%s OFF: the battery as today', (n) => {
    expect(applySwitches(load(n), { rdfW3Forms: true, r8Counts: false })).toEqual(applySwitches(load(n), { rdfW3Forms: true }));
  });

  test.each(FILES)('%s ON: every RDF subsection has the counts asked for', (n) => {
    const b = applySwitches(load(n), ON);
    for (const [id, [p, s]] of Object.entries(WANTED)) {
      const t = task(b, id);
      expect([id, t.practice.length, t.items.length]).toEqual([id, p, s]);
      expect(new Set(t.items.map((it) => it.id)).size).toBe(s);
      if (Array.isArray(t.grid)) expect(t.grid).toEqual(t.items.map((it) => it.show));
    }
    expect(b.ui.r8_counts).toBe(true);
  });

  test.each(FILES)('%s ON: today\'s items keep their place and id; the new ones are named spares', (n) => {
    const before = load(n);
    const b = applySwitches(before, ON);
    for (const id of Object.keys(WANTED)) {
      const was = task(before, id).items;
      expect(task(b, id).items.slice(0, was.length)).toEqual(was);
      // practice is dropped from the end only
      expect(task(b, id).practice).toEqual(task(before, id).practice.slice(0, WANTED[id][0]));
    }
    const added = (id) => task(b, id).items.slice(task(before, id).items.length);
    const lang = /\.ur\.json$/.test(n) ? 'ur' : 'en';
    expect(added('ur.words4').map((x) => x.show)).toEqual(['گھر']);
    expect(added('en.words4').map((x) => x.show)).toEqual(['come']);
    expect(added('ma.discrimination2').map((x) => [x.target, x.options])).toEqual([[39, [39, 23]]]);
    expect(added('ma.add2i').map((x) => [x.show, x.answer])).toEqual([['12 + 14', 26], ['22 + 37', 59], ['38 + 26', 64]]);
    expect(added('ma.sub2i').map((x) => [x.show, x.answer])).toEqual([['26 − 14', 12], ['59 − 37', 22], ['64 − 26', 38]]);
    expect(added('ma.mul2i').map((x) => [x.show, x.answer])).toEqual([['6 × 6', 36], ['7 × 8', 56]]);
    for (const id of ['ma.add2i', 'ma.sub2i', 'ma.mul2i']) {
      for (const x of added(id)) expect(x.prompt_audio).toMatch(new RegExp(`^sa/v1/${lang}/[0-9a-f]{12}\\.mp3$`));
    }
  });

  test.each(FILES)('%s ON: the story questions give 15 s each, one replay; the missing-number grade difference stays', (n) => {
    const before = load(n);
    const b = applySwitches(before, ON);
    for (const id of ['ur.story_comp_w3', 'en.story_comp_w3']) {
      expect(task(b, id).question_timeout_s).toBe(15);
      expect(task(b, id).replay_max).toBe(1);
      expect(task(b, id).items).toEqual(task(before, id).items);
    }
    expect(task(b, 'ma.missing4')).toEqual(task(before, 'ma.missing4'));
  });
});

describe('the engine route reads sa_r8_counts', () => {
  async function served(r8Counts) {
    const { createSaEngineRouter } = require('../routes/sa-engine.routes');
    const off = () => false;
    const app = express();
    app.use(createSaEngineRouter({ on: () => true, practiceAllMaths: off, passageRotation: off, voiceV2: off, rdfW3Forms: () => true, r8Counts }));
    const srv = app.listen(0);
    try {
      const r = await fetch(`http://127.0.0.1:${srv.address().port}/sa/batteries/sa.coach.G3.A.ur.json`);
      return await r.json();
    } finally { srv.close(); }
  }
  test('ON: five familiar words; OFF: four', async () => {
    expect(task(await served(() => true), 'ur.words4').items).toHaveLength(5);
    expect(task(await served(() => false), 'ur.words4').items).toHaveLength(4);
  });
});

describe('the engine (sa-core): a story question with the counts form', () => {
  const core = require('../sa/sa-core');
  // the served form's question task (15 s with counts ON), run through the real runner
  function at(ms, ui) {
    let t = 0;
    const served = applySwitches(load('sa.coach.G3.A.en.json'), { ...ON, r8Counts: !!ui.counts, r8CompWaitNext: !!ui.wait });
    const q = task(served, 'en.story_comp_w3');
    const battery = { battery_id: 'b', ui: served.ui, lines: {}, tasks: [{ ...q, depends_on: undefined, variants: undefined }] };
    const runner = core.createRunner({ battery, now: () => t, onEvent: () => {} });
    runner.start(); runner.instructionDone(); runner.begin(); runner.promptDone();
    const first = runner.view().item.id;
    t = ms; runner.tick();
    return runner.view().item.id !== first;
  }
  test('counts ON: a question waits 15 s, then moves on (also with wait-for-Next ON: one timer, never none)', () => {
    expect(at(14500, { counts: true })).toBe(false);
    expect(at(15500, { counts: true })).toBe(true);
    expect(at(14500, { counts: true, wait: true })).toBe(false);
    expect(at(15500, { counts: true, wait: true })).toBe(true);
  });
  test('counts OFF: today (10 s; wait-for-Next ON: never by itself)', () => {
    expect(at(10500, {})).toBe(true);
    expect(at(60000, { wait: true })).toBe(false);
  });
});

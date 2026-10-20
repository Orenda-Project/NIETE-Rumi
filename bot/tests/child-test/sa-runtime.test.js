'use strict';

/**
 * The runtime batteries the SA engine runs: sa/sa.<form>.<lang>.json, made from the SA bank by sa/build.js
 * runtimeBattery. Each one must pass the engine's own validate (dashboard/sa/sa-core.js) and start a runner, every
 * block and island must name a task in it, and the stop and skip rules must be in the engine's terms.
 */

const path = require('path');
const fs = require('fs');

const DATA = path.join(__dirname, '../../shared/data/child-test');
const core = require('../../../dashboard/sa/sa-core.js');
const { buildSaBank, runtimeBattery, FORMS } = require('../../shared/services/child-test/sa/build');
const v3 = require('../../shared/data/child-test/item-bank.v3.json');
const extra = require('../../shared/data/child-test/item-bank.sa-extra.v1.json');

const bank = buildSaBank({ v3, extra });
const files = FORMS.flatMap(({ form }) => ['ur', 'en'].map((lang) => [`sa.${form}.${lang}.json`, form, lang]));
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, 'sa', f), 'utf8'));

describe('SA runtime batteries (what /sa/play.html runs)', () => {
  test.each(files)('%s is committed, current, and passes the engine\'s validate', (f, form, lang) => {
    const b = read(f);
    expect(b).toEqual(JSON.parse(JSON.stringify(runtimeBattery(bank, form, lang))));
    expect(core.validate(b)).toBe(true);
    const r = core.createRunner({ battery: b, now: () => 0, session_id: 't' });
    expect(r).toBeTruthy();
  });

  test.each(files)('%s: every block, island and tower id is one of its tasks', (f) => {
    const b = read(f);
    const ids = new Set(b.tasks.map((t) => t.id));
    const lists = b.surface === 'coach' ? [...Object.values(b.blocks), b.full] : [...Object.values(b.islands), b.tower];
    for (const l of lists) for (const id of l) expect(ids.has(id)).toBe(true);
  });

  test.each(files)('%s: stop rules, skips and lines in the engine\'s terms and the battery\'s language', (f, form, lang) => {
    const b = read(f);
    const t = Object.fromEntries(b.tasks.map((x) => [x.id, x]));
    expect(t['ur.letters'].stop).toEqual({ first_line_n: 10, first_line_min_correct: 1 });
    expect(t['ur.letters'].options_n).toBe(5);
    expect(t['en.words'].response).toBe('tap');
    expect(t['ma.add1'].response).toBe('keypad');
    expect(t['ur.story'].response).toBe('record');
    expect(t['ur.story'].last_word_tap).toBe(true);
    expect(t['ur.story'].depends_on).toEqual({ task: 'ur.words', skip_if_stop: 'early_stop_first_line' });
    expect(t['ur.story_comp'].response).toBe('oral');
    expect(t['ur.story_comp'].depends_on).toEqual({ task: 'ur.story', upto_item: 'last_word_tap' });
    expect(t['ma.add2'].depends_on).toEqual({ task: 'ma.add1', skip_if_zero: true });
    expect(typeof b.lines.welcome.text).toBe('string');
    expect(b.lines.welcome.audio).toMatch(new RegExp(`^sa/v1/${lang}/[0-9a-f]{12}\\.mp3$`));
    expect(t['ma.add1'].instruction.audio).toMatch(new RegExp(`^sa/v1/${lang}/`));
    // The item's own language wins for what is said (an English word is said in English on an Urdu battery).
    expect(t['en.words'].items[0].prompt_audio).toMatch(/^sa\/v1\/en\//);
  });

  test('engine runs ur.story_comp only up to the line reached', () => {
    const b = read('sa.coach.G3.A.ur.json');
    const comp = b.tasks.find((x) => x.id === 'ur.story_comp');
    expect(comp.items.every((q) => typeof q.prompt.text === 'string' && /^sa\/v1\/ur\//.test(q.prompt.audio))).toBe(true);
    expect(comp.items.some((q) => q.needs_line != null)).toBe(true);
  });
});

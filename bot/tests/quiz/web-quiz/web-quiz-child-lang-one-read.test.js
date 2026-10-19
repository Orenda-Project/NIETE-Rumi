'use strict';
/**
 * The child's language switch (app_settings web_quiz_return_lang) rides the kid hub's one switch read
 * (web-quiz-hub-flags.js flags()): once the hub has read its switches, asking whether the child's language is on reads
 * nothing more, so every hub open makes the same settings reads as before the switch existed. The value is this
 * switch's own (only the JSON boolean true is on). Supabase is the boundary and is faked.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
const Ret = require('../../../shared/services/quiz/web-quiz-return-lang');

let fake;
function seed(rows) {
  fake = makeFake({ app_settings: [{ key: 'web_quiz_hub', value: true }, ...rows] });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  Flags._resetCache();
  Ret._resetCache();
}
const settingsReads = () => fake.calls.filter((c) => c.table === 'app_settings').length;

describe('the hub\'s one switch read carries the child\'s language switch', () => {
  test.each([
    ['absent', [], false],
    ['false', [{ key: 'web_quiz_return_lang', value: false }], false],
    ['JSON true', [{ key: 'web_quiz_return_lang', value: true }], true],
    ['the string "true" (off: only the JSON boolean is on)', [{ key: 'web_quiz_return_lang', value: 'true' }], false],
  ])('row %s: one settings read in all, the switch\'s own value', async (_l, rows, want) => {
    seed(rows);
    await Flags.flags();
    expect(await Ret.on()).toBe(want);
    expect(settingsReads()).toBe(1);
  });

  test('the hub\'s switch reads failing: hub off as before, the switch reads its own row', async () => {
    seed([{ key: 'web_quiz_return_lang', value: true }]);
    const from = supabase.from;
    supabase.from = (t) => {
      const b = from(t);
      if (t === 'app_settings') b.in = () => { throw new Error('settings down'); };
      return b;
    };
    expect((await Flags.flags()).hub).toBe(false);
    expect(await Ret.on()).toBe(true);
  });

  test('reading the child\'s language row throws (in any read that names it): the hub stays on, that switch off', async () => {
    const { throwOn } = require('../../helpers/switch-off-matrix');
    seed([{ key: 'web_quiz_return_lang', value: true }]);
    supabase.from = throwOn(supabase.from, 'web_quiz_return_lang');
    expect((await Flags.flags()).hub).toBe(true);
    expect(await Ret.on()).toBe(false);
  });

  test.each([
    ['absent', [], false],
    ['false', [{ key: 'web_quiz_return_lang', value: false }], false],
    ['JSON true', [{ key: 'web_quiz_return_lang', value: true }], true],
  ])('the hub\'s switches warm, only this switch\'s cache cold (row %s): it answers from the hub\'s read, no read of its own', async (_l, rows, want) => {
    seed(rows);
    await Flags.flags();
    await Flags.flags();
    expect(settingsReads()).toBe(1);
    Ret._resetCache();
    expect(await Ret.on()).toBe(want);
    expect(settingsReads()).toBe(1);
  });

  test('the hub\'s switches warm from a read without this row (the combined read failed): this switch still reads its own row', async () => {
    const { throwOn } = require('../../helpers/switch-off-matrix');
    seed([{ key: 'web_quiz_return_lang', value: true }]);
    const from = supabase.from;
    supabase.from = throwOn(from, 'web_quiz_return_lang');
    expect((await Flags.flags()).hub).toBe(true);
    supabase.from = from;
    Ret._resetCache();
    expect(await Ret.on()).toBe(true);
  });

  test('a stale hub cache re-read refreshes the switch too', async () => {
    seed([{ key: 'web_quiz_return_lang', value: false }]);
    const t0 = Date.now();
    await Flags.flags(t0);
    expect(await Ret.on(t0)).toBe(false);
    fake.db.app_settings.find((r) => r.key === 'web_quiz_return_lang').value = true;
    await Flags.flags(t0 + 31 * 1000);
    expect(await Ret.on(t0 + 31 * 1000)).toBe(true);
    expect(settingsReads()).toBe(2);
  });
});

describe('the child\'s language switch answers from the hub\'s read only while that read is live and its own', () => {
  test('an earlier good read, then the hub\'s read fails 31 s later: a cold language switch never answers from the earlier read', async () => {
    const { throwOn } = require('../../helpers/switch-off-matrix');
    seed([{ key: 'web_quiz_return_lang', value: true }]);
    const t0 = Date.now();
    await Flags.flags(t0);
    expect(settingsReads()).toBe(1);
    supabase.from = throwOn(supabase.from, 'web_quiz_return_lang');
    expect((await Flags.flags(t0 + 31 * 1000)).hub).toBe(true);
    expect(settingsReads()).toBe(2); // the hub's switches re-read on their own
    Ret._resetCache();
    expect(await Ret.on(t0 + 31 * 1000)).toBe(false); // its own read fails, so off; never the 31 s old on
    expect(settingsReads()).toBe(2);
  });

  test('the hub\'s read stale, the language switch cold: it reads its own row and answers the fresh value', async () => {
    seed([{ key: 'web_quiz_return_lang', value: true }]);
    const t0 = Date.now();
    await Flags.flags(t0);
    fake.db.app_settings.find((r) => r.key === 'web_quiz_return_lang').value = false;
    Ret._resetCache();
    const before = settingsReads();
    expect(await Ret.on(t0 + 31 * 1000)).toBe(false);
    expect(settingsReads() - before).toBe(1);
  });

  test('the row is the string "true", the hub\'s read live, the language switch cold: off, with no read of its own', async () => {
    seed([{ key: 'web_quiz_return_lang', value: 'true' }]);
    await Flags.flags();
    Ret._resetCache();
    expect(await Ret.on()).toBe(false);
    expect(settingsReads()).toBe(1);
  });
});

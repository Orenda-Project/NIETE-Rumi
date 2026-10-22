'use strict';

/**
 * The last word read, suggested from the passage recording (app_settings sa_coach_last_word, default OFF; a pilot list
 * of coach ids or true). The coach's phone asks for it after the passage (POST /sa/session/:id/last-word-hint
 * { taskId }); the bot transcribes the clip once (Soniox) and aligns the words heard to the passage in order. The coach's
 * tap then confirms it or picks another word. Never a 500: no switch → off, no clip yet → pending, STT failure → null.
 */

const { lastWordIndex } = require('../../shared/services/child-test/sa/last-word-hint');
const sa = require('../../shared/services/child-test/app/sa-api.service');

const heard = (s) => s.split(/\s+/).filter(Boolean).map((w) => ({ w, raw: w }));
const EN = 'Imran woke up early. He saw his father in the garden. His father was planting trees. Imran ran to help him.'.split(' ');

describe('lastWordIndex: the words heard, aligned in order to the passage', () => {
  test('read to word 12 with one word misheard: index 11', () => {
    const got = lastWordIndex(EN, heard('imran woke up early he saw hiss father in the garden his'), 'en');
    expect(got.index).toBe(11);
    expect(got.matched).toBeGreaterThanOrEqual(10);
  });
  test('punctuation and case never matter', () => {
    expect(lastWordIndex(EN, heard('Imran, woke UP early.'), 'en').index).toBe(3);
  });
  test('a repeated word and a skipped word: the end is still found', () => {
    expect(lastWordIndex(EN, heard('imran imran woke early he he saw his'), 'en').index).toBe(6);
  });
  test('a skipped line (more than 4 words) is caught up by two words in a row', () => {
    expect(lastWordIndex(EN, heard('imran woke up early his father was planting trees'), 'en').index).toBe(15);
  });
  test('Urdu: diacritics and letter forms differ, the index is right', () => {
    const UR = 'آج بلال صبح سویرے اٹھا۔ اس نے اپنے ابّو کو باغ میں دیکھا۔'.split(' ');
    expect(lastWordIndex(UR, heard('اج بلال صبح سویرے اٹھا اس نے اپنے ابو کو'), 'ur').index).toBe(9);
  });
  test('fewer than 2 words matched: null (other talk, silence)', () => {
    expect(lastWordIndex(EN, heard('okay go on please'), 'en')).toEqual({ index: null, matched: 0 });
    expect(lastWordIndex(EN, [], 'en').index).toBeNull();
    expect(lastWordIndex(EN, heard('imran'), 'en').index).toBeNull();
  });
});

const SID = 'cccccccc-0000-4000-8000-000000000003';
const COACH = 'aaaaaaaa-0000-4000-8000-000000000001';
const KEY = `child-test/sandbox/sch-1/${SID}/sa/en.story_w3.webm`;

function world({ on = true, key = KEY, stt } = {}) {
  const logs = [];
  const sess = { id: SID, coach_user_id: COACH, school_id: 'sch-1', grade: 3, form: 'A', item_bank_version: 'sa-battery' };
  const deps = {
    enabled: async () => true,
    coachLastWord: on,
    supabase: { from: () => { throw new Error('no direct reads'); } },
    store: {
      getSession: async () => ({ ok: true, session: sess }),
      listBlocks: async () => ({ ok: true, blocks: key ? [{ block: 'en.story_w3', audio_r2_key: key }] : [{ block: 'en.story_w3', audio_r2_key: null }] }),
    },
    saStore: { findByClient: async () => ({ ok: true, sessionId: null }) },
    hintWords: stt || (async () => heard('okay imran woke up early for school today his class was planting')),
    now: () => new Date('2026-10-22T14:00:00Z'),
    log: (...a) => logs.push(a), logError: (...a) => logs.push(a),
  };
  return { deps, logs };
}
const ask = (deps, taskId = 'en.story_w3') => sa.saLastWordHint({ userId: COACH, sessionId: SID, taskId }, deps);

describe('saLastWordHint', () => {
  test('switch off: off, nothing transcribed', async () => {
    const stt = jest.fn();
    const { deps } = world({ on: false, stt });
    expect(await ask(deps)).toEqual({ status: 'ok', off: true });
    expect(stt).not.toHaveBeenCalled();
  });
  test('no recording on the row yet: pending', async () => {
    const { deps } = world({ key: null });
    expect(await ask(deps)).toEqual({ status: 'ok', pending: true });
  });
  test('the clip heard to "planting" on the G3 English passage (after the coach\'s "okay"): the word index, heard, matched', async () => {
    const { deps, logs } = world();
    const out = await ask(deps);
    expect(out).toMatchObject({ status: 'ok', index: 10, heard: 12 });
    expect(out.matched).toBeGreaterThanOrEqual(10);
    expect(JSON.stringify(logs)).not.toMatch(/planting/);
  });
  test('STT fails: index null, reason stt_failed (never an error)', async () => {
    const { deps } = world({ stt: async () => { throw new Error('soniox down'); } });
    expect(await ask(deps)).toEqual({ status: 'ok', index: null, reason: 'stt_failed' });
  });
  test('a task that is not a passage: invalid', async () => {
    const { deps } = world();
    expect(await ask(deps, 'en.words4')).toEqual({ status: 'invalid', reason: 'not_a_passage' });
  });
});

describe('the internal route', () => {
  test('/sa/last-word-hint maps to saLastWordHint with taskId', () => {
    const src = require('fs').readFileSync(require.resolve('../../shared/routes/child-test-app.routes.js'), 'utf8');
    expect(src).toMatch(/'\/sa\/last-word-hint': \['saLastWordHint', \['userId', 'sessionId', 'taskId'\], 'sa-api\.service'\]/);
  });
});

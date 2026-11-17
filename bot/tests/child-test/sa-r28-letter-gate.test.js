'use strict';

/**
 * sa_r28_letter_gate (app_settings, default OFF): the speech gate muted a whole letter clip when speech-to-text heard no
 * WORD in it, and a child saying bare letter sounds (/b/ /m/ /s/) says no word. ON, for the two letter subtasks only,
 * the letters path makes no speech-to-text call: only the duration floor and the model's own found:false mute a clip.
 * The scorer's own path runs here (battery task, prompt, marks); only the clip, speech-to-text and the model are
 * stand-ins at the dependency boundary. Every fixture is synthetic.
 */

jest.mock('../../shared/config/supabase', () => ({ from: () => { throw new Error('no db in this test'); } }));

const score = require('../../shared/services/child-test/sa/score');
const letterGate = require('../../shared/services/child-test/app/letter-gate-switch');

const SID = 'eeeeeeee-0000-4000-8000-000000000028';
const KEY = (t) => `child-test/sandbox/sch-1/${SID}/sa/${t}.webm`;

const item = (task, k, show, answer) => ({ id: `${task}.0${k + 1}`, show, target: show, answer, src: 'synthetic' });
const grid = (id, subtask, shows, answers) => ({
  id, w3: true, kind: 'grid', subtask, lang: id.slice(0, 2), response: 'record', present: 'one_at_a_time', time_limit_s: 60, stop: {},
  grid: shows, items: shows.map((s, k) => item(id, k, s, answers[k])),
});
const BATTERY = {
  tasks: [
    grid('ur.letter_sounds5', 'letter_sound_identification', ['ب', 'م', 'ک', 'س', 'ر'], ['/ب/', '/م/', '/ک/', '/س/', '/ر/']),
    grid('ur.letter_names5', 'letter_name_identification', ['د', 'ج', 'پ', 'ت', 'ا'], ['دال', 'جیم', 'پے', 'تے', 'الف']),
    grid('ur.words4', 'familiar_word_reading', ['بچہ', 'دروازہ', 'پانی', 'کتاب'], ['بچہ', 'دروازہ', 'پانی', 'کتاب']),
    // a future recording on a task whose subtask merely CONTAINS "letter": never the letters gate
    grid('ur.letter_rec5', 'letter_pick_monitor', ['ب', 'م', 'ک', 'س', 'ر'], ['/ب/', '/م/', '/ک/', '/س/', '/ر/']),
    { id: 'ur.letter_pick10', w3: true, r28: 'letter_pick', replaces: 'ur.letter_sounds5', kind: 'pick', response: 'tap',
      subtask: 'letter_sound_identification', lang: 'ur', time_limit_s: null, stop: {}, replay_at_s: 10, next_at_s: 15,
      items: [{ id: 'ur.letter_pick10.01', options: ['ت', 'ب', 'پ', 'ٹ', 'ن'], target: 'ب', prompt_audio: 'sa/v5/ur/x.mp3', prompt_text: 'بَ', src: 'synthetic' }] },
  ],
};

const session = () => ({ id: SID, grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'completed', finished_at: '2026-11-17T10:00:00Z' });
const row = (block, over = {}) => ({
  id: `row-${block}`, session_id: SID, block, response_mode: 'record', ai_status: 'failed', ai_reason: 'final:sa_score_later',
  ai_marks: null, audio_r2_key: KEY(block), audio_r2_keys: null, updated_at: '2026-11-17T09:58:00Z',
  responses: [{ kind: 'result', mode: 'record', session_id: 'phone-session', time_used_ms: 30000 }],
  ...over,
});

/** Stand-ins: a clip of `dur` seconds, speech-to-text hearing `words`, the model marking the first `right` letters c. */
function standIns({ dur = 3, words = 0, right = 3, found = true, n = 5 } = {}) {
  const stt = [];
  const prompts = [];
  return {
    stt, prompts,
    bank: { forms: {}, tasks: {} },
    phoneBattery: () => BATTERY,
    clipOf: async (key) => ({ base64: 'AAAA', durationSec: dur, key }),
    speechOf: async (clip, lang) => { stt.push(lang); return { words, text: words ? 'x' : '', model: 'stt:test', cost: 0.003, seconds: 1 }; },
    model: () => 'model:test',
    chatJSON: async ({ prompt, job }) => {
      prompts.push({ job, prompt });
      if (job === 'child_test.sa_words') return { json: { words: [1, 2, 3, 4].map((i) => ({ i, w: 'x', v: 'correct' })), words_correct: 4, words_attempted: 4, notes: '' }, cost: 0.001, seconds: 1 };
      return { json: { found, last_attempted: n, letters_correct: right, items: Array.from({ length: n }, (_, k) => ({ i: k + 1, heard: 'x', v: k < right ? 'c' : 'w', conf: 0.9 })) }, cost: 0.001, seconds: 1 };
    },
  };
}
const verdicts = (got) => got.marks.detail.items.map((i) => i.verdict);
const gateCalls = (got) => got.marks.meta.calls.filter((c) => c.job === 'child_test.sa_speech_gate').map((c) => c.model);

const OFF_UR_SOUND = "A child in a Pakistani government school (grade 3) is doing the timed Urdu LETTER SOUND task of an EGRA reading test ALONE on a phone, wearing headphones. The phone showed 5 letters ONE AT A TIME, in this order, each for a few seconds, and recorded the child for up to 60 seconds. There is no adult in the clip; the phone's own voice may be faintly heard.\nMarking rules: the child says each letter's SOUND (e.g. \"بَ\" for ب); a letter NAME said instead of its sound is WRONG. A self-correction counts as correct. A letter said wrongly, or passed over while the child keeps going, is WRONG. Every position after the last letter the child reached is SKIPPED.\nThe printed letters in order (position: letter (what a correct child says)):\n1: ب (/ب/) 2: م (/م/) 3: ک (/ک/) 4: س (/س/) 5: ر (/ر/)\nFor EVERY position 1-5 return v = \"c\" (correct), \"w\" (wrong) or \"s\" (skipped / not reached), heard = what the child said for that letter (\"\" if skipped), and conf = your confidence 0-1 in that verdict. found = whether the clip contains the child saying letters from this card at all.\nReturn ONLY JSON: {\"found\": true, \"last_attempted\": <int>, \"letters_correct\": <int>, \"items\": [{\"i\": 1, \"heard\": \"...\", \"v\": \"c|w|s\", \"conf\": 0.9}, ...]}";
const OFF_EN_NAME = "A child in a Pakistani government school (grade 3) is doing the timed English LETTER NAME task of an EGRA reading test ALONE on a phone, wearing headphones. The phone showed a card of 5 letters, 10 per row, read left to right row by row, and recorded the child for up to 60 seconds. There is no adult in the clip; the phone's own voice may be faintly heard.\nMarking rules: the child says each letter's NAME (upper or lower case is the same letter); a clear letter SOUND for that letter also counts. A self-correction counts as correct. A letter said wrongly, or passed over while the child keeps going, is WRONG. Every position after the last letter the child reached is SKIPPED.\nThe printed card in reading order (position: letter):\n1: b 2: m 3: s 4: t 5: a\nFor EVERY position 1-5 return v = \"c\" (correct), \"w\" (wrong) or \"s\" (skipped / not reached), heard = what the child said for that letter (\"\" if skipped), and conf = your confidence 0-1 in that verdict. found = whether the clip contains the child saying letters from this card at all.\nReturn ONLY JSON: {\"found\": true, \"last_attempted\": <int>, \"letters_correct\": <int>, \"items\": [{\"i\": 1, \"heard\": \"...\", \"v\": \"c|w|s\", \"conf\": 0.9}, ...]}";

describe('sa_r28_letter_gate: letter clips are not muted because speech-to-text heard no word', () => {
  const before = { ...process.env };
  beforeEach(() => {
    process.env.CHILD_TEST_SA_SCORER = 'on'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; process.env.CHILD_TEST_SA_SPEECH_GATE = 'on';
    delete process.env.CHILD_TEST_SA_MIN_SPEECH_S; delete process.env.CHILD_TEST_SA_SECOND_VOICE;
  });
  afterEach(() => { process.env = { ...before }; });

  test('1. OFF (default): letter sounds, STT 0 words -> not_reached x5, no model call, calls[] as today', async () => {
    const s = standIns({ words: 0 });
    const got = await score.scoreRow(row('ur.letter_sounds5'), session(), s);
    expect(got.ok).toBe(true);
    expect(verdicts(got)).toEqual(Array(5).fill('not_reached'));
    expect(got.marks.correct).toBe(0);
    expect(s.stt).toEqual(['ur']);
    expect(s.prompts).toEqual([]);
    expect(gateCalls(got)).toEqual(['stt:test']);
    expect(got.marks.detail).not.toHaveProperty('letter_gate');
  });

  test('1b. OFF given explicitly (letterGate: false) is the same as absent', async () => {
    const s = standIns({ words: 0 });
    const got = await score.scoreRow(row('ur.letter_sounds5'), session(), { ...s, letterGate: false });
    expect(verdicts(got)).toEqual(Array(5).fill('not_reached'));
    expect(s.stt).toEqual(['ur']);
    expect(got.marks.detail).not.toHaveProperty('letter_gate');
  });

  test('2. ON: the same fixture makes no STT call, reaches the model, scores 3/5, records skipped_r28 and letter_gate', async () => {
    const s = standIns({ words: 0, right: 3 });
    const got = await score.scoreRow(row('ur.letter_sounds5'), session(), { ...s, letterGate: true });
    expect(got.ok).toBe(true);
    expect(s.stt).toEqual([]);
    expect(s.prompts.map((p) => p.job)).toEqual(['child_test.sa_letters']);
    expect(got.marks.correct).toBe(3);
    expect(verdicts(got)).toEqual(['correct', 'correct', 'correct', 'wrong', 'wrong']);
    expect(gateCalls(got)).toEqual(['skipped_r28']);
    expect(got.marks.meta.calls.find((c) => c.model === 'skipped_r28')).toMatchObject({ job: 'child_test.sa_speech_gate', cost: 0, error: null });
    expect(got.marks.detail.letter_gate).toBe('r28');
  });

  test('2b. ON: letter NAMES are under the gate too', async () => {
    const s = standIns({ words: 0, right: 2 });
    const got = await score.scoreRow(row('ur.letter_names5'), session(), { ...s, letterGate: true });
    expect(s.stt).toEqual([]);
    expect(got.marks.correct).toBe(2);
    expect(got.marks.detail.letter_gate).toBe('r28');
  });

  test('3. ON: a 0.5 s letter clip stays not_reached x5 (the duration floor), no STT and no model call', async () => {
    const s = standIns({ dur: 0.5, words: 0 });
    const got = await score.scoreRow(row('ur.letter_sounds5'), session(), { ...s, letterGate: true });
    expect(verdicts(got)).toEqual(Array(5).fill('not_reached'));
    expect(got.marks.detail.items.every((i) => i.no_speech && i.conf === 0)).toBe(true);
    expect(s.stt).toEqual([]);
    expect(s.prompts).toEqual([]);
    expect(gateCalls(got)).toEqual(['duration']);
  });

  test('4. ON: a 3 s clip with STT 0 words reaches the model (and STT is not even asked)', async () => {
    const s = standIns({ dur: 3, words: 0, right: 5 });
    const got = await score.scoreRow(row('ur.letter_sounds5'), session(), { ...s, letterGate: true });
    expect(s.prompts).toHaveLength(1);
    expect(got.marks.correct).toBe(5);
  });

  test("4b. ON: the model's own found:false still mutes the clip", async () => {
    const s = standIns({ words: 0, right: 5, found: false });
    const got = await score.scoreRow(row('ur.letter_sounds5'), session(), { ...s, letterGate: true });
    expect(got.marks.correct).toBe(0);
    expect(got.marks.detail.items.every((i) => i.verdict === 'not_reached' && i.no_speech)).toBe(true);
  });

  test('5. ON: a non-letter grid task (familiar_word_reading) is untouched: STT called, 0 words mutes', async () => {
    const s = standIns({ words: 0 });
    const got = await score.scoreRow(row('ur.words4'), session(), { ...s, letterGate: true });
    expect(s.stt).toEqual(['ur']);
    expect(s.prompts).toEqual([]);
    expect(verdicts(got)).toEqual(Array(4).fill('not_reached'));
    expect(gateCalls(got)).toEqual(['stt:test']);
    expect(got.marks.detail).not.toHaveProperty('letter_gate');
  });

  test('6. ON: the scope is the two subtask names, never /letter/: a "letter_pick_monitor" recording keeps the STT mute', async () => {
    const s = standIns({ words: 0 });
    const got = await score.scoreRow(row('ur.letter_rec5'), session(), { ...s, letterGate: true });
    expect(s.stt).toEqual(['ur']);
    expect(verdicts(got)).toEqual(Array(5).fill('not_reached'));
    expect(got.marks.detail).not.toHaveProperty('letter_gate');
  });

  test('6b. ON: a tap picker row (kind pick, subtask letter_sound_identification) is never scored: no_scorer_for_kind', async () => {
    const s = standIns({ words: 0 });
    const pick = row('ur.letter_pick10', { response_mode: 'tap', audio_r2_key: null });
    for (const gate of [true, false]) {
      const got = await score.scoreRow(pick, session(), { ...s, letterGate: gate });
      expect(got).toEqual({ ok: false, reason: 'no_scorer_for_kind', retry: false });
    }
    expect(s.stt).toEqual([]);
    expect(s.prompts).toEqual([]);
  });

  test('7. lettersPrompt: OFF text is byte-identical to today; ON adds the bare-phonemes sentence', () => {
    const p = score.__internals.lettersPrompt;
    const ur = { grade: 3, lang: 'ur', items: ['ب', 'م', 'ک', 'س', 'ر'], perRow: 10, sound: true, answers: ['/ب/', '/م/', '/ک/', '/س/', '/ر/'], one: true };
    const en = { grade: 3, lang: 'en', items: ['b', 'm', 's', 't', 'a'], perRow: 10, sound: false, answers: [], one: false };
    expect(p(ur)).toBe(OFF_UR_SOUND);
    expect(p(en)).toBe(OFF_EN_NAME);
    expect(p({ ...ur, phonemes: false })).toBe(OFF_UR_SOUND);
    const on = p({ ...ur, phonemes: true });
    expect(on).toContain(score.__internals.BARE_PHONEMES);
    expect(on.replace(` ${score.__internals.BARE_PHONEMES}`, '')).toBe(OFF_UR_SOUND);
    expect(p({ ...en, phonemes: true })).toContain(score.__internals.BARE_PHONEMES);
  });

  test('7b. ON: the prompt the model gets on a letters row carries the sentence; OFF it does not', async () => {
    const on = standIns({ words: 3 });
    await score.scoreRow(row('ur.letter_sounds5'), session(), { ...on, letterGate: true });
    expect(on.prompts[0].prompt).toContain(score.__internals.BARE_PHONEMES);
    const off = standIns({ words: 3 });
    await score.scoreRow(row('ur.letter_sounds5'), session(), off);
    expect(off.prompts[0].prompt).not.toContain(score.__internals.BARE_PHONEMES);
  });

  test("8. silent() names its reason: 'duration' / 'no_words' / false (and null when it cannot tell)", async () => {
    const { silent } = score.__internals;
    const deps = (words) => ({ speechOf: async () => ({ words, model: 'stt:test', cost: 0 }) });
    expect(await silent(deps(3), [], { durationSec: 0.5 }, 'ur')).toBe('duration');
    expect(await silent(deps(0), [], { durationSec: 3 }, 'ur')).toBe('no_words');
    expect(await silent(deps(2), [], { durationSec: 3 }, 'ur')).toBe(false);
    expect(await silent({}, [], { durationSec: 3 }, 'ur')).toBe(null);
    // the letters path under the switch: no STT, only the floor
    const calls = [];
    const never = { speechOf: async () => { throw new Error('STT must not be called'); } };
    expect(await silent(never, calls, { durationSec: 3 }, 'ur', null, { skipStt: true })).toBe(false);
    expect(await silent(never, calls, { durationSec: 0.5 }, 'ur', null, { skipStt: true })).toBe('duration');
    expect(calls.map((c) => c.model)).toEqual(['skipped_r28', 'duration']);
    delete process.env.CHILD_TEST_SA_SPEECH_GATE;
    expect(await silent(deps(0), [], { durationSec: 3 }, 'ur')).toBe(null);
  });
});

describe('the sweep reads app_settings sa_r28_letter_gate and hands it to the scorer', () => {
  const before = { ...process.env };
  beforeEach(() => { process.env.CHILD_TEST_SA_SCORER = 'on'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; process.env.CHILD_TEST_SA_SPEECH_GATE = 'on'; score.__internals.resetBoot(); });
  afterEach(() => { process.env = { ...before }; });

  function fakeDb(tables) {
    function query(name) {
      const f = []; let patch = null; let lim = null;
      const q = {
        select() { return q; }, order() { return q; }, in() { return q; },
        limit(n) { lim = n; return q; },
        eq(c, v) { f.push((r) => r[c] === v); return q; },
        is(c, v) { f.push((r) => (r[c] ?? null) === v); return q; },
        like(c, v) { const pre = v.replace(/%$/, ''); f.push((r) => String(r[c] || '').startsWith(pre)); return q; },
        gte(c, v) { f.push((r) => String(r[c]) >= v); return q; },
        update(x) { patch = x; return q; },
        then(ok, bad) {
          try {
            const hit = (tables[name] || []).filter((r) => f.every((fn) => fn(r)));
            if (patch) { hit.forEach((r) => Object.assign(r, patch)); return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null }).then(ok, bad); }
            const copy = hit.map((r) => JSON.parse(JSON.stringify(r)));
            return Promise.resolve({ data: lim ? copy.slice(0, lim) : copy, error: null }).then(ok, bad);
          } catch (e) { return Promise.reject(e).then(ok, bad); }
        },
      };
      return q;
    }
    return { from: query };
  }

  test('setting true: the letters row is scored through the gate (no STT, model marks stand, letter_gate r28)', async () => {
    const r = row('ur.letter_sounds5');
    const db = fakeDb({ child_test_blocks: [r], child_test_sessions: [session()], app_settings: [{ key: 'sa_r28_letter_gate', value: true }] });
    const s = standIns({ words: 0, right: 3 });
    const out = await score.sweepOnce({ now: new Date('2026-11-17T10:05:00Z'), deps: { supabase: db, ...s } });
    expect(out).toMatchObject({ found: 1, scored: 1 });
    expect(s.stt).toEqual([]);
    expect(r.ai_marks).toMatchObject({ task: 'ur.letter_sounds5', correct: 3 });
    expect(r.ai_marks.detail.letter_gate).toBe('r28');
  });
});

describe('the switch module (app_settings sa_r28_letter_gate)', () => {
  test("a test's letterGate wins; only JSON true is on", async () => {
    expect(letterGate.KEY).toBe('sa_r28_letter_gate');
    expect(await letterGate.enabled({ letterGate: true })).toBe(true);
    expect(await letterGate.enabled({ letterGate: false })).toBe(false);
    expect(await letterGate.enabled({ letterGate: 'true' })).toBe(false);
    expect(await letterGate.enabled({ letterGate: async () => true })).toBe(true);
  });

  test('the setting: JSON true is on; no row, another value or a read error is off (fails closed)', async () => {
    const client = (rows, error = null) => ({ from: () => ({ select: () => ({ eq: async () => ({ data: rows, error }) }) }) });
    expect(await letterGate.on(1e12, client([{ key: 'sa_r28_letter_gate', value: true }]))).toBe(true);
    expect(await letterGate.on(2e12, client([]))).toBe(false);
    expect(await letterGate.on(3e12, client([{ key: 'sa_r28_letter_gate', value: 'yes' }]))).toBe(false);
    expect(await letterGate.on(4e12, client(null, { message: 'down' }))).toBe(false);
  });
});

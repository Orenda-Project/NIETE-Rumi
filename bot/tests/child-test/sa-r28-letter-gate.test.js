'use strict';

/**
 * sa_r28_letter_gate (app_settings, default OFF): the speech gate muted a whole letter-sound clip when speech-to-text
 * heard no WORD in it, and a child saying bare letter sounds (/b/ /m/ /s/) says no word. ON, for letter SOUNDS and letter
 * NAMES (a single spoken letter name often comes back from speech-to-text as no word too), an energy voice-activity
 * check on the clip (relative to its own noise floor; no speech-to-text call) takes the place of the word count; the
 * duration floor and the model's own found:false still mute. Letter sounds go to the model without the expected
 * answers (variant B); the letter-names prompt is unchanged. Spoken maths and words keep today's speech-to-text gate.
 * The scorer's own path runs here
 * (battery task, the real ffmpeg decode of the clip, prompt, marks); speech-to-text and the model are stand-ins. Every
 * clip is synthetic, generated below.
 */

jest.mock('../../shared/config/supabase', () => ({ from: () => { throw new Error('no db in this test'); } }));

const score = require('../../shared/services/child-test/sa/score');
const letterGate = require('../../shared/services/child-test/app/letter-gate-switch');
const { voiceActivity, VAD } = require('../../shared/services/child-test/sa/voice-activity');

const SID = 'eeeeeeee-0000-4000-8000-000000000028';
const KEY = (t) => `child-test/sandbox/sch-1/${SID}/sa/${t}.webm`;
const RATE = 16000;

// ---- synthetic audio --------------------------------------------------------------------------------------------
let seed = 7;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
/** white noise with this RMS in dBFS */
const noise = (dbfs) => { const a = Math.sqrt(3) * 10 ** (dbfs / 20); return () => (rand() * 2 - 1) * a; };
const SILENCE = () => 0;
const HISS_40 = noise(-40);
/** a "child" saying three short sounds over a quiet room: 0.4 s bursts (a 220 Hz voice at about -13 dBFS) */
const BURSTS = [[0.3, 0.7], [1.2, 1.6], [2.1, 2.5]];
const room = noise(-60);
const VOICED = (t) => room() + (BURSTS.some(([a, b]) => t >= a && t < b) ? 0.3 * Math.sin(2 * Math.PI * 220 * t) : 0);
function pcm(seconds, fill) {
  seed = 7;
  const n = Math.round(seconds * RATE);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i += 1) out[i] = Math.max(-32768, Math.min(32767, Math.round(fill(i / RATE) * 32767)));
  return out;
}
/** a 16 kHz mono 16-bit WAV, base64: what the stand-in R2 fetch hands the scorer (the real ffmpeg decode reads it) */
function wav(seconds, fill) {
  const s = pcm(seconds, fill);
  const data = Buffer.alloc(s.length * 2);
  s.forEach((x, i) => data.writeInt16LE(x, i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]).toString('base64');
}
/** a child sounding letters with no pause: 6 s of 400 ms sounds and 100 ms gaps over a quiet room (no 150 ms silence) */
const NO_PAUSE = (t) => room() + ((t % 0.5) < 0.4 ? 0.3 * Math.sin(2 * Math.PI * 220 * t) : 0);
/** steady noise whose level wobbles (every 50 ms between -45 and -30 dBFS): no 150 ms below its floor, a small margin */
const wobbleLo = noise(-45); const wobbleHi = noise(-30);
const WOBBLE = (t) => (Math.floor(t / 0.05) % 2 ? wobbleHi() : wobbleLo());
const CLIPS = { silent6: [6, SILENCE], hiss6: [6, HISS_40], voiced3: [3, VOICED], short05: [0.5, VOICED], nopause6: [6, NO_PAUSE], wobble6: [6, WOBBLE] };
const CLIP64 = {};
const clipFor = (name) => { if (!CLIP64[name]) CLIP64[name] = wav(...CLIPS[name]); return { base64: CLIP64[name], durationSec: CLIPS[name][0] }; };

// ---- the battery and rows ---------------------------------------------------------------------------------------
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
    { id: 'ma.add2i', w3: true, kind: 'oral', subtask: 'mental_addition', lang: null, response: 'record', present: 'one_at_a_time', time_limit_s: null, stop: {},
      items: [{ id: 'ma.add2i.01', show: '13 + 6', target: 19, answer: 19, src: 'synthetic' }, { id: 'ma.add2i.02', show: '18 + 7', target: 25, answer: 25, src: 'synthetic' }] },
    { id: 'ur.letter_pick10', w3: true, r28: 'letter_pick', replaces: 'ur.letter_sounds5', kind: 'pick', response: 'tap',
      subtask: 'letter_sound_identification', lang: 'ur', time_limit_s: null, stop: {}, replay_at_s: 10, next_at_s: 15,
      items: [{ id: 'ur.letter_pick10.01', options: ['ت', 'ب', 'پ', 'ٹ', 'ن'], target: 'ب', prompt_audio: 'sa/v5/ur/x.mp3', prompt_text: 'بَ', src: 'synthetic' }] },
  ],
};

const session = () => ({ id: SID, grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'completed', finished_at: '2026-11-17T10:00:00Z' });
const row = (block, over = {}) => ({
  id: `row-${block}`, session_id: SID, block, response_mode: 'record', ai_status: 'failed', ai_reason: 'final:sa_score_later',
  ai_marks: null, audio_r2_key: KEY(block), audio_r2_keys: null, updated_at: '2026-11-17T09:58:00Z', lang: 'ur',
  responses: [{ kind: 'result', mode: 'record', session_id: 'phone-session', time_used_ms: 30000 }],
  ...over,
});

/** Stand-ins: the clip `clip` (synthetic audio), speech-to-text hearing `words`, the model marking the first `right` c. */
function standIns({ clip = 'voiced3', words = 0, right = 3, found = true } = {}) {
  const stt = [];
  const prompts = [];
  return {
    stt, prompts,
    bank: { forms: {}, tasks: {} },
    phoneBattery: () => BATTERY,
    clipOf: async (key) => ({ ...clipFor(clip), key }),
    speechOf: async (c, lang) => { stt.push(lang); return { words, text: words ? 'x' : '', model: 'stt:test', cost: 0.003, seconds: 1 }; },
    model: () => 'model:test',
    chatJSON: async ({ prompt, job }) => {
      prompts.push({ job, prompt });
      if (job === 'child_test.sa_words') return { json: { words: [1, 2, 3, 4].map((i) => ({ i, w: 'x', v: 'correct' })), words_correct: 4, words_attempted: 4, notes: '' }, cost: 0.001, seconds: 1 };
      const n = job === 'child_test.sa_oral_maths' ? 2 : 5;
      return { json: { found, last_attempted: n, letters_correct: right, items: Array.from({ length: n }, (_, k) => ({ i: k + 1, heard: 'x', v: k < right ? 'c' : 'w', conf: 0.9 })) }, cost: 0.001, seconds: 1 };
    },
  };
}
const verdicts = (got) => got.marks.detail.items.map((i) => i.verdict);
const gateCalls = (got) => got.marks.meta.calls.filter((c) => c.job === 'child_test.sa_speech_gate').map((c) => c.model);
const ON = (s) => ({ ...s, letterGate: true });
const SOUNDS = () => row('ur.letter_sounds5');
const LETTER_KEYS = ['vad_voiced_ms', 'vad_share', 'vad_floor_db', 'vad_pass'];

const OFF_UR_SOUND = "A child in a Pakistani government school (grade 3) is doing the timed Urdu LETTER SOUND task of an EGRA reading test ALONE on a phone, wearing headphones. The phone showed 5 letters ONE AT A TIME, in this order, each for a few seconds, and recorded the child for up to 60 seconds. There is no adult in the clip; the phone's own voice may be faintly heard.\nMarking rules: the child says each letter's SOUND (e.g. \"بَ\" for ب); a letter NAME said instead of its sound is WRONG. A self-correction counts as correct. A letter said wrongly, or passed over while the child keeps going, is WRONG. Every position after the last letter the child reached is SKIPPED.\nThe printed letters in order (position: letter (what a correct child says)):\n1: ب (/ب/) 2: م (/م/) 3: ک (/ک/) 4: س (/س/) 5: ر (/ر/)\nFor EVERY position 1-5 return v = \"c\" (correct), \"w\" (wrong) or \"s\" (skipped / not reached), heard = what the child said for that letter (\"\" if skipped), and conf = your confidence 0-1 in that verdict. found = whether the clip contains the child saying letters from this card at all.\nReturn ONLY JSON: {\"found\": true, \"last_attempted\": <int>, \"letters_correct\": <int>, \"items\": [{\"i\": 1, \"heard\": \"...\", \"v\": \"c|w|s\", \"conf\": 0.9}, ...]}";
const OFF_EN_NAME = "A child in a Pakistani government school (grade 3) is doing the timed English LETTER NAME task of an EGRA reading test ALONE on a phone, wearing headphones. The phone showed a card of 5 letters, 10 per row, read left to right row by row, and recorded the child for up to 60 seconds. There is no adult in the clip; the phone's own voice may be faintly heard.\nMarking rules: the child says each letter's NAME (upper or lower case is the same letter); a clear letter SOUND for that letter also counts. A self-correction counts as correct. A letter said wrongly, or passed over while the child keeps going, is WRONG. Every position after the last letter the child reached is SKIPPED.\nThe printed card in reading order (position: letter):\n1: b 2: m 3: s 4: t 5: a\nFor EVERY position 1-5 return v = \"c\" (correct), \"w\" (wrong) or \"s\" (skipped / not reached), heard = what the child said for that letter (\"\" if skipped), and conf = your confidence 0-1 in that verdict. found = whether the clip contains the child saying letters from this card at all.\nReturn ONLY JSON: {\"found\": true, \"last_attempted\": <int>, \"letters_correct\": <int>, \"items\": [{\"i\": 1, \"heard\": \"...\", \"v\": \"c|w|s\", \"conf\": 0.9}, ...]}";

describe('sa_r28_letter_gate: letter SOUNDS are gated on voice activity, not on words heard', () => {
  const before = { ...process.env };
  beforeEach(() => {
    process.env.CHILD_TEST_SA_SCORER = 'on'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; process.env.CHILD_TEST_SA_SPEECH_GATE = 'on';
    delete process.env.CHILD_TEST_SA_MIN_SPEECH_S; delete process.env.CHILD_TEST_SA_SECOND_VOICE;
  });
  afterEach(() => { process.env = { ...before }; });

  test('OFF (default): a voiced letter-sounds clip with STT 0 words -> not_reached x5 as today, STT called, no new keys', async () => {
    const s = standIns({ clip: 'voiced3', words: 0 });
    const got = await score.scoreRow(SOUNDS(), session(), s);
    expect(got.ok).toBe(true);
    expect(verdicts(got)).toEqual(Array(5).fill('not_reached'));
    expect(s.stt).toEqual(['ur']);
    expect(s.prompts).toEqual([]);
    expect(gateCalls(got)).toEqual(['stt:test']);
    expect(got.marks.detail).not.toHaveProperty('letter_gate');
    got.marks.detail.items.forEach((i) => { [...LETTER_KEYS, 'reason', 'clip_s'].forEach((k) => expect(i).not.toHaveProperty(k)); });
  });

  test('OFF given explicitly (letterGate: false) is the same as absent', async () => {
    const s = standIns({ words: 0 });
    const got = await score.scoreRow(SOUNDS(), session(), { ...s, letterGate: false });
    expect(verdicts(got)).toEqual(Array(5).fill('not_reached'));
    expect(s.stt).toEqual(['ur']);
  });

  test('ON: a silent 6 s letter-sounds clip scores 0 (no_voice), with no STT and no model call', async () => {
    const s = standIns({ clip: 'silent6', right: 5 });
    const got = await score.scoreRow(SOUNDS(), session(), ON(s));
    expect(got.marks.correct).toBe(0);
    expect(verdicts(got)).toEqual(Array(5).fill('not_reached'));
    expect(s.stt).toEqual([]);
    expect(s.prompts).toEqual([]);
    expect(gateCalls(got)).toEqual(['skipped_r28']);
    expect(got.marks.meta.calls.find((c) => c.model === 'skipped_r28')).toMatchObject({ vad_pass: false, vad_voiced_ms: 0, clip_s: 6 });
    got.marks.detail.items.forEach((i) => expect(i).toMatchObject({ no_speech: true, conf: 0, reason: 'no_voice', vad_pass: false, vad_voiced_ms: 0, clip_s: 6 }));
  });

  test('ON: a -40 dBFS hiss scores 0 (steady noise is not voice)', async () => {
    const s = standIns({ clip: 'hiss6', right: 5 });
    const got = await score.scoreRow(SOUNDS(), session(), ON(s));
    expect(got.marks.correct).toBe(0);
    expect(s.prompts).toEqual([]);
    expect(s.stt).toEqual([]);
    expect(got.marks.detail.items[0]).toMatchObject({ reason: 'no_voice', vad_pass: false });
  });

  test('ON: a 3 s voiced clip (STT would hear 0 words) reaches the model: 3/5, skipped_r28, letter_gate r28', async () => {
    const s = standIns({ clip: 'voiced3', words: 0, right: 3 });
    const got = await score.scoreRow(SOUNDS(), session(), ON(s));
    expect(s.stt).toEqual([]);
    expect(s.prompts.map((p) => p.job)).toEqual(['child_test.sa_letters']);
    expect(got.marks.correct).toBe(3);
    expect(verdicts(got)).toEqual(['correct', 'correct', 'correct', 'wrong', 'wrong']);
    expect(gateCalls(got)).toEqual(['skipped_r28']);
    const call = got.marks.meta.calls.find((c) => c.model === 'skipped_r28');
    expect(call).toMatchObject({ job: 'child_test.sa_speech_gate', cost: 0, error: null, vad_pass: true, clip_s: 3 });
    expect(call.vad_voiced_ms).toBeGreaterThanOrEqual(1000);
    expect(call.vad_share).toBeLessThan(0.9);
    expect(got.marks.detail.letter_gate).toBe('r28');
    got.marks.detail.items.forEach((i) => { expect(i).toMatchObject({ vad_pass: true, clip_s: 3 }); expect(i).not.toHaveProperty('reason'); });
  });

  test('ON: a letter-sounds clip with no pause reaches the model; vad_margin_db is stored on the call and the items', async () => {
    const s = standIns({ clip: 'nopause6', words: 0, right: 4 });
    const got = await score.scoreRow(SOUNDS(), session(), ON(s));
    expect(s.prompts.map((p) => p.job)).toEqual(['child_test.sa_letters']);
    expect(got.marks.correct).toBe(4);
    const call = got.marks.meta.calls.find((c) => c.model === 'skipped_r28');
    expect(call).toMatchObject({ vad_pass: true });
    expect(call.vad_margin_db).toBeGreaterThanOrEqual(29);
    got.marks.detail.items.forEach((i) => expect(i.vad_margin_db).toBe(call.vad_margin_db));
  });

  test('ON: steady noise with no pause scores 0 (no_voice), its margin stored', async () => {
    const s = standIns({ clip: 'wobble6', right: 5 });
    const got = await score.scoreRow(SOUNDS(), session(), ON(s));
    expect(got.marks.correct).toBe(0);
    expect(s.prompts).toEqual([]);
    expect(got.marks.detail.items[0]).toMatchObject({ reason: 'no_voice', vad_pass: false });
    expect(got.marks.detail.items[0].vad_margin_db).toBeLessThan(20);
  });

  test('ON: a 0.5 s letter-sounds clip stays not_reached x5 (the duration floor), nothing decoded or called', async () => {
    const s = standIns({ clip: 'short05', words: 0 });
    const got = await score.scoreRow(SOUNDS(), session(), ON(s));
    expect(verdicts(got)).toEqual(Array(5).fill('not_reached'));
    expect(s.stt).toEqual([]);
    expect(s.prompts).toEqual([]);
    expect(gateCalls(got)).toEqual(['duration']);
    got.marks.detail.items.forEach((i) => expect(i).toMatchObject({ reason: 'duration', clip_s: 0.5, no_speech: true }));
  });

  test("ON: the model's own found:false still mutes a voiced clip, and the gated row says so: reason 'found_false' beside the voice check's numbers", async () => {
    const s = standIns({ clip: 'voiced3', right: 5, found: false });
    const got = await score.scoreRow(SOUNDS(), session(), ON(s));
    expect(got.marks.correct).toBe(0);
    expect(got.marks.detail.items.every((i) => i.verdict === 'not_reached' && i.no_speech)).toBe(true);
    // the weekly precision table splits the three mute causes (duration / no_voice / found_false) from the stored marks
    got.marks.detail.items.forEach((i) => expect(i).toMatchObject({ reason: 'found_false', vad_pass: true, raw_verdict: 'correct' }));
  });

  test('ON: a voice check that cannot run falls back to the STT gate (never the model alone)', async () => {
    const s = standIns({ clip: 'voiced3', words: 0 });
    const got = await score.scoreRow(SOUNDS(), session(), { ...ON(s), pcmOf: async () => { throw new Error('decode failed'); } });
    expect(s.stt).toEqual(['ur']);
    expect(verdicts(got)).toEqual(Array(5).fill('not_reached'));
    expect(gateCalls(got)).toEqual(['skipped_r28', 'stt:test']);
    expect(got.marks.meta.calls[0].error).toMatch(/^vad_failed/);
  });

  test('ON: letter NAMES take the voice-activity gate too: a voiced names clip with STT 0 words reaches the model (3/5), no STT call', async () => {
    const s = standIns({ clip: 'voiced3', words: 0, right: 3 });
    const got = await score.scoreRow(row('ur.letter_names5'), session(), ON(s));
    expect(verdicts(got)).toEqual(['correct', 'correct', 'correct', 'wrong', 'wrong']);
    expect(got.marks.correct).toBe(3);
    expect(s.stt).toEqual([]);
    expect(s.prompts.map((p) => p.job)).toEqual(['child_test.sa_letters']);
    expect(gateCalls(got)).toEqual(['skipped_r28']);
    expect(got.marks.meta.calls.find((c) => c.model === 'skipped_r28')).toMatchObject({ vad_pass: true, clip_s: 3 });
    expect(got.marks.detail.letter_gate).toBe('r28');
    got.marks.detail.items.forEach((i) => { expect(i).toMatchObject({ vad_pass: true, clip_s: 3 }); expect(i).not.toHaveProperty('reason'); });
  });

  test('ON: a silent 6 s letter-NAMES clip scores 0 (no_voice), with no STT and no model call', async () => {
    const s = standIns({ clip: 'silent6', right: 5 });
    const got = await score.scoreRow(row('ur.letter_names5'), session(), ON(s));
    expect(got.marks.correct).toBe(0);
    expect(verdicts(got)).toEqual(Array(5).fill('not_reached'));
    expect(s.stt).toEqual([]);
    expect(s.prompts).toEqual([]);
    expect(gateCalls(got)).toEqual(['skipped_r28']);
    got.marks.detail.items.forEach((i) => expect(i).toMatchObject({ no_speech: true, conf: 0, reason: 'no_voice', vad_pass: false, clip_s: 6 }));
  });

  test('ON: the letter-NAMES prompt is unchanged (variant B stays letter sounds only)', async () => {
    const on = standIns({ clip: 'voiced3', words: 3 });
    const off = standIns({ clip: 'voiced3', words: 3 });
    await score.scoreRow(row('ur.letter_names5'), session(), ON(on));
    await score.scoreRow(row('ur.letter_names5'), session(), off);
    expect(on.prompts[0].prompt).toBe(off.prompts[0].prompt);
    expect(on.prompts[0].prompt).not.toContain(score.__internals.LETTER_SOUNDS_BARE);
    expect(on.prompts[0].prompt).toContain('(دال)');
  });

  test('OFF: letter NAMES keep the STT gate: a voiced names clip with STT 0 words stays not_reached x5, as today', async () => {
    const s = standIns({ clip: 'voiced3', words: 0 });
    const got = await score.scoreRow(row('ur.letter_names5'), session(), s);
    expect(s.stt).toEqual(['ur']);
    expect(s.prompts).toEqual([]);
    expect(verdicts(got)).toEqual(Array(5).fill('not_reached'));
    expect(gateCalls(got)).toEqual(['stt:test']);
    expect(got.marks.detail).not.toHaveProperty('letter_gate');
  });

  test('ON: spoken maths (mental addition) keeps the STT gate: STT 0 words stays not_reached', async () => {
    const s = standIns({ clip: 'voiced3', words: 0 });
    const got = await score.scoreRow(row('ma.add2i'), session(), ON(s));
    expect(s.stt).toEqual(['ur']);
    expect(s.prompts).toEqual([]);
    expect(verdicts(got)).toEqual(['not_reached', 'not_reached']);
    expect(got.marks.detail).not.toHaveProperty('letter_gate');
  });

  test('ON: a non-letter grid task (familiar_word_reading) is untouched: STT called, 0 words mutes', async () => {
    const s = standIns({ words: 0 });
    const got = await score.scoreRow(row('ur.words4'), session(), ON(s));
    expect(s.stt).toEqual(['ur']);
    expect(verdicts(got)).toEqual(Array(4).fill('not_reached'));
    expect(got.marks.detail).not.toHaveProperty('letter_gate');
  });

  test('ON: the scope is the subtask name, never /letter/: a "letter_pick_monitor" recording keeps the STT mute', async () => {
    const s = standIns({ words: 0 });
    const got = await score.scoreRow(row('ur.letter_rec5'), session(), ON(s));
    expect(s.stt).toEqual(['ur']);
    expect(verdicts(got)).toEqual(Array(5).fill('not_reached'));
  });

  test('ON: a tap picker row (kind pick, subtask letter_sound_identification) is never scored: no_scorer_for_kind', async () => {
    const s = standIns({ words: 0 });
    const pick = row('ur.letter_pick10', { response_mode: 'tap', audio_r2_key: null });
    for (const gate of [true, false]) {
      expect(await score.scoreRow(pick, session(), { ...s, letterGate: gate })).toEqual({ ok: false, reason: 'no_scorer_for_kind', retry: false });
    }
    expect(s.stt).toEqual([]);
    expect(s.prompts).toEqual([]);
  });

  test('lettersPrompt: OFF text is byte-identical to today; ON (variant B) drops the expected answers and adds two sentences', () => {
    const { lettersPrompt: p, LETTER_SOUNDS_BARE: BARE, LETTER_SOUNDS_NO_CHILD: NO_CHILD } = score.__internals;
    const ur = { grade: 3, lang: 'ur', items: ['ب', 'م', 'ک', 'س', 'ر'], perRow: 10, sound: true, answers: ['/ب/', '/م/', '/ک/', '/س/', '/ر/'], one: true };
    const en = { grade: 3, lang: 'en', items: ['b', 'm', 's', 't', 'a'], perRow: 10, sound: false, answers: [], one: false };
    expect(p(ur)).toBe(OFF_UR_SOUND);
    expect(p(en)).toBe(OFF_EN_NAME);
    expect(p({ ...ur, variantB: false })).toBe(OFF_UR_SOUND);
    expect(typeof BARE).toBe('string');
    expect(typeof NO_CHILD).toBe('string');
    const on = p({ ...ur, variantB: true });
    expect(on).toContain(`faintly heard. ${BARE}\n`);
    expect(on).toContain(`SKIPPED. ${NO_CHILD}\n`);
    expect(on).toContain('The printed letters in order (position: letter):\n1: ب 2: م 3: ک 4: س 5: ر\n');
    expect(on).not.toContain('/ب/');
    expect(on).not.toContain('what a correct child says');
    // an Urdu card without answers given still prints no letter names under variant B
    expect(p({ ...ur, answers: [], variantB: true })).toBe(on);
  });

  test('ON: the prompt the model gets on a letter-sounds row is variant B; OFF it is today\'s', async () => {
    const on = standIns({ clip: 'voiced3', words: 3 });
    await score.scoreRow(SOUNDS(), session(), ON(on));
    expect(on.prompts[0].prompt).toContain(score.__internals.LETTER_SOUNDS_BARE);
    expect(on.prompts[0].prompt).not.toContain('(/ب/)');
    const off = standIns({ clip: 'voiced3', words: 3 });
    await score.scoreRow(SOUNDS(), session(), off);
    expect(off.prompts[0].prompt).toContain('(/ب/)');
    expect(off.prompts[0].prompt).not.toContain(score.__internals.LETTER_SOUNDS_BARE);
  });

  test("silent() names its reason: 'duration' / 'no_words' / false / null; with the voice check: 'no_voice' / false", async () => {
    const { silent } = score.__internals;
    const deps = (words) => ({ speechOf: async () => ({ words, model: 'stt:test', cost: 0 }) });
    expect(await silent(deps(3), [], { durationSec: 0.5 }, 'ur')).toBe('duration');
    expect(await silent(deps(0), [], { durationSec: 3 }, 'ur')).toBe('no_words');
    expect(await silent(deps(2), [], { durationSec: 3 }, 'ur')).toBe(false);
    expect(await silent({}, [], { durationSec: 3 }, 'ur')).toBe(null);
    const never = { speechOf: async () => { throw new Error('STT must not be called'); } };
    const calls = [];
    const quiet = { ...never, pcmOf: async () => ({ samples: pcm(3, SILENCE), rate: RATE }) };
    const voiced = { ...never, pcmOf: async () => ({ samples: pcm(3, VOICED), rate: RATE }) };
    expect(await silent(quiet, calls, { durationSec: 3 }, 'ur', {}, { vad: true })).toBe('no_voice');
    expect(await silent(voiced, calls, { durationSec: 3 }, 'ur', {}, { vad: true })).toBe(false);
    expect(await silent(voiced, calls, { durationSec: 0.5 }, 'ur', {}, { vad: true })).toBe('duration');
    expect(calls.map((c) => c.model)).toEqual(['skipped_r28', 'skipped_r28', 'duration']);
    delete process.env.CHILD_TEST_SA_SPEECH_GATE;
    expect(await silent(deps(0), [], { durationSec: 3 }, 'ur')).toBe(null);
  });
});

describe('voiceActivity: a relative floor, silencedetect-like windows', () => {
  test('the shipped defaults are one constant object', () => {
    expect(VAD).toMatchObject({ minSilenceMs: 150, minVoicedMs: 500, maxVoicedShare: 0.9, minMarginDb: 20, floorRule: { percentile: 10, plusDb: 10 } });
  });

  test('a child with no pause (share ~1.0) passes on the margin; steady noise with the same share fails on it', () => {
    const v = voiceActivity(pcm(6, NO_PAUSE), RATE);
    expect(v.share).toBeGreaterThanOrEqual(0.9);
    expect(v.margin_db).toBeGreaterThanOrEqual(29);
    expect(v.pass).toBe(true);
    const n = voiceActivity(pcm(6, WOBBLE), RATE);
    expect(n.share).toBeGreaterThanOrEqual(0.9);
    expect(n.margin_db).toBeLessThan(20);
    expect(n.pass).toBe(false);
    // the margin is the 90th-percentile frame loudness minus the (clamped) floor
    expect(voiceActivity(pcm(6, SILENCE), RATE)).toMatchObject({ pass: false, floor_db: -70, margin_db: -30 });
    expect(voiceActivity(pcm(6, HISS_40), RATE).pass).toBe(false);
    expect(voiceActivity(pcm(3, VOICED), RATE).pass).toBe(true);
  });

  test('digital silence and steady hiss fail; three short sounds over a quiet room pass', () => {
    expect(voiceActivity(pcm(6, SILENCE), RATE)).toMatchObject({ voiced_ms: 0, pass: false });
    expect(voiceActivity(pcm(6, HISS_40), RATE)).toMatchObject({ pass: false });
    const v = voiceActivity(pcm(3, VOICED), RATE);
    expect(v.pass).toBe(true);
    expect(v.voiced_ms).toBeGreaterThanOrEqual(1100);
    expect(v.voiced_ms).toBeLessThanOrEqual(1400);
    expect(v.share).toBeLessThan(0.5);
  });

  test('relative, not fixed dBFS: a loud room (-30 dBFS) with a child over it passes; that room alone fails', () => {
    const loud = noise(-30);
    const child = (t) => loud() + (BURSTS.some(([a, b]) => t >= a && t < b) ? 0.5 * Math.sin(2 * Math.PI * 220 * t) : 0);
    const v = voiceActivity(pcm(3, child), RATE);
    expect(v.pass).toBe(true);
    expect(v.floor_db).toBeGreaterThan(-40); // a fixed -40 dBFS floor would call the whole clip voiced (share 1.0: muted)
    expect(voiceActivity(pcm(3, loud), RATE).pass).toBe(false);
  });

  test('parameters can be set: a 2 s minimum voiced time fails the three short sounds', () => {
    expect(voiceActivity(pcm(3, VOICED), RATE, { minVoicedMs: 2000 }).pass).toBe(false);
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

'use strict';

/**
 * E-11: a gate that overrides the model (the speech gate's mute, the model's own found:false, the echo check) dropped
 * the model's answer and what speech-to-text heard, so a wrong gate stayed invisible. Behind the same r28 switches
 * (sa_r28_letter_gate for the speech gate's mutes and found:false, sa_r28_no_echo_ur for the echo check), the item keeps
 * raw_verdict / raw_heard (the model's, when it was asked) and stt_words / clip_s (when speech-to-text ran), plus the
 * override's reason ('duration' / 'no_words' / 'no_voice' / 'found_false'). stt_text (<= 80 code points) is kept ONLY on
 * the echo override, where it is the phone's own question by construction: a coach-led clip's transcript (an adult's
 * words, a child's name) never enters the marks. No mark changes; OFF stores nothing new. Only the clip, speech-to-text and
 * the model are stand-ins; every fixture is synthetic.
 * Letter names (like letter sounds) take sa_r28_letter_gate's voice-activity check in place of speech-to-text's word
 * count, so their gate keys are the voice check's numbers (vad_*, clip_s), never stt_words; the speech-to-text keys are
 * asserted on the tasks that keep the speech-to-text gate (words, passage, spoken maths, questions).
 */

jest.mock('../../shared/config/supabase', () => ({ from: () => { throw new Error('no db in this test'); } }));

const score = require('../../shared/services/child-test/sa/score');

const SID = 'eeeeeeee-0000-4000-8000-000000000111';
const KEY = (t, i) => `child-test/sandbox/sch-1/${SID}/sa/${t}${i ? `__${i}` : ''}.webm`;
const item = (task, k, show, answer) => ({ id: `${task}.0${k + 1}`, show, target: show, answer, src: 'synthetic' });
const grid = (id, subtask, shows) => ({ id, w3: true, kind: 'grid', subtask, lang: 'ur', response: 'record', present: 'one_at_a_time', time_limit_s: 60, stop: {}, grid: shows, items: shows.map((s, k) => item(id, k, s, s)) });
const Q_EN = [{ id: 'en.story_x.q1', prompt: { text: 'Who did Bano play with?' }, accept: ['the parrot'], reject: ['the cat'], src: 'synthetic' }];
const Q_UR = [{ id: 'ur.story_x.q1', prompt: { text: 'بانو کس کے ساتھ کھیلتی تھی؟' }, accept: ['مٹھو'], reject: [], src: 'synthetic' }];
const BATTERY = {
  tasks: [
    grid('ur.letter_names5', 'letter_name_identification', ['د', 'ج', 'پ', 'ت', 'ا']),
    grid('ur.words4', 'familiar_word_reading', ['بچہ', 'دروازہ', 'پانی', 'کتاب']),
    { id: 'ur.story_y', w3: true, kind: 'passage', subtask: 'oral_reading_fluency', lang: 'ur', response: 'record', time_limit_s: 60, stop: {},
      passage: { text: 'بانو اور مٹھو', lines: [{ from: 0, to: 2 }] }, items: ['بانو', 'اور', 'مٹھو'].map((w, k) => ({ id: `ur.story_y.w${k + 1}`, show: w, target: w, src: 'synthetic' })) },
    { id: 'ma.add2i', w3: true, kind: 'oral', subtask: 'mental_addition', lang: null, response: 'record', present: 'one_at_a_time', time_limit_s: null, stop: {},
      items: [{ id: 'ma.add2i.01', show: '13 + 6', target: 19, answer: 19, src: 'synthetic' }, { id: 'ma.add2i.02', show: '18 + 7', target: 25, answer: 25, src: 'synthetic' }] },
    { id: 'en.story_x_comp', w3: true, kind: 'questions', subtask: 'reading_comprehension', lang: 'en', response: 'record', stop: {}, items: Q_EN },
    { id: 'ur.story_x_comp', w3: true, kind: 'questions', subtask: 'reading_comprehension', lang: 'ur', response: 'record', stop: {}, items: Q_UR },
  ],
};
const session = () => ({ id: SID, grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'completed', finished_at: '2026-11-17T10:00:00Z' });
const row = (block, over = {}) => ({
  id: `row-${block}`, session_id: SID, block, lang: 'ur', response_mode: 'record', ai_status: 'failed', ai_reason: 'final:sa_score_later',
  ai_marks: null, audio_r2_key: KEY(block), audio_r2_keys: null, updated_at: '2026-11-17T09:58:00Z',
  responses: [{ kind: 'result', mode: 'record', session_id: 'phone-session', time_used_ms: 30000 }],
  ...over,
});
const qRow = (block, qs) => row(block, {
  response_mode: 'oral', audio_r2_key: null, audio_r2_keys: qs.map((q) => ({ i: q.id, key: KEY(block, q.id) })),
  responses: [{ kind: 'result', mode: 'oral', asked: qs.map((q) => q.id), session_id: 'phone-session', time_used_ms: 20000 }],
});

function standIns({ dur = 3, stt = '', found = true, question = null } = {}) {
  return {
    bank: { forms: {}, tasks: {} },
    phoneBattery: () => BATTERY,
    clipOf: async (key) => ({ base64: 'AAAA', durationSec: dur, key }),
    speechOf: async () => ({ words: stt ? stt.split(/\s+/).length : 0, text: stt, model: 'stt:test', cost: 0.003, seconds: 1 }),
    model: () => 'model:test',
    chatJSON: async ({ prompt, job }) => {
      if (job === 'child_test.sa_questions') {
        const id = /\[([a-z]{2}\.story_x\.q\d)\]/.exec(prompt)[1];
        return { json: { questions: [{ id, answer: question, verdict: 'correct', confidence: 0.9 }] }, cost: 0.001, seconds: 1 };
      }
      if (job === 'child_test.sa_words' || job === 'child_test.sa_story') return { json: { words: [1, 2, 3, 4].map((i) => ({ i, w: 'x', v: 'correct' })), words_correct: 4, words_attempted: 4, notes: '' }, cost: 0.001, seconds: 1 };
      const n = job === 'child_test.sa_oral_maths' ? 2 : 5;
      return { json: { found, last_attempted: n, letters_correct: n, items: Array.from({ length: n }, (_, k) => ({ i: k + 1, heard: `h${k + 1}`, v: k === 0 ? 'w' : 'c', conf: 0.9 })) }, cost: 0.001, seconds: 1 };
    },
  };
}
const NEW = ['raw_verdict', 'raw_heard', 'stt_words', 'stt_text', 'clip_s', 'reason'];
// 16 kHz PCM for the voice check: 3 s of silence, or three short 220 Hz sounds (0.4 s each) over the silence
const RATE = 16000;
const pcmOf = (voiced) => async () => {
  const out = new Int16Array(3 * RATE);
  if (voiced) for (let i = 0; i < out.length; i += 1) { const t = i / RATE; if ([[0.3, 0.7], [1.2, 1.6], [2.1, 2.5]].some(([a, b]) => t >= a && t < b)) out[i] = Math.round(0.3 * Math.sin(2 * Math.PI * 220 * t) * 32767); }
  return { samples: out, rate: RATE };
};
const noNewKeys = (got) => got.marks.detail.items.forEach((i) => NEW.forEach((k) => expect(i).not.toHaveProperty(k)));
const ON = { letterGate: true };

describe('E-11: a gate override keeps what the model and speech-to-text said', () => {
  const before = { ...process.env };
  beforeEach(() => {
    process.env.CHILD_TEST_SA_SCORER = 'on'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; process.env.CHILD_TEST_SA_SPEECH_GATE = 'on';
    delete process.env.CHILD_TEST_SA_MIN_SPEECH_S; delete process.env.CHILD_TEST_SA_SECOND_VOICE;
  });
  afterEach(() => { process.env = { ...before }; });

  test('speech gate mute (letter names, no voice heard): ON stores reason no_voice, the voice check\'s numbers and clip_s, never stt_words / stt_text; OFF nothing new', async () => {
    const on = await score.scoreRow(row('ur.letter_names5'), session(), { ...standIns(), pcmOf: pcmOf(false), ...ON });
    on.marks.detail.items.forEach((i) => expect(i).toMatchObject({ verdict: 'not_reached', no_speech: true, reason: 'no_voice', vad_pass: false, clip_s: 3 }));
    on.marks.detail.items.forEach((i) => { expect(i).not.toHaveProperty('stt_text'); expect(i).not.toHaveProperty('stt_words'); });
    expect(on.marks.detail.items[0]).not.toHaveProperty('raw_verdict');
    noNewKeys(await score.scoreRow(row('ur.letter_names5'), session(), standIns()));
  });

  test('speech gate mute (words, STT 0 words): ON stores reason, stt_words, clip_s and never stt_text', async () => {
    const on = await score.scoreRow(row('ur.words4'), session(), { ...standIns(), ...ON });
    on.marks.detail.items.forEach((i) => expect(i).toMatchObject({ verdict: 'not_reached', no_speech: true, reason: 'no_words', stt_words: 0, clip_s: 3 }));
    on.marks.detail.items.forEach((i) => expect(i).not.toHaveProperty('stt_text'));
  });

  test("the model's found:false (letter names, a voice heard): ON stores reason 'found_false', raw_verdict / raw_heard per item and the voice check's numbers, never the transcript", async () => {
    const s = standIns({ stt: 'دال جیم', found: false });
    const on = await score.scoreRow(row('ur.letter_names5'), session(), { ...s, pcmOf: pcmOf(true), ...ON });
    expect(on.marks.correct).toBe(0);
    expect(on.marks.detail.items.map((i) => [i.verdict, i.raw_verdict, i.raw_heard])).toEqual([
      ['not_reached', 'wrong', 'h1'], ['not_reached', 'correct', 'h2'], ['not_reached', 'correct', 'h3'], ['not_reached', 'correct', 'h4'], ['not_reached', 'correct', 'h5']]);
    expect(on.marks.detail.items[0]).toMatchObject({ reason: 'found_false', vad_pass: true, clip_s: 3 });
    on.marks.detail.items.forEach((i) => { expect(i.reason).toBe('found_false'); expect(i).not.toHaveProperty('stt_text'); expect(i).not.toHaveProperty('stt_words'); });
    noNewKeys(await score.scoreRow(row('ur.letter_names5'), session(), s));
  });

  test('the duration floor (words, 0.5 s): ON stores reason and clip_s, no STT fields (STT never ran)', async () => {
    const on = await score.scoreRow(row('ur.words4'), session(), { ...standIns({ dur: 0.5 }), ...ON });
    on.marks.detail.items.forEach((i) => { expect(i).toMatchObject({ reason: 'duration', clip_s: 0.5 }); expect(i).not.toHaveProperty('stt_words'); });
  });

  test('passage mute: ON stores reason and stt_words on every word', async () => {
    const on = await score.scoreRow(row('ur.story_y'), session(), { ...standIns(), ...ON });
    expect(on.marks.detail.items).toHaveLength(3);
    on.marks.detail.items.forEach((i) => expect(i).toMatchObject({ no_speech: true, reason: 'no_words', stt_words: 0, clip_s: 3 }));
    noNewKeys(await score.scoreRow(row('ur.story_y'), session(), standIns()));
  });

  test("spoken maths: ON a mute stores stt_words (never stt_text); the model's found:false stores reason 'found_false', raw_verdict / raw_heard", async () => {
    const mute = await score.scoreRow(row('ma.add2i'), session(), { ...standIns(), ...ON });
    mute.marks.detail.items.forEach((i) => { expect(i).toMatchObject({ reason: 'no_words', stt_words: 0, clip_s: 3 }); expect(i).not.toHaveProperty('stt_text'); });
    const none = await score.scoreRow(row('ma.add2i'), session(), { ...standIns({ stt: 'انیس', found: false }), ...ON });
    expect(none.marks.correct).toBe(0);
    expect(none.marks.detail.items.map((i) => [i.reason, i.raw_verdict, i.raw_heard, i.stt_words])).toEqual([['found_false', 'wrong', 'h1', 1], ['found_false', 'correct', 'h2', 1]]);
    none.marks.detail.items.forEach((i) => expect(i).not.toHaveProperty('stt_text'));
    noNewKeys(await score.scoreRow(row('ma.add2i'), session(), standIns({ stt: 'انیس', found: false })));
  });

  test('questions mute: ON stores reason and stt_words', async () => {
    const on = await score.scoreRow(qRow('ur.story_x_comp', Q_UR), session(), { ...standIns(), ...ON });
    expect(on.marks.detail.items[0]).toMatchObject({ verdict: 'no_answer', reason: 'no_words', stt_words: 0, clip_s: 3 });
  });

  test('the echo check (English, sa_r28_no_echo_ur ON): raw_verdict / raw_heard / stt_words / stt_text kept; OFF nothing new', async () => {
    const s = standIns({ stt: 'Who did Bano play with', question: 'the parrot' });
    const on = await score.scoreRow(qRow('en.story_x_comp', Q_EN), session(), { ...s, noEchoUr: true });
    expect(on.marks.detail.items[0]).toMatchObject({ verdict: 'no_answer', echo: true, raw_verdict: 'correct', raw_heard: 'the parrot', stt_words: 5, stt_text: 'Who did Bano play with', clip_s: 3 });
    const off = await score.scoreRow(qRow('en.story_x_comp', Q_EN), session(), s);
    expect(off.marks.detail.items[0]).toMatchObject({ verdict: 'no_answer', echo: true });
    noNewKeys(off);
  });

  test('stt_text is stored only on the echo override (the phone\'s question by construction), cut to 80 code points', async () => {
    const long = Array.from({ length: 20 }, () => 'Who did Bano play with').join(' ');
    const on = await score.scoreRow(qRow('en.story_x_comp', Q_EN), session(), { ...standIns({ stt: long, question: 'the parrot' }), noEchoUr: true });
    expect(on.marks.detail.items[0]).toMatchObject({ verdict: 'no_answer', echo: true, stt_words: 100 });
    expect(Array.from(on.marks.detail.items[0].stt_text)).toHaveLength(80);
    expect(long.startsWith(on.marks.detail.items[0].stt_text)).toBe(true);
    // the same long transcript on a spoken-maths found:false leaves only its word count
    const sums = await score.scoreRow(row('ma.add2i'), session(), { ...standIns({ stt: long, found: false }), ...ON });
    sums.marks.detail.items.forEach((i) => { expect(i.stt_words).toBe(100); expect(i).not.toHaveProperty('stt_text'); });
    // and on letter names (the voice check, no speech-to-text) no transcript and no word count at all
    const names = await score.scoreRow(row('ur.letter_names5'), session(), { ...standIns({ stt: long, found: false }), pcmOf: pcmOf(true), ...ON });
    names.marks.detail.items.forEach((i) => { expect(i).not.toHaveProperty('stt_words'); expect(i).not.toHaveProperty('stt_text'); });
  });

  test('ON with no override (the model marks stand): no new keys', async () => {
    noNewKeys(await score.scoreRow(row('ur.words4'), session(), { ...standIns({ stt: 'بچہ' }), ...ON }));
    // letter names keep the voice check's numbers on every item, as letter sounds do, and nothing an override adds
    const names = await score.scoreRow(row('ur.letter_names5'), session(), { ...standIns({ stt: 'دال' }), pcmOf: pcmOf(true), ...ON });
    names.marks.detail.items.forEach((i) => {
      expect(i).toMatchObject({ vad_pass: true, clip_s: 3 });
      ['raw_verdict', 'raw_heard', 'stt_words', 'stt_text', 'reason'].forEach((k) => expect(i).not.toHaveProperty(k));
    });
  });
});

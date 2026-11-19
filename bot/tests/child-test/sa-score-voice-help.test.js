'use strict';

/**
 * The another-voice check, help only (app_settings sa_r28_voice_help, OFF by default).
 *
 * Today the check asks a model whether another person is heard. A coach saying "louder" or "press next" is a person,
 * so the flag went up on most real tests, while hand checks of the transcripts found someone HELPING (saying the item
 * or the answer, correcting, building the answer) in a few. ON: each clip gets a transcript split by speaker, a text
 * model reads it beside the task's own items and answers and labels the clip help / other_child / support / unclear /
 * none; only help and other_child flag, and only when the quoted words are in the transcript. The detail says what
 * kind of help (Results: "An adult helped with the answer") and the matched item words; support and unclear are logged, never
 * a flag. OFF: unchanged. The scorer's own path runs here; only the clip, speech-to-text and the models are stand-ins.
 */

jest.mock('../../shared/config/supabase', () => ({ from: () => { throw new Error('no direct reads'); } }));

const score = require('../../shared/services/child-test/sa/score');
const helpSwitch = require('../../shared/services/child-test/app/voice-help-switch');
const VH = require('../../shared/services/child-test/sa/voice-help');

const SID = 'cccccccc-0000-4000-8000-000000000028';
const PHONE_SID = 'dddddddd-0000-4000-8000-000000000028';
const KEY = (q) => `child-test/sandbox/sch-1/${SID}/sa/ur.story_comp_w3__ur.story2.${q}.webm`;
const QS = ['q1', 'q2', 'q3'];
const qOf = (key) => /\.(q\d)\.webm$/.exec(key)[1];

const session = () => ({ id: SID, grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'completed', finished_at: '2026-11-17T05:19:56Z', asked: QS.map((q) => `ur.story2.${q}`) });
const row = () => ({
  id: 'row-ur-comp', session_id: SID, block: 'ur.story_comp_w3', response_mode: 'oral', ai_status: 'failed', ai_reason: 'final:sa_score_later',
  ai_marks: null, audio_r2_key: null, audio_r2_keys: QS.map((q) => ({ i: `ur.story2.${q}`, key: KEY(q) })), updated_at: '2026-11-17T05:16:30Z',
  responses: [{ kind: 'result', mode: 'oral', asked: QS.map((q) => `ur.story2.${q}`), task_id: 'ur.story_comp_w3', recorded: true, attempted: 3, session_id: PHONE_SID, stop_reason: 'complete' }],
});

// fixture transcripts, as the diarized speech-to-text renders them
const SUPPORT = '[1s] spk1: اونچی آواز میں بولو، شاباش\n[4s] spk2: پنجرے میں';
const ADULT_ANSWER = '[1s] spk1: آپ کہو گے اپنے پنجرے میں\n[4s] spk2: پنجرے میں';
const plainOf = (turns) => turns.split('\n').map((l) => l.replace(/^\[\d+s\] spk\d: /, '')).join(' ');

/**
 * per question: turns = the diarized transcript ('fail' = speech-to-text down), judge = what the text model answers;
 * voice = what today's audio check answers (OFF path).
 */
function standIns(per = {}) {
  const jobs = [];
  const turnsAsked = [];
  return {
    jobs,
    turnsAsked,
    clipOf: async (key) => ({ base64: 'AAAA', durationSec: 6, key }),
    speechOf: async () => ({ words: 3, text: 'پنجرے میں', said: 'پنجرے میں', model: 'soniox:test', cost: 0, seconds: 1 }),
    speechTurnsOf: async (clip) => {
      const p = per[qOf(clip.key)] || {};
      turnsAsked.push(qOf(clip.key));
      if (p.turns === 'fail') throw new Error('stt down');
      const turns = p.turns == null ? '[2s] spk1: پنجرے میں' : p.turns;
      const text = plainOf(turns);
      return { words: text.split(/\s+/).filter(Boolean).length, turns, text, model: 'soniox:plain', cost: 0.00002, seconds: 1 };
    },
    model: () => 'google/gemini-test',
    chatJSON: async ({ prompt, schema, job, audio }) => {
      jobs.push({ job, schema, prompt, audio: Boolean(audio) });
      if (job === 'child_test.sa_second_voice' && schema && schema.name === 'sa_voice_help') {
        const q = (/ur\.story2\.(q\d)/.exec(prompt) || [])[1];
        const turnsQ = Object.keys(per).find((k) => per[k].turns && typeof per[k].turns === 'string' && prompt.includes(per[k].turns));
        const j = (per[turnsQ || q] || {}).judge || { label: 'none', kind: '', who: 'none', evidence: '', confidence: 0.9 };
        return { json: j, cost: 0.0003, seconds: 1 };
      }
      if (job === 'child_test.sa_second_voice') {
        const v = (per[qOf(audio.key)] || {}).voice || { second_voice: false };
        return { json: { second_voice: v.second_voice, who: v.second_voice ? 'adult' : 'none', confidence: 0.9 }, cost: 0.0002, seconds: 1 };
      }
      const id = /\[(ur\.story2\.q\d)\]/.exec(prompt)[1];
      return { json: { questions: [{ id, answer: 'پنجرے میں', verdict: 'correct', confidence: 0.9 }] }, cost: 0.001, seconds: 1 };
    },
  };
}

const helpCalls = (got) => got.marks.meta.calls.filter((c) => c.job === 'child_test.sa_second_voice');

describe('sa_r28_voice_help: flag help, not support', () => {
  const before = { ...process.env };
  beforeEach(() => {
    process.env.CHILD_TEST_SA_SCORER = 'on'; process.env.CHILD_TEST_R2_ENV = 'sandbox';
    process.env.CHILD_TEST_SA_SECOND_VOICE = 'on'; process.env.CHILD_TEST_SA_SPEECH_GATE = 'on';
  });
  afterEach(() => { process.env = { ...before }; });

  test('OFF (unchanged): today\'s audio check runs, no transcript turns are asked for, no r28 fields', async () => {
    const s = standIns({ q2: { voice: { second_voice: true } } });
    const got = await score.scoreRow(row(), session(), s);
    expect(got.marks.detail).toMatchObject({ second_voice: true, second_voice_clips: 1, second_voice_checked: 3 });
    expect(s.turnsAsked).toEqual([]);
    expect(s.jobs.filter((j) => j.job === 'child_test.sa_second_voice').every((j) => j.audio && j.schema.name === 'sa_second_voice')).toBe(true);
    for (const k of ['voice_check', 'second_voice_kind', 'second_voice_reason', 'other_voice']) expect(got.marks.detail).not.toHaveProperty(k);
  });

  test('ON: a coach saying "louder, well done" is support: no flag, logged as other_voice, and the clip is checked from its transcript', async () => {
    const s = standIns({ q1: { turns: SUPPORT, judge: { label: 'support', kind: '', who: 'adult', evidence: '', confidence: 0.9 } } });
    const got = await score.scoreRow(row(), session(), { ...s, voiceHelp: true });
    expect(got.marks.detail).toMatchObject({ second_voice: false, second_voice_clips: 0, second_voice_checked: 3, other_voice: 'support', voice_check: 'r28' });
    expect(got.marks.detail.items.map((i) => !!i.second_voice)).toEqual([false, false, false]);
    // the model read the transcript, as text: no audio goes to the help check
    const judged = s.jobs.filter((j) => j.schema && j.schema.name === 'sa_voice_help');
    expect(judged).toHaveLength(3);
    expect(judged.every((j) => !j.audio)).toBe(true);
    expect(judged.some((j) => j.prompt.includes(SUPPORT))).toBe(true);
    // ... beside the task's own questions and answers
    expect(judged[0].prompt).toContain('پنجرے میں');
    expect(judged[0].prompt).toContain('مٹھو میاں');
  });

  test('ON: an adult saying the answer is help: flagged, with the kind and the matched answer words', async () => {
    const s = standIns({ q1: { turns: ADULT_ANSWER, judge: { label: 'help', kind: 'said_answer', who: 'adult', evidence: 'آپ کہو گے اپنے پنجرے میں', confidence: 0.9 } } });
    const got = await score.scoreRow(row(), session(), { ...s, voiceHelp: true });
    expect(got.marks.detail).toMatchObject({ second_voice: true, second_voice_clips: 1, second_voice_kind: 'help', voice_check: 'r28' });
    // the words that match the task's answer, never the rest of what the adult said (it can hold a name)
    expect(got.marks.detail.second_voice_reason).toBe('پنجرے میں');
    // a per-question clip: the item the help touched is that clip's own question
    expect(got.marks.detail.second_voice_items).toEqual(['ur.story2.q1']);
    expect(got.marks.detail.items.map((i) => !!i.second_voice)).toEqual([true, false, false]);
    expect(helpCalls(got).find((c) => c.label === 'help')).toMatchObject({ kind: 'said_answer', voice_check: 'words_heard' });
    expect(JSON.stringify(got.marks.meta)).not.toContain('آپ کہو گے');
  });

  test('ON: a re-ask is help only when the child\'s new answer is right; no change, or wrong to another wrong, is support', async () => {
    const s = standIns();
    await score.scoreRow(row(), session(), { ...s, voiceHelp: true });
    const judged = s.jobs.filter((j) => j.schema && j.schema.name === 'sa_voice_help');
    expect(judged).toHaveLength(3);
    for (const { prompt } of judged) {
      expect(prompt).toContain('right after a WRONG answer ("-3?", "کیا لگایا، زمین میں؟"), and the child then gives a different answer and the new answer is right, that is help (kind "corrected")');
      expect(prompt).toContain('If the new answer is still wrong, or the child keeps the same answer, the re-ask is support: the score cannot move.');
      expect(prompt).toContain('asks the same item again after a WRONG answer and the child then changes to the RIGHT answer');
      expect(prompt).toContain('asking a question again when the child had not answered, does not change the answer, or changes it to another wrong answer');
      expect(prompt).not.toContain('whether the new answer is right or not');
      // the read-again rule stays help on its own sentence: "So is …" after the support sentence read as support
      expect(prompt).toContain('Telling the child to read the passage again from some point ("دوبارہ پڑھو، یہاں سے") is help too.');
      expect(prompt).not.toContain('So is telling the child');
    }
  });

  test('ON: a help label whose quote is not in the transcript is kept as unclear, never a flag', async () => {
    const s = standIns({ q2: { turns: SUPPORT, judge: { label: 'help', kind: 'said_answer', who: 'adult', evidence: 'انھیں بھوک لگی تھی', confidence: 0.6 } } });
    const got = await score.scoreRow(row(), session(), { ...s, voiceHelp: true });
    expect(got.marks.detail).toMatchObject({ second_voice: false, other_voice: 'unclear' });
    expect(helpCalls(got).find((c) => c.label === 'unclear')).toMatchObject({ voice_check: 'not_corroborated' });
  });

  test('ON: another child reading along flags as other_child', async () => {
    const turns = '[1s] spk1: انھیں بھوک لگی تھی\n[1s] spk2: انھیں بھوک لگی تھی';
    const s = standIns({ q2: { turns, judge: { label: 'other_child', kind: 'read_along', who: 'child', evidence: 'انھیں بھوک لگی تھی', confidence: 0.8 } } });
    const got = await score.scoreRow(row(), session(), { ...s, voiceHelp: true });
    expect(got.marks.detail).toMatchObject({ second_voice: true, second_voice_kind: 'other_child' });
  });

  test('ON: no word heard (noise, silence) is none, with no model call', async () => {
    const s = standIns({ q1: { turns: '' }, q2: { turns: '' }, q3: { turns: '' } });
    const got = await score.scoreRow(row(), session(), { ...s, voiceHelp: true });
    expect(got.marks.detail).toMatchObject({ second_voice: false, second_voice_checked: 3, other_voice: null, voice_check: 'r28' });
    expect(s.jobs.filter((j) => j.schema && j.schema.name === 'sa_voice_help')).toHaveLength(0);
    expect(helpCalls(got).every((c) => c.voice_check === 'no_words' && c.label === 'none')).toBe(true);
  });

  test('ON: speech-to-text down: that clip is not checked (no flag), and the row still scores', async () => {
    const s = standIns({ q3: { turns: 'fail' } });
    const got = await score.scoreRow(row(), session(), { ...s, voiceHelp: true });
    expect(got.ok).toBe(true);
    expect(got.marks.detail).toMatchObject({ second_voice: false, second_voice_checked: 2 });
  });

  test('ON: the flag never changes a mark', async () => {
    const s = standIns({ q1: { turns: ADULT_ANSWER, judge: { label: 'help', kind: 'said_answer', who: 'adult', evidence: 'آپ کہو گے اپنے پنجرے میں', confidence: 0.9 } } });
    const got = await score.scoreRow(row(), session(), { ...s, voiceHelp: true });
    expect(got.marks.detail.items.map((i) => i.verdict)).toEqual(['correct', 'correct', 'correct']);
    expect(got.marks.correct).toBe(3);
  });

  test('ON overrides the stricter audio check: the help check runs, not the audio one', async () => {
    const s = standIns({ q1: { turns: SUPPORT, judge: { label: 'support', kind: '', who: 'adult', evidence: '', confidence: 0.9 } } });
    const got = await score.scoreRow(row(), session(), { ...s, voiceHelp: true, voiceStrict: true });
    expect(s.jobs.filter((j) => j.job === 'child_test.sa_second_voice').every((j) => !j.audio)).toBe(true);
    expect(got.marks.detail).toMatchObject({ voice_check: 'r28' });
  });

  test('a section recording: the whole clip is transcribed and judged once', async () => {
    const one = { ...row(), audio_r2_keys: null, audio_r2_key: KEY('q1') };
    const s = standIns({ q1: { turns: ADULT_ANSWER, judge: { label: 'help', kind: 'said_answer', who: 'adult', evidence: 'آپ کہو گے اپنے پنجرے میں', confidence: 0.9 } } });
    const got = await score.scoreRow(one, session(), { ...s, voiceHelp: true });
    expect(s.turnsAsked).toEqual(['q1']);
    expect(got.marks.detail).toMatchObject({ second_voice: true, second_voice_checked: 1 });
  });
});

describe('the switch: sa_r28_voice_help', () => {
  test('only JSON true is ON; anything else (a number, a string, no row) is OFF', () => {
    expect(helpSwitch.KEY).toBe('sa_r28_voice_help');
    expect(helpSwitch.valueOf(true)).toBe(true);
    for (const v of [false, null, undefined, 'true', 1, 0.4, {}]) expect(helpSwitch.valueOf(v)).toBe(false);
  });
  test('a handler sees a test\'s voiceHelp first, else the setting (fails closed on a read error)', async () => {
    expect(await helpSwitch.enabled({ voiceHelp: true })).toBe(true);
    expect(await helpSwitch.enabled({ voiceHelp: () => false })).toBe(false);
    const broken = { from: () => ({ select: () => ({ eq: async () => ({ data: null, error: { message: 'down' } }) }) }) };
    expect(await helpSwitch.on(Date.now() + 10 * 60 * 1000, broken)).toBe(false);
  });
});

describe('voice-help: the task content the model compares against, and the decision', () => {
  test('sums: each problem with its result; reading a sum aloud is support', () => {
    const c = VH.contentOf({ task: 'ma.add2i', kind: 'oral', subtask: 'addition', lang: 'ur', record: { items: [{ show: '13 + 6', answer: 19 }, { show: '18 + 7', answer: 25 }] } });
    expect(c).toContain('13 + 6 = 19');
    expect(c).toMatch(/reading a sum aloud is SUPPORT/);
  });
  test('a passage: its text; letters: names vs sounds; number ID: saying the number is the answer', () => {
    expect(VH.contentOf({ kind: 'passage', record: { passage: { text: 'آج بلال اپنے والد کے ساتھ' } } })).toContain('آج بلال');
    expect(VH.contentOf({ subtask: 'letter_sound', record: { grid: ['ب'], answers: ['بَ'] } })).toMatch(/SOUND[\s\S]*1: ب \(بَ\)/);
    expect(VH.contentOf({ subtask: 'number_identification', record: { grid: ['45'], answers: ['45'] } })).toMatch(/saying a shown number is giving the answer/);
  });
  test('decide: help needs a quote the transcript holds; support and unclear never flag', () => {
    const inTx = (q) => q === 'پنجرے میں';
    expect(VH.decide({ label: 'help', kind: 'said_answer', evidence: 'پنجرے میں' }, inTx)).toEqual({ label: 'help', kind: 'said_answer', flag: true, why: 'words_heard' });
    expect(VH.decide({ label: 'help', kind: 'said_answer', evidence: 'کچھ اور' }, inTx)).toEqual({ label: 'unclear', kind: '', flag: false, why: 'not_corroborated' });
    expect(VH.decide({ label: 'support', kind: '', evidence: '' }, inTx)).toMatchObject({ label: 'support', flag: false });
    expect(VH.decide({ label: 'unclear', kind: '', evidence: '' }, inTx)).toMatchObject({ label: 'unclear', flag: false });
    expect(VH.decide({ label: 'bogus' }, inTx)).toMatchObject({ label: null, flag: null });
  });
  test('matched words: only the quote\'s words that are the task\'s own items, answers or passage words (both digit scripts)', () => {
    const task = { record: { items: [{ show: '13 + 6', answer: 19 }], questions: [{ accept: ['پنجرے میں'] }] } };
    expect(VH.matchedWords('آپ کہو گے اپنے پنجرے میں', task)).toBe('پنجرے میں');
    expect(VH.matchedWords('شاباش بیٹا ۱۹ بولو', task)).toBe('۱۹');
    expect(VH.matchedWords('اونچی آواز میں بولو', { record: { items: [] } })).toBe('');
  });
});

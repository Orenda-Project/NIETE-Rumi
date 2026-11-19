'use strict';

/**
 * sa_r28_voice_help: a help flag says WHICH item the help touched (second_voice_items), and its reason is the task's
 * own word for it.
 *
 * On English tasks a coach often speaks Urdu, and speech-to-text writes the English word in Urdu script («پلانٹ» for
 * "plant") or spells it with Urdu letter names («ایف کے بعد آئی» for f, i). The reason kept only the quote's words that
 * are the task's own (in the task's script), so those flags stood with an empty reason and Results had nothing a coach
 * could check. ON: the reason is the target word in the task's spelling, and the detail keeps the matched item ids
 * (never the adult's other words). A call that heard no word made no model call and says so in its model field.
 * The scorer's own path runs on the real Grade 3 English battery; only the clip, speech-to-text and the models are
 * stand-ins.
 */

jest.mock('../../shared/config/supabase', () => ({ from: () => { throw new Error('no direct reads'); } }));

const score = require('../../shared/services/child-test/sa/score');
const VH = require('../../shared/services/child-test/sa/voice-help');

const SID = 'cccccccc-0000-4000-8000-000000000029';
const PHONE_SID = 'dddddddd-0000-4000-8000-000000000029';
const session = () => ({ id: SID, grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'completed', finished_at: '2026-11-18T05:19:56Z', asked: [] });
const row = (block, extra = {}) => ({
  id: `row-${block}`, session_id: SID, block, response_mode: 'record', ai_status: 'failed', ai_reason: 'final:sa_score_later',
  ai_marks: null, audio_r2_key: `child-test/sandbox/sch-1/${SID}/sa/${block}.webm`, audio_r2_keys: null, updated_at: '2026-11-18T05:16:30Z',
  responses: [{ kind: 'result', mode: 'record', task_id: block, session_id: PHONE_SID, time_used_ms: 60000, stop_reason: 'time_up', ...extra }],
});

// made-up transcripts in the shape the diarized speech-to-text gives (the coach in Urdu, the child in English)
const WORDS_SPELLED = '[3s] spk1: go\n[6s] spk1: sad\n[9s] spk1: up\n[12s] spk2: دیکھو، ایف کے بعد آئی ہے۔\n[14s] spk1: find';
const STORY_URDU_SCRIPT = '[40s] spk1: He took a small\n[44s] spk2: پلانٹ۔\n[46s] spk1: plant in a bag';
const plainOf = (turns) => turns.split('\n').map((l) => l.replace(/^\[\d+s\] spk\d: /, '')).join(' ');

function standIns({ turns, judge }) {
  const jobs = [];
  return {
    jobs,
    clipOf: async (key) => ({ base64: 'AAAA', durationSec: 20, key }),
    speechOf: async () => ({ words: 12, text: 'go sad up find', model: 'soniox:test', cost: 0, seconds: 1 }),
    speechTurnsOf: async () => {
      const text = plainOf(turns);
      return { words: text.split(/\s+/).filter(Boolean).length, turns, text, model: 'soniox:plain', cost: 0.00002, seconds: 1 };
    },
    model: () => 'google/gemini-test',
    chatJSON: async ({ prompt, schema, job }) => {
      jobs.push({ job, schema: schema && schema.name, prompt });
      if (schema && schema.name === 'sa_voice_help') return { json: judge, cost: 0.0003, seconds: 1 };
      const n = /words4/.test(prompt) || !/Imran/.test(prompt) ? 4 : 60;
      return { json: { words: Array.from({ length: n }, (_, k) => ({ i: k + 1, w: 'x', v: k < 3 ? 'correct' : 'skipped' })), words_correct: 3, words_attempted: 3, notes: '' }, cost: 0.001, seconds: 1 };
    },
  };
}

const helpCalls = (got) => got.marks.meta.calls.filter((c) => c.job === 'child_test.sa_second_voice');

describe('sa_r28_voice_help: the flag names the item the help touched', () => {
  const before = { ...process.env };
  beforeEach(() => {
    process.env.CHILD_TEST_SA_SCORER = 'on'; process.env.CHILD_TEST_R2_ENV = 'sandbox';
    process.env.CHILD_TEST_SA_SECOND_VOICE = 'on'; process.env.CHILD_TEST_SA_SPEECH_GATE = 'on';
  });
  afterEach(() => { process.env = { ...before }; });

  test('EN words, the coach spells the word in Urdu letter names: the reason is the word, the item is stored', async () => {
    const s = standIns({ turns: WORDS_SPELLED, judge: { label: 'help', kind: 'prompted', who: 'adult', evidence: 'دیکھو، ایف کے بعد آئی ہے۔', confidence: 0.95 } });
    const got = await score.scoreRow(row('en.words4'), session(), { ...s, voiceHelp: true });
    expect(got.ok).toBe(true);
    expect(got.marks.detail).toMatchObject({ second_voice: true, second_voice_kind: 'help', voice_check: 'r28' });
    expect(got.marks.detail.second_voice_reason).toBe('find');
    expect(got.marks.detail.second_voice_items).toEqual(['en.words4.04']);
    // the adult's own words are never kept
    expect(JSON.stringify(got.marks)).not.toContain('بعد');
  });

  test('EN story, the coach says the passage word in Urdu script: the reason is the word, its position is stored', async () => {
    const s = standIns({ turns: STORY_URDU_SCRIPT, judge: { label: 'help', kind: 'said_answer', who: 'adult', evidence: 'پلانٹ۔', confidence: 0.95 } });
    const got = await score.scoreRow(row('en.story_w3'), session(), { ...s, voiceHelp: true });
    expect(got.ok).toBe(true);
    expect(got.marks.detail).toMatchObject({ second_voice: true, second_voice_kind: 'help' });
    expect(got.marks.detail.second_voice_reason).toBe('plant');
    // "plant" is words 17, 31 and 39: the first is the one a reader meets first
    expect(got.marks.detail.second_voice_items).toEqual(['en.story_w3.017']);
  });

  test('a same-script match keeps its reason and gains the item', async () => {
    const turns = '[2s] spk2: find\n[3s] spk1: find';
    const s = standIns({ turns, judge: { label: 'help', kind: 'said_answer', who: 'adult', evidence: 'find', confidence: 0.9 } });
    const got = await score.scoreRow(row('en.words4'), session(), { ...s, voiceHelp: true });
    expect(got.marks.detail).toMatchObject({ second_voice_reason: 'find', second_voice_items: ['en.words4.04'] });
  });

  test('a help verdict whose quote names no item still flags (the quote is in the transcript), with no item', async () => {
    const turns = '[2s] spk2: دوبارہ پڑھو، یہاں سے\n[3s] spk1: go';
    const s = standIns({ turns, judge: { label: 'help', kind: 'corrected', who: 'adult', evidence: 'دوبارہ پڑھو، یہاں سے', confidence: 0.9 } });
    const got = await score.scoreRow(row('en.words4'), session(), { ...s, voiceHelp: true });
    expect(got.marks.detail).toMatchObject({ second_voice: true, second_voice_reason: '', second_voice_items: [] });
  });

  test('support: no flag, no item fields', async () => {
    const turns = '[2s] spk2: اونچی آواز میں بولو\n[3s] spk1: go';
    const s = standIns({ turns, judge: { label: 'support', kind: '', who: 'adult', evidence: '', confidence: 0.9 } });
    const got = await score.scoreRow(row('en.words4'), session(), { ...s, voiceHelp: true });
    expect(got.marks.detail).toMatchObject({ second_voice: false, other_voice: 'support' });
    expect(got.marks.detail).not.toHaveProperty('second_voice_items');
    expect(got.marks.detail).not.toHaveProperty('second_voice_reason');
  });

  test('no word heard: no model call, and the call row says so instead of naming a model', async () => {
    const s = standIns({ turns: '', judge: null });
    const got = await score.scoreRow(row('en.words4'), session(), { ...s, voiceHelp: true });
    const c = helpCalls(got);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ voice_check: 'no_words', label: 'none', model: 'skipped_no_words', cost: null });
    expect(s.jobs.filter((j) => j.schema === 'sa_voice_help')).toHaveLength(0);
  });

  test('timed sums, the adult reads digits that are operands of the sheet: the flag stands, no item (never every sum whose answer it is)', async () => {
    const turns = '[20s] spk2: 5 - 1?\n[22s] spk1: 4';
    const s = standIns({ turns, judge: { label: 'help', kind: 'prompted', who: 'adult', evidence: '5 - 1?', confidence: 0.9 } });
    const got = await score.scoreRow(row('ma.fluency1m'), session(), { ...s, voiceHelp: true });
    expect(got.ok).toBe(true);
    expect(got.marks.detail).toMatchObject({ second_voice: true, second_voice_kind: 'help', second_voice_items: [] });
  });

  test('letter sounds: the reason is the letter, without the sound\'s slashes', async () => {
    const turns = '[3s] spk2: اس کی آواز کیا ہے؟ ب۔\n[5s] spk1: ب';
    const s = standIns({ turns, judge: { label: 'help', kind: 'said_answer', who: 'adult', evidence: 'اس کی آواز کیا ہے؟ ب۔', confidence: 0.9 } });
    const got = await score.scoreRow(row('ur.letter_sounds5'), session(), { ...s, voiceHelp: true });
    expect(got.marks.detail).toMatchObject({ second_voice: true, second_voice_reason: 'ب', second_voice_items: ['ur.letter_sounds5.01'] });
  });

  test('OFF: unchanged, no item fields', async () => {
    const s = standIns({ turns: STORY_URDU_SCRIPT, judge: null });
    const got = await score.scoreRow(row('en.story_w3'), session(), s);
    for (const k of ['second_voice_items', 'second_voice_reason', 'second_voice_kind', 'voice_check']) expect(got.marks.detail).not.toHaveProperty(k);
  });
});

describe('voice-help: matchedItems', () => {
  const words = { lang: 'en', subtask: 'familiar_word_reading', record: { items: [{ id: 'w.1', show: 'go', target: 'go', answer: 'go' }, { id: 'w.2', show: 'small', target: 'small', answer: 'small' }, { id: 'w.3', show: 'find', target: 'find', answer: 'find' }] } };
  test('an English word in Urdu script, and a word spelled in Urdu letter names', () => {
    expect(VH.matchedItems('سمال۔', words)).toEqual({ words: 'small', items: ['w.2'] });
    expect(VH.matchedItems('ایف کے بعد آئی', words)).toEqual({ words: 'find', items: ['w.3'] });
  });
  test('Urdu words that are not the task\'s own match nothing; an Urdu task is not read across scripts', () => {
    expect(VH.matchedItems('اونچی آواز میں بولو', words)).toEqual({ words: '', items: [] });
    const ur = { lang: 'ur', record: { items: [{ id: 'u.1', show: 'پانی', target: 'پانی', answer: 'پانی' }] } };
    expect(VH.matchedItems('پانی۔', ur)).toEqual({ words: 'پانی', items: ['u.1'] });
    expect(VH.matchedItems('pani', ur)).toEqual({ words: '', items: [] });
  });
  test('a question: the accepted answer the adult said is the reason, the question is the item; the question itself is not', () => {
    const qs = { lang: 'en', record: { items: [{ id: 'q.1', prompt: { text: 'Why did Imran wake up early?' }, accept: ['for school', 'سکول کے لیے'] }, { id: 'q.2', prompt: { text: 'What was the class planting?' }, accept: ['trees', 'پودے'] }] } };
    expect(VH.matchedItems('بیٹا سکول کے لیے نا', qs)).toEqual({ words: 'سکول کے لیے', items: ['q.1'] });
    expect(VH.matchedItems('ٹریز', qs)).toEqual({ words: 'trees', items: ['q.2'] });
    expect(VH.matchedItems('Why did Imran wake up early?', qs)).toEqual({ words: '', items: [] });
  });
  test('a letter task: one Urdu letter name is that letter', () => {
    const letters = { lang: 'en', subtask: 'letter_name', record: { items: [{ id: 'l.1', show: 'i', target: 'i', answer: 'i' }, { id: 'l.2', show: 'y', target: 'y', answer: 'y' }] } };
    expect(VH.matchedItems('وائی بولو', letters)).toEqual({ words: 'y', items: ['l.2'] });
  });
  test('one item or none: two items named is no item, and the reason keeps both words', () => {
    const ur = { lang: 'ur', subtask: 'letter_name', record: { items: [{ id: 'n.1', show: 'د', target: 'د', answer: 'دال' }, { id: 'n.2', show: 'ج', target: 'ج', answer: 'جیم' }] } };
    expect(VH.matchedItems('دال کہو، پھر جیم', ur)).toEqual({ words: 'دال جیم', items: [] });
  });
  test('questions: the whole accepted answer that is the longest run in the quote names one question; a tie names none', () => {
    const qs = { lang: 'ur', record: { items: [
      { id: 'q2', accept: ['اس نے پودا لگایا', 'پودا لگایا'] }, { id: 'q3', accept: ['پودا'] }, { id: 'q4', accept: ['پودا', 'مٹی'] },
      { id: 'q5', accept: ['پانی ڈالا'] }, { id: 'q6', accept: ['پودا'] },
    ] } };
    expect(VH.matchedItems('اس نے پودا لگایا؟', qs).items).toEqual(['q2']);
    expect(VH.matchedItems('پودا؟', qs)).toEqual({ words: 'پودا', items: [] });
  });
  test('timed sums: a number names a sum only when it is the answer of exactly one sum and an operand of none', () => {
    const sheet = { lang: 'ur', record: { items: [
      { id: 'f.01', show: '1 + 4', answer: 5 }, { id: 'f.02', show: '2 + 2', answer: 4 }, { id: 'f.03', show: '6 + 4', answer: 10 },
      { id: 'f.10', show: '10 − 5', answer: 5 }, { id: 'f.12', show: '5 + 3', answer: 8 }, { id: 'f.14', show: '2 + 5', answer: 7 },
      { id: 'f.17', show: '8 − 5', answer: 3 }, { id: 'f.18', show: '9 − 4', answer: 5 }, { id: 'f.19', show: '7 − 2', answer: 5 },
    ] } };
    // operands, and an answer of four sums
    expect(VH.matchedItems('5 - 1?', sheet).items).toEqual([]);
    // every number an operand somewhere on the sheet
    expect(VH.matchedItems('اب 6 ہے، 6 کے ساتھ 4، ہم 7، 8، 9', sheet).items).toEqual([]);
    // the answer of one sum, an operand of none
    const one = { lang: 'ur', record: { items: [{ id: 'a.1', show: '13 + 6', answer: 19 }, { id: 'a.2', show: '18 + 7', answer: 25 }, { id: 'a.3', show: '2 + 2', answer: 4 }] } };
    expect(VH.matchedItems('4', one)).toEqual({ words: '4', items: ['a.3'] });
  });
  test('sums: the result said is that item; reading the sum\'s numbers is not an item match on its own', () => {
    const sums = { lang: 'ur', record: { items: [{ id: 's.1', show: '13 + 6', answer: 19 }, { id: 's.2', show: '8 + 4', answer: 12 }] } };
    expect(VH.matchedItems('بیٹا ۱۲ بولو', sums)).toEqual({ words: '12', items: ['s.2'] });
  });
});

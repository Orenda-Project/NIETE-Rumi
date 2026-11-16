'use strict';

/**
 * A stricter "another voice heard" check (app_settings sa_r26_voice_strict, OFF by default).
 *
 * The check asks a model whether another person speaks in a clip. On real recordings it raised the flag on clips where
 * speech-to-text heard no word at all, and on noise-only test clips it reported an adult in about half the runs. ON:
 * the model also gives the other person's words, and the flag stands only when speech-to-text heard words in the same
 * clip and those words are among them. No word heard, or words that are not in the transcript, and the flag is
 * cleared. A transcript that could not be made leaves the model's answer as it was. The flag never changes a mark.
 * OFF: unchanged. The scorer's own path runs here; only the clip, speech-to-text and the model are stand-ins.
 */

jest.mock('../../shared/config/supabase', () => ({ from: () => { throw new Error('no direct reads'); } }));

const score = require('../../shared/services/child-test/sa/score');
const strictSwitch = require('../../shared/services/child-test/app/voice-strict-switch');

const SID = 'cccccccc-0000-4000-8000-000000000026';
const PHONE_SID = 'dddddddd-0000-4000-8000-000000000026';
const KEY = (q) => `child-test/sandbox/sch-1/${SID}/sa/ur.story_comp_w3__ur.story2.${q}.webm`;
const QS = ['q1', 'q2', 'q3'];
const qOf = (key) => /\.(q\d)\.webm$/.exec(key)[1];

const session = () => ({ id: SID, grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'completed', finished_at: '2026-11-16T05:19:56Z', asked: QS.map((q) => `ur.story2.${q}`) });
const row = () => ({
  id: 'row-ur-comp', session_id: SID, block: 'ur.story_comp_w3', response_mode: 'oral', ai_status: 'failed', ai_reason: 'final:sa_score_later',
  ai_marks: null, audio_r2_key: null, audio_r2_keys: QS.map((q) => ({ i: `ur.story2.${q}`, key: KEY(q) })), updated_at: '2026-11-16T05:16:30Z',
  responses: [{ kind: 'result', mode: 'oral', asked: QS.map((q) => `ur.story2.${q}`), task_id: 'ur.story_comp_w3', recorded: true, attempted: 3, session_id: PHONE_SID, stop_reason: 'complete' }],
});

const ADULT = 'اونچا بولنا ہے شاباش';

/**
 * per question: stt = what speech-to-text heard ({ words, said } | 'fail'), voice = what the voice check answers
 * ({ second_voice, words }).
 */
function standIns(per = {}) {
  const jobs = [];
  const stt = [];
  return {
    jobs,
    stt,
    clipOf: async (key) => ({ base64: 'AAAA', durationSec: 6, key }),
    speechOf: async (clip) => {
      const p = per[qOf(clip.key)] || {};
      stt.push(qOf(clip.key));
      if (p.stt === 'fail') throw new Error('stt down');
      const s = p.stt || { words: 3, said: 'بانو کی بلی' };
      return { words: s.words, text: s.said, said: s.said, model: 'soniox:test', cost: 0, seconds: 1 };
    },
    model: () => 'google/gemini-test',
    chatJSON: async ({ prompt, schema, job, audio }) => {
      jobs.push({ job, schema, prompt });
      if (job === 'child_test.sa_second_voice') {
        const v = (per[qOf(audio.key)] || {}).voice || { second_voice: false, words: '' };
        const json = { second_voice: v.second_voice, who: v.second_voice ? 'adult' : 'none', confidence: 0.9 };
        if (schema && schema.schema.properties.words) json.words = v.words || '';
        return { json, cost: 0.0002, seconds: 1 };
      }
      const id = /\[(ur\.story2\.q\d)\]/.exec(prompt)[1];
      return { json: { questions: [{ id, answer: 'بانو کی بلی', verdict: 'wrong', confidence: 0.9 }] }, cost: 0.001, seconds: 1 };
    },
  };
}

const voiceCalls = (got) => got.marks.meta.calls.filter((c) => c.job === 'child_test.sa_second_voice');

describe('sa_r26_voice_strict: the another-voice flag needs the other person\'s words in the transcript', () => {
  const before = { ...process.env };
  beforeEach(() => {
    process.env.CHILD_TEST_SA_SCORER = 'on'; process.env.CHILD_TEST_R2_ENV = 'sandbox';
    process.env.CHILD_TEST_SA_SECOND_VOICE = 'on'; process.env.CHILD_TEST_SA_SPEECH_GATE = 'on';
  });
  afterEach(() => { process.env = { ...before }; });

  test('OFF (unchanged): the model\'s flag stands even where speech-to-text heard no word', async () => {
    const s = standIns({ q2: { stt: { words: 0, said: '' }, voice: { second_voice: true } } });
    const got = await score.scoreRow(row(), session(), s);
    expect(got.marks.detail).toMatchObject({ second_voice: true, second_voice_clips: 1, second_voice_checked: 3 });
    // the prompt and schema are today's: no words asked for
    const voice = s.jobs.filter((j) => j.job === 'child_test.sa_second_voice');
    expect(voice.every((j) => !j.schema.schema.properties.words)).toBe(true);
  });

  test('ON: no word heard in the clip clears the flag (noise or silence), and says why', async () => {
    const s = standIns({ q2: { stt: { words: 0, said: '' }, voice: { second_voice: true, words: ADULT } } });
    const got = await score.scoreRow(row(), session(), { ...s, voiceStrict: true });
    expect(got.marks.detail).toMatchObject({ second_voice: false, second_voice_clips: 0, second_voice_checked: 3 });
    expect(got.marks.detail.items.map((i) => !!i.second_voice)).toEqual([false, false, false]);
    const q2 = voiceCalls(got).find((c) => c.model_second_voice === true);
    expect(q2).toMatchObject({ second_voice: false, model_second_voice: true, voice_check: 'no_words' });
  });

  test('ON: the other person\'s words are in the transcript: the flag stands', async () => {
    const s = standIns({ q2: { stt: { words: 7, said: `بانو کی بلی ${ADULT}` }, voice: { second_voice: true, words: ADULT } } });
    const got = await score.scoreRow(row(), session(), { ...s, voiceStrict: true });
    expect(got.marks.detail).toMatchObject({ second_voice: true, second_voice_clips: 1, second_voice_checked: 3 });
    expect(got.marks.detail.items.map((i) => !!i.second_voice)).toEqual([false, true, false]);
    expect(voiceCalls(got).find((c) => c.second_voice === true)).toMatchObject({ voice_check: 'words_heard' });
  });

  test('ON: words the transcript does not hold (the model invented an adult): the flag is cleared', async () => {
    const s = standIns({ q1: { stt: { words: 3, said: 'بانو کی بلی' }, voice: { second_voice: true, words: 'آپ آگے کریں جلدی کرو' } } });
    const got = await score.scoreRow(row(), session(), { ...s, voiceStrict: true });
    expect(got.marks.detail).toMatchObject({ second_voice: false, second_voice_clips: 0 });
    expect(voiceCalls(got).find((c) => c.model_second_voice === true)).toMatchObject({ second_voice: false, voice_check: 'not_corroborated' });
  });

  test('ON: no words given by the model: nothing to hold the flag up, it is cleared', async () => {
    const s = standIns({ q3: { stt: { words: 3, said: 'بانو کی بلی' }, voice: { second_voice: true, words: '' } } });
    const got = await score.scoreRow(row(), session(), { ...s, voiceStrict: true });
    expect(got.marks.detail).toMatchObject({ second_voice: false });
    expect(voiceCalls(got).find((c) => c.model_second_voice === true)).toMatchObject({ voice_check: 'not_corroborated' });
  });

  test('ON: speech-to-text failed: the model\'s answer stands (we cannot check it), and the row still scores', async () => {
    const s = standIns({ q2: { stt: 'fail', voice: { second_voice: true, words: ADULT } } });
    const got = await score.scoreRow(row(), session(), { ...s, voiceStrict: true });
    expect(got.ok).toBe(true);
    expect(got.marks.detail).toMatchObject({ second_voice: true, second_voice_clips: 1 });
    expect(voiceCalls(got).find((c) => c.second_voice === true)).toMatchObject({ voice_check: 'stt_unavailable' });
  });

  test('ON: the flag never changes a mark', async () => {
    const s = standIns({ q2: { stt: { words: 7, said: `بانو کی بلی ${ADULT}` }, voice: { second_voice: true, words: ADULT } } });
    const got = await score.scoreRow(row(), session(), { ...s, voiceStrict: true });
    expect(got.marks.detail.items.map((i) => i.verdict)).toEqual(['wrong', 'wrong', 'wrong']);
    expect(got.marks.correct).toBe(0);
  });

  test('ON: one speech-to-text call per clip, shared by the speech gate and the voice check', async () => {
    const s = standIns({ q2: { stt: { words: 7, said: `بانو کی بلی ${ADULT}` }, voice: { second_voice: true, words: ADULT } } });
    await score.scoreRow(row(), session(), { ...s, voiceStrict: true });
    expect(s.stt.sort()).toEqual(['q1', 'q2', 'q3']);
  });

  test('ON: the model is asked for the other person\'s words, and the marks never keep them (they can hold a name)', async () => {
    const s = standIns({ q2: { stt: { words: 7, said: `بانو کی بلی ${ADULT}` }, voice: { second_voice: true, words: ADULT } } });
    const got = await score.scoreRow(row(), session(), { ...s, voiceStrict: true });
    const voice = s.jobs.filter((j) => j.job === 'child_test.sa_second_voice');
    expect(voice).toHaveLength(3);
    expect(voice.every((j) => j.schema.schema.properties.words && j.schema.schema.required.includes('words'))).toBe(true);
    expect(JSON.stringify(got.marks)).not.toContain('اونچا');
  });

  test('ON, gate off: the voice check makes its own speech-to-text call', async () => {
    delete process.env.CHILD_TEST_SA_SPEECH_GATE;
    const s = standIns({ q2: { stt: { words: 0, said: '' }, voice: { second_voice: true, words: ADULT } } });
    const got = await score.scoreRow(row(), session(), { ...s, voiceStrict: true });
    expect(s.stt.sort()).toEqual(['q2']);   // only the flagged clip needs a transcript
    expect(got.marks.detail).toMatchObject({ second_voice: false });
  });

  test('a section recording: the whole clip\'s transcript is what the quote is checked against', async () => {
    const one = { ...row(), audio_r2_keys: null, audio_r2_key: KEY('q1') };
    const s = standIns({ q1: { stt: { words: 0, said: '' }, voice: { second_voice: true, words: ADULT } } });
    const got = await score.scoreRow(one, session(), { ...s, voiceStrict: true });
    expect(got.marks.detail).toMatchObject({ second_voice: false, second_voice_checked: 1 });
  });
});

describe('corroboration rule', () => {
  const { corroborated } = score.__internals;
  test('the quote must be found in what speech-to-text heard (character pairs, harakat and punctuation ignored)', () => {
    expect(corroborated('اونچا بولنا ہے', { words: 5, said: 'بانو اُونچا بولنا ہے، شاباش' })).toEqual({ ok: true, why: 'words_heard' });
    expect(corroborated('speak louder', { words: 4, said: 'cat sat, speak louder' })).toEqual({ ok: true, why: 'words_heard' });
    expect(corroborated('آپ آگے کریں', { words: 3, said: 'بانو کی بلی' })).toEqual({ ok: false, why: 'not_corroborated' });
    expect(corroborated('اونچا بولنا', { words: 0, said: '' })).toEqual({ ok: false, why: 'no_words' });
    expect(corroborated('', { words: 3, said: 'بانو کی بلی' })).toEqual({ ok: false, why: 'not_corroborated' });
    expect(corroborated('اونچا', null)).toEqual({ ok: null, why: 'stt_unavailable' });
  });
  test('a quote the model wrote in Devanagari is compared in Urdu script', () => {
    expect(corroborated('झंडा', { words: 2, said: 'جھنڈا لہرا' }).why).not.toBe('stt_unavailable');
  });
});

describe('the switch (app_settings sa_r26_voice_strict)', () => {
  const client = (rows, error = null) => ({ from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: rows, error }) }) }) });
  test('JSON true only; absent, any other value or a read error is off', async () => {
    expect(strictSwitch.KEY).toBe('sa_r26_voice_strict');
    expect(await strictSwitch.on(1e12, client([{ key: 'sa_r26_voice_strict', value: true }]))).toBe(true);
    expect(await strictSwitch.on(2e12, client([{ key: 'sa_r26_voice_strict', value: 'true' }]))).toBe(false);
    expect(await strictSwitch.on(3e12, client([]))).toBe(false);
    expect(await strictSwitch.on(4e12, client(null, { message: 'down' }))).toBe(false);
  });
  test('a test\'s voiceStrict wins over the setting', async () => {
    expect(await strictSwitch.enabled({ voiceStrict: true })).toBe(true);
    expect(await strictSwitch.enabled({ voiceStrict: false })).toBe(false);
  });
});

describe('the sweep reads the switch and the scorer uses it', () => {
  const before = { ...process.env };
  beforeEach(() => {
    process.env.CHILD_TEST_SA_SCORER = 'on'; process.env.CHILD_TEST_R2_ENV = 'sandbox';
    process.env.CHILD_TEST_SA_SECOND_VOICE = 'on'; process.env.CHILD_TEST_SA_SPEECH_GATE = 'on';
    score.__internals.resetBoot();
  });
  afterEach(() => { process.env = { ...before }; });

  function fakeDb(tables) {
    const from = (name) => {
      const f = []; let patch = null;
      const q = {
        select() { return q; }, order() { return q; }, limit() { return q; },
        eq(c, v) { f.push((r) => r[c] === v); return q; },
        is(c, v) { f.push((r) => (r[c] ?? null) === v); return q; },
        like(c, v) { const p = v.replace(/%$/, ''); f.push((r) => String(r[c] || '').startsWith(p)); return q; },
        gte(c, v) { f.push((r) => String(r[c]) >= v); return q; },
        in(c, vs) { f.push((r) => vs.includes(r[c])); return q; },
        update(p) { patch = p; return q; },
        then(ok, bad) {
          if (!tables[name]) return Promise.resolve({ data: [], error: null }).then(ok, bad);
          const hit = tables[name].filter((r) => f.every((fn) => fn(r)));
          if (patch) { hit.forEach((r) => Object.assign(r, patch)); return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null }).then(ok, bad); }
          return Promise.resolve({ data: hit.map((r) => JSON.parse(JSON.stringify(r))), error: null }).then(ok, bad);
        },
      };
      return q;
    };
    return { from };
  }

  test('switch on: a silent clip\'s flag is cleared in the stored marks', async () => {
    const rows = [row()];
    const db = fakeDb({ child_test_blocks: rows, child_test_sessions: [session()] });
    const s = standIns({ q2: { stt: { words: 0, said: '' }, voice: { second_voice: true, words: ADULT } } });
    const out = await score.sweepOnce({ now: new Date('2026-11-16T06:00:00Z'), deps: { supabase: db, ...s, voiceStrict: true } });
    expect(out).toMatchObject({ scored: 1 });
    expect(rows[0].ai_marks.detail).toMatchObject({ second_voice: false });
  });

  test('switch off: the same clip stays flagged', async () => {
    const rows = [row()];
    const db = fakeDb({ child_test_blocks: rows, child_test_sessions: [session()] });
    const s = standIns({ q2: { stt: { words: 0, said: '' }, voice: { second_voice: true, words: ADULT } } });
    const out = await score.sweepOnce({ now: new Date('2026-11-16T06:00:00Z'), deps: { supabase: db, ...s, voiceStrict: false } });
    expect(out).toMatchObject({ scored: 1 });
    expect(rows[0].ai_marks.detail).toMatchObject({ second_voice: true });
  });
});

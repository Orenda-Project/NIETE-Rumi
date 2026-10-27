'use strict';

/**
 * Self-corrections (EGRA: a self-correction counts as correct; EGMA: the last answer the child settles on is the
 * answer), in the spoken scorers:
 *  1. Comprehension and listening questions: the marker is told to judge the FINAL answer the child settles on (a
 *     correction to the right answer is correct; a change from right to wrong is wrong), in the self-administered
 *     scorer's questions prompt and in the coach-recorded comprehension prompt. The tests read the prompt the scorer
 *     really sends, with a child correcting themself each way in the clip / transcript.
 *  2. Spoken maths (and questions) recorded as one section: each item's stretch runs a moment into the next question
 *     (to 2 s after the next question's ask, never past that question's end), so a correction said just after the
 *     screen moved on is in the item's own stretch; the marker is told to ignore talk about another question.
 * Only the cut, STT and the model are stand-ins (the model one marks the last number heard in the stretch for the
 * item, as the prompt tells it to). Synthetic timelines only: no real child, no names.
 */

const score = require('../../shared/services/child-test/sa/score');

const SID = 'cccccccc-0000-4000-8000-00000000000e';
const PHONE_SID = 'dddddddd-0000-4000-8000-00000000000e';
const session = (asked) => ({ id: SID, grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'completed', finished_at: '2026-10-25T10:00:00Z', asked });
const FINAL_RULE = /final answer the child settles on/i;
const RIGHT_TO_WRONG = /from (a|the) right answer to a wrong one is WRONG/i;

function sectionRow({ block, taskId, asked, marks }) {
  return {
    id: `row-${block}`, session_id: SID, block, response_mode: 'oral', ai_status: 'failed', ai_reason: 'final:sa_score_later',
    ai_marks: null, audio_r2_key: `child-test/sandbox/sch-1/${SID}/sa/${block}.webm`, audio_r2_keys: null, updated_at: '2026-10-25T09:59:00Z',
    responses: [{ kind: 'result', mode: 'oral', asked, task_id: taskId, recorded: true, attempted: asked ? asked.length : 2, session_id: PHONE_SID,
      stop_reason: 'complete', rec_section: true, rec_marks: marks }],
  };
}

const env = { ...process.env };
beforeEach(() => { process.env.CHILD_TEST_SA_SCORER = 'on'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; delete process.env.CHILD_TEST_SA_SPEECH_GATE; });
afterEach(() => { process.env = { ...env }; });

describe('1. comprehension and listening: the marker judges the final answer the child settles on', () => {
  const QS = ['q1', 'q2'];
  // the child's words in each question's stretch, both ways (the marker hears this; the test reads the prompt)
  const BOTH_WAYS = { q1: 'گرم… نہیں، ٹھنڈی', q2: 'ٹھنڈی… نہیں، گرم' };
  async function promptsFor(block, taskId, ids) {
    const prompts = [];
    const deps = {
      clipOf: async () => { throw new Error('cut, never whole'); },
      sliceOf: async (key, windows) => windows.map((w) => ({ base64: 'AAAA', durationSec: w.to_s - w.from_s, item: w.item_id })),
      model: () => 'google/gemini-test',
      chatJSON: async ({ prompt }) => {
        prompts.push(prompt);
        const id = /\[([a-z]{2}\.[a-z0-9_]+\.q\d)\]/.exec(prompt)[1];
        return { json: { questions: [{ id, answer: BOTH_WAYS[id.slice(-2)], verdict: 'correct', confidence: 0.8 }] }, cost: 0, seconds: 1 };
      },
    };
    const marks = ids.map((id, k) => ({ item_id: id, ask_ms: k * 10000, answer_ms: k * 10000 + 3000, end_ms: k * 10000 + 9000 }));
    const got = await score.scoreRow(sectionRow({ block, taskId, asked: ids, marks }), session(ids), deps);
    expect(got.ok).toBe(true);
    return prompts;
  }

  test('reading comprehension (self-administered): every question prompt carries the final-answer rule', async () => {
    const prompts = await promptsFor('ur.story_comp_w3', 'ur.story_comp_w3', QS.map((q) => `ur.story2.${q}`));
    expect(prompts).toHaveLength(2);
    for (const p of prompts) { expect(p).toMatch(FINAL_RULE); expect(p).toMatch(RIGHT_TO_WRONG); }
  });

  test('listening comprehension (self-administered): every question prompt carries the final-answer rule', async () => {
    const prompts = await promptsFor('ur.listening', 'ur.listening', QS.map((q) => `ur.listening.${q}`));
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toMatch(/story the phone read aloud/);
    for (const p of prompts) { expect(p).toMatch(FINAL_RULE); expect(p).toMatch(RIGHT_TO_WRONG); }
  });

  test('one clip for all questions (no section): the prompt carries the rule too', () => {
    const p = score.__internals.questionsPrompt({ lang: 'en', task: { kind: 'listen_questions' }, questions: [{ id: 'en.listening.q1', prompt: { text: 'Where did they go?' }, accept: ['market'] }], passage: null, single: true });
    expect(p).toMatch(FINAL_RULE);
    expect(p).toMatch(RIGHT_TO_WRONG);
  });

  describe('coach-recorded comprehension (the transcript grader)', () => {
    let mockCreate;
    let scoreQuestions;
    beforeEach(() => {
      jest.resetModules();
      mockCreate = jest.fn();
      jest.doMock('openai', () => jest.fn().mockImplementation(() => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } })));
      ({ scoreQuestions } = require('../../shared/services/child-test/scoring/comprehension'));
    });
    afterEach(() => { jest.dontMock('openai'); });
    const promptOf = (req) => { const c = req.messages[0].content; return typeof c === 'string' ? c : c[0].text; };
    const words = (childSays) => [
      { raw: 'ہوا', start: 70, end: 70.4, speaker: 1 }, { raw: 'کیسی', start: 70.5, end: 70.9, speaker: 1 }, { raw: 'تھی', start: 71, end: 71.3, speaker: 1 },
      ...childSays.split(' ').map((w, k) => ({ raw: w, start: 73 + k * 0.6, end: 73.4 + k * 0.6, speaker: 2 })),
    ];
    const spec = { story: { text: 'ٹھنڈی ہوا چل رہی تھی۔' }, questions: [{ id: 'u3A-q2', prompt: 'وہاں ہوا کیسی تھی', accept: ['ٹھنڈی'], reject: ['گرم'] }] };

    test.each([
      ['wrong-then-right', 'گرم نہیں ٹھنڈی'],
      ['right-then-wrong', 'ٹھنڈی نہیں گرم'],
    ])('%s: the transcript and the final-answer rule both reach the grader', async (_, childSays) => {
      mockCreate.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ questions: [{ id: 'u3A-q2', asked: true, answer: childSays, verdict: 'correct', confidence: 0.8 }] }) } }], usage: { cost: 0.001, prompt_tokens: 10, completion_tokens: 10 } });
      const r = await scoreQuestions({ lang: 'urdu', spec, words: words(childSays), window: { start: 65, end: 80 }, calls: [] });
      expect(r.ok).toBe(true);
      const p = promptOf(mockCreate.mock.calls[0][0]);
      expect(p).toContain(childSays.split(' ')[2]);
      expect(p).toMatch(FINAL_RULE);
      expect(p).toMatch(RIGHT_TO_WRONG);
    });
  });
});

describe('2. spoken maths recorded as one section: a correction said just after the screen moved on is the item\'s', () => {
  // ma.add2i: 13 + 6 = 19, then 18 + 7 = 25. Item 1 asked 0 s, answer window 2 s, moved on 8 s; item 2 asked 9 s.
  const MARKS = [{ item_id: 'ma.add2i.01', ask_ms: 0, answer_ms: 2000, end_ms: 8000 }, { item_id: 'ma.add2i.02', ask_ms: 9000, answer_ms: 11000, end_ms: 15000 }];
  const ITEM_OF = { '13 + 6': 'ma.add2i.01', '18 + 7': 'ma.add2i.02' };
  // what the child says, when, and which question it is about (the correction lands at 9.6 s: item 2 is being asked)
  const WRONG_THEN_RIGHT = [{ t: 5, item: 'ma.add2i.01', n: 18 }, { t: 9.6, item: 'ma.add2i.01', n: 19 }, { t: 12, item: 'ma.add2i.02', n: 25 }];
  const RIGHT_THEN_WRONG = [{ t: 5, item: 'ma.add2i.01', n: 19 }, { t: 9.6, item: 'ma.add2i.01', n: 20 }, { t: 12, item: 'ma.add2i.02', n: 25 }];

  function run(timeline) {
    const prompts = []; const cuts = [];
    // each cut clip carries its own stretch in its bytes, so the stand-in marker knows what it hears
    const enc = (w) => Buffer.from(JSON.stringify([w.from_s, w.to_s])).toString('base64');
    const dec = (b64) => JSON.parse(Buffer.from(b64, 'base64').toString());
    const deps = {
      clipOf: async () => { throw new Error('cut, never whole'); },
      sliceOf: async (key, windows) => { cuts.push(windows); return windows.map((w) => ({ base64: enc(w), durationSec: w.to_s - w.from_s })); },
      model: () => 'google/gemini-test',
      // the marker: hears the stretch, takes the last number said about THIS item (it is told to ignore another one)
      chatJSON: async ({ prompt, audio }) => {
        prompts.push(prompt);
        const shown = /1: shown "([^"]+)" → correct answer (\d+)/.exec(prompt);
        const item = ITEM_OF[shown[1]];
        const [from, to] = dec(audio.data);
        const said = timeline.filter((x) => x.item === item && x.t >= from && x.t < to);
        const last = said.length ? said[said.length - 1].n : null;
        return { json: { found: true, last_attempted: 1, letters_correct: 0, items: [{ i: 1, heard: last == null ? '' : String(last), v: last == null ? 's' : last === Number(shown[2]) ? 'c' : 'w', conf: 0.9 }] }, cost: 0, seconds: 1 };
      },
    };
    const row = sectionRow({ block: 'ma.add2i', taskId: 'ma.add2i', asked: null, marks: MARKS });
    return score.scoreRow(row, session([]), deps).then((got) => ({ got, prompts, cuts }));
  }

  test('the stretch runs 2 s into the next question (never past its end); the last runs 2.5 s past its own end', async () => {
    const { cuts } = await run(WRONG_THEN_RIGHT);
    expect(cuts[0]).toEqual([{ item_id: 'ma.add2i.01', from_s: 1, to_s: 11 }, { item_id: 'ma.add2i.02', from_s: 10, to_s: 17.5 }]);
  });

  test('wrong-then-right ("18… 19" for 13 + 6, the 19 after the screen moved on): correct', async () => {
    const { got } = await run(WRONG_THEN_RIGHT);
    expect(got.marks.detail.items.map((i) => [i.verdict, i.heard])).toEqual([['correct', '19'], ['correct', '25']]);
  });

  test('right-then-wrong ("19… 20" for 13 + 6, the 20 after the screen moved on): wrong', async () => {
    const { got } = await run(RIGHT_THEN_WRONG);
    expect(got.marks.detail.items.map((i) => [i.verdict, i.heard])).toEqual([['wrong', '20'], ['correct', '25']]);
  });

  test('each stretch\'s prompt tells the marker to ignore talk about another question', async () => {
    const { prompts } = await run(WRONG_THEN_RIGHT);
    expect(prompts).toHaveLength(2);
    for (const p of prompts) expect(p).toMatch(/ignore anything said about (another|the next) question/i);
  });

  test('a stretch never runs past the next question\'s own end', () => {
    const w = score.__internals.sectionWindows({ audio_r2_key: 'k' }, { rec_section: true, rec_marks: [
      { item_id: 'a', ask_ms: 0, answer_ms: 1000, end_ms: 5000 }, { item_id: 'b', ask_ms: 5000, answer_ms: 5500, end_ms: 6000 }] });
    expect(w[0]).toEqual({ item_id: 'a', from_s: 0, to_s: 6 });
  });
});

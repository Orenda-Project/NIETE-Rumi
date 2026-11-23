'use strict';
/**
 * Queue #230 — no rubric key reaches a report as text (the operator, 23 Nov: "on a report i am seeing in underscores
 * one_improvement_only. why is that?").
 *
 * Why it happened: the debrief judge is told to aim its "try" at "a rubric key you judged FALSE", and in 116 of 710
 * prod debriefs since 10 Nov it wrote the KEY itself as try.move; the report printed try.move as its Key Focus Area.
 * A few focus_why lines name keys mid-sentence. Fixed at both ends: the judge's answer is put in words before it is
 * stored or sent (coachFeedbackWithRepair), and the report shapers put stored rows in words before a page sees them.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

const SNAKE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/;
const KEYS = ['opened_with_specific_praise', 'anchored_in_real_moment', 'asked_and_waited', 'one_improvement_only',
  'moves_not_teacher', 'elicited_if_then', 'righting_reflex_held', 'rehearsed_the_step'];

// The shape stored on prod today (23 Nov, a FICO-S visit): try.move is the bare key, focus_why names two keys.
function storedFeedback(over = {}) {
  const rubric = { disparaged_teacher: false };
  for (const k of KEYS) rubric[k] = !['one_improvement_only', 'elicited_if_then', 'rehearsed_the_step'].includes(k);
  return {
    praise_line: 'You opened with what really worked in the lesson.',
    wins: [{ behaviour: 'opened_with_specific_praise', evidence: 'you named the story' }, { behaviour: 'asked_and_waited', evidence: 'you waited' }],
    try: { move: 'one_improvement_only', evidence: 'You raised three changes at once.', instead: 'Pick the one that matters most.' },
    reflection_question: 'Which one change matters most?',
    focus: 'one_improvement_only',
    focus_why: 'One change gives room for elicited_if_then and rehearsed_the_step to follow.',
    missed: {
      one_improvement_only: 'You raised three changes.',
      elicited_if_then: 'You gave the step yourself, before elicited_if_then could happen.',
      rehearsed_the_step: 'The talk ended once the plan was agreed.',
    },
    did: { opened_with_specific_praise: 'You praised the story.' },
    rubric,
    ...over,
  };
}

/** Every string the page could print, with the paths of the fields that are keys by design taken out. */
function printed(o, path = '', out = []) {
  if (typeof o === 'string') { out.push([path, o]); return out; }
  if (Array.isArray(o)) { o.forEach((v, i) => printed(v, `${path}[${i}]`, out)); return out; }
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) printed(v, path ? `${path}.${k}` : k, out);
  return out;
}
const isKeyField = (p) => /(^|\.)(key|id|focus|behaviour)$/.test(p) || /(^|\.)rubric\./.test(p);
const leaks = (o) => printed(o).filter(([p, s]) => !isKeyField(p) && SNAKE.test(s));

describe('queue #230 · keysToWords / feedbackInWords (observe-coach-rubric)', () => {
  const R = require('../../bot/shared/services/observe/observe-coach-rubric');
  const { observeStrings } = require('../../bot/shared/services/observe/observe-strings');
  const EN = observeStrings('en').coach_rubric_names;
  const UR = observeStrings('ur').coach_rubric_names;

  it('a bare key becomes its name, in the language asked for', () => {
    expect(R.keysToWords('one_improvement_only', 'en')).toBe(EN.one_improvement_only);
    expect(R.keysToWords(' one_improvement_only ', 'ur')).toBe(UR.one_improvement_only);
  });

  it('a key inside a line takes the line\'s own language; any other snake_case word loses its underscores', () => {
    expect(R.keysToWords('feeds both elicited_if_then and rehearsed_the_step.'))
      .toBe(`feeds both ${EN.elicited_if_then} and ${EN.rehearsed_the_step}.`);
    expect(R.keysToWords('یہ elicited_if_then سے جڑا ہے')).toBe(`یہ ${UR.elicited_if_then} سے جڑا ہے`);
    expect(R.keysToWords('a some_new_key here')).toBe('a some new key here');
    expect(R.keysToWords('Hold the silence after your question.')).toBe('Hold the silence after your question.');
  });

  it('feedbackInWords: every line in words; the rubric, focus, missed/did keys and win behaviours stay keys', () => {
    const fb = storedFeedback();
    const out = R.feedbackInWords(fb);
    expect(leaks(out)).toEqual([]);
    expect(out.try.move).toBe(EN.one_improvement_only);
    expect(out.focus).toBe('one_improvement_only');
    expect(Object.keys(out.missed)).toEqual(Object.keys(fb.missed));
    expect(out.wins.map((w) => w.behaviour)).toEqual(['opened_with_specific_praise', 'asked_and_waited']);
    expect(out.rubric).toEqual(fb.rubric);
    expect(fb.try.move).toBe('one_improvement_only'); // the input is untouched
  });

  // Today's real FICO-S debrief: English lines quoting the officer's Urdu ("You said 'شاباش'…"). It is an English
  // debrief; a key in it is named in English, inside a line and as a bare move.
  it('an English debrief that quotes Urdu speech is English: the key is named in English', () => {
    const fb = storedFeedback({
      try: { move: 'one_improvement_only', evidence: "You said 'آج ہم نے کہانی پڑھی' and moved on to three changes.", instead: 'Pick the one that matters most.' },
      focus_why: "You told the teacher 'یہ بھی ٹھیک کریں' twice, so elicited_if_then never came.",
    });
    const out = R.feedbackInWords(fb);
    expect(R.feedbackLanguage(fb)).toBe('en');
    expect(out.try.move).toBe(EN.one_improvement_only);
    expect(out.focus_why).toContain(EN.elicited_if_then);
  });

  it('an Urdu debrief names a bare-key move in Urdu', () => {
    const fb = storedFeedback({
      praise_line: 'آپ نے سبق کی اصل خوبی سے بات شروع کی۔',
      wins: [{ behaviour: 'opened_with_specific_praise', evidence: 'آپ نے کہانی کا ذکر کیا' }, { behaviour: 'asked_and_waited', evidence: 'آپ نے انتظار کیا' }],
      try: { move: 'one_improvement_only', evidence: 'آپ نے ایک ساتھ تین تبدیلیاں بتائیں۔', instead: 'سب سے اہم ایک چنیں۔' },
      reflection_question: 'کون سی ایک تبدیلی سب سے اہم ہے؟',
      focus_why: 'ایک تبدیلی سے elicited_if_then کی جگہ بنتی ہے۔',
      missed: { one_improvement_only: 'آپ نے تین تبدیلیاں بتائیں۔' },
      did: { opened_with_specific_praise: 'آپ نے کہانی کی تعریف کی۔' },
    });
    const out = R.feedbackInWords(fb);
    expect(out.try.move).toBe(UR.one_improvement_only);
    expect(out.focus_why).toBe(`ایک تبدیلی سے ${UR.elicited_if_then} کی جگہ بنتی ہے۔`);
  });
});

describe('queue #230 · the judge\'s answer is stored and sent in words (coachFeedbackWithRepair)', () => {
  beforeEach(() => jest.resetModules());
  afterEach(() => jest.resetModules());

  it('a try.move written as a key comes back as the behaviour\'s name', async () => {
    const fb = storedFeedback();
    jest.doMock('../../bot/shared/services/gpt5-mini.service', () => ({ completeJson: jest.fn(async () => ({ result: fb })) }));
    const D = require('../../bot/shared/services/observe/observe-debrief.service');
    const out = await D.coachFeedbackWithRepair('PROMPT', 's1');
    expect(leaks(out)).toEqual([]);
    expect(out.focus).toBe('one_improvement_only');
  });
});

describe('queue #230 · stored rows reach the page in words', () => {
  it('the coach\'s debrief report (coach-report.service shapeCoachReport): no raw key in Key Focus Area, why, or lines', () => {
    const SVC = require('../../dashboard/services/coach-report.service');
    const report = SVC.shapeCoachReport({ id: 'r1', feedback: storedFeedback(), created_at: '2026-11-23T10:24:32Z' });
    expect(report.focus.key).toBe('one_improvement_only');
    expect(report.focus.move).toBeTruthy();
    expect(leaks(report)).toEqual([]);
  });

  it('the portal\'s feedback view (portal-observe shapeFeedback): no raw key in try or lines', () => {
    const P = require('../../bot/shared/services/observe/portal-observe.service');
    const view = P._shapeFeedback(storedFeedback());
    expect(view.try.move).toBeTruthy();
    expect(leaks(view)).toEqual([]);
  });
});

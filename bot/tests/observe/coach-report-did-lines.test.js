/**
 * Coach reports in the app — "What you did well" lists EVERY done behaviour, each with what the coach did (the ICT HITL
 * owner's gap doc, content gap 4: "Every behaviour done, each with what the coach said").
 *
 * The ur/en judge already writes `missed` (one line per behaviour judged FALSE). It now also writes `did`: one line per
 * behaviour judged TRUE, quoting the coach's own words or naming the moment. Same discipline as `missed`: kept only for
 * keys the judge scored true (computed from the booleans, never from the model's say-so), a line that is too long is
 * dropped (never shown cut off), and no number may ride in it (the score scrub reads it too).
 * Swahili's prompt is untouched.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const F = require('../../shared/services/observe/observe-coach-feedback');

const rubric = (over = {}) => {
  const r = {};
  for (const k of F.RUBRIC_KEYS) r[k] = false;
  r.disparaged_teacher = false;
  r.rehearsed_the_step = false;
  return { ...r, ...over };
};

const card = (over = {}) => ({
  praise_line: 'You opened with what really worked.',
  wins: [{ behaviour: 'Specific praise', evidence: 'the story was told very well' }, { behaviour: 'Real moment', evidence: 'the student said it' }],
  concern: null,
  try: { move: 'Let the teacher name the step', evidence: 'you named it', instead: 'ask first' },
  reflection_question: 'What made you move on?',
  value: null,
  focus: 'elicited_if_then',
  focus_why: 'The other steps build on it.',
  missed: { elicited_if_then: 'You gave the step yourself.' },
  did: {
    opened_with_specific_praise: 'You said the story was told very well.',
    anchored_in_real_moment: 'You named the moment a student answered.',
    asked_and_waited: 'This key was judged false, so its line must go.',
  },
  // moves_not_teacher false is the harm gate (it made it about the person), so it is true in a respectful debrief.
  rubric: rubric({ opened_with_specific_praise: true, anchored_in_real_moment: true, moves_not_teacher: true }),
  ...over,
});

test('the ur/en prompt asks for a `did` line for every behaviour judged TRUE, and shows it in the JSON shape', () => {
  for (const lang of ['ur', 'en']) {
    const p = F.buildCoachFeedbackPromptI18n('T: hello', { foName: 'Coach' }, lang);
    expect(p).toMatch(/"did": for EVERY rubric key you judged TRUE/);
    expect(p).toMatch(/"did": \{ "<each rubric key judged true>"/);
  }
});

test('Swahili is untouched: no `did` in its prompt', () => {
  expect(F.buildCoachFeedbackPrompt('T: habari', {})).not.toMatch(/"did"/);
});

test('`did` keeps only the keys judged true; a line for a missed key is dropped', () => {
  const fb = card();
  F.validateCoachFeedback(fb, { rehearsal: true });
  expect(fb.did).toEqual({
    opened_with_specific_praise: 'You said the story was told very well.',
    anchored_in_real_moment: 'You named the moment a student answered.',
  });
});

test('a too-long `did` line is dropped, never cut', () => {
  const fb = card({ did: { opened_with_specific_praise: 'x'.repeat(301), anchored_in_real_moment: 'Fine.' } });
  F.validateCoachFeedback(fb, { rehearsal: true });
  expect(fb.did).toEqual({ anchored_in_real_moment: 'Fine.' });
});

test('a number in a `did` line is caught by the score scrub like any other line', () => {
  const fb = card({ did: { opened_with_specific_praise: 'You scored 7/8 on praise.' } });
  expect(() => F.validateCoachFeedback(fb, { rehearsal: true })).toThrow(/score/);
});

test('a card judged before `did` existed stays valid and gains no field', () => {
  const { did, ...old } = card();
  F.validateCoachFeedback(old, { rehearsal: true });
  expect('did' in old).toBe(false);
});

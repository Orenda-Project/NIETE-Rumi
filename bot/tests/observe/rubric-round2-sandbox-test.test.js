/**
 * bd-rlxkkt.4 — fixes after the ICT HITL owner's sandbox test (4 Nov), red-first. Staging (bd-enec2e.6) carries the
 * JUDGE half only: the ur/en judge writes, per behaviour judged false, what happened in THIS debrief ("missed"), and
 * why its focus is the one to work on first ("focus_why"). The coach's report page in the app shows them.
 *
 * Not here, on purpose: the round-2 card image and text card (sections 1 and 5–7 on sandbox) stay on sandbox, since the
 * report is a page in the app now and a coach off coach_reports_app keeps today's card; the notes changes (sections
 * 2–4) reached staging with bd-rlxkkt.7 (rubric-round2-notes.test.js).
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const F = require('../../shared/services/observe/observe-coach-feedback');
const { feedbackFields } = require('../../shared/services/observe/observe-gender-address');

const rubric = (over = {}) => {
  const r = {};
  for (const k of F.RUBRIC_KEYS) r[k] = true;
  r.disparaged_teacher = false;
  r.rehearsed_the_step = true;
  return { ...r, ...over };
};
// Rifat's sandbox report: 3/8, the focus is asked_and_waited.
const feedback = (over = {}) => ({
  praise_line: 'You opened with what really worked in the lesson.',
  wins: [
    { behaviour: 'Specific praise', evidence: 'you said "the Ta\'if story was told very well"' },
    { behaviour: 'Real moment', evidence: 'you named the moment the student said "Hazrat Umar"' },
  ],
  try: {
    move: 'Ask one open question after your praise, then wait in silence',
    evidence: 'بس ابھی جب آپ اس ویک میں نیا ڈی سی ریکارڈ کرو گے…',
    instead: 'then ask them to state the specific step in their own words',
  },
  missed: {
    asked_and_waited: 'You asked "how did it go?" and answered it yourself before the teacher spoke.',
    one_improvement_only: 'You raised feedback on answers and also the pace of the lesson.',
    elicited_if_then: 'You gave the step yourself: "name one correct piece of the answer".',
    righting_reflex_held: 'You spoke for most of the talk; the teacher\'s answers stayed short.',
    rehearsed_the_step: 'The talk ended once the plan was agreed; the teacher never said it aloud.',
  },
  focus_why: 'The other steps build on it: the teacher has to speak before they can name a step.',
  reflection_question: 'What made you move on before the teacher spoke?',
  value: 'ukuaji',
  concern: null,
  focus: 'asked_and_waited',
  rubric: rubric({
    asked_and_waited: false, one_improvement_only: false, elicited_if_then: false,
    righting_reflex_held: false, rehearsed_the_step: false,
  }),
  ...over,
});

describe('5–6. the ur/en judge writes the per-miss lines and the reason', () => {
  for (const lang of ['ur', 'en']) {
    it(`${lang}: the prompt asks for "missed" (what happened in THIS debrief, per false key) and "focus_why"`, () => {
      const p = F.buildCoachFeedbackPromptI18n('t'.repeat(200), {}, lang);
      expect(p).toMatch(/"missed"/);
      expect(p).toMatch(/"focus_why"/);
      expect(p).toMatch(/THIS debrief/);
      expect(p).toMatch(/never a definition|not a definition/i);
    });
  }
  it('the validator keeps only lines for behaviours judged false, as plain short strings', () => {
    const fb = feedback({
      missed: {
        asked_and_waited: '  You answered your own question.  ',
        opened_with_specific_praise: 'judged true, so this goes',
        rehearsed_the_step: 42,
        elicited_if_then: 'x'.repeat(400),
        not_a_key: 'goes',
      },
    });
    F.validateCoachFeedback(fb, { rehearsal: true });
    expect(fb.missed).toEqual({ asked_and_waited: 'You answered your own question.' });
  });
  it('a too-long or non-string reason is dropped, never shown cut off', () => {
    const a = feedback({ focus_why: 'y'.repeat(400) });
    F.validateCoachFeedback(a, { rehearsal: true });
    expect(a.focus_why).toBeNull();
    const b = feedback({ focus_why: { no: 1 } });
    F.validateCoachFeedback(b, { rehearsal: true });
    expect(b.focus_why).toBeNull();
  });
  it('a score inside a per-miss line is still caught', () => {
    const fb = feedback({ missed: { asked_and_waited: 'You scored 3/8 on this.' } });
    expect(() => F.validateCoachFeedback(fb, { rehearsal: true })).toThrow(/score/);
  });
  it('the gender check reads the new lines', () => {
    const names = feedbackFields(feedback()).map(([n]) => n);
    expect(names).toEqual(expect.arrayContaining(['missed.asked_and_waited', 'focus_why']));
  });
});

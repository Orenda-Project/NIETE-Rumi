/**
 * bd-rlxkkt.3 — the coach's Feedback Report shows the rubric (TDD, red-first).
 *
 * The ICT HITL owner's ask (3 Nov): "Feedback Report needs to actually show the rubric as well." Today the card is
 * praise + 2 wins + 1 try whatever the coach did, so a strong debrief and a weak one look alike. For ur/en the card now
 * shows, on the PNG and the text alike:
 *   - 8 behaviour marks and a separate Respect line, COMPUTED IN CODE from the judge's booleans (never LLM text);
 *   - "What you did well" (the existing wins);
 *   - "What was missed": each missed behaviour with its fixed "why it matters" line (catalog strings);
 *   - "Next focus" (the existing try) + one link to that behaviour's Coach Training module;
 *   - the reflection question.
 * The 8th behaviour needs the judge to score rehearsed_the_step: the ur/en prompt gains that key and its definition.
 * Swahili (prompt, text card, card HTML) stays byte-identical. Old rows without the key show 7 marks, never a fake miss.
 * The harmful-debrief path is unchanged.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const crypto = require('crypto');
const F = require('../../shared/services/observe/observe-coach-feedback');
const Card = require('../../shared/services/observe/observe-coach-card');
const R = require('../../shared/services/observe/observe-coach-rubric');
const M = require('../../shared/config/coach-training-modules');
const { observeStrings } = require('../../shared/services/observe/observe-strings');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const rubric = (over = {}) => {
  const r = {};
  for (const k of F.RUBRIC_KEYS) r[k] = true;
  r.disparaged_teacher = false;
  r.rehearsed_the_step = true;
  return { ...r, ...over };
};
// 5 of 8: the prototype's sample (own step, talked less and rehearsal missed).
const feedback = (over = {}) => ({
  praise_line: 'You opened with what really worked in the lesson.',
  wins: [
    { behaviour: 'Specific praise', evidence: 'you said "I liked how you used Manu the cat"' },
    { behaviour: 'Asked and waited', evidence: 'you asked "what was going through your mind?" and waited' },
  ],
  try: { move: 'Have the teacher say the question out loud', evidence: 'the talk ended once the plan was agreed', instead: 'say "show me how you will say it in class", then wait' },
  reflection_question: 'What stopped you from asking for a rehearsal today?',
  value: null,
  concern: null,
  focus: 'rehearsed_the_step',
  rubric: rubric({ elicited_if_then: false, righting_reflex_held: false, rehearsed_the_step: false }),
  ...over,
});

describe('the module map lives in the bot too', () => {
  it('ten modules; every judged behaviour has one; the same map the portal holds', () => {
    expect(M.COACH_MODULES.map((m) => m.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(M.BEHAVIOUR_MODULE).toEqual({
      opened_with_specific_praise: 1, anchored_in_real_moment: 2, asked_and_waited: 3, one_improvement_only: 4,
      moves_not_teacher: 5, elicited_if_then: 6, righting_reflex_held: 7, rehearsed_the_step: 8,
    });
    expect(M.moduleUrl(M.moduleFor('rehearsed_the_step'))).toBe('https://claude.ai/artifact/MGVm5YMAdQhRCrWRWWg65C');
  });
  it('bd-rlxkkt.12 — Module 10 (No evidence, no level) is no debrief behaviour\'s module, and the capstone stays 9', () => {
    const ten = M.moduleByNumber(10);
    expect(ten).toMatchObject({ n: 10, key: 'evidence', artifact: '62371mmVGLxniEHz6VGRXx', video: null });
    expect(M.moduleUrl(ten)).toBe('https://claude.ai/artifact/62371mmVGLxniEHz6VGRXx');
    expect(Object.values(M.BEHAVIOUR_MODULE)).not.toContain(10);
    expect(M.FULL_DEBRIEF_MODULE).toBe(9);
  });
});

describe('the judge scores rehearsal (ur/en only)', () => {
  for (const lang of ['ur', 'en']) {
    const p = F.buildCoachFeedbackPromptI18n('T'.repeat(200), {}, lang);
    it(`${lang}: names rehearsed_the_step with its definition and asks for it in the rubric`, () => {
      expect(p).toMatch(/rehearsed_the_step: .*out loud.*before the debrief ended/i);
      expect(p).toMatch(/"rehearsed_the_step": true\/false/);
    });
    it(`${lang}: asks which judged-false behaviour the try targets ("focus")`, () => {
      expect(p).toMatch(/"focus"/);
    });
  }
  it('the Swahili prompt is byte-identical', () => {
    expect(sha(F.buildCoachFeedbackPrompt('T'.repeat(200), { language: 'sw' })))
      .toBe('2e7d8563a00c868a2901c28edd7b0036cea97055ad656c0c096d8f2ba72a47e9');
  });
});

describe('the validator', () => {
  it('requires rehearsed_the_step when asked to (ur/en)', () => {
    const fb = feedback();
    delete fb.rubric.rehearsed_the_step;
    expect(() => F.validateCoachFeedback(fb, { rehearsal: true })).toThrow(/rehearsed_the_step/);
    expect(F.validateCoachFeedback(feedback(), { rehearsal: true })).toBe(true);
  });
  it('still accepts a card without it when not asked (Swahili, older callers)', () => {
    const fb = feedback();
    delete fb.rubric.rehearsed_the_step;
    expect(F.validateCoachFeedback(fb)).toBe(true);
  });
  it('a focus that is not a behaviour judged false is dropped, never trusted', () => {
    const a = feedback({ focus: 'opened_with_specific_praise' });   // judged TRUE
    F.validateCoachFeedback(a, { rehearsal: true });
    expect(a.focus).toBeNull();
    const b = feedback({ focus: 'made_up_key' });
    F.validateCoachFeedback(b, { rehearsal: true });
    expect(b.focus).toBeNull();
  });
});

describe('the marks are computed in code from the booleans', () => {
  it('eight marks in rubric order, five done, Respect held', () => {
    const m = R.rubricMarks(feedback().rubric);
    expect(m.marks.map((x) => x.key)).toEqual(R.BEHAVIOUR_KEYS);
    expect(R.BEHAVIOUR_KEYS).toHaveLength(8);
    expect(m.done).toBe(5);
    expect(m.total).toBe(8);
    expect(m.respectHeld).toBe(true);
  });
  it('an old row without rehearsed_the_step: seven marks, never a fake miss', () => {
    const r = feedback().rubric;
    delete r.rehearsed_the_step;
    const m = R.rubricMarks(r);
    expect(m.total).toBe(7);
    expect(m.marks.map((x) => x.key)).not.toContain('rehearsed_the_step');
    expect(R.missedBehaviours(r)).not.toContain('rehearsed_the_step');
  });
  it('next focus: the judge\'s focus when valid, else the first miss, else the full debrief', () => {
    expect(R.nextFocusKey(feedback())).toBe('rehearsed_the_step');
    expect(R.nextFocusKey(feedback({ focus: null }))).toBe('elicited_if_then');
    expect(R.focusModule(feedback({ focus: null, rubric: rubric() })).n).toBe(9);
  });
});

// Staging (bd-enec2e.6): the round-2 card stays on sandbox. The coach's report is a page in the app now (coach-report.service.js
// reads the judge's booleans, focus and the words below), so on staging the WhatsApp card a coach off coach_reports_app gets
// is exactly today's: no marks, no missed section, no module link, today's title.
describe('the WhatsApp card is unchanged on staging (the report is a page in the app)', () => {
  for (const lang of ['en', 'ur']) {
    const S = observeStrings(lang);
    it(`${lang}: the text card draws no marks, no missed section and no module link`, () => {
      const c = F.renderCoachFeedbackMessages(feedback(), S)[1];
      expect(c).not.toMatch(/★|\/8|\/7/);
      for (const k of ['elicited_if_then', 'righting_reflex_held', 'rehearsed_the_step']) expect(c).not.toContain(S.coach_rubric_why[k]);
      expect(c).not.toContain('https://claude.ai/artifact/');
      expect(c).toContain(S.coach_card_title);
      expect(c).toContain('I liked how you used Manu the cat');
      expect(c).toContain('Have the teacher say the question out loud');
    });
    it(`${lang}: the card image draws no marks`, () => {
      const html = Card.buildCoachCardHtml(feedback(), { lang, brand: 'niete' });
      expect(html).not.toMatch(/data-mark=/);
    });
  }
  it('no marks label, and today\'s card titles', () => {
    expect(observeStrings('en').coach_card_marks_label).toBeUndefined();
    expect(observeStrings('ur').coach_card_marks_label).toBeUndefined();
    expect(observeStrings('en').coach_card_title).toBe('Strengths · growth · action plan');
    expect(observeStrings('en').coach_card_try_label).toBe('Areas for growth');
  });

  it('every behaviour has its name and why line in en and ur', () => {
    for (const lang of ['en', 'ur']) {
      const S = observeStrings(lang);
      for (const k of R.BEHAVIOUR_KEYS) {
        expect(S.coach_rubric_names[k]).toBeTruthy();
        expect(S.coach_rubric_why[k]).toBeTruthy();
      }
    }
  });

  it('the harmful path is unchanged: no marks, no wins, the concern', () => {
    const fb = feedback({
      praise_line: null, wins: [], focus: null,
      concern: { what_happened: 'you said they cannot teach', why_it_matters: 'it costs trust', instead: 'name the move' },
      rubric: rubric({ disparaged_teacher: true, moves_not_teacher: false }),
    });
    const msgs = F.renderCoachFeedbackMessages(fb, observeStrings('en')).join('\n');
    expect(msgs).not.toMatch(/★|\/8|✓/);
    expect(msgs).toContain('it costs trust');
  });

  it('the Swahili text card is byte-identical', () => {
    const r = {};
    for (const k of F.RUBRIC_KEYS) r[k] = true;
    r.disparaged_teacher = false; r.elicited_if_then = false;
    const fb = { praise_line: 'Ulianza vizuri.', wins: [{ behaviour: 'Sifa', evidence: 'nilipenda vijiti' }, { behaviour: 'Subira', evidence: 'ulisubiri' }], try: { move: 'Shikilia ukimya', evidence: 'ulijibu mwenyewe', instead: 'hesabu tatu' }, reflection_question: 'Utafanya nini?', value: 'imani', rubric: r, concern: null };
    expect(sha(JSON.stringify(F.renderCoachFeedbackMessages(fb, observeStrings('sw')))))
      .toBe('3f7520b9b8955d2b5dd8bd6d5081ff45d0bd5b5bbd017a35f460d425fe1d542f');
    expect(sha(Card.buildCoachCardHtml(JSON.parse(JSON.stringify(fb)), { lang: 'sw', brand: 'niete' })))
      .toBe('dfc64b46493a98f43ace5ad25021a3fe5e9420d2f4280073f72a8a158f2658e8');
  });
});

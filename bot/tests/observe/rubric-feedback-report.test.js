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
  it('nine modules; every judged behaviour has one; the same map the portal holds', () => {
    expect(M.COACH_MODULES.map((m) => m.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(M.BEHAVIOUR_MODULE).toEqual({
      opened_with_specific_praise: 1, anchored_in_real_moment: 2, asked_and_waited: 3, one_improvement_only: 4,
      moves_not_teacher: 5, elicited_if_then: 6, righting_reflex_held: 7, rehearsed_the_step: 8,
    });
    expect(M.moduleUrl(M.moduleFor('rehearsed_the_step'))).toBe('https://claude.ai/artifact/MGVm5YMAdQhRCrWRWWg65C');
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

describe('the text card (the fallback the PNG must match)', () => {
  for (const lang of ['en', 'ur']) {
    const S = observeStrings(lang);
    const card = () => F.renderCoachFeedbackMessages(feedback(), S)[1];
    it(`${lang}: the marks block — eight named lines, ✓ or ○, the count and the Respect line`, () => {
      const c = card();
      for (const k of R.BEHAVIOUR_KEYS) expect(c).toContain(S.coach_rubric_names[k]);
      expect(c).toContain('5/8');
      expect(c).toContain('★★★★★☆☆☆');
      expect(c).toContain(S.coach_card_respect_line);
      expect(c).toMatch(new RegExp(`○ ${S.coach_rubric_names.rehearsed_the_step}`));
      expect(c).toMatch(new RegExp(`✓ ${S.coach_rubric_names.opened_with_specific_praise}`));
    });
    it(`${lang}: did well (the wins), missed (each with its fixed why), next focus, its module link, the question`, () => {
      const c = card();
      const at = [S.coach_card_wins_label, S.coach_card_missed_label, S.coach_card_try_label, S.coach_card_reflect_label].map((l) => c.indexOf(l));
      at.forEach((i) => expect(i).toBeGreaterThan(-1));
      expect([...at].sort((a, b) => a - b)).toEqual(at);
      expect(c).toContain('I liked how you used Manu the cat');
      for (const k of ['elicited_if_then', 'righting_reflex_held', 'rehearsed_the_step']) expect(c).toContain(S.coach_rubric_why[k]);
      expect(c).not.toContain(S.coach_rubric_why.opened_with_specific_praise);
      expect(c).toContain('Have the teacher say the question out loud');
      expect(c).toContain('https://claude.ai/artifact/MGVm5YMAdQhRCrWRWWg65C');
      expect(c).toContain(M.moduleFor('rehearsed_the_step').title[lang]);
      expect(c).toContain('What stopped you from asking for a rehearsal today?');
    });
    it(`${lang}: the marks follow the booleans, not what the model wrote`, () => {
      const fb = feedback({ wins: [{ behaviour: 'Rehearsed aloud', evidence: 'you had them rehearse' }, { behaviour: 'x', evidence: 'y' }] });
      const c = F.renderCoachFeedbackMessages(fb, S)[1];
      expect(c).toMatch(new RegExp(`○ ${S.coach_rubric_names.rehearsed_the_step}`));
      expect(c).toContain('5/8');
    });
    it(`${lang}: an old row shows 7 marks and no rehearsal miss`, () => {
      const fb = feedback({ focus: null });
      delete fb.rubric.rehearsed_the_step;
      const c = F.renderCoachFeedbackMessages(fb, S)[1];
      expect(c).toContain('5/7');
      expect(c).not.toContain(S.coach_rubric_names.rehearsed_the_step);
      expect(c).not.toContain(S.coach_rubric_why.rehearsed_the_step);
    });
    it(`${lang}: nothing missed → no missed section`, () => {
      const c = F.renderCoachFeedbackMessages(feedback({ rubric: rubric(), focus: null }), S)[1];
      expect(c).not.toContain(S.coach_card_missed_label);
      expect(c).toContain('8/8');
    });
  }

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

describe('the PNG says what the text says', () => {
  for (const lang of ['en', 'ur']) {
    const S = observeStrings(lang);
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    it(`${lang}: the same marks, Respect, missed whys and module`, () => {
      const html = Card.buildCoachCardHtml(feedback(), { lang, brand: 'niete' });
      expect(html.match(/data-mark="done"/g)).toHaveLength(5);
      expect(html.match(/data-mark="missed"/g)).toHaveLength(3);
      expect(html).toContain('5/8');
      expect(html).toContain(esc(S.coach_card_respect_line));
      for (const k of ['elicited_if_then', 'righting_reflex_held', 'rehearsed_the_step']) expect(html).toContain(esc(S.coach_rubric_why[k]));
      expect(html).toContain(esc(M.moduleFor('rehearsed_the_step').title[lang]));
    });
  }
});

describe('the caption carries the tappable module link (an image cannot)', () => {
  it('praise, the module line with its link, then the closing — inside the 1,024 cap', () => {
    const S = observeStrings('en');
    const cap = F.coachCardCaption('You opened warmly.', feedback(), S);
    expect(cap.indexOf('You opened warmly.')).toBe(0);
    expect(cap).toContain('https://claude.ai/artifact/MGVm5YMAdQhRCrWRWWg65C');
    expect(cap.endsWith(S.coach_card_closing)).toBe(true);
    expect([...cap].length).toBeLessThanOrEqual(1024);
  });
  it('Swahili: no link, the caption as before', () => {
    const S = observeStrings('sw');
    expect(F.coachCardCaption('Ulianza vizuri.', feedback(), S)).toBe(`Ulianza vizuri.\n\n${S.coach_card_closing}`);
  });
});

/**
 * FEAT-053 bd-30 — THE HARM GATE. Never praise an officer for mistreating a teacher.
 *
 * WHAT HAPPENED (Sabeena, staging 2026-07-14): she role-played a deliberately
 * abusive officer ("your class was very bad", "you don't know how to teach at
 * all", "your class is filthy"). Rumi's coach-the-coach card came back with:
 *     WIN 1 "Named concrete classroom evidence" — quoting "your class is filthy"
 *     WIN 2 "Called out how noise affected learning"
 * i.e. it CONGRATULATED the officer for insulting the teacher, in a feature whose
 * entire purpose is to stop officers behaving like inspectors.
 *
 * ROOT CAUSE: the rubric correctly scored the debrief as harmful
 * (moves_not_teacher=false, 6 of 7 behaviours false) — but validateCoachFeedback
 * REQUIRED exactly 2 wins, so the model had to manufacture praise, and the only
 * "concrete" material in the transcript was the abuse.
 *
 * THE RULE: wins are never mandatory. When the officer disparaged the teacher,
 * the feedback leads with an honest, warm concern and offers ZERO wins.
 */

const {
  RUBRIC_KEYS,
  isHarmfulDebrief,
  buildCoachFeedbackPrompt,
  validateCoachFeedback,
  renderCoachFeedbackMessages,
} = require('../../shared/services/observe/observe-coach-feedback');
const { observeStrings } = require('../../shared/services/observe/observe-strings');

const S = observeStrings('en');

const goodRubric = () => ({
  opened_with_specific_praise: true,
  anchored_in_real_moment: true,
  asked_and_waited: true,
  one_improvement_only: true,
  moves_not_teacher: true,
  elicited_if_then: true,
  righting_reflex_held: true,
  disparaged_teacher: false,
});

// The EXACT rubric Rumi produced for Sabeena's abusive role-play.
const sabeenaRubric = () => ({
  opened_with_specific_praise: false,
  anchored_in_real_moment: true,
  asked_and_waited: false,
  one_improvement_only: false,
  moves_not_teacher: false,      // ← it KNEW the officer attacked the person
  elicited_if_then: false,
  righting_reflex_held: false,
  disparaged_teacher: true,
});

const healthy = () => ({
  praise_line: 'You opened by naming a real strength — that is how trust is built.',
  wins: [
    { behaviour: 'Opened with evidence-based praise', evidence: 'I liked how you used the sticks.' },
    { behaviour: 'Let the teacher name her own commitment', evidence: 'I will try tomorrow in maths.' },
  ],
  try: { move: 'Hold the pause', evidence: 'At 2:10 you answered your own question.', instead: 'Count three seconds.' },
  rubric: goodRubric(),
});

const harmful = () => ({
  concern: {
    what_happened: 'The conversation opened by judging her as a person — "you don\'t know how to teach at all".',
    why_it_matters: 'A teacher who feels attacked stops being honest with you, and the coaching stops working.',
    instead: 'Name what you saw, not what she is: "the children were talking during the explanation — what do you make of that?"',
  },
  wins: [],
  try: { move: 'Talk about the moves, not the teacher', evidence: '"Your class is filthy."', instead: 'Describe one moment and ask what she makes of it.' },
  rubric: sabeenaRubric(),
});

describe('isHarmfulDebrief', () => {
  test('disparaged_teacher true → harmful', () => {
    expect(isHarmfulDebrief({ ...goodRubric(), disparaged_teacher: true })).toBe(true);
  });
  test('moves_not_teacher false → harmful (judged the person, not the moves)', () => {
    expect(isHarmfulDebrief({ ...goodRubric(), moves_not_teacher: false })).toBe(true);
  });
  test("Sabeena's actual rubric → harmful", () => {
    expect(isHarmfulDebrief(sabeenaRubric())).toBe(true);
  });
  test('a genuinely good debrief → not harmful', () => {
    expect(isHarmfulDebrief(goodRubric())).toBe(false);
  });
});

describe('validateCoachFeedback — the harm gate', () => {
  test('THE REGRESSION: harmful debrief with manufactured "wins" is REJECTED', () => {
    const abusive = {
      praise_line: 'You named clear, observable details from the lesson.',
      wins: [
        { behaviour: 'Named concrete classroom evidence', evidence: 'Your class is so filthy, no charts up.' },
        { behaviour: 'Called out how noise affected learning', evidence: "The children weren't even listening to you." },
      ],
      try: { move: 'Ask an open question', evidence: 'x', instead: 'y' },
      rubric: sabeenaRubric(),
    };
    expect(() => validateCoachFeedback(abusive)).toThrow(/harm|concern|wins/i);
  });

  test('harmful debrief MUST carry a concern (what happened / why it matters / instead)', () => {
    const noConcern = { ...harmful() };
    delete noConcern.concern;
    expect(() => validateCoachFeedback(noConcern)).toThrow(/concern/i);
  });

  test('harmful debrief must offer ZERO wins — never a compliment wrapped round an insult', () => {
    const withWin = { ...harmful(), wins: [{ behaviour: 'Was specific', evidence: 'Your class is filthy.' }] };
    expect(() => validateCoachFeedback(withWin)).toThrow(/wins/i);
  });

  test('harmful debrief must NOT carry a celebratory praise line', () => {
    const withPraise = { ...harmful(), praise_line: 'Beautiful work — you were so direct!' };
    expect(() => validateCoachFeedback(withPraise)).toThrow(/praise/i);
  });

  test('a properly-shaped harmful feedback passes', () => {
    expect(() => validateCoachFeedback(harmful())).not.toThrow();
  });

  test('a healthy debrief still requires exactly 2 wins + praise (unchanged)', () => {
    expect(() => validateCoachFeedback(healthy())).not.toThrow();
    const oneWin = { ...healthy(), wins: [healthy().wins[0]] };
    expect(() => validateCoachFeedback(oneWin)).toThrow(/wins/i);
  });

  test('rubric must judge disparagement explicitly', () => {
    expect(RUBRIC_KEYS).toContain('disparaged_teacher');
    const missing = healthy();
    delete missing.rubric.disparaged_teacher;
    expect(() => validateCoachFeedback(missing)).toThrow(/rubric/i);
  });
});

describe('renderCoachFeedbackMessages — harmful path', () => {
  test('leads with the concern, never a wins card, and still coaches (no score)', () => {
    const msgs = renderCoachFeedbackMessages(harmful(), S);
    const all = msgs.join('\n');
    expect(all).not.toMatch(/✓/);                       // no win ticks
    expect(all).not.toMatch(/Two wins/i);               // not the celebration card
    expect(all).toMatch(/don't know how to teach|judging her as a person/i); // names it
    expect(all).toMatch(/trust|honest/i);               // says why it matters
    expect(all).toMatch(/Talk about the moves/i);       // still gives the move
    expect(all).not.toMatch(/\d+\s*\/\s*\d+|%/);        // still never a score on the officer
  });

  test('healthy path still renders the two-wins card', () => {
    const card = renderCoachFeedbackMessages(healthy(), S).join('\n');
    expect((card.match(/✓/g) || [])).toHaveLength(2);
  });
});

describe('buildCoachFeedbackPrompt — instructs the harm gate', () => {
  const p = buildCoachFeedbackPrompt('some debrief transcript', { language: 'en' });
  test('tells the model to flag disparagement', () => {
    expect(p).toContain('disparaged_teacher');
  });
  test('explicitly forbids inventing wins when the officer mistreated the teacher', () => {
    expect(p).toMatch(/do not|usitoe|never/i);
    expect(p).toMatch(/concern/i);
  });
});

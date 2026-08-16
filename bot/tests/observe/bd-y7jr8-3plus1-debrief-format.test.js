/**
 * bd-y7jr8 — the 3+1 debrief format (TDD, red-first).
 *
 * Warda Kiani & Mehwish (HITL row 3): "Rumi generates debriefs as reflection
 * questions, requiring coaches to spend extra time restructuring the feedback
 * during time-constrained classroom observations." They asked for Strengths /
 * Areas for Growth / Action Plan.
 *
 * Operator (2026-08-17): lead with the three sections, keep ONE reflection
 * question at the end — and make BOTH surfaces follow it: the guide the coach
 * reads while talking to the teacher, AND the card she gets afterwards.
 *
 * Note the earlier diagnosis in the sheet pointed at the coach-feedback prompt.
 * That was wrong: the feedback card is already "2 wins + 1 try". The
 * question-shaped thing is the DEBRIEF GUIDE (6 steps: intent → praise →
 * question+silence → one improvement → if-then → return day).
 *
 * The invariant that matters most here is the HARM GATE (bd-30): when a coach
 * disparaged the teacher, there must be NO strengths — a three-section layout
 * must never become "there is a Strengths heading, therefore fill it".
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OBSERVE_FRAMEWORK = 'fico';

const {
  buildGuidePrompt, validateGuide, renderGuideMessage, buildFallbackGuide,
} = require('../../shared/services/observe/observe-debrief-guide');
const {
  validateCoachFeedback, renderCoachFeedbackMessages, RUBRIC_KEYS,
} = require('../../shared/services/observe/observe-coach-feedback');
const { observeStrings } = require('../../shared/services/observe/observe-strings');

const V2 = {
  strengths: [{ evidence: 'you had every child answer in pairs before the whole class' }],
  focus_area: {
    title: 'Checking for understanding',
    try_this_tomorrow: 'ask two children to explain the step back to you',
    lever_question: 'How did you know they had understood?',
  },
};

const goodGuide = () => ({
  intro: 'Your conversation guide — about 15 minutes.',
  sections: {
    strengths: { title: 'Strengths', body: 'Name the real moment.', say_this: 'I loved this moment: you had every child answer in pairs.' },
    growth:    { title: 'Areas for growth', body: 'One move only.', say_this: 'How about checking understanding with two children tomorrow?' },
    action:    { title: 'Action plan', body: 'Agree the move and the return day.', say_this: 'Shall we look at this again on Thursday?' },
  },
  reflection_question: 'Before I go — what is the one thing you will try?',
  outro: 'No number to hand over. 💛',
});

// ── A. The guide the coach reads ───────────────────────────────────────

describe('bd-y7jr8 · the debrief guide asks for 3 sections + 1 question', () => {
  for (const lang of ['ur', 'en']) {
    it(`prompt for ${lang} names the three sections and the closing question`, () => {
      const p = buildGuidePrompt(V2, { language: lang });
      expect(p).toMatch(/strengths/i);
      expect(p).toMatch(/areas for growth|growth/i);
      expect(p).toMatch(/action plan/i);
      expect(p).toMatch(/reflection_question/);
      expect(p).toMatch(/"sections"/);
    });
  }

  it('leaves the Swahili prompt on its original 6-step shape', () => {
    // Tanzania is served by the sw path; changing its shape is out of scope
    // and would break a live market.
    const p = buildGuidePrompt(V2, { language: 'sw' });
    expect(p).toMatch(/hatua 6|steps/i);
    expect(p).not.toMatch(/reflection_question/);
  });

  it('accepts the 3+1 shape for ur/en', () => {
    for (const lang of ['ur', 'en']) {
      expect(validateGuide(goodGuide(), observeStrings(lang), lang)).toBe(true);
    }
  });

  it('rejects a guide missing any of the three sections', () => {
    for (const drop of ['strengths', 'growth', 'action']) {
      const g = goodGuide();
      delete g.sections[drop];
      expect(() => validateGuide(g, observeStrings('en'), 'en')).toThrow(new RegExp(drop, 'i'));
    }
  });

  it('rejects a guide with no reflection question — the coaching stance must survive', () => {
    const g = goodGuide();
    g.reflection_question = '';
    expect(() => validateGuide(g, observeStrings('en'), 'en')).toThrow(/question/i);
  });

  it('still requires the 6-step shape for sw', () => {
    expect(() => validateGuide(goodGuide(), observeStrings('sw'), 'sw')).toThrow(/6 steps/i);
  });

  it('renders Strengths, then Growth, then Action, with the question LAST', () => {
    const out = renderGuideMessage(goodGuide(), observeStrings('en'));
    const iS = out.indexOf('Strengths');
    const iG = out.indexOf('Areas for growth');
    const iA = out.indexOf('Action plan');
    const iQ = out.indexOf('what is the one thing you will try');
    expect(iS).toBeGreaterThan(-1);
    expect(iG).toBeGreaterThan(iS);
    expect(iA).toBeGreaterThan(iG);
    expect(iQ).toBeGreaterThan(iA);          // the question closes the guide
  });

  it('still renders the 6-step shape when given one (sw path unchanged)', () => {
    const sw = buildFallbackGuide(V2, { language: 'sw' });
    const out = renderGuideMessage(sw, observeStrings('sw'));
    expect(out).toContain(sw.steps[0].title);
    expect(out).toContain(sw.steps[5].title);
  });

  it('the no-LLM fallback also hands over the 3+1 shape for ur/en', () => {
    for (const lang of ['ur', 'en']) {
      const g = buildFallbackGuide(V2, { language: lang });
      expect(g.sections).toBeTruthy();
      expect(g.sections.strengths.say_this).toBeTruthy();
      expect(g.sections.growth.say_this).toBeTruthy();
      expect(g.sections.action.say_this).toBeTruthy();
      expect(g.reflection_question).toBeTruthy();
      expect(validateGuide(g, observeStrings(lang), lang)).toBe(true);   // and it passes its own gates
    }
  });

  it('the fallback stays inside the character budget', () => {
    for (const lang of ['ur', 'en']) {
      const rendered = renderGuideMessage(buildFallbackGuide(V2, { language: lang }), observeStrings(lang));
      expect(rendered.length).toBeLessThanOrEqual(2200);
    }
  });

  it('never leaks a score into the guide', () => {
    const g = goodGuide();
    g.sections.strengths.body = 'you scored 72% overall';
    expect(() => validateGuide(g, observeStrings('en'), 'en')).toThrow(/score/i);
  });
});

// ── B. The card the coach gets afterwards ──────────────────────────────

const rubric = (over = {}) => {
  const r = {};
  for (const k of RUBRIC_KEYS) r[k] = true;
  r.disparaged_teacher = false;
  return { ...r, ...over };
};

const goodFeedback = () => ({
  praise_line: 'You opened warmly and let the teacher think.',
  wins: [
    { behaviour: 'Opened with specific praise', evidence: 'you said "the pair work was excellent"' },
    { behaviour: 'Held the silence', evidence: 'you waited after asking how it went' },
  ],
  try: { move: 'Let the teacher name the next step', evidence: 'you offered the plan yourself', instead: 'ask "what will you try?" and wait' },
  reflection_question: 'What will you do differently in your next debrief?',
  value: null,
  rubric: rubric(),
  concern: null,
});

describe('bd-y7jr8 · the coach card speaks the same three headings', () => {
  it('renders Strengths / Areas for growth / Action plan', () => {
    const S = observeStrings('en');
    const msgs = renderCoachFeedbackMessages(goodFeedback(), S).join('\n');
    expect(msgs).toMatch(new RegExp(S.coach_card_wins_label, 'i'));
    expect(msgs).toMatch(new RegExp(S.coach_card_try_label, 'i'));
  });

  it('carries one reflection question for the coach', () => {
    const msgs = renderCoachFeedbackMessages(goodFeedback(), observeStrings('en')).join('\n');
    expect(msgs).toMatch(/What will you do differently/);
  });

  it('the three headings read as Strengths / Growth / Action in en and ur', () => {
    for (const lang of ['en', 'ur']) {
      const S = observeStrings(lang);
      expect(S.coach_card_wins_label).toBeTruthy();
      expect(S.coach_card_try_label).toBeTruthy();
      expect(S.coach_card_action_label).toBeTruthy();     // new third heading
      expect(S.coach_card_reflect_label).toBeTruthy();    // the closing question
    }
  });

  // ── THE HARM GATE — the reason this shape needs guarding ──
  it('a disparaging debrief still yields NO strengths, and the concern instead', () => {
    const fb = {
      praise_line: null,
      wins: [],
      concern: {
        what_happened: 'you told the teacher she does not know how to teach',
        why_it_matters: 'it costs the trust the next lesson depends on',
        instead: 'name the move, never the person',
      },
      try: { move: 'Talk about the moves', evidence: 'you judged the person', instead: 'describe what you saw' },
      reflection_question: 'How would you want that said to you?',
      value: null,
      rubric: rubric({ disparaged_teacher: true, moves_not_teacher: false }),
    };
    expect(validateCoachFeedback(fb)).toBe(true);
    const msgs = renderCoachFeedbackMessages(fb, observeStrings('en')).join('\n');
    expect(msgs).toMatch(/trust/i);
    expect(msgs).not.toMatch(/✓/);
  });

  it('still refuses to praise a coach who disparaged the teacher', () => {
    const fb = goodFeedback();
    fb.rubric = rubric({ disparaged_teacher: true });
    expect(() => validateCoachFeedback(fb)).toThrow(/wins must be EMPTY/i);
  });
});

// ── C. Two upstream bugs found while doing this ────────────────────────
//
// 1. `_deliverCoachFeedback` reverse-engineers the card's language by
//    string-matching S.coach_card_wins_label against a hardcoded Urdu literal.
//    Re-labelling the card — exactly what this change does — would silently
//    flip Urdu coaches to the English card. That is the same failure shape as
//    bd-2644 (the tofu-boxes bug), one layer up.
// 2. The redelivery path resolves language as
//    `preferred_language === 'sw' ? 'sw' : 'en'`, which collapses URDU to
//    English — so an Urdu coach was handed the English strings pack while the
//    model wrote Urdu prose. That is why her card had English headings.
describe('bd-y7jr8 · the card language is passed, not guessed', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../../shared/services/observe/observe-debrief.service.js'), 'utf8');

  it('no longer detects the language by comparing a label to a literal', () => {
    expect(src).not.toMatch(/coach_card_wins_label\s*===/);
  });

  it('does not collapse Urdu into English when resolving the coach language', () => {
    expect(src).not.toMatch(/preferred_language\)\s*===\s*'sw'\s*\?\s*'sw'\s*:\s*'en'/);
  });

  it('resolves the coach language through observeLang, like the rest of the flow', () => {
    expect(src).toMatch(/observeLang\(session\.users\)/);
  });
});

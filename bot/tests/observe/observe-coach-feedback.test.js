/**
 * FEAT-053 bd-28 — coach-the-coach feedback (pure layer: prompt, validation,
 * render). The officer rubric (D27, 7 observable behaviours) is scored
 * INTERNALLY; the FO sees 2 wins + 1 try — never a score on the officer.
 */

const {
  MIN_TRANSCRIPT_CHARS,
  RUBRIC_KEYS,
  buildCoachFeedbackPrompt,
  validateCoachFeedback,
  renderCoachFeedbackMessages,
} = require('../../shared/services/observe/observe-coach-feedback');
const { observeStrings } = require('../../shared/services/observe/observe-strings');

const S = observeStrings('sw');

const TRANSCRIPT =
  'FO: Asante kwa kunikaribisha darasani leo. Nilipenda ulivyotumia vijiti. ' +
  'Mwalimu: Asante. FO: Wewe mwenyewe, unaonaje somo lilikwendaje? ... ' +
  'Mwalimu: Nadhani wanafunzi walielewa lakini wachache walijibu maswali. ' +
  'FO: Vipi kesho ukiuliza "Umejuaje?" baada ya kila jibu? Mwalimu: Nitajaribu kesho asubuhi wakati wa hesabu.';

const GUIDE = {
  intro: 'x',
  steps: [
    { n: 1, title: 'Fungua kwa nia', say_this: 'Asante kwa kunikaribisha.' },
    { n: 2, title: 'Sifa yenye ushahidi', say_this: 'Nilipenda vijiti.' },
    { n: 3, title: 'Swali, kisha subira', say_this: 'Unaonaje somo?' },
    { n: 4, title: 'Jambo MOJA', say_this: 'Vipi "Umejuaje?"' },
    { n: 5, title: 'Ahadi ya kama–basi', say_this: 'Lini utajaribu?' },
    { n: 6, title: 'Panga kurejea', say_this: 'Nirudi Alhamisi?' },
  ],
  outro: 'x',
};

const goodFeedback = () => ({
  praise_line: 'Ulifungua kwa shukrani ya kweli — hivyo ndivyo imani inavyojengwa. 💛',
  wins: [
    { behaviour: 'Ulianza na sifa yenye ushahidi', evidence: 'Nilipenda ulivyotumia vijiti' },
    { behaviour: 'Ulimwachia mwalimu ahadi yake mwenyewe', evidence: 'Nitajaribu kesho asubuhi wakati wa hesabu' },
  ],
  try: {
    move: 'Shikilia ukimya',
    evidence: 'Baada ya swali lako la kutafakari, ulijibu mwenyewe haraka.',
    instead: 'Wakati ujao, hesabu sekunde tatu kimya — mwalimu ajaze ukimya.',
  },
  rubric: {
    opened_with_specific_praise: true,
    anchored_in_real_moment: true,
    asked_and_waited: false,
    one_improvement_only: true,
    moves_not_teacher: true,
    elicited_if_then: true,
    righting_reflex_held: false, disparaged_teacher: false,
  },
});

describe('buildCoachFeedbackPrompt', () => {
  test('contains transcript, guide say-this lines, and all 7 rubric keys', () => {
    const p = buildCoachFeedbackPrompt(TRANSCRIPT, { guide: GUIDE, language: 'sw' });
    expect(p).toContain('Umejuaje?');
    expect(p).toContain('Asante kwa kunikaribisha');
    for (const key of RUBRIC_KEYS) expect(p).toContain(key);
  });

  test('states the 2-wins-1-try shape and the no-score rule', () => {
    const p = buildCoachFeedbackPrompt(TRANSCRIPT, { guide: GUIDE, language: 'sw' });
    expect(p).toMatch(/mbili|two/i);
    expect(p).toMatch(/moja|one/i);
    expect(p).toMatch(/alama|score/i);          // ban stated
    expect(p).toMatch(/takriban dakika/);       // Swahili timestamp phrasing rule
  });

  test('diarization segments included when available (timestamped evidence)', () => {
    const withDia = buildCoachFeedbackPrompt(TRANSCRIPT, {
      guide: GUIDE,
      language: 'sw',
      diarization: { segments: [{ start_ms: 130000, speaker: 'spk1', text: 'Nilipenda vijiti' }] },
    });
    expect(withDia).toContain('130000');
    const without = buildCoachFeedbackPrompt(TRANSCRIPT, { guide: GUIDE, language: 'sw' });
    expect(without).not.toContain('130000');
  });

  test('asks for JSON', () => {
    expect(buildCoachFeedbackPrompt(TRANSCRIPT, { guide: GUIDE, language: 'sw' })).toMatch(/JSON/);
  });
});

describe('validateCoachFeedback', () => {
  test('accepts the good shape', () => {
    expect(() => validateCoachFeedback(goodFeedback())).not.toThrow();
  });

  test('rejects wins count ≠ 2', () => {
    const fb = goodFeedback();
    fb.wins.pop();
    expect(() => validateCoachFeedback(fb)).toThrow(/wins/i);
    fb.wins = [...goodFeedback().wins, { behaviour: 'x', evidence: 'y' }];
    expect(() => validateCoachFeedback(fb)).toThrow(/wins/i);
  });

  test('rejects a missing try move', () => {
    const fb = goodFeedback();
    delete fb.try;
    expect(() => validateCoachFeedback(fb)).toThrow(/try/i);
  });

  test('rejects any score-on-the-officer leakage', () => {
    for (const leak of ['Ulipata 7/10 kwa mazungumzo', 'asilimia 70 ya hatua', 'alama 8']) {
      const fb = goodFeedback();
      fb.praise_line = leak;
      expect(() => validateCoachFeedback(fb)).toThrow(/score/i);
    }
  });

  test('rejects an incomplete rubric (all 7 behaviours must be judged)', () => {
    const fb = goodFeedback();
    delete fb.rubric.righting_reflex_held;
    expect(() => validateCoachFeedback(fb)).toThrow(/rubric/i);
  });
});

describe('renderCoachFeedbackMessages', () => {
  test('two messages: warm praise bubble, then the 2-wins-1-try card', () => {
    const msgs = renderCoachFeedbackMessages(goodFeedback(), S);
    expect(msgs).toHaveLength(2);
    const [praise, card] = msgs;
    expect(praise).toContain('imani inavyojengwa');
    expect((card.match(/✓/g) || [])).toHaveLength(2);
    expect(card).toContain('Shikilia ukimya');
    expect(card).toContain('sekunde tatu');
  });

  test('card carries no numeric scores or rubric internals', () => {
    const card = renderCoachFeedbackMessages(goodFeedback(), S)[1];
    expect(card).not.toMatch(/\d+\s*\/\s*\d+|%|righting_reflex|rubric/);
  });

  // review fix #15/#21: an over-long model card must be truncated below the
  // WhatsApp 4096-char cap — past it sendMessage fails silently and the
  // feedback would be lost.
  test('over-long card is truncated below the 4096 WhatsApp cap', () => {
    const huge = goodFeedback();
    huge.try.evidence = 'x'.repeat(6000);
    const card = renderCoachFeedbackMessages(huge, S)[1];
    expect(card.length).toBeLessThanOrEqual(4096);
    expect(card).toContain(S.coach_card_closing);   // closing survives truncation
  });

  // re-verify fix: truncation must never split a UTF-16 surrogate pair into
  // a lone surrogate (Meta may reject → SQS retry loop).
  test('truncation never leaves a lone surrogate (emoji-safe, code-point slice)', () => {
    // build a card that lands an emoji right at the cut boundary across many lengths
    for (let pad = 4050; pad <= 4130; pad += 1) {
      const fb = goodFeedback();
      fb.try.evidence = `${'a'.repeat(pad)}😀😀😀`;
      const card = renderCoachFeedbackMessages(fb, S)[1];
      // no unpaired surrogate anywhere in the body
      expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(card)).toBe(false);
      expect(card.length).toBeLessThanOrEqual(4096);
    }
  });

  test('a card already under 4096 is sent untouched (no needless truncation)', () => {
    const fb = goodFeedback();
    const card = renderCoachFeedbackMessages(fb, S)[1];
    expect(card).not.toContain('…');   // small card not truncated
  });
});

describe('MIN_TRANSCRIPT_CHARS', () => {
  test('exported and sane', () => {
    expect(MIN_TRANSCRIPT_CHARS).toBeGreaterThanOrEqual(100);
    expect(MIN_TRANSCRIPT_CHARS).toBeLessThanOrEqual(500);
  });
});

// bd-65: "try" was undefined in both prompts — the model filled it with the
// debrief's CONTENT (classroom advice to the teacher) instead of its CRAFT
// (a coaching move for the officer's next debrief). Pin the definition.
describe('bd-65 — try is a coaching-craft move, never teaching advice', () => {
  const { buildCoachFeedbackPrompt, buildCoachFeedbackPromptI18n } = require('../../shared/services/observe/observe-coach-feedback');

  test('i18n prompt defines try as a NEXT-DEBRIEF coaching move and forbids classroom advice', () => {
    const p = buildCoachFeedbackPromptI18n('t', { foName: 'Noor' }, 'ur');
    expect(p).toMatch(/COACHING move for the officer's NEXT DEBRIEF/);
    expect(p).toMatch(/NEVER classroom-teaching advice/);
    expect(p).toMatch(/belongs on the TEACHER's report/);
  });

  test('sw prompt carries the same definition natively', () => {
    const p = buildCoachFeedbackPrompt('t', { language: 'sw' });
    expect(p).toMatch(/HATUA MOJA YA UKOCHA kwa DEBRIEF IJAYO/);
    expect(p).toMatch(/KAMWE si ushauri wa ufundishaji darasani/);
    expect(p).toMatch(/ripoti ya MWALIMU/);
  });
});

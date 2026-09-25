/**
 * bd-jgddp -- REPORTED SPEECH ABOUT THE BOOK IS NOT AN INSTRUCTION TO TALK.
 *
 * The PEER_TALK Opening gate hard-stopped 4 of 15 chapters on strings that quote or
 * describe what is PRINTED on the textbook page. The operator's ruling is unchanged --
 *
 *   *"teachers dont let students talk to each other, that too when the class begins"*
 *   *"Guided practice should stay as is, I only asked talking to be removed from opening"*
 *
 * -- so the exemption may not be "the text is inside quotation marks". `Say: "Turn to your
 * partner and discuss"` is the evasion that shape opens, and it MUST still fail. Every test
 * below exists to pin one half of that: an exemption requires an ATTRIBUTION TO A SOURCE
 * (the page, p.NNN, a named textbook feature, a named story character) whose reporting verb
 * is FINITE -- `the page asks`, `Pinky says` -- never a bare imperative the teacher performs.
 *
 * Second, independent rule: the operator permits WRITTEN peer exchange. An addressee told
 * `to write` is exempt on that ground alone, with or without an attribution.
 */
'use strict';

const path = require('path');
const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const A = require(path.join(V, 'lib', 'peertalk_attribution.js'));
const { peerTalkDefects, norm } = require(path.join(V, 'lib', 'peertalk.js'));

/** Exempt-or-not for the FIRST PEER_TALK defect the matcher finds in `s`. */
function exemptFirstDefect(s, opts) {
  const text = norm(s);
  const d = peerTalkDefects(s)[0];
  if (!d) throw new Error(`no PEER_TALK defect in: ${s}`);
  return A.isExempt(text, d.index, d.end, opts);
}

const ON = { namedFeature: true };
const OFF = { namedFeature: false };

// The five live strings, verbatim from the fresh 15-chapter build.
const CASE_A = 'See–Think–Wonder, on textbook p. 129. Open textbook p.129 and point to the two speaking portraits. Say: "On this page, a boy asks, ‘Can you help me sort out the words given below into the right column?’ Then an older man says, ‘Hey buddies! Discuss with your classmates which is your most favourite season.’ Today we will use simple English words and phrases in a small circle."';
const CASE_B = 'Sir Riaz: “What is a question you can ask your neighbour? How is it different from a statement?”';
const CASE_C = 'On p.177, the Match and Weigh Partner Challenge asks each partner to write a mass up to 3 kg, add the two masses, and see how close the total is to 5 kg.';
const CASE_D = 'See–Think–Wonder, on the picture on p. 210. Show textbook p.210. Say: "The Skill Sharpener asks, ‘With a partner, calculate how many seconds are in 15 minutes and 30 seconds.’ The page also asks, ‘If it takes 2 minutes and 30 seconds to boil an egg, how many seconds does it take?’"';

describe('bd-jgddp: the evasion the exemption must never open', () => {
  test('a teacher SAYING the banned move aloud is still the banned move', () => {
    expect(exemptFirstDefect('Say: "Turn to your partner and discuss"', ON)).toBe(false);
  });

  test('quotation marks alone attribute nothing', () => {
    expect(exemptFirstDefect('"Turn to your partner and discuss."', ON)).toBe(false);
  });

  test('a bare imperative is not a reporting verb, however it is punctuated', () => {
    expect(exemptFirstDefect('Now ask a classmate what they remember.', ON)).toBe(false);
    expect(exemptFirstDefect('Tell them: "Talk to your partner."', ON)).toBe(false);
  });

  test('a classroom ROLE word is not a named story character', () => {
    expect(exemptFirstDefect('Listener says, ‘Turn to your partner.’', ON)).toBe(false);
    expect(exemptFirstDefect('The teacher says, ‘Turn to your partner.’', ON)).toBe(false);
  });

  test('the span closes with the quote: an instruction AFTER it is still caught', () => {
    const s = 'The page says, ‘Look at the picture.’ Now turn to your partner and tell them.';
    expect(exemptFirstDefect(s, ON)).toBe(false);
  });
});

describe('bd-jgddp: attribution to a source exempts', () => {
  test('a named story character speaking in a read-aloud (g2_ch8/English_seg2)', () => {
    expect(exemptFirstDefect(CASE_B, OFF)).toBe(true);
  });

  test('a page / textbook referent with a finite reporting verb', () => {
    expect(exemptFirstDefect('The page asks, ‘Talk to your partner about it.’', OFF)).toBe(true);
    expect(exemptFirstDefect('Page 141 says, ‘Discuss with your partner.’', OFF)).toBe(true);
  });

  test('a named character with a finite verb, nested inside a teacher Say', () => {
    const s = 'Say: "Pinky says, ‘Ask your neighbour for a pencil.’"';
    expect(exemptFirstDefect(s, OFF)).toBe(true);
  });

  test('an UNNAMED person on the page is not a source (g2_ch10/English_seg4)', () => {
    // Measured, not assumed: this document’s Opening also runs a small-circle SPEAKING
    // CHAIN that no PEER_TALK pattern catches. Exempting its quoted speech bubble would
    // turn a correct block into a silent pass, so the unnamed-person tier stays out.
    expect(exemptFirstDefect(CASE_A, ON)).toBe(false);
  });
});

describe('bd-jgddp: the named-textbook-feature decision (g5_ch10/Maths_seg6)', () => {
  test('OFF: forced off, the teacher reading the task aloud still fails', () => {
    expect(exemptFirstDefect(CASE_D, OFF)).toBe(false);
  });

  test('ON (shipped since bd-lqw3e): the same string is exempt', () => {
    expect(exemptFirstDefect(CASE_D, ON)).toBe(true);
  });

  test('the shipped default is ON -- the operator ruled it is the book talking', () => {
    expect(A.EXEMPT_NAMED_FEATURE_ATTRIBUTION).toBe(true);
    expect(exemptFirstDefect(CASE_D)).toBe(true);
  });
});

describe('bd-jgddp: WRITTEN peer exchange is a separate, independent ground', () => {
  test('g3_ch10/Maths_seg4 is exempt even with the feature tier OFF', () => {
    expect(exemptFirstDefect(CASE_C, OFF)).toBe(true);
  });

  test('written exchange needs no attribution at all', () => {
    expect(exemptFirstDefect('Ask each partner to write a mass up to 3 kg.', OFF)).toBe(true);
  });

  test('a SPOKEN verb in the matched phrase forfeits the written ground', () => {
    expect(exemptFirstDefect('Discuss with your partner, then write a mass.', OFF)).toBe(false);
    expect(exemptFirstDefect('Tell your partner to write a mass.', OFF)).toBe(false);
  });

  test('the writing verb must govern the addressee, not merely appear later', () => {
    expect(exemptFirstDefect('Ask a classmate what they think. Then write it down.', OFF)).toBe(false);
  });
});

describe('bd-jgddp: Urdu is not exempted by an English-only discriminator', () => {
  test('a live Urdu opening violation stays unexempted', () => {
    // bd-47kx7's live g2_ch8/Urdu_seg1 opening string, verbatim.
    const s = 'ابھی اپنے ساتھی کو اپنا جواب بتائیں۔';
    // Rule 20: code points, never bytes -- 36 code points, 66 UTF-8 bytes.
    expect([...s].length).toBe(36);
    expect(A.isExempt(norm(s), 0, [...norm(s)].length, ON)).toBe(false);
  });

  test('an Urdu terminal mark closes an unquoted reported clause', () => {
    const s = 'The page says something. ساتھی کو بتائیں۔';
    expect(A.attributedSpans(norm(s)).length).toBe(0);
  });
});

describe('bd-jgddp: peerTalkDefects reports WHERE it matched', () => {
  test('index/end slice the matched phrase out of the normalised string', () => {
    const s = 'Now turn to your partner and tell them.';
    const d = peerTalkDefects(s)[0];
    expect(norm(s).slice(d.index, d.end)).toBe('turn to your partner');
  });

  test('every defect carries a usable span', () => {
    for (const d of peerTalkDefects(CASE_A)) {
      expect(typeof d.index).toBe('number');
      expect(d.end).toBeGreaterThan(d.index);
    }
  });
});

describe('bd-jgddp: the exact edges of a reported span', () => {
  // One span, its offsets pinned, so the two containment comparisons are testable
  // individually. `The page says, 'Ask your partner.'` -> span [16, 33): 16 is the first
  // character INSIDE the quote, 33 the index OF the closing quote.
  const S = "The page says, 'Ask your partner.'";
  const T = norm(S);

  test('the span is where we think it is', () => {
    expect(A.attributedSpans(T, OFF)).toEqual([{ start: 16, end: 33, source: 'source-text' }]);
  });

  test('a match that ENDS where the quote OPENS is not inside it', () => {
    // Half-open at the start on purpose: ending at the first quoted character means the
    // banned phrase is the teacher's own lead-in, not the reported words.
    expect(A.isReported(T, 0, 16, OFF)).toBe(false);
  });

  test('a match that ENDS on the closing quote IS inside it', () => {
    // Inclusive at the end on purpose: the last reported word is still reported.
    expect(A.isReported(T, 16, 33, OFF)).toBe(true);
  });

  test('a source that quotes nothing reports nothing', () => {
    // An empty quotation is a zero-width span; it must never enter the span list, or
    // every later containment test has a degenerate candidate to reason about.
    expect(A.attributedSpans(norm('The page says, "" and nothing else.'), OFF)).toEqual([]);
  });

  test("a straight quote closes on the quote mark, not on an apostrophe inside it", () => {
    // `norm` flattens the curly ‘ ’ the corpus actually uses down to a straight ', so a
    // reported sentence containing "Don't" arrives here with three identical ' marks.
    // Closing on the middle one would drop the rest of the quotation out of the span.
    expect(exemptFirstDefect("The page says, 'Don't be shy. Ask your partner.'", OFF)).toBe(true);
  });
});

describe('bd-jgddp: an unquoted reported clause', () => {
  // Reported speech need not be quoted: `<source> asks <someone> to <do X>` is the shape
  // g3_ch10/Maths_seg4 uses. This case deliberately has NO writing verb, so the WRITTEN
  // ground cannot rescue it -- it is exempt on the attribution ground alone, or not at all.
  const S = 'Page 141 asks each partner to point at the picture.';

  test('an infinitive clause reported from a source is exempt', () => {
    expect(exemptFirstDefect(S, OFF)).toBe(true);
  });

  test('it is the attribution, not the writing rule, that exempts it', () => {
    const T = norm(S);
    const d = peerTalkDefects(S)[0];
    expect(A.isWrittenExchange(T, d.index, d.end)).toBe(false);
    expect(A.isReported(T, d.index, d.end, OFF)).toBe(true);
  });

  test('a clause whose `to` is far from the reporting verb is not reported', () => {
    // 40 characters. Past that the "to" belongs to some later thought, not to what the
    // source asked, and treating the whole sentence as reported would exempt anything
    // that merely follows a source mention.
    expect(exemptFirstDefect(
      'The chart asks each partner, once everybody has settled right down, to write two numbers.',
      OFF,
    )).toBe(false);
  });
});

describe('bd-jgddp: how far the written instruction may sit from the addressee', () => {
  test('a short qualifier between the addressee and `to write` is still written', () => {
    // 18 characters of qualifier -- well inside the window, and far enough outside a
    // one-space gap that the window is genuinely exercised rather than merely present.
    expect(exemptFirstDefect('Ask your partner in the same pair to write the answer.', OFF)).toBe(true);
  });

  test('a long clause between them is not', () => {
    // 25 characters. The written permission is for "partner ... to write", not for any
    // sentence that eventually mentions writing.
    expect(exemptFirstDefect(
      'Ask your partner, once the whole class has settled right down, to write the answer.',
      OFF,
    )).toBe(false);
  });
});

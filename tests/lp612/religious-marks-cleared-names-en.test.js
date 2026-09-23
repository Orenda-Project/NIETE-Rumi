/**
 * THE G5c CLEARED-NAME LIST, LATIN HALF — bd-5t71f (P0).
 *
 * The Q2 ruling ("since we will have lots of Muhammads not the prophet but regular ppl, get a
 * list approved from the page truths so we know which names can come up and dont need the
 * salutation") was executed for URDU ONLY. `g5c_cleared_names.json` is keyed on the Urdu word
 * sequence, so the Urdu lane clears `محمد علی جناح` and the English lane refuses
 * `Mohammad Ali Jinnah`: an English-medium Pakistan Studies lesson naming the Quaid is refused
 * outright and the teacher gets nothing. Across the Grades 6-12 page-truth corpus that is 436
 * unhonorified Latin occurrences on 192 pages in 33 books.
 *
 * The fix may NOT be a grammar rule. `isCompoundGivenName()` decides by grammar which `محمد` is
 * somebody's given name; porting it into the Latin lane would be the automated clearance brief
 * §4c forbids — "Automated checks do NOT clear religious content: the native-speaker review
 * remains a hard hold before any teacher delivery." So the Latin lane is driven exactly the way
 * the Urdu lane is: off the reviewer's approved list, and off nothing else.
 *
 * THE REAL LIST DOES NOT EXIST YET. `bot/vendor/lp-v9/g5c_cleared_names_en.json` ships EMPTY and
 * clears NOTHING; the candidate list derived from the page truths is with Amena for sign-off.
 * So this suite mocks that path with a FIXTURE clearance. What it proves is the MECHANISM —
 * and, in the REGRESSION block, the half of the mechanism that matters: everything the review
 * has not cleared still fails, closed.
 *
 * Red-first: on this branch's base every `does not block` assertion here reports RELIGIOUS_MARKS,
 * because `clearedByReviewEn` does not exist there at all.
 */

// `person` clears. `prophet` never clears — it only ARBITRATES where two decided phrases cover
// the same word. Both halves are exercised below.
jest.mock('../../bot/vendor/lp-v9/g5c_cleared_names_en.json', () => ({
  person: ['Mohammad Ali Jinnah', 'Muhammad Ali'],
  prophet: ['Hazrat Muhammad'],
}));

const { religious, withProse, setSecondProse } = require('./helpers/religious-marks');

/** Latin prose alone is not religious content. An Urdu religious string supplies the trigger,
 *  exactly as the production Grade 6 History document did — without it the gate never runs and
 *  every assertion here would be vacuous. */
const TRIGGER = 'سیرت کا سبق';
const en = (text) => setSecondProse(withProse(TRIGGER), text);

describe('a Latin name the review cleared no longer blocks delivery', () => {
  test('the Quaid, in the sentence a Pakistan Studies lesson actually writes', () => {
    expect(religious(en('Quaid-e-Azam Mohammad Ali Jinnah founded Pakistan in 1947.'))).toEqual([]);
  });

  test('the caps a heading prints are read through — the key is the WORD, not the bytes', () => {
    // Only the surname is capitalised here: `TRANSLIT_PROPHET_RE` is case-SENSITIVE, so an
    // all-caps `MOHAMMAD` never reaches this gate at all and would assert nothing. The folding
    // this proves is the one that matters — the REST of the decided phrase, as the book sets it.
    expect(religious(en('Mohammad Ali JINNAH led the League.'))).toEqual([]);
  });

  test('the possessive is the same name — "Jinnah’s vision"', () => {
    expect(religious(en('Mohammad Ali Jinnah’s vision shaped the new state.'))).toEqual([]);
    expect(religious(en("Mohammad Ali Jinnah's vision shaped the new state."))).toEqual([]);
  });

  test('edge punctuation is read through — a parenthesis is not part of a name', () => {
    expect(religious(en('The founder (Mohammad Ali Jinnah), a lawyer, led the League.'))).toEqual([]);
  });
});

describe('REGRESSION — everything the review did not clear still fails, closed', () => {
  test('a bare "Mohammad" is still refused', () => {
    expect(religious(en('Mohammad taught his companions.')).length).toBeGreaterThan(0);
  });

  test('a name of the SAME SHAPE that the review never saw is still refused', () => {
    // Three words, same first two, decided nowhere. An allowlist that cleared this would be a
    // heuristic wearing a list's clothes.
    expect(religious(en('Mohammad Ali Bogra became Prime Minister in 1953.')).length).toBeGreaterThan(0);
  });

  test('a phrase the review marked `prophet` NEVER clears', () => {
    expect(religious(en('Hazrat Muhammad was born in Makkah.')).length).toBeGreaterThan(0);
  });

  test('on equal length the blocking mark wins — `Hazrat Muhammad` over `Muhammad Ali`', () => {
    // Both decided phrases cover the same word. The reviewer's blocking mark decides.
    expect(religious(en('Hazrat Muhammad Ali is named in the chapter.')).length).toBeGreaterThan(0);
  });

  test('a cleared name does not clear a DIFFERENT Mohammad in the same sentence', () => {
    expect(religious(en('Mohammad Ali Jinnah met Mohammad Iqbal in 1930.')).length).toBeGreaterThan(0);
  });

  test('the honorified form still passes, exactly as before', () => {
    expect(religious(en('The Prophet Muhammad ﷺ was born in Makkah.'))).toEqual([]);
  });

  test('the Urdu lane is untouched — a bare محمد there still fails', () => {
    // The English list is consulted only by the English lane. If it leaked, this would clear.
    expect(religious(withProse('سیرت کا سبق: محمد نے فرمایا')).length).toBeGreaterThan(0);
  });
});

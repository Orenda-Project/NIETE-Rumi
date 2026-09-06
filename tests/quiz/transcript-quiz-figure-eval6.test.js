'use strict';
/**
 * What the first author eval on real early-years lessons found (round 6).
 *
 * Twelve synthetic-but-realistic KG-G3 transcripts through the real digest,
 * author and validator on the production model. The model DID reach for the new
 * types — the round-0 question is answered — and three defects came with it:
 *
 * 1. THE SET LACKED THE WORDS PHONICS ACTUALLY USES. The author asked for
 *    `picto: "pig"` and `picto: "mat"` — after `cat`, the two most canonical
 *    CVC words in any phonics scheme — and both were missing, which failed the
 *    whole question and, on those two sessions, the whole quiz. The set was
 *    built by intersecting the segmentation's own nouns with OpenMoji, and a
 *    segmentation says "blend CVC words", not "pig". 48 more nouns were added,
 *    and ONLY ones the upstream glyph actually IS: `fig` -> a pear and `rug` ->
 *    a rolled-up newspaper draw the wrong thing under the right word, which is
 *    the same defect class as an atom spec that says magnesium and draws
 *    chlorine.
 *
 * 2. THE AUTHOR MUST PICK A WORD THE SET CAN PICTURE. The roster was already in
 *    the prompt and the model invented a name anyway. The contract now says what
 *    to do about it: choose a word from the lesson that the set HAS, or write the
 *    question without a figure — never invent a name.
 *
 * 3. `count_objects` WAS USED AS A VOCABULARY INSTRUMENT. One Urdu session drew
 *    two birds, one goat and three mountains and asked, of each, "which word
 *    does this picture match?" — the counts were meaningless and one of them
 *    contradicted the intended answer. A counting picture is for HOW MANY;
 *    matching a picture to a word is what `match` is for.
 */

jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const Pictograms = require('../../bot/vendor/lp-v9/diagrams/lib/pictogram');
const Figure = require('../../bot/shared/services/quiz/transcript-quiz-figure');
const Author = require('../../bot/shared/services/quiz/transcript-quiz-author.service');

const prompt = (gradeBand = '1-2') => Author.buildAuthorPrompt({
  digest: { subject: 'english', slos: [{ id: 'S1', statement: 's', taught_level: 'recall' }] },
  excerpts: 'x', language: 'en', gradeBand,
});

describe('the set covers the words a phonics lesson actually uses', () => {
  // The CVC and early-decodable inventory, from what the author asked for in
  // round 6 plus the standard SATPIN-onward roster.
  const CVC = ['cat', 'pig', 'rat', 'hen', 'dog', 'fox', 'ox', 'ant', 'bat', 'bag', 'cap',
    'cup', 'sun', 'net', 'pin', 'pen', 'bed', 'box', 'egg', 'bus', 'hut', 'web', 'owl'];
  test.each(CVC)('%s has a pictogram', (noun) => {
    expect(Pictograms.has(noun)).toBe(true);
  });

  test('every glyph in the index still resolves to real markup', () => {
    expect(Pictograms.names().length).toBeGreaterThanOrEqual(250);
    Pictograms.names().forEach((n) => expect(Pictograms.inner(n).length).toBeGreaterThan(20));
  });

  test('a name the set does not have still fails loudly, with a sample of the roster', () => {
    expect(() => Figure.renderFigureSvg({ type: 'word_blank', word: 'yak', blanks: [1], picto: 'yak' }, 'en'))
      .toThrow(/unknown pictogram "yak"/);
  });

  test('the failure message is bounded — it does not paste the whole roster into the retry prompt', () => {
    // The roster is already IN the prompt; repeating all 255 names inside a
    // validator error spends the retry's budget on something the model has.
    let msg = '';
    try { Figure.renderFigureSvg({ type: 'count_objects', picto: 'yak', count: 4 }, 'en'); } catch (e) { msg = e.message; }
    expect(msg).toMatch(/unknown pictogram "yak"/);
    expect(msg.length).toBeLessThan(400);
  });
});

describe('the author contract tells the model what to do when the set lacks its word', () => {
  test('it says to pick a word the set has, or to drop the figure', () => {
    const p = prompt();
    expect(p).toMatch(/never invent a (pictogram )?name/i);
    expect(p).toMatch(/choose a word from the lesson that IS on the list, or write that question without a figure/i);
  });
});

describe('count_objects is a counting instrument, not a vocabulary one', () => {
  test('the contract says so, and points at match instead', () => {
    const p = prompt();
    expect(p).toMatch(/count_objects[\s\S]{0,600}how many/i);
    expect(p).toMatch(/to ask which WORD a picture matches, use the match type/i);
  });

  test('a single thing is refused — one of something is not a count', () => {
    expect(() => Figure.renderFigureSvg({ type: 'count_objects', picto: 'goat', count: 1 }, 'en'))
      .toThrow(/one .* is not something to count/i);
  });

  test('two or more is still allowed — a KG class genuinely counts to two', () => {
    expect(Figure.renderFigureSvg({ type: 'count_objects', picto: 'bird', count: 2 }, 'en')).toContain('<svg');
  });
});

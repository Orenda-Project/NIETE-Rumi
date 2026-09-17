/**
 * THE G5c CLEARED-NAME LIST — bd-zipoe (P1).
 *
 * `محمد` is an ordinary Pakistani given name. The gate demanded ﷺ after every one of them, so a
 * delivered Grade 10 Urdu lesson (grade_10_urdu.p2c05.p135-135.tafheem, v9.6) carried FIVE
 * RELIGIOUS_MARKS fails on the poet Nazeer Akbarabadi's real name `سیّد ولی محمد` — four of them
 * on teacher-facing paths. `isCompoundGivenName()` does not reach it: it reads the word AFTER
 * `محمد`, and here `محمد` is the LAST word of the name.
 *
 * The fix may not be a heuristic. Brief §4c / gate G5c: "Automated checks do NOT clear religious
 * content: the native-speaker review remains a hard hold before any teacher delivery." Deciding
 * which `محمد` is not the Prophet is exactly what that reserves for the reviewer. So the only
 * thing permitted to clear a name is the REVIEW ITSELF — the 298 rows Amena Ahmed decided on
 * 2026-09-17, carried into the repo as `bot/vendor/lp-v9/g5c_cleared_names.json`.
 *
 * Everything not on that list still fails. That is the whole design, and the REGRESSION blocks
 * below are the half of it that matters.
 *
 * Red-first: on this branch's base every `does not block` assertion here reports RELIGIOUS_MARKS.
 */

const { religious, withProse } = require('./helpers/religious-marks');

/** The four live teacher-facing strings, verbatim from the production render rows. */
const PROD = [
  'کا اصل نام سیّد ولی محمد اور تخلص نظیر تھا (ص ۱۳۵',
  'ر: اصل نام سیّد ولی محمد (شاعر کا اپنا نام)',
  'ں: اصل نام سیّد ولی محمد، تخلص نظیر',
  'سیّد ولی محمد',
];

describe('a name the native-speaker review cleared no longer blocks delivery', () => {
  test.each(PROD)('the production Grade 10 string is delivered: %s', (text) => {
    expect(religious(withProse(text))).toEqual([]);
  });

  test('the shadda the book prints is read through — سیّد is the cleared سید', () => {
    // The clearance row is `سید ولی محمد`; the book prints `سیّد` with a shadda. A byte-exact
    // allowlist would clear neither the row nor the page, so the key is normalised.
    expect(religious(withProse('نظیر اکبرآبادی کا اصل نام سیّد ولی محمد تھا۔'))).toEqual([]);
    expect(religious(withProse('نظیر اکبرآبادی کا اصل نام سید ولی محمد تھا۔'))).toEqual([]);
  });

  test('a second decided row clears the same way — نور محمد', () => {
    // Iqbal's father, grade_10/11 Urdu. `محمد` closes the name and the next word is `اور`, so
    // `isCompoundGivenName()` cannot reach this one either. Aeraab must not change the row.
    expect(religious(withProse('والد کا نام نور محمد اور والدہ کا نام امام بی بی تھا۔'))).toEqual([]);
    expect(religious(withProse('والد کا نام نُور محمد اور والدہ کا نام امام بی بی تھا۔'))).toEqual([]);
  });

  test('a cleared name still clears when the sentence puts punctuation against it', () => {
    expect(religious(withProse('اصل نام: سیّد ولی محمد، تخلص نظیر۔'))).toEqual([]);
  });
});

describe('REGRESSION — everything the review did not clear still fails, closed', () => {
  const blocks = (text) => religious(withProse(text)).join(' ');

  test('a bare محمد still demands ﷺ', () => {
    expect(blocks('نبی کریم ﷺ کا نام محمد ہے۔')).toMatch(/names the Prophet/);
  });

  test('حضرت محمد — a row the reviewer marked Y — still demands ﷺ', () => {
    expect(blocks('حضرت محمد نے صبر کی تلقین کی۔')).toMatch(/names the Prophet/);
  });

  test('محمد بن عبداللہ and محمد مصطفیٰ still demand ﷺ', () => {
    expect(blocks('آپ کا نام محمد بن عبداللہ ہے۔')).toMatch(/names the Prophet/);
    expect(blocks('محمد مصطفیٰ کا اسوہ ہمارے لیے نمونہ ہے۔')).toMatch(/names the Prophet/);
  });

  test('a name NOBODY reviewed still fails — the list is the only clearance', () => {
    // Same SHAPE as the case this bead fixes — محمد closing a compound name, so
    // `isCompoundGivenName()` cannot reach it — but not one of the 298 decided rows. Fail-closed
    // is the point: an unreviewed name is not cleared just because it reads like a person.
    expect(blocks('استاد زوار الخوارزمی محمد نے کلاس لی۔')).toMatch(/names the Prophet/);
  });

  test('a cleared name does not license a DIFFERENT محمد in the same sentence', () => {
    expect(blocks('سیّد ولی محمد کا ذکر ہے، اور حضرت محمد کا بھی۔')).toMatch(/names the Prophet/);
  });

  test('the LONGER decided phrase wins — حضرت محمد باقر رحمہ اللہ is cleared, حضرت محمد is not', () => {
    // The two rows overlap: `حضرت محمد` is Y, `حضرت محمد باقر رحمہ اللہ` is N. Reading the
    // shortest match would refuse a name the reviewer explicitly cleared, so the longest decided
    // phrase present is the one that rules — and on a tie the blocking mark wins.
    expect(religious(withProse('حضرت محمد باقر رحمہ اللہ کے صاحبزادے تھے۔'))).toEqual([]);
    expect(blocks('حضرت محمد کے صاحبزادے تھے۔')).toMatch(/names the Prophet/);
  });
});

describe('what this change does NOT touch', () => {
  // Honest record of the bead's other two evidence strings. Both are ALREADY retired on sandbox —
  // by `isCompoundGivenName()` (bd-gyrg8), not by the cleared list — and both sat on
  // /human_review_reason, which bd-kpqu6 took out of enforcement scope. They are pinned here so
  // this change is shown not to move them.
  test('grade_8_urdu علامہ محمد اقبالؒ was already clear before the list existed', () => {
    expect(religious(withProse('شاعر کا حوالہ علامہ محمد اقبالؒ کے طور پر آتا ہے۔'))).toEqual([]);
  });

  test('grade_6_urdu "لفظ محمد شامل ہے" was already clear before the list existed', () => {
    expect(religious(withProse('وطن کے ناموں میں لفظ محمد شامل ہے (کیپٹن سرور اور دیگر)۔')))
      .toEqual([]);
  });
});

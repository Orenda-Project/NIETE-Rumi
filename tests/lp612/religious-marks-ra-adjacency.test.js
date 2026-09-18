/**
 * "RA" IS AN HONORIFIC ONLY WHEN IT IS ADJACENT TO A NAME — bd-6tfw6, option 1.
 *
 * `ABBREV_RE` held a bare `\bRA\b`, so any religious-carrying document that also said "the RA
 * value on the diagram" was refused. Three of the four tokens in that set spell nothing else in a
 * school lesson; RA spells right ascension, relative abundance and the roughness symbol Ra. The
 * operator's ruling (2026-09-17, "go on option 1") narrows RA — and ONLY RA — to the adjacent
 * shapes. PBUH, SAW and SAWW still fire unconditionally.
 *
 * WHAT MAKES THIS A NARROWING WITH NO MEASURED COST. The 2026-09-17 census (bd-2cbwr) re-linted
 * all 1,401 servable renders on production. Exactly one raises RA at all — 1140eb1d,
 * grade_7_history.c02.p021-022, ur, v9.6, `recordedVerdict: clean`, currently SERVING — and it
 * raises it 35 times. Describe A is every one of those 28 whose token the census excerpt actually
 * shows, verbatim off the stored fail message, plus the 3 SAW strings from the same render.
 *
 * DESCRIBE A IS A GUARD, NOT A RED. It passed before this change and passes after it; that is
 * the whole point — it is the evidence the protection was not narrowed. Describe B is the red.
 *
 * WHAT THIS FILE DOES NOT COVER, stated plainly: 7 of the 35 RA fails on 1140eb1d sit beyond the
 * 70-character excerpt the gate stores in its message, so their shape is UNDETERMINED from the
 * census alone. Reading the stored document itself needs a production R2 read. Paths, for
 * whoever gets that read: /sections/1/blocks/0/text, /sections/1/blocks/1/items/0,
 * /sections/4/homework/items/0/text, /page2/homework_key/0/answer, /page2/exam_bank/how_marked,
 * /page2/coaching_lookfor, /one_screen.
 */

const { blocked, withProse, setSecondProse } = require('./helpers/religious-marks');

/** An Urdu religious string supplies `isReligious`; check 2 never runs without it. */
const TRIGGER = 'سیرت کا سبق';

/** Put `text` in a teacher-facing slot of a document that is already detected as religious. */
const inLesson = (text) => setSecondProse(withProse(TRIGGER), text);

// Verbatim from `currentReligiousFails` on render 1140eb1d — the gate's own 70-char excerpt of
// the stored string, so these are production text and not a re-typing of it.
const CENSUS_RA = [
  "You can name Hazrat Mu'awiya (RA) as the Umayyad founder and his tribe",
  'You can explain why Hazrat Hassan (RA) gave his pledge in 661 AD.',
  'Hazrat Ali (RA).',
  'In 661 AD, Hazrat Hassan ibn Ali (RA) had support to become caliph him',
  'Pupils often confuse Hazrat Ali (RA), the fourth Pious Caliph, with Ha',
  "Hazrat Mu'awiya (RA) was from Banu Umayya, a branch of the Quraysh, an",
  "661 AD: after Hazrat Ali (RA)'s martyrdom, Hazrat Hassan (RA) pledged ",
  "Hazrat Hassan (RA) 'decided to give his pledge' to Hazrat Mu'awiya (RA",
  "In what year did Hazrat Hassan (RA) give his pledge to Hazrat Mu'awiya",
  "Because Hazrat Hassan (RA)'s pledge to Hazrat Mu'awiya (RA) united the",
  "1 mark: names Hazrat Mu'awiya (RA) as founder.",
  '1 mark: states Hazrat Hassan (RA) gave his pledge for the sake of Musl',
  "Umayyad Dynasty: 661-750 AD · founder Hazrat Mu'awiya (RA) · capital D",
  'In 3-4 sentences, explain what Hazrat Hassan (RA) gave up in 661 AD an',
  'Write underneath: Hazrat Ali (RA) martyred, then Hazrat Hassan (RA) pl',
  'Hazrat Ali (RA) martyred',
  "Am al-Jama: Hazrat Hassan (RA) pledges to Hazrat Mu'awiya (RA)",
  "(B) the year of unification — 'Am al-Jama' marks Hazrat Hassan (RA)'s ",
  'Hazrat Hassan (RA) gave up his own claim to the caliphate, even though',
  "Hazrat Hassan (RA) lost to Hazrat Mu'awiya (RA) in a fight for power.",
  'Did the book describe a battle, or a pledge that Hazrat Hassan (RA) ch',
  'Who was the Governor of Syria during the caliphate of Hazrat Ali (RA)?',
  'Hazrat Hassan (RA)',
  "Hazrat Mu'awiya (RA)",
  '1 mark: Hazrat Ali (RA) martyred, ending the Pious Caliphate.',
  '1 mark: Hazrat Hassan (RA) initially had support to become caliph.',
  "1 mark: Hazrat Hassan (RA) pledged to Hazrat Mu'awiya (RA) for the sak",
  'Which of my pupils described 661 AD as a loss for Hazrat Hassan (RA) r',
];

const CENSUS_SAW = [
  'Which family/tribe did the Prophet (SAW) belong to?',
  "The Umayyad Dynasty started with the Prophet's (SAW) family line direc",
  "Whose great-grandfather was Umayya — the Prophet's (SAW), or Hazrat Mu",
];

describe('A — GUARD: the production census still blocks, all 31 verifiable strings', () => {
  it.each(CENSUS_RA)('RA still blocks: %s', (s) => {
    expect(blocked(inLesson(s))).toBe(true);
  });

  it.each(CENSUS_SAW)('SAW is untouched and still blocks: %s', (s) => {
    expect(blocked(inLesson(s))).toBe(true);
  });

  it('names the ABBREVIATION in the message, not the name word in front of it', () => {
    // The adjacency arms have to match the name to require the adjacency, so the whole match is
    // "Ali (RA". The teacher-facing message must still say the token was "RA".
    const msg = require('./helpers/religious-marks')
      .religious(inLesson('Hazrat Ali (RA) was the fourth caliph.')).join(' ');
    expect(msg).toMatch(/abbreviates an honorific \("RA"\)/);
  });

  it('a name-adjacent RA with no parens blocks too — "Hazrat Ali RA"', () => {
    expect(blocked(inLesson('The pledge of Hazrat Ali RA is in the book.'))).toBe(true);
  });

  it('PBUH is untouched by option 1', () => {
    expect(blocked(inLesson('Hazrat Muhammad (PBUH) an embodiment of justice'))).toBe(true);
  });

  it('SAWW is untouched by option 1', () => {
    expect(blocked(inLesson('The Prophet SAWW said so in the book.'))).toBe(true);
  });

  it('lowercase "ra" was never in the set and still is not', () => {
    expect(blocked(inLesson('Measure the ra of the surface in micrometres.'))).toBe(false);
  });
});

describe('B — RED: a bare RA, adjacent to nothing, is ordinary science prose', () => {
  it('the bead\'s own string — "Identify the RA value on the diagram."', () => {
    expect(blocked(inLesson('Identify the RA value on the diagram.'))).toBe(false);
  });

  it('sentence-initial "Find RA from the chart." is not a name adjacency', () => {
    expect(blocked(inLesson('Find RA from the chart.'))).toBe(false);
  });

  it('right ascension defined without parens', () => {
    expect(blocked(inLesson('The star has an RA of 18 hours and a declination of 38 degrees.'))).toBe(false);
  });

  it('relative abundance in a biology line', () => {
    expect(blocked(inLesson('Record the RA of each isotope in the table below.'))).toBe(false);
  });

  it('a possessive lowercase word in front is not a name', () => {
    expect(blocked(inLesson("Read the star's RA value off the axis."))).toBe(false);
  });
});

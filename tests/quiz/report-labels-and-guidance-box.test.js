'use strict';
/**
 * The class report's own words and the box she acts on (PLAN_R5 §0 rows 6, 12, 14).
 *
 * The operator read his own Urdu report off staging and said three things about
 * it that are all about the DOCUMENT rather than the data in it:
 *
 *   a. "It says class Ausat — I don't even know what that means. If it was an
 *      English word forcefully translated, please correct that."
 *   c. "The what-to-reteach section is very hard to read because of its colour
 *      background… the one-to-stretch-them is awkwardly named."
 *  14. "even if it is in Urdu, English terms are written in English so that the
 *      teacher can understand them."
 *
 * and item 6: the class comes from what the CHILDREN typed, never from a digest
 * band that reads "Grade 6-8".
 *
 * THE URDU RULE THIS FILE ENCODES (written out because it is a judgement, not a
 * lookup, and the next person to add a string needs it):
 *
 *   1. A TERM OF RECORD — an English word a Pakistani teacher actually says —
 *      stays in LATIN LETTERS, in place: quiz, link, forward, group, PDF, and
 *      every subject term. Never translated, and never transliterated into Urdu
 *      script: "کوئز" is the forced form, not the natural one.
 *   2. AN EVERYDAY IDEA she says in Urdu is written as real Urdu WITH ITS
 *      GRAMMATICAL LINKER. "کلاس اوسط" is a word-for-word calque of "class
 *      average" — Urdu does not stack two nouns like that; it needs "کا".
 *   3. The test is spoken, not written: read it aloud as a teacher in a Rawalpindi
 *      staffroom. Whichever language she would actually use for that word, use.
 *
 * `bot/shared/config/ux-strings.js` already settles this register — its Urdu
 * strings carry quiz/link/forward/group/PDF/transcript/WhatsApp in Latin — and
 * the two report chrome tables were the only place in the repo that had drifted.
 */
const renderReport = require('../../bot/shared/templates/video-quiz-report.template');
const { classHeading } = require('../../bot/shared/utils/text-format');

const BASE = {
  topic: 'Electric circuit', teacherName: 'Razia', started: 3, finished: 2, average: 88,
  students: [
    { student_name: 'Hamza', student_class: '7', correct_answers: 7, total_questions_answered: 8, mastery_percentage: 88 },
    { student_name: 'Ayesha', student_class: '6', correct_answers: 6, total_questions_answered: 8, mastery_percentage: 75 },
  ],
  hardest: [{ question_text: 'What breaks the circuit?', wrong: 2, total: 3, top_wrong_text: 'the wire', correct_text: 'the open switch', explanation: 'A gap stops the current.', misconception: 'They read a wire as a gap.', slo: 'tell a closed circuit from an open one' }],
  unfinished: ['Bilal'], generatedAt: '5 Sep 2026',
  guidance: { muddled: 'They think a bulb lights whenever a wire touches it.', board: 'Draw the same loop twice, once whole and once with a gap. Ask two children to hold hands to close the circle and let go to break it. They copy both loops and mark where the current stops.', check: 'If I open the switch, does the bulb light?' },
};
const en = (o) => renderReport({ ...BASE, language: 'en', contentLanguage: 'en', ...o });
const ur = (o) => renderReport({ ...BASE, language: 'ur', contentLanguage: 'ur', ...o });

describe('item 6 — the header names the class the CHILDREN entered', () => {
  test('classHeading is a shared helper, not a string built in the template', () => {
    expect(typeof classHeading).toBe('function');
  });
  test('one class reads "Class 7"; two read "Classes 6, 7", sorted numerically', () => {
    expect(classHeading(['7'], 'en')).toBe('Class 7');
    expect(classHeading(['7', '6'], 'en')).toBe('Classes 6, 7');
    expect(classHeading(['10', '6', '7'], 'en')).toBe('Classes 6, 7, 10');
  });
  test('a class the child typed as "Class 7" is the same class as "7"', () => {
    expect(classHeading(['Class 7', '7', ' 7 '], 'en')).toBe('Class 7');
  });
  test('Urdu takes the Urdu unit word, singular and plural', () => {
    expect(classHeading(['7'], 'ur')).toBe('جماعت 7');
    expect(classHeading(['6', '7'], 'ur')).toBe('جماعتیں 6، 7');
  });
  test('no classes at all renders nothing — never an empty label, never a band', () => {
    expect(classHeading([], 'en')).toBe('');
    expect(classHeading(null, 'ur')).toBe('');
    const html = en({ classes: [] });
    expect(html).not.toMatch(/Class(es)?\s*<\/div>/);
  });
  test('the classes the children entered reach the who-line', () => {
    expect(en({ classes: ['6', '7'] })).toMatch(/Razia<\/span>[^<]*&middot; Classes 6, 7/);
    expect(ur({ classes: ['7'] })).toMatch(/&middot; جماعت/);
  });
  test('classes win over any `grade` a caller still passes — a band is never the class', () => {
    expect(en({ classes: ['7'], grade: '6-8' })).not.toMatch(/6-8/);
  });
});

describe('item 14 — English terms stay in Latin inside the Urdu report', () => {
  const html = ur();
  test('the eyebrow says quiz in Latin letters, never the transliteration', () => {
    expect(html).not.toMatch(/کوئز/);
    expect(html).toMatch(/quiz/);
  });
  test('no Urdu chrome string anywhere transliterates an English word into Urdu script', () => {
    const TRANSLITERATIONS = ['کوئز', 'لنک', 'گروپ', 'فارورڈ', 'رپورٹنگ', 'اسکور'];
    TRANSLITERATIONS.forEach((t) => expect(html).not.toMatch(new RegExp(t)));
  });
});

describe('item 12a — no forced translations in the Urdu chrome', () => {
  const html = ur();
  test('"کلاس اوسط" is gone — the calque had no linker and read as nothing', () => {
    expect(html).not.toMatch(/کلاس اوسط/);
    expect(html).toMatch(/کلاس کا اوسط/);
  });
  test('the roster heading does not use the masculine-marked "طالب علم"', () => {
    expect(html).not.toMatch(/طالب علم/);
  });
});

describe('item 12c — the guidance box is readable, and its parts are named for what they are', () => {
  const html = en();
  test('no gradient behind the text, and the box is not set in white on colour', () => {
    const box = /\.try\{([^}]*)\}/.exec(html);
    expect(box).not.toBeNull();
    expect(box[1]).not.toMatch(/linear-gradient/);
    expect(box[1]).not.toMatch(/color:#fff/);
  });
  test('the guidance text is dark ink on a light ground', () => {
    expect(html).toMatch(/\.try-text\{[^}]*color:#232735/);
  });
  test('each part is its own block with its own label', () => {
    expect((html.match(/class="try-part"/g) || []).length).toBe(3);
    expect((html.match(/class="try-label"/g) || []).length).toBe(3);
  });
  test('the three labels say what she does, not what the field is called', () => {
    expect(html).toMatch(/Where they got muddled/);
    expect(html).toMatch(/How to reteach it tomorrow/);
    expect(html).toMatch(/Ask this at the end/);
    expect(html).not.toMatch(/On the board/);
  });
  test('the secure/stretch pair is named as an action too, not "One to stretch them"', () => {
    const zero = en({ hardest: [], guidance: { secure: 'They can read a circuit diagram.', stretch: 'Give them a two-bulb loop and ask which bulb dims. They predict first, then you build it. Whoever was wrong explains what changed.' } });
    expect(zero).toMatch(/How to stretch them tomorrow/);
    expect(zero).not.toMatch(/One to stretch them/);
  });
  test('Urdu labels read as a teacher would say them, and the stretch one names the action', () => {
    const html2 = ur();
    expect(html2).toMatch(/بچے کہاں الجھے/);
    expect(html2).toMatch(/کل اسے دوبارہ کیسے پڑھائیں/);
    expect(html2).toMatch(/آخر میں یہ پوچھیں/);
    expect(html2).not.toMatch(/ایک اور آگے کا سوال/);
  });
});

/**
 * v26 G1 fixes (v25 review, bd-5jmnfj.4.57).
 * 1. English Q12 "This is a trophy." did not fit the 30%-wide box: a sentence slot prints its
 *    picture full width over a taller box (sentence_box).
 * 2. Q9/Q12/Q13 printed "(10)" for five 2-mark items under a legend of one mark each: a slot of
 *    2+ items worth 2+ each prints "(5×2=10)".
 * 3. Maths Q8 "Which is longer?" drew the two things unaligned: the lined-up rule fired only for
 *    "Which one is longer".
 * 4. Urdu Q6 drew a bed for کمرہ: the picture is the thing a child names with that word.
 * 5-6. The key printed «یہ بھی درست: بلی» under the answer بلی, and joined sentences with «؛».
 * 7. Urdu Q10 printed «تصویر کے بارے میں ایک جملہ لکھیں۔» under the same instruction five times:
 *    it is a picture and a sentence box, like English Q12.
 */
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const Kie = require('../../bot/shared/services/assessment/fde-picture-kie');
const { acceptText } = require('../../bot/shared/services/assessment/fde-accept-line');
const urdu = require('./fixtures/early/g1-urdu-exam.json');
const english = require('./fixtures/early/g1-english-exam.json');

const clone = (o) => JSON.parse(JSON.stringify(o));
const slotOf = (subject, id) => Patterns.subjectOf('fde_g1_2026', subject).sections.flatMap((s) => s.slots).find((s) => s.slot === id);
// A fresh paper: its layout carries today's pattern flags, as fde-layout copies them.
function fresh(exam, subject) {
  const e = clone(exam);
  (e._layout.sections || []).forEach((s) => (s.slots || []).forEach((sl) => {
    const p = slotOf(subject, sl.slot);
    if (p) ['picture_only', 'sentence_box', 'marks_line_en', 'marks_line_ur'].forEach((k) => { sl[k] = p[k]; });
  }));
  return e;
}
const cells = (html, id) => [...html.matchAll(new RegExp(`<div class="q([^"]*)" data-slot="${id.replace(/\./g, '\\.')}">`, 'g'))].map((m) => m[1]);
const headOf = (html, id) => {
  const at = html.indexOf(`data-slot="${id}"`);
  const head = html.lastIndexOf('<div class="slot-head">', at);
  return html.slice(head, html.indexOf('</div>', head));
};

const enHtml = R.renderPaper({ examJson: fresh(english, 'english'), grade: 1, subject: 'english', answerLines: true });
const urHtml = R.renderPaper({ examJson: fresh(urdu, 'urdu'), grade: 1, subject: 'urdu', answerLines: true });

describe('1. a sentence slot prints wide with a taller box', () => {
  test('English Q12 cells are wide picture cells', () => {
    const c = cells(enHtml, 'g1.english.C.Q12');
    expect(c.length).toBe(5);
    c.forEach((k) => expect(k).toMatch(/pic-cell wide/));
  });
  test('the wide cell spans the line and its box is three lines tall', () => {
    expect(enHtml).toMatch(/\.q\.pic-cell\.wide \{[^}]*width: 100%/);
    const at = enHtml.indexOf('data-slot="g1.english.C.Q12"');
    expect(enHtml.slice(at, at + 2000)).toMatch(/class="write-box" style="height:28mm"/);
  });
  test('control: a word slot (English Q7) keeps the narrow cell and 12mm box', () => {
    cells(enHtml, 'g1.english.B.Q7').forEach((k) => expect(k).not.toMatch(/wide/));
  });
});

describe('2. 2-mark items print their sum', () => {
  test('English Q12 reads (5×2=10)', () => {
    expect(headOf(enHtml, 'g1.english.C.Q12')).toMatch(/\(5×2=10\)/);
  });
  test('a 1-mark slot keeps (5)', () => {
    expect(slotOf('english', 'g1.english.B.Q7').marks_line_en).toBe('({t:9})');
  });
  test('Urdu Q10 reads 5×2=10 without brackets', () => {
    expect(slotOf('urdu', 'g1.urdu.B.Q10').marks_line_ur).toBe('{n:5}×2={t:10}');
  });
});

describe('3. "Which is longer?" lines the two things up', () => {
  test.each(['Which is longer?', 'Which one is longer?', 'Which is heavier?'])('%s compares', (question) => {
    expect(Kie.showOf({ picture: { kind: 'scene', describe: 'a pencil and a crayon' }, question, answer: 'the pencil' })).toMatchObject({ compare: true });
  });
});

describe('4. Urdu Q6 picture is the thing itself', () => {
  test('the rule forbids a room, place or anything named by another word', () => {
    const rule = slotOf('urdu', 'g1.urdu.B.Q6').prompt_rule;
    expect(rule).toMatch(/never a room or a place/i);
    expect(rule).toMatch(/another word/i);
  });
});

describe('5-6. the accept line', () => {
  test('drops the key itself, loosely', () => {
    expect(acceptText('بلی', ['بلی۔', 'بلّی'], 'ur')).toBe(''); // v27: a shadda is noise too
    expect(acceptText('(b) a cat', ['a cat', 'cat'], 'en')).toBe('cat');
    expect(acceptText('بلی', ['بلی'], 'ur')).toBe('');
  });
  test('joins sentences with a slash', () => {
    expect(acceptText('بچہ پڑھ رہا ہے۔', ['بچہ کتاب پڑھ رہا ہے۔', 'لڑکا پڑھ رہا ہے۔'], 'ur')).toBe('بچہ کتاب پڑھ رہا ہے۔ / لڑکا پڑھ رہا ہے۔');
  });
  test('control: words keep their separator', () => {
    expect(acceptText('cat', ['kitten', 'kitty'], 'en')).toBe('kitten; kitty');
    expect(acceptText('بلی', ['بلّی', 'پشی', 'میاؤں'], 'ur')).toBe('پشی؛ میاؤں');
  });
  test('the printed key never repeats the answer as an accept', () => {
    // The fixture's بطخ item accepts only بطخ.
    const key = R.renderMarkingScheme({ examJson: fresh(urdu, 'urdu'), grade: 1, subject: 'urdu', allowShort: true });
    expect(key).toMatch(/بطخ/);
    expect(key).not.toMatch(/یہ بھی درست: بطخ</);
  });
});

describe('7. Urdu Q10 is a picture and a sentence box', () => {
  test('no item repeats the instruction as its stem', () => {
    const at = urHtml.indexOf('data-slot="g1.urdu.B.Q10"');
    expect(urHtml.slice(at, urHtml.indexOf('</div></div>', at + 4000))).not.toMatch(/ایک جملہ لکھیں/);
  });
  test('its cells are wide', () => {
    const c = cells(urHtml, 'g1.urdu.B.Q10');
    expect(c.length).toBe(5);
    c.forEach((k) => expect(k).toMatch(/pic-cell wide/));
  });
});

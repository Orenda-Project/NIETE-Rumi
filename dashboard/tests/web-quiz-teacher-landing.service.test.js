/**
 * The teacher's own preview link opens a page styled for the teacher: the brand's teacher line
 * ("FOR TEACHERS" for NIETE), no mascot greeting the teacher like a child, and "Who played?" first.
 * Runs the whole shipped page (wq-page-harness).
 */
const { page } = require('./wq-page-harness');
const WebQuizBrand = require('../../bot/shared/config/web-quiz-brand');

const brand = WebQuizBrand.publicBrand('niete');

test('a child sees the child landing: the mascot hello and FOR STUDENTS', () => {
  const p = page({ lang: 'en', brand });
  expect(p.html()).toContain('FOR STUDENTS');
  expect(p.html()).toContain('play the quiz together');
});

test("the teacher's preview: FOR TEACHERS, no child greeting, Who played? is the main button", () => {
  const p = page({ lang: 'en', brand, preview: true, search: '?p=tok' });
  const h = p.html();
  expect(h).toContain('FOR TEACHERS');
  expect(h).not.toContain('FOR STUDENTS');
  expect(h).not.toContain('play the quiz together');
  expect(h).not.toMatch(/class="wq-jug/);
  expect(h).toMatch(/<button class="wq-btn wq-go" id="wq-whoplayed">Who played\?<\/button>/);
  expect(h).toContain('Try it as a child');
});

test("Urdu: the teacher's preview is addressed to the teacher", () => {
  const p = page({ lang: 'ur', brand, preview: true, search: '?p=tok' });
  expect(p.html()).toContain('استاد کے لیے');
  expect(p.html()).toContain('FOR TEACHERS');
});

test('Rumi keeps its own line on the teacher page (no FOR TEACHERS of NIETE)', () => {
  const p = page({ lang: 'en', brand: WebQuizBrand.publicBrand('rumi'), preview: true, search: '?p=tok' });
  expect(p.html()).not.toContain('FOR TEACHERS');
  expect(p.html()).toContain('QUIZ');
});

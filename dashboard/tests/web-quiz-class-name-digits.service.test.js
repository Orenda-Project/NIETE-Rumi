/**
 * The class's name on an URDU child page is drawn with Urdu digits, like the score beside it («۲/۵»): the server's
 * label (web-quiz.service.js classLabel → the report's className) is shared with the teacher's report and stays Latin,
 * so the page converts it where it draws it — the quiz landing's "from" line (today's and the name-first landing's) and
 * the score card's header. A Latin label («3-B», drawn as a Latin isolate) and an English page draw the label exactly as
 * sent (golden: fixtures/class-name-digits-en.golden.json, written on the base).
 * The shipped wq.js runs in a vm; only the browser is faked. Invented class and teacher only.
 */
const fs = require('fs');
const path = require('path');
const { page } = require('./wq-page-harness');

const BRAND = { name: 'NIETE', mark: { tile: true, svg: '<svg></svg>' }, label: { en: 'NIETE', ur: 'NIETE' }, sub: { en: 'QUIZ', ur: 'کوئز' } };
const UR_CLS = { label: 'جماعتیں 1، 3، 5', teacher: 'Ms Testwala', chips: [] };
const EN_CLS = { label: 'Classes 1, 3, 5', teacher: 'Ms Testwala', chips: [] };
const RESULT = { card: { first: 'Zara Testwala', animal: 'owl', correct: 2, total: 5, stars: 2 }, challenge_code: 'CHAL12', score: { correct: 2, total: 5 } };
const finished = () => ({ wq_s_TEST: { st: 's1', child: { first: 'Zara Testwala', chip: 'c1', animal: 'owl' }, answers: {}, queue: [], result: RESULT } });
const text = (h) => h.replace(/<[^>]+>/g, '').replace(/[⁦-⁩ ]/g, (c) => (c === ' ' ? ' ' : ''));
const subOf = (p) => text((p.html().match(/<p class="wq-sub">[\s\S]*?<\/p>/) || [''])[0]);
const headerOf = (p) => text((p.html().match(/<header>[\s\S]*?<\/header>/) || [''])[0]);

describe('the quiz landing (M3): the class in the "from" line', () => {
  test('Urdu: «جماعتیں ۱، ۳، ۵», no Latin digit left', () => {
    const p = page({ lang: 'ur', cls: UR_CLS, brand: BRAND });
    expect(p.moment()).toBe('M3');
    expect(subOf(p)).toContain('جماعتیں ۱، ۳، ۵');
    expect(subOf(p)).not.toMatch(/[0-9]/);
  });
  test('English: the label exactly as sent', () => {
    const p = page({ lang: 'en', cls: EN_CLS, brand: BRAND });
    expect(subOf(p)).toBe('From Ms Testwala · Classes 1, 3, 5');
  });
});

describe('the name-first landing (identity v2, wq-identity.js): the same "from" line', () => {
  const V2 = (cls) => ({ ...cls, identity: { mode: 'v2', class: { state: 'known', label: cls.label, ask: null }, roster: true, invited: false } });
  test('Urdu: «جماعتیں ۱، ۳، ۵»', () => {
    const p = page({ lang: 'ur', cls: V2(UR_CLS), brand: BRAND, ident: true });
    expect(p.moment()).toBe('M4-who-v2');
    expect(subOf(p)).toContain('جماعتیں ۱، ۳، ۵');
    expect(subOf(p)).not.toMatch(/[0-9]/);
  });
  test('English: the label exactly as sent', () => {
    const p = page({ lang: 'en', cls: V2(EN_CLS), brand: BRAND, ident: true });
    expect(subOf(p)).toBe('From Ms Testwala · Classes 1, 3, 5');
  });
});

describe('a Latin label on an Urdu page («3-B») is kept as sent', () => {
  test('the landing and the card header keep «3-B»', () => {
    const cls = { label: '3-B', teacher: 'Ms Testwala', chips: [] };
    expect(subOf(page({ lang: 'ur', cls, brand: BRAND }))).toContain('3-B');
    expect(headerOf(page({ lang: 'ur', cls, brand: BRAND, store: finished() }))).toContain('3-B');
  });
});

describe('the score card (M10): the header beside the score', () => {
  test('Urdu: «NIETE · جماعتیں ۱، ۳، ۵»', () => {
    const p = page({ lang: 'ur', cls: UR_CLS, brand: BRAND, store: finished() });
    expect(p.moment()).toBe('M10');
    expect(headerOf(p)).toBe('NIETE · جماعتیں ۱، ۳، ۵');
  });
  test('English: «NIETE · Classes 1, 3, 5»', () => {
    const p = page({ lang: 'en', cls: EN_CLS, brand: BRAND, store: finished() });
    expect(headerOf(p)).toBe('NIETE · Classes 1, 3, 5');
  });
});

describe('English pages are untouched', () => {
  test('GOLDEN: the English landing and score card are today\'s, byte for byte', () => {
    const got = JSON.stringify({
      landing: page({ lang: 'en', cls: EN_CLS, brand: BRAND }).html(),
      card: page({ lang: 'en', cls: EN_CLS, brand: BRAND, store: finished() }).html(),
    });
    const file = path.join(__dirname, 'fixtures', 'class-name-digits-en.golden.json');
    // Recorded once from the base code; to re-record, write `${got}\n` to `file` by hand for one run.
    expect(got).toBe(fs.readFileSync(file, 'utf8').trimEnd());
  });
});

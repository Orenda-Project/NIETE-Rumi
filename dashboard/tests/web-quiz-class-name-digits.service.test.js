/**
 * With app_settings web_quiz_ur_class_digits on (JSON `true` only; boot `ur_class_digits: true`), the class's name on
 * an URDU child page is drawn with Urdu digits, like the score beside it («۲/۵»): the server's
 * label (web-quiz.service.js classLabel → the report's className) is shared with the teacher's report and stays Latin,
 * so the page converts it where it draws it — the quiz landing's "from" line (today's and the name-first landing's) and
 * the score card's header. A Latin label («3-B», drawn as a Latin isolate) and an English page draw the label exactly as
 * sent (golden: fixtures/class-name-digits-en.golden.json, written on the base). With the switch off (absent, false, a
 * string "true"), the Urdu landing, picker, league heading and card header are the base's, byte for byte
 * (golden: fixtures/class-name-digits-ur-off.golden.json, written on the base).
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
// The switch, as the server names it in the quiz payload when app_settings web_quiz_ur_class_digits is JSON true.
const ON = { ur_class_digits: true };
const flush = () => new Promise((r) => setImmediate(r));

describe('the quiz landing (M3): the class in the "from" line', () => {
  test('Urdu: «جماعتیں ۱، ۳، ۵», no Latin digit left', () => {
    const p = page({ lang: 'ur', cls: UR_CLS, brand: BRAND, bootExtra: ON });
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
    const p = page({ lang: 'ur', cls: V2(UR_CLS), brand: BRAND, ident: true, bootExtra: ON });
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
    expect(subOf(page({ lang: 'ur', cls, brand: BRAND, bootExtra: ON }))).toContain('3-B');
    expect(headerOf(page({ lang: 'ur', cls, brand: BRAND, store: finished(), bootExtra: ON }))).toContain('3-B');
  });
});

describe('the score card (M10): the header beside the score', () => {
  test('Urdu: «NIETE · جماعتیں ۱، ۳، ۵»', () => {
    const p = page({ lang: 'ur', cls: UR_CLS, brand: BRAND, store: finished(), bootExtra: ON });
    expect(p.moment()).toBe('M10');
    expect(headerOf(p)).toBe('NIETE · جماعتیں ۱، ۳، ۵');
  });
  test('English with the switch on: the label exactly as sent', () => {
    expect(headerOf(page({ lang: 'en', cls: EN_CLS, brand: BRAND, store: finished(), bootExtra: ON }))).toBe('NIETE · Classes 1, 3, 5');
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
  test('GOLDEN: with app_settings web_quiz_ur_class_digits on, the English landing and score card are still today\'s', () => {
    const got = JSON.stringify({
      landing: page({ lang: 'en', cls: EN_CLS, brand: BRAND, bootExtra: { ur_class_digits: true } }).html(),
      card: page({ lang: 'en', cls: EN_CLS, brand: BRAND, store: finished(), bootExtra: { ur_class_digits: true } }).html(),
    });
    expect(got).toBe(fs.readFileSync(path.join(__dirname, 'fixtures', 'class-name-digits-en.golden.json'), 'utf8').trimEnd());
  });
});

// The Urdu screens that draw the class's name: the landing (today's and name-first), the class picker, the name
// picker's "in <class>" line, the league heading and the score card's header.
const UR_G = { ...UR_CLS, teacher: 'Ms Teacher' };
const PICK_CLS = { ...UR_G, roster: { lists: 2, classes: [{ key: 'k1', label: 'جماعت 4' }, { key: 'k2', label: '4-B' }] } };
const CHIP_CLS = { ...UR_G, chips: [{ chip: 'c1', first: 'Testchild', animal: 'owl' }] };
const V2_UR = { ...UR_G, identity: { mode: 'v2', class: { state: 'known', label: UR_G.label, ask: null }, roster: true, invited: false } };
const doneG = () => ({ wq_s_TEST: { st: 's1', child: { first: 'Testchild', chip: 'c1', animal: 'owl' }, answers: {}, queue: [], result: { ...RESULT, card: { ...RESULT.card, first: 'Testchild' } } } });
const BOARD = { finishers_n: 3, class_avg_pct: 50, rows: [{ place: 1, first: 'Testchild', animal: 'owl', correct: 2, total: 5 }], more_n: 0 };
async function urScreens(extra) {
  const at = (o, go) => { const p = page({ lang: 'ur', brand: BRAND, bootExtra: extra, ...o }); if (go) go(p); return p; };
  const league = at({ cls: UR_G, board: BOARD }, (p) => p.wq.board());
  await flush(); await flush();
  return JSON.stringify({
    landing: at({ cls: UR_G }).html(),
    landingV2: at({ cls: V2_UR, ident: true }).html(),
    picker: at({ cls: PICK_CLS }, (p) => p.wq.who()).html(),
    names: at({ cls: CHIP_CLS }, (p) => p.wq.who()).html(),
    league: league.html(),
    card: at({ cls: UR_G, store: doneG() }).html(),
  });
}
const UR_OFF_GOLDEN = path.join(__dirname, 'fixtures', 'class-name-digits-ur-off.golden.json');

describe('app_settings web_quiz_ur_class_digits OFF: the Urdu pages are the base\'s', () => {
  // Recorded once from the base code (no switch existed); to re-record, write `${got}\n` to the file by hand for one run.
  test.each([['absent', {}], ['false', { ur_class_digits: false }], ['a string "true"', { ur_class_digits: 'true' }], ['1', { ur_class_digits: 1 }]])(
    'GOLDEN (%s): landing, name-first landing, class picker, name picker, league heading, card header byte for byte', async (_, extra) => {
      expect(await urScreens(extra)).toBe(fs.readFileSync(UR_OFF_GOLDEN, 'utf8').trimEnd());
    });
  test('off: the landing keeps the label\'s Latin digits', () => {
    expect(subOf(page({ lang: 'ur', cls: UR_CLS, brand: BRAND }))).toContain('جماعتیں 1، 3، 5');
  });
});

describe('app_settings web_quiz_ur_class_digits ON: every Urdu screen that names the class takes Urdu digits', () => {
  test('the class picker, the name picker and the league heading', async () => {
    const picker = page({ lang: 'ur', cls: PICK_CLS, brand: BRAND, bootExtra: ON }); picker.wq.who();
    expect(picker.html()).toContain('جماعت ۴');
    expect(picker.html()).toContain('4-B');
    const names = page({ lang: 'ur', cls: CHIP_CLS, brand: BRAND, bootExtra: ON }); names.wq.who();
    expect(names.html()).toContain('جماعتیں ۱، ۳، ۵ میں اپنا نام ڈھونڈیں');
    const league = page({ lang: 'ur', cls: UR_CLS, brand: BRAND, board: BOARD, bootExtra: ON }); league.wq.board();
    await flush(); await flush();
    expect(league.html()).toContain('<h2>جماعتیں ۱، ۳، ۵ کی لیگ ٹیبل</h2>');
  });
  test('a label with an Urdu letter in brackets keeps it, unbroken: «جماعت ۳ (ب)»', () => {
    const p = page({ lang: 'ur', cls: { ...UR_G, label: 'جماعت 3 (ب)' }, brand: BRAND, bootExtra: ON });
    expect(p.html()).toContain('جماعت\u00A0۳\u00A0(ب)');
    expect(page({ lang: 'ur', cls: { ...UR_G, label: 'جماعت 3 (ب)' }, brand: BRAND }).html()).toContain('جماعت\u00A03\u00A0(ب)');
  });
  test('on differs from the golden off only where the class is named', async () => {
    const on = await urScreens(ON);
    const off = fs.readFileSync(UR_OFF_GOLDEN, 'utf8').trimEnd();
    expect(on).not.toBe(off);
    // The class's name back to Latin digits (the score's Urdu digits are the base's and stay): then the two are one.
    const latin = (m) => m.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
    expect(on.replace(/(?:جماعتیں|جماعت)[\s\u00a0۰-۹،]+/g, latin)).toBe(off);
  });
});

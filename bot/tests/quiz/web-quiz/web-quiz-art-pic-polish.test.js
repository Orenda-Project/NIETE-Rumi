'use strict';
/**
 * The share-picture polish (app_settings web_quiz_share_pic_polish, default OFF; on only as JSON true). With it on:
 *   - the class table: the child's own row keeps its "(me)" label whole and shortens the NAME instead (it read "<name> (");
 *     the rows are 60% of the square's width (they were sized to their words, about a third of it) with larger text; the
 *     English square is one centred stack like the Urdu one (no empty band between the average and the pill);
 *   - the Urdu challenge (and the friend's door): the headline names the child, so the sub line does not name them again;
 *     it is the quiz's title, kept on one line (no break inside the title);
 *   - the English challenge headline breaks into balanced lines, the score held to the name ("<name>'s 3/8?" never leaves
 *     "3/8?" alone), one size step down when it would need more than 2 lines.
 * The card picture and the school picture never change; off, every HTML and every input is the base's (hashes recorded
 * on the base in __golden__/web-quiz-art-pic-polish-off.json).
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../shared/storage/r2', () => ({ downloadFromR2: jest.fn(), uploadBuffer: jest.fn(), headObject: jest.fn() }));
jest.mock('../../../shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));

const sharp = require('sharp');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const r2 = require('../../../shared/storage/r2');
const { htmlToImage } = require('../../../shared/utils/html-to-pdf');
const { renderArt } = require('../../../shared/templates/web-quiz-art.template');
const Input = require('../../../shared/services/quiz/web-quiz-art-input');
const { cases, sha, LIVE, LONG, LATIN } = require('./__golden__/pic-polish-cases');
const GOLDEN = require('./__golden__/web-quiz-art-pic-polish-off.json');

const NB = ' ';
const ON = { ...LIVE, us: true, pp: true };
const BASE = { ...LIVE, us: true };
const art = (kind, size, lang, d, ui, door) => renderArt({ kind, size, brand: 'niete', lang, d, ui, door }, { fonts: false, pictures: false });
const css = (h) => h.slice(h.indexOf('<style>'), h.indexOf('</style>'));
const ANI = ['cat', 'turtle', 'parrot', 'owl', 'dog', 'fish', 'lion', 'bee', 'horse', 'rabbit'];
const rows = (n, at, first) => Array.from({ length: n }, (_, i) => ({ place: i + 1, animal: ANI[i % 10], correct: 7 - Math.min(6, Math.floor(i / 2)), total: 7, ...(i === at ? { me: true, first } : {}) }));
const cls = (lang, n, at, first) => ({ topic: lang === 'ur' ? 'ضمیر کی دُہرائی' : 'Parts of a plant', cls: '', played: 18, avgPct: 43, top: { correct: 7, total: 7 }, rows: rows(n, at, first) });
const lis = (h) => Array.from(h.matchAll(/<li class="([^"]*)"/g), (m) => m[1]);
const px = (c, rx) => Number((rx.exec(c) || [])[1]);
const POS = (n) => [['first', 0], ['middle', Math.floor(n / 2)], ['last', n - 1]];
const SHORT = 'Iqra Testwala';
const ME = { en: 'me', ur: 'میں' };

describe('the class table, switch on', () => {
  for (const size of ['sq', 'og']) for (const lang of ['en', 'ur']) for (const first of [SHORT, LATIN]) for (const n of [3, 6, 10]) {
    test(`${size} ${lang} "${first}" ${n} rows: the child's row is always drawn, its label whole beside a name that shortens`, () => {
      for (const [, at] of POS(n)) {
        const h = art('class', size, lang, cls(lang, n, at, first), ON);
        const l = lis(h);
        expect(l).toContain('me');
        // a «…» row stands for the rows left out before the child's own
        if (l.indexOf('me') !== at) expect(l[l.indexOf('me') - 1]).toBe('gap');
        // the name is its own box that may shorten; the label is a box of its own after it, never cut
        expect(h).toContain(`<span class="who"><bdi class="nm" dir="ltr">${first}</bdi><small>(${ME[lang]})</small></span>`);
      }
    });
  }
  // an Urdu name of one long word on the Urdu picture ran under the score: «… محمدعبدالرحمان (۳/۷», its «(میں)» lost
  for (const size of ['sq', 'og']) for (const n of [3, 6, 10]) {
    test(`${size} ur «${LONG}» ${n} rows: «(میں)» whole, the name shortens before the score column, never under it`, () => {
      for (const [, at] of POS(n)) {
        const h = art('class', size, 'ur', cls('ur', n, at, LONG), ON);
        expect(lis(h)).toContain('me');
        expect(h).toContain(`<span class="who"><bdi class="nm" dir="rtl">${LONG}</bdi><small>(میں)</small></span>`);
        const c = css(h);
        expect(c).toMatch(/\.crow \.who\{display:flex;[^}]*min-width:0/);
        expect(c).toMatch(/\.crow \.sc\{flex:0 0 auto/);
        expect(c).toMatch(/\.crow \.who \.nm\{[^}]*text-overflow:ellipsis/);
      }
    });
  }
  test.each([['sq'], ['og']])('%s: the name gives up its width (an ellipsis), the label never does', (size) => {
    const c = css(art('class', size, 'en', cls('en', 6, 5, LATIN), ON));
    expect(c).toMatch(/\.crow \.who\{display:flex;[^}]*min-width:0/);
    expect(c).toMatch(/\.crow \.who \.nm\{[^}]*flex:0 1 auto;[^}]*min-width:0;[^}]*overflow:hidden;[^}]*text-overflow:ellipsis;[^}]*white-space:nowrap/);
    expect(c).toMatch(/\.crow \.who small\{flex:0 0 auto/);
  });
  test.each([['en'], ['ur']])('square %s: the rows are 60%% of the picture (648 px) and their text grows with them', (lang) => {
    const base = css(art('class', 'sq', lang, cls(lang, 6, 2, SHORT), BASE));
    const c = css(art('class', 'sq', lang, cls(lang, 6, 2, SHORT), ON));
    expect(c).toMatch(/\.crow\{width:648px;/);
    const was = px(base, /\.crow li\{display:flex;[^}]*font-size:(\d+)px/);
    const now = px(c, /\.crow li\{font-size:(\d+)px/);
    expect(was).toBe(37);
    expect(now).toBeGreaterThanOrEqual(Math.round(was * 1.35));
  });
  test.each([['en'], ['ur']])('wide %s: the rows keep the column\'s width and their text grows', (lang) => {
    const c = css(art('class', 'og', lang, cls(lang, 6, 2, SHORT), ON));
    expect(px(c, /\.crow li\{font-size:(\d+)px/)).toBeGreaterThanOrEqual(32);
  });
  test('English square: one centred stack, 24 px between title, count, rows, average and pill (no empty band)', () => {
    const c = css(art('class', 'sq', 'en', cls('en', 3, 0, SHORT), ON));
    expect(c).toContain('.main{flex:0 0 auto}.art{gap:24px;justify-content:center}');
    expect(c).toMatch(/\.main\{gap:24px\}/);
    expect(c).toContain('.cta{margin:0}');
  });
  test('the square keeps the class average line; the wide picture keeps it in its title line', () => {
    expect(art('class', 'sq', 'en', cls('en', 10, 9, SHORT), ON)).toContain('<p class="sub">Class average <span class="num">43%</span></p>');
    expect(art('class', 'og', 'en', cls('en', 10, 9, SHORT), ON)).toContain('Class average <span class="num">43%</span></p><h1');
  });
});

describe('the Urdu challenge, switch on', () => {
  const TITLE = 'تفہیم - مکالمے کو سمجھنا';
  const inv = (first, topic = TITLE, correct = 4) => ({ first, correct, total: 7, topic });
  for (const size of ['sq', 'og']) for (const door of [false, true]) for (const first of ['Iqra Testwala', LONG, LATIN]) {
    test(`${size}${door ? ' door' : ''} "${first}": the headline names the child, the sub line is the quiz title on one line`, () => {
      const h = art('invite', size, 'ur', inv(first), ON, door);
      const head = /<h1 class="head">(.*?)<\/h1>/.exec(h)[1];
      const sub = /<p class="sub">(.*?)<\/p>/.exec(h)[1];
      expect(head).toContain(`>${first}</bdi>`);
      expect(sub).not.toContain(first);
      expect(sub).toBe(`<bdi dir="rtl">${TITLE.replace(/ /g, NB)}</bdi>`);
    });
  }
  test('a title too long for one line even a size down: it keeps its spaces (it may break), never runs off the picture', () => {
    const long = 'تفہیم - مکالمے کو سمجھنا اور کہانی کے کرداروں کی باتوں کو غور سے سننا اور سمجھنا';
    const sub = /<p class="sub">(.*?)<\/p>/.exec(art('invite', 'sq', 'ur', inv(LONG, long), ON))[1];
    expect(sub).toBe(`<bdi dir="rtl">${long}</bdi>`);
  });
  test('a title a little too long is set a step smaller to stay on its line', () => {
    const mid = 'تفہیم - مکالمے کو سمجھنا اور کہانی کے کرداروں کی باتیں سننا';
    const h = art('invite', 'og', 'ur', inv(LONG, mid), ON);
    expect(h).toContain(`<p class="sub"><bdi dir="rtl">${mid.replace(/ /g, NB)}</bdi></p>`);
    expect(px(css(h), /\.sub\{font-size:(\d+)px;white-space:nowrap\}/)).toBeLessThan(32);
  });
  test('the headline, stars and pill are the base\'s (only the sub line changes)', () => {
    for (const size of ['sq', 'og']) for (const door of [false, true]) {
      const strip = (h) => h.replace(/<p class="sub">.*?<\/p>/, '').replace(/\n\/\* The polish[^]*?<\/style>/, '</style>');
      expect(strip(art('invite', size, 'ur', inv(LONG), ON, door))).toBe(strip(art('invite', size, 'ur', inv(LONG), BASE, door)));
    }
  });
});

describe('the English challenge headline, switch on', () => {
  const inv = (first, correct = 3) => ({ first, correct, total: 8, topic: 'Rocket and Space Vocabulary' });
  test.each([['sq'], ['og']])('%s: balanced lines, the score held to the name', (size) => {
    const h = art('invite', size, 'en', inv('Iqra Testwala'), ON);
    expect(h).toContain(`Can you beat <bdi dir="ltr">Iqra Testwala</bdi>'s${NB}<span class="num">3/8</span>?`);
    expect(css(h)).toMatch(/\.head\{font-size:\d+px;text-wrap:balance\}/);
    // a zero score: "challenged you!" stays together
    expect(art('invite', size, 'en', inv('Iqra Testwala', 0), ON)).toContain(`<bdi dir="ltr">Iqra Testwala</bdi> challenged${NB}you!`);
  });
  test('a long name: one size step down rather than a third line', () => {
    const base = px(css(art('invite', 'og', 'en', inv('Iqra Testwala'), ON)), /\.head\{font-size:(\d+)px;text-wrap:balance\}/);
    const long = px(css(art('invite', 'og', 'en', inv(LATIN), ON)), /\.head\{font-size:(\d+)px;text-wrap:balance\}/);
    expect(base).toBe(58);
    expect(long).toBeLessThan(base);
    expect(long).toBeGreaterThanOrEqual(Math.round(base * 0.7));
  });
});

describe('the English challenge, switch on: the sub line and the square\'s stack', () => {
  const TITLE = 'Rocket and Space Vocabulary';
  const inv = (first, correct = 3, topic = TITLE) => ({ first, correct, total: 8, topic });
  for (const size of ['sq', 'og']) for (const first of ['Iqra Testwala', LONG, LATIN]) {
    test(`${size} "${first}": the headline names the child, the sub line is the quiz title on one line`, () => {
      const h = art('invite', size, 'en', inv(first), ON);
      const head = /<h1 class="head">(.*?)<\/h1>/.exec(h)[1];
      const sub = /<p class="sub">(.*?)<\/p>/.exec(h)[1];
      expect(head).toContain(`>${first}</bdi>`);
      expect(sub).not.toContain(first);
      expect(sub).toBe(`<bdi dir="ltr">${TITLE.replace(/ /g, NB)}</bdi>`);
      // the stars still follow the sub line
      expect(h).toMatch(/<\/p><div class="stars">/);
    });
  }
  test('a title too long for one line even a size down keeps its spaces', () => {
    const long = 'Rocket and Space Vocabulary: planets, moons, stars and the people who travel between them';
    expect(/<p class="sub">(.*?)<\/p>/.exec(art('invite', 'og', 'en', inv('Iqra Testwala', 3, long), ON))[1]).toBe(`<bdi dir="ltr">${long}</bdi>`);
  });
  test('square: one centred stack, 24 px between the lines and the pill (no empty band above the pill)', () => {
    const c = css(art('invite', 'sq', 'en', inv('Iqra Testwala'), ON));
    expect(c).toContain('.main{gap:24px}.main{flex:0 0 auto}.art{gap:24px;justify-content:center}.cta{margin:0}');
    expect(c).toContain('.side{flex:0 1 190px;min-height:96px}');
    // the wide picture keeps its two columns
    expect(css(art('invite', 'og', 'en', inv('Iqra Testwala'), ON))).not.toContain('.art{gap:24px;justify-content:center}');
  });
});

describe('the Urdu class table, switch on: the child\'s row uses its neighbours\' digits', () => {
  const ranks = (h) => Array.from(h.matchAll(/<span class="rk">(.*?)<\/span>/g), (m) => m[1].replace(/<[^>]+>/g, ''));
  const scores = (h) => Array.from(h.matchAll(/<span class="sc">(.*?)<\/span>/g), (m) => m[1].replace(/<[^>]+>/g, ''));
  const URD = /^[\u06F0-\u06F9/]+$/;
  const LAT = /^[0-9/]+$/;
  for (const size of ['sq', 'og']) for (const n of [3, 6, 10]) {
    test(`${size} ${n} rows: Urdu digits on every row with the digits switch on, Western on every row with it off`, () => {
      for (const [, at] of POS(n)) {
        const on = art('class', size, 'ur', cls('ur', n, at, LONG), ON);
        expect([...ranks(on), ...scores(on)].every((x) => URD.test(x))).toBe(true);
        const off = art('class', size, 'ur', cls('ur', n, at, LONG), { ...ON, ud: false });
        expect([...ranks(off), ...scores(off)].every((x) => LAT.test(x))).toBe(true);
      }
    });
  }
});

describe('what the switch never changes', () => {
  test('the card and school pictures, both languages and sizes', () => {
    for (const size of ['sq', 'og']) for (const lang of ['en', 'ur']) {
      const card = { first: LONG, animal: 'cat', correct: 4, total: 7, topic: 'کسور', cls: '', school: 'School Alpha', added: 18 };
      expect(art('card', size, lang, card, ON)).toBe(art('card', size, lang, card, BASE));
      const sch = { rows: [{ rank: 1, name: 'School Alpha', sector: '', points: 10, kids: 2, move: 0, you: true }] };
      expect(art('school', size, lang, sch, ON)).toBe(art('school', size, lang, sch, BASE));
    }
  });
  test('a class picture with no rows (the tiles)', () => {
    for (const size of ['sq', 'og']) for (const lang of ['en', 'ur']) {
      const d = { topic: 'کسور', cls: '', played: 5, of: 9, avgPct: 64, rows: [] };
      expect(art('class', size, lang, d, ON)).toBe(art('class', size, lang, d, BASE));
    }
  });
});

describe('switch off: exactly the base (hashes recorded on the base)', () => {
  const OFFS = [['absent', {}], ['false', { pp: false }], ['the string "true"', { pp: 'true' }], ['1', { pp: 1 }]];
  const all = cases();
  test.each(OFFS)('pp %s: every case draws the base HTML and has the base input', (_n, off) => {
    expect(all.length).toBe(Object.keys(GOLDEN.html).length);
    for (const c of all) {
      const ui = c.ui || Object.keys(off).length ? { ...(c.ui || {}), ...off } : c.ui;
      const html = sha(renderArt({ kind: c.kind, size: c.size, brand: 'niete', lang: c.lang, d: c.d, ui, door: c.door }, { fonts: false, pictures: false }));
      const input = sha(JSON.stringify(Input.artInput(c.kind, c.size, 'niete', { lang: c.lang, d: c.d }, ui, c.door)));
      expect([c.key, html, input]).toEqual([c.key, GOLDEN.html[c.key], GOLDEN.input[c.key]]);
    }
  });
  test('on: the polish rides in the input with its own version (a new key)', () => {
    const f = { lang: 'en', d: { first: 'Iqra Testwala' } };
    expect(Input.artInput('invite', 'sq', 'niete', f, { pp: true }).ui).toEqual({ pp: true, pv: Input.ART_PP_V });
    expect(Input.artInput('class', 'sq', 'niete', f, ON).ui).toMatchObject({ pp: true, pv: Input.ART_PP_V, us: true });
  });
});

describe('served: the switch in the card switches\' one read', () => {
  const SID = '0f8e2c1a-1b2c-4d5e-8f90-a1b2c3d4e5f6';
  const seed = (lang, settings) => {
    const now = Date.now();
    return {
      quiz_share_codes: [
        { id: 'sc-1', code: 'CLS001', quiz_id: 'qz-1', teacher_user_id: 't-1', topic: 'Fractions', language: lang, active: true },
        { id: 'sc-ch', code: 'CHAL01', quiz_id: 'qz-1', teacher_user_id: 't-1', topic: 'Fractions', language: lang, active: true, invited_by_student_id: 'st-1', parent_share_code_id: 'sc-1' },
      ],
      quizzes: [{ id: 'qz-1', topic: 'Fractions', grade: '3', subject: 'Maths', language: lang, meta: {} }],
      students: [{ id: 'st-1', student_name: 'Amal Testwala' }, { id: 'st-2', student_name: 'Zarvish Testwala' }],
      quiz_sessions: [
        { id: SID, quiz_id: 'qz-1', student_id: 'st-1', student_name: 'Amal Testwala', share_code_id: 'sc-1', status: 'completed', correct_answers: 7, total_questions_answered: 8, mastery_percentage: 88, completed_at: new Date(now - 60000).toISOString(), created_at: new Date(now - 300000).toISOString() },
        { id: 's-2', quiz_id: 'qz-1', student_id: 'st-2', student_name: 'Zarvish Testwala', share_code_id: 'sc-1', status: 'completed', correct_answers: 8, total_questions_answered: 8, mastery_percentage: 100, completed_at: new Date(now - 30000).toISOString(), created_at: new Date(now - 200000).toISOString() },
      ],
      app_settings: settings,
      users: [{ id: 't-1', school_id: 'SA' }],
      schools: [{ id: 'SA', name: 'School Alpha', region: 'Sector One', is_active: true, is_probable_test: false }],
    };
  };
  let Art;
  let fake;
  async function drawn(kind, ref, lang, settings) {
    fake = makeFake(seed(lang, settings));
    Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
    require('../../../shared/services/quiz/web-quiz-card-switch')._reset();
    require('../../../shared/services/quiz/web-quiz-ur-polish')._reset();
    require('../../../shared/services/quiz/web-quiz-schools')._reset();
    Art._resetCache();
    htmlToImage.mockClear();
    const out = await Art.artImage(Art.artId(kind, ref), { size: 'sq' });
    return { key: out.key, html: htmlToImage.mock.calls[0][0] };
  }
  beforeEach(() => {
    process.env.INTERNAL_API_KEY = 'art-key';
    delete process.env.WEB_QUIZ_TOKEN_SECRET;
    Art = require('../../../shared/services/quiz/web-quiz-art');
    r2.downloadFromR2.mockReset().mockRejectedValue(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }));
    r2.uploadBuffer.mockReset().mockResolvedValue('https://r2/x');
    r2.headObject.mockReset().mockResolvedValue({ exists: false });
    htmlToImage.mockReset().mockImplementation(async (h, o) => sharp({ create: { width: o.width, height: o.height || o.width, channels: 3, background: '#333748' } }).png().toBuffer());
  });
  const PP = [{ key: 'web_quiz_share_pic_polish', value: true }];
  test.each([['l', SID, 'en'], ['l', SID, 'ur'], ['i', 'CHAL01', 'en'], ['i', 'CHAL01', 'ur']])('on: the %s picture (%s, %s) is drawn polished under a new key', async (kind, ref, lang) => {
    const off = await drawn(kind, ref, lang, []);
    const on = await drawn(kind, ref, lang, PP);
    expect(off.html).not.toContain('/* The polish');
    expect(on.html).toContain('/* The polish');
    expect(on.key).not.toBe(off.key);
  });
  test('on: the card picture keeps its key and its HTML', async () => {
    const off = await drawn('c', SID, 'en', []);
    const on = await drawn('c', SID, 'en', PP);
    expect(on.key).toBe(off.key);
    expect(on.html).toBe(off.html);
  });
  test.each([['false', false], ['the string "true"', 'true'], ['1', 1]])('the key %s: today\'s key and HTML', async (_n, value) => {
    for (const [kind, ref] of [['l', SID], ['i', 'CHAL01']]) {
      const today = await drawn(kind, ref, 'ur', []);
      const off = await drawn(kind, ref, 'ur', [{ key: 'web_quiz_share_pic_polish', value }]);
      expect(off.key).toBe(today.key);
      expect(off.html).toBe(today.html);
    }
  });
  test('the key is read in the card switches\' one settings read, never a read of its own', async () => {
    const Card = require('../../../shared/services/quiz/web-quiz-card-switch');
    expect(Card.PIC_POLISH_KEY).toBe('web_quiz_share_pic_polish');
    fake = makeFake(seed('en', PP));
    const reads = [];
    const from = fake.from;
    Object.assign(supabase, { from: (t) => { const q = from(t); if (t === 'app_settings') { const inF = q.in.bind(q); q.in = (col, keys) => { reads.push(keys); return inF(col, keys); }; } return q; } });
    Card._reset();
    await Card.on();
    expect(reads.length).toBe(1);
    expect(reads[0]).toContain('web_quiz_share_pic_polish');
    expect(reads[0]).toContain('web_quiz_share_ur_stack');
    expect(Card.picPolishCached()).toBe(true);
    for (const value of [false, 'true', 1]) {
      fake = makeFake(seed('en', [{ key: 'web_quiz_share_pic_polish', value }]));
      Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
      Card._reset();
      await Card.on();
      expect(Card.picPolishCached()).toBe(false);
    }
  });
});

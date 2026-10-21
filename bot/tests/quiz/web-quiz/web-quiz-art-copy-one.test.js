'use strict';
/**
 * One child, one star, one kid (app_settings web_quiz_share_copy_one, default OFF; on only as JSON true). With it on:
 *   - the class table picture: «۱ بچے نے کھیلا» (and «۱۰ میں سے ۱ بچے نے کھیلا»), never «۱ بچوں نے کھیلا»;
 *   - the school picture: "1 kid" / «۱ بچہ», never "1 kids" / «۱ بچے»;
 *   - the Urdu class table picture: a long name cut to its own box («محمد عبدالر…» then «(میں)» right after it), not a
 *     cut that leaves the rest of its box empty before «(میں)» (EL-1). The English picture never changes for it.
 * The one forms are data in the catalog (ux-strings.js, `_one` keys), picked at the one call site when the count is 1.
 * 0 and 2 or more keep today's words; off, every HTML and every input is today's.
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
const { UX_STRINGS } = require('../../../shared/config/ux-strings');

const LIVE = { ur2: true, ink: true, ud: true, nf: true, us: true, pp: true };
const ONE = { ...LIVE, one: true };
const art = (kind, size, lang, d, ui) => renderArt({ kind, size, brand: 'niete', lang, d, ui }, { fonts: false, pictures: false });
const head = (h) => (/<h1 class="head">([\s\S]*?)<\/h1>/.exec(h) || [])[1].replace(/<[^>]+>/g, '');
const kids = (h) => Array.from(h.matchAll(/<span class="pt">[\s\S]*?<small>([\s\S]*?)<\/small><\/span>/g), (m) => m[1].replace(/<[^>]+>/g, ''));
const ANI = ['cat', 'turtle', 'parrot', 'owl'];
const rows = (n, at, first) => Array.from({ length: n }, (_, i) => ({ place: i + 1, animal: ANI[i % 4], correct: 6 - i, total: 6, ...(i === at ? { me: true, first } : {}) }));
const cls = (lang, played, of, first = 'Sana') => ({ topic: 'Proper Fraction', cls: '', played, ...(of ? { of } : {}), avgPct: 34, rows: rows(Math.max(1, played), 0, first) });
const school = (k) => ({ rows: [{ rank: 1, name: 'School Alpha', points: 10, kids: k, move: 0, you: true }, { rank: 2, name: 'School Beta', points: 40, kids: 3, move: 0 }] });
const LONG = 'محمد عبدالرحمان Testwala';

describe('the catalog holds the one forms as data', () => {
  test.each(['wqArtPlayed_one', 'wqArtPlayedOf_one', 'wqArtKids_one'])('%s has English and Urdu', (k) => {
    expect(typeof UX_STRINGS[k].en).toBe('string');
    expect(typeof UX_STRINGS[k].ur).toBe('string');
  });
});

describe('on: one child, one kid', () => {
  for (const size of ['sq', 'og']) {
    test(`${size} ur: «۱ بچے نے کھیلا», with the class size «۱۰ میں سے ۱ بچے نے کھیلا»`, () => {
      expect(head(art('class', size, 'ur', cls('ur', 1), ONE))).toBe('۱ بچے نے کھیلا');
      expect(head(art('class', size, 'ur', cls('ur', 1, 10), ONE))).toBe('۱۰ میں سے ۱ بچے نے کھیلا');
    });
    test(`${size} ur: 0 and 2 keep today's words`, () => {
      for (const n of [0, 2]) for (const of of [0, 10]) {
        expect(head(art('class', size, 'ur', cls('ur', n, of), ONE))).toBe(head(art('class', size, 'ur', cls('ur', n, of), LIVE)));
      }
      expect(head(art('class', size, 'ur', cls('ur', 2), ONE))).toBe('۲ بچوں نے کھیلا');
    });
    test(`${size} en: the class table is byte for byte today's (it reads "1 played", "1 of 10 played")`, () => {
      for (const n of [0, 1, 2]) for (const of of [0, 10]) {
        expect(art('class', size, 'en', cls('en', n, of), ONE)).toBe(art('class', size, 'en', cls('en', n, of), LIVE));
      }
    });
    test(`${size}: the school picture says "1 kid" / «۱ بچہ»; 3 keeps today's`, () => {
      expect(kids(art('school', size, 'en', school(1), ONE))).toEqual(['points · 1 kid', 'points · 3 kids']);
      expect(kids(art('school', size, 'ur', school(1), ONE))).toEqual(['پوائنٹس،&ensp;۱ بچہ', 'پوائنٹس،&ensp;۳ بچے']);
      expect(kids(art('school', size, 'en', school(1), LIVE))).toEqual(['points · 1 kids', 'points · 3 kids']);
    });
  }
});

describe('on: EL-1, the Urdu class table fits a long name to its own box', () => {
  test('the Urdu class picture carries the fit, run before the picture is taken', () => {
    const h = art('class', 'sq', 'ur', cls('ur', 2, 0, LONG), ONE);
    expect(h).toContain('window.__beforeCapture');
    expect(h).toMatch(/\.crow \.who \.nm/);
  });
  test('the English class picture, the Urdu card and challenge, and every picture with the key off: no fit', () => {
    expect(art('class', 'sq', 'en', cls('en', 2, 0, 'Muhammad Abdurrahman Testwala'), ONE)).not.toContain('__beforeCapture');
    expect(art('class', 'sq', 'ur', cls('ur', 2, 0, LONG), LIVE)).not.toContain('__beforeCapture');
    expect(art('invite', 'sq', 'ur', { first: LONG, correct: 1, total: 6, topic: 'Proper Fraction' }, ONE)).not.toContain('__beforeCapture');
  });
});

describe('off: today\'s HTML and input', () => {
  test.each([[undefined], [LIVE], [{ ...LIVE, one: false }], [{ ...LIVE, one: 'true' }], [{ ...LIVE, one: 1 }]])('ui %j', (ui) => {
    const base = ui ? { ...ui } : undefined;
    if (base) delete base.one;
    for (const lang of ['en', 'ur']) for (const size of ['sq', 'og']) {
      expect(art('class', size, lang, cls(lang, 1, 10), ui)).toBe(art('class', size, lang, cls(lang, 1, 10), base));
      expect(art('school', size, lang, school(1), ui)).toBe(art('school', size, lang, school(1), base));
    }
  });
  test('the input carries the key only when on (its own version: a new picture key)', () => {
    const f = { lang: 'ur', d: cls('ur', 1) };
    expect(Input.artInput('class', 'sq', 'niete', f, LIVE)).toEqual(Input.artInput('class', 'sq', 'niete', f, { ...LIVE, one: 'true' }));
    expect(Input.artInput('class', 'sq', 'niete', f, ONE).ui).toMatchObject({ one: true, ov: Input.ART_ONE_V });
  });
});

describe('served: the key in the card switches\' one read', () => {
  const SID = '0f8e2c1a-1b2c-4d5e-8f90-a1b2c3d4e5f6';
  const seed = (lang, settings) => {
    const now = Date.now();
    return {
      quiz_share_codes: [{ id: 'sc-1', code: 'CLS001', quiz_id: 'qz-1', teacher_user_id: 't-1', topic: 'Fractions', language: lang, active: true }],
      quizzes: [{ id: 'qz-1', topic: 'Fractions', grade: '3', subject: 'Maths', language: lang, meta: {} }],
      students: [{ id: 'st-1', student_name: 'Amal Testwala' }],
      quiz_sessions: [
        { id: SID, quiz_id: 'qz-1', student_id: 'st-1', student_name: 'Amal Testwala', share_code_id: 'sc-1', status: 'completed', correct_answers: 7, total_questions_answered: 8, mastery_percentage: 88, completed_at: new Date(now - 60000).toISOString(), created_at: new Date(now - 300000).toISOString() },
      ],
      app_settings: settings,
      users: [{ id: 't-1', school_id: 'SA' }],
      schools: [{ id: 'SA', name: 'School Alpha', region: 'Sector One', is_active: true, is_probable_test: false }],
    };
  };
  let Art;
  async function drawn(kind, ref, lang, settings) {
    const fake = makeFake(seed(lang, settings));
    Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
    require('../../../shared/services/quiz/web-quiz-card-switch')._reset();
    require('../../../shared/services/quiz/web-quiz-ur-polish')._reset();
    require('../../../shared/services/quiz/web-quiz-schools')._reset();
    Art._resetCache();
    htmlToImage.mockClear();
    const out = await Art.artImage(Art.artId(kind, ref), { size: 'sq' });
    return { key: out.key, html: htmlToImage.mock.calls[0][0], opt: htmlToImage.mock.calls[0][1] };
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
  const ON = [{ key: 'web_quiz_share_copy_one', value: true }, { key: 'web_quiz_share_pic_polish', value: true }];
  test('on: the Urdu class picture says «۱ بچے نے کھیلا» under a new key, and its fit runs before the picture is taken', async () => {
    const off = await drawn('l', SID, 'ur', ON.slice(1));
    const on = await drawn('l', SID, 'ur', ON);
    expect(off.html).toContain('بچوں نے کھیلا');
    expect(on.html).toContain('بچے نے کھیلا');
    expect(on.key).not.toBe(off.key);
    expect(on.opt.beforeCapture).toBe(true);
    expect(off.opt.beforeCapture).toBeUndefined();
  });
  test('on: the card picture keeps its key, its HTML and its draw', async () => {
    const off = await drawn('c', SID, 'ur', []);
    const on = await drawn('c', SID, 'ur', ON.slice(0, 1));
    expect(on.key).toBe(off.key);
    expect(on.html).toBe(off.html);
    expect(on.opt).toEqual(off.opt);
  });
  test.each([['false', false], ['the string "true"', 'true'], ['1', 1]])('the key %s: today\'s key, HTML and draw', async (_n, value) => {
    const today = await drawn('l', SID, 'ur', ON.slice(1));
    const off = await drawn('l', SID, 'ur', [{ key: 'web_quiz_share_copy_one', value }, ...ON.slice(1)]);
    expect(off.key).toBe(today.key);
    expect(off.html).toBe(today.html);
    expect(off.opt).toEqual(today.opt);
  });
  test('the key is read in the card switches\' one settings read, and named in the page field only when on', async () => {
    const Card = require('../../../shared/services/quiz/web-quiz-card-switch');
    expect(Card.COPY_ONE_KEY).toBe('web_quiz_share_copy_one');
    const reads = [];
    const fake = makeFake(seed('ur', ON.slice(0, 1)));
    Object.assign(supabase, { from: (t) => { const q = fake.from(t); if (t === 'app_settings') { const inF = q.in.bind(q); q.in = (col, keys) => { reads.push(keys); return inF(col, keys); }; } return q; } });
    Card._reset();
    await Card.on();
    expect(reads.length).toBe(1);
    expect(reads[0]).toContain('web_quiz_share_copy_one');
    expect(Card.copyOneCached()).toBe(true);
    expect(await Card.field()).toEqual({ copy_one: true });
    for (const value of [false, 'true', 1]) {
      const f2 = makeFake(seed('ur', [{ key: 'web_quiz_share_copy_one', value }]));
      Object.assign(supabase, { from: f2.from, rpc: f2.rpc });
      Card._reset();
      await Card.on();
      expect(Card.copyOneCached()).toBe(false);
      expect(await Card.field()).toEqual({});
    }
  });
});

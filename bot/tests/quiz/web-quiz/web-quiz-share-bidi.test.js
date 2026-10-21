'use strict';
/**
 * The Urdu share words read right to left (app_settings web_quiz_share_bidi, default OFF; on only as JSON true). OB-1:
 * in every Urdu count line a number keeps the word after it (U+00A0), so a wrap never leaves «۱» without its noun:
 *   - the card picture and its page lines (web-quiz-card-data.js words(): «۷ میں سے ۱ صحیح», «۱ ستارہ»), the switch
 *     sealed into the card at mint (`b: 1`), so a card keeps the words it was made with;
 *   - the class table picture («۱ بچے نے کھیلا», «۱۰ میں سے ۱ بچے نے کھیلا», «۲ بچوں نے کھیلا») and the school
 *     picture («۱ بچہ»), carried as `ui.nb` with its own version (a new picture key).
 * The switch is read in the card switches' one settings read, named in the page field (`share_bidi`) and in the mint's
 * answer (`bidi`) only when on. Off, and English: every line, HTML, input and answer is today's.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../shared/storage/r2', () => ({ downloadFromR2: jest.fn(), uploadBuffer: jest.fn(), headObject: jest.fn() }));
jest.mock('../../../shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { renderArt } = require('../../../shared/templates/web-quiz-art.template');
const Input = require('../../../shared/services/quiz/web-quiz-art-input');
const Data = require('../../../shared/services/quiz/web-quiz-card-data');
const A = require('../../../shared/services/quiz/web-quiz-card-a');

const NB = ' ';
// a digit (either system), maybe closing an isolate or a span, then a plain space: what OB-1 takes out
const LOOSE = /[0-9۰-۹](?:⁩|<\/span>)? (?=\S)/;
const OFFS = [[undefined], [false], ['true'], [1]];

// ─── the card's lines ───────────────────────────────────────────────────────

describe('the card\'s lines (words)', () => {
  const X = [{ r: 1, o: 7, s: 1 }, { r: 3, o: 7, s: 2 }, { w: 42, s: 3 }, { r: 1, o: 1, s: 3 }];
  test('on, Urdu: every number keeps its word', () => {
    expect(Data.words({ r: 1, o: 7, s: 1 }, 'quiz', 'ur', true)).toMatchObject({ score: `۷${NB}میں سے ۱${NB}صحیح`, stars_text: `۱${NB}ستارہ`, dare: `آپ ۷${NB}کے ۷${NB}صحیح کر کے دکھائیں!` });
    expect(Data.words({ w: 42, s: 3 }, 'read', 'ur', true)).toMatchObject({ words: `۴۲${NB}لفظ پڑھے`, stars_text: `۳${NB}ستارے` });
    for (const x of X) for (const v of Object.values(Data.words(x, 'quiz', 'ur', true))) if (typeof v === 'string') expect(v).not.toMatch(LOOSE);
  });
  test.each(OFFS)('off (%j), and English on: today\'s lines', (nb) => {
    for (const x of X) {
      expect(Data.words(x, 'quiz', 'ur', nb)).toEqual(Data.words(x, 'quiz', 'ur'));
      expect(Data.words(x, 'quiz', 'en', true)).toEqual(Data.words(x, 'quiz', 'en'));
    }
    expect(Data.words({ r: 1, o: 7, s: 1 }, 'quiz', 'ur').score).toBe('۷ میں سے ۱ صحیح');
  });
  const card = (lang, bidi, data = { r: 1, o: 7, s: 1 }) => A.renderCardA({ kind: 'quiz', deed: 'quiz_done', lang, first: 'Sana', data, ...(bidi === undefined ? {} : { bidi }) }, { fonts: false });
  test('on, Urdu: the card picture draws «۷ میں سے ۱ صحیح» kept together, «صحیح» still in its own span', () => {
    const h = card('ur', true);
    expect(h).toContain(`۷${NB}میں سے ۱${NB}<span class="sah">صحیح</span>`);
  });
  test.each(OFFS)('off (%j), and English on: today\'s card picture', (bidi) => {
    expect(card('ur', bidi)).toBe(card('ur'));
    expect(card('ur')).toContain('۷ میں سے ۱ <span class="sah">صحیح</span>');
    expect(card('en', true)).toBe(card('en'));
  });
});

// ─── the class table and school pictures ────────────────────────────────────

const LIVE = { ur2: true, ink: true, ud: true, nf: true, us: true, pp: true };
const art = (kind, size, lang, d, ui) => renderArt({ kind, size, brand: 'niete', lang, d, ui }, { fonts: false, pictures: false });
const head = (h) => (/<h1 class="head">([\s\S]*?)<\/h1>/.exec(h) || [])[1];
const kids = (h) => Array.from(h.matchAll(/<span class="pt">[\s\S]*?<small>([\s\S]*?)<\/small><\/span>/g), (m) => m[1]);
const rows = (n) => Array.from({ length: Math.max(1, n) }, (_, i) => ({ place: i + 1, animal: 'owl', correct: 6 - i, total: 6, ...(i === 0 ? { me: true, first: 'Sana' } : {}) }));
const cls = (played, of) => ({ topic: 'Proper Fraction', cls: '', played, ...(of ? { of } : {}), avgPct: 34, rows: rows(played) });
const school = (k) => ({ rows: [{ rank: 1, name: 'School Alpha', points: 10, kids: k, move: 0, you: true }, { rank: 2, name: 'School Beta', points: 40, kids: 3, move: 0 }] });

describe('the pictures (ui.nb)', () => {
  for (const ui of [{ ...LIVE, nb: true }, { ...LIVE, one: true, nb: true }]) {
    for (const size of ['sq', 'og']) {
      test(`${size} ${ui.one ? 'with' : 'without'} the one forms: the class count keeps its words`, () => {
        for (const [n, of] of [[1, 0], [1, 10], [2, 0], [2, 10]]) {
          const h = head(art('class', size, 'ur', cls(n, of), ui));
          expect(h).not.toMatch(LOOSE);
          expect(h).toContain(NB);
        }
      });
      test(`${size} ${ui.one ? 'with' : 'without'} the one forms: the school's kids keep their word`, () => {
        for (const k of kids(art('school', size, 'ur', school(1), ui))) expect(k).not.toMatch(LOOSE);
      });
    }
  }
  test('English, on: byte for byte today\'s', () => {
    for (const size of ['sq', 'og']) {
      expect(art('class', size, 'en', cls(1, 10), { ...LIVE, nb: true })).toBe(art('class', size, 'en', cls(1, 10), LIVE));
      expect(art('school', size, 'en', school(1), { ...LIVE, nb: true })).toBe(art('school', size, 'en', school(1), LIVE));
    }
  });
  test.each([[false], ['true'], [1]])('off (nb %j): today\'s HTML and input', (nb) => {
    for (const lang of ['en', 'ur']) for (const size of ['sq', 'og']) {
      expect(art('class', size, lang, cls(1, 10), { ...LIVE, nb })).toBe(art('class', size, lang, cls(1, 10), LIVE));
      expect(art('school', size, lang, school(1), { ...LIVE, nb })).toBe(art('school', size, lang, school(1), LIVE));
    }
    const f = { lang: 'ur', d: cls(1) };
    expect(Input.artInput('class', 'sq', 'niete', f, { ...LIVE, nb })).toEqual(Input.artInput('class', 'sq', 'niete', f, LIVE));
  });
  test('on: the input carries it with its own version (a new picture key)', () => {
    expect(Input.artInput('class', 'sq', 'niete', { lang: 'ur', d: cls(1) }, { ...LIVE, nb: true }).ui).toMatchObject({ nb: true, nbv: Input.ART_NB_V });
  });
});

// ─── the switch ─────────────────────────────────────────────────────────────

describe('the key in the card switches\' one read', () => {
  const seed = (settings) => makeFake({ app_settings: settings });
  test('read once with the others, named in the page field only when on', async () => {
    const Card = require('../../../shared/services/quiz/web-quiz-card-switch');
    expect(Card.SHARE_BIDI_KEY).toBe('web_quiz_share_bidi');
    const reads = [];
    const fake = seed([{ key: 'web_quiz_share_bidi', value: true }]);
    Object.assign(supabase, { from: (t) => { const q = fake.from(t); if (t === 'app_settings') { const inF = q.in.bind(q); q.in = (col, keys) => { reads.push(keys); return inF(col, keys); }; } return q; } });
    Card._reset();
    await Card.on();
    expect(reads.length).toBe(1);
    expect(reads[0]).toContain('web_quiz_share_bidi');
    expect(Card.shareBidiCached()).toBe(true);
    expect(await Card.field()).toEqual({ share_bidi: true });
    for (const value of [false, 'true', 1]) {
      const f2 = seed([{ key: 'web_quiz_share_bidi', value }]);
      Object.assign(supabase, { from: f2.from, rpc: f2.rpc });
      Card._reset();
      await Card.on();
      expect(Card.shareBidiCached()).toBe(false);
      expect(await Card.field()).toEqual({});
    }
  });
});

// ─── SECT-1 + DG-1: the school picture's sectors and digits ─────────────────

// SECT-1: a sector is drawn by its display name from the catalog ("ICT" / «آئی سی ٹی»), never the stored key ("ict");
// a short lower-case code without one in capitals; anything else as stored. In both languages.
// DG-1: on the Urdu school picture the ranks and points are set in the Urdu digit face (Noto Nastaliq Urdu, whose
// U+06F4/06F6/06F7 are the Urdu forms; Lexend has no Urdu digits), first in the stack, never after a Latin face.
const sectors = (h) => Array.from(h.matchAll(/<span class="sn">[\s\S]*?<small>([\s\S]*?)<\/small><\/span>/g), (m) => m[1].replace(/<[^>]+>/g, ''));
const schoolS = () => ({ rows: [{ rank: 1, name: 'School Alpha', sector: 'ict', points: 1072, kids: 4, move: 0 }, { rank: 2, name: 'School Beta', sector: 'Urban-I', points: 687, kids: 6, move: 0, you: true }, { rank: 3, name: 'School Gamma', sector: 'bk', points: 40, kids: 3, move: 0 }] });
const DG_RX = /\.board \.num\{font-family:'NastaliqUrdu','Lexend',sans-serif\}/;

describe('SECT-1 + DG-1 on (ui.nb), the school picture', () => {
  for (const size of ['sq', 'og']) {
    test(`${size}: the sector's display name, both languages`, () => {
      expect(sectors(art('school', size, 'ur', schoolS(), { ...LIVE, nb: true }))).toEqual(['آئی سی ٹی', 'Urban-I', 'BK']);
      expect(sectors(art('school', size, 'en', schoolS(), { ...LIVE, nb: true }))).toEqual(['ICT', 'Urban-I', 'BK']);
    });
    test(`${size}: Urdu ranks and points in the Urdu digit face; English and the class picture untouched`, () => {
      expect(art('school', size, 'ur', schoolS(), { ...LIVE, nb: true })).toMatch(DG_RX);
      expect(art('school', size, 'en', schoolS(), { ...LIVE, nb: true })).not.toMatch(DG_RX);
      expect(art('class', size, 'ur', cls(2, 0), { ...LIVE, nb: true })).not.toMatch(DG_RX);
    });
  }
  test('the catalog has the sector\'s two names', () => {
    const { UX_STRINGS } = require('../../../shared/config/ux-strings');
    expect(UX_STRINGS.wqArtSector_ict).toEqual({ en: 'ICT', ur: 'آئی سی ٹی' });
  });
});

describe('SECT-1 + DG-1 off: today\'s school picture', () => {
  test.each(OFFS)('nb %j: the stored sector, today\'s digit face', (nb) => {
    for (const lang of ['en', 'ur']) for (const size of ['sq', 'og']) {
      const h = art('school', size, lang, schoolS(), { ...LIVE, nb });
      expect(h).toBe(art('school', size, lang, schoolS(), LIVE));
      expect(sectors(h)).toEqual(['ict', 'Urban-I', 'bk']);
      expect(h).not.toMatch(DG_RX);
    }
  });
});

describe('served: the school picture under the key', () => {
  const sharp = require('sharp');
  const r2 = require('../../../shared/storage/r2');
  const { htmlToImage } = require('../../../shared/utils/html-to-pdf');
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
      schools: [{ id: 'SA', name: 'School Alpha', region: 'ict', is_active: true, is_probable_test: false }],
    };
  };
  let Art;
  async function drawn(lang, settings) {
    const fake = makeFake(seed(lang, settings));
    Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
    require('../../../shared/services/quiz/web-quiz-card-switch')._reset();
    require('../../../shared/services/quiz/web-quiz-ur-polish')._reset();
    require('../../../shared/services/quiz/web-quiz-schools')._reset();
    Art._resetCache();
    htmlToImage.mockClear();
    const out = await Art.artImage(Art.artId('s', 'CLS001'), { size: 'sq' });
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
  test.each(['en', 'ur'])('%s, on: "ICT" (or «آئی سی ٹی») under a new key; off: today\'s', async (lang) => {
    const off = await drawn(lang, []);
    const on = await drawn(lang, [{ key: 'web_quiz_share_bidi', value: true }]);
    expect(sectors(off.html)).toEqual(['ict']);
    expect(sectors(on.html)).toEqual([lang === 'ur' ? 'آئی سی ٹی' : 'ICT']);
    expect(on.key).not.toBe(off.key);
    for (const value of [false, 'true', 1]) {
      const o2 = await drawn(lang, [{ key: 'web_quiz_share_bidi', value }]);
      expect(o2.key).toBe(off.key);
      expect(o2.html).toBe(off.html);
    }
  });
});

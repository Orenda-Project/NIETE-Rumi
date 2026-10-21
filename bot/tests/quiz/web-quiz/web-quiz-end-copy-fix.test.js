'use strict';
/**
 * The end screen's words (app_settings web_quiz_end_copy_fix, default OFF; on only as JSON true), the bot's side:
 *   - the key is read in the card switches' one settings read and named in the page field (`end_copy`) only when on;
 *   - UD-2: the Urdu class table picture draws its numbers («۱ بچے نے کھیلا», each row's place and score) in the digit
 *     face (a Naskh subset of the Urdu digits, ۴ ۶ ۷ in their Urdu forms), never Nastaliq, where a lone ۱ reads as
 *     alif; carried as `ui.dg` with its own version (a new picture key);
 *   - UD-3: the school league's answer names the viewer's sector by its catalog names ({en, ur}) and says `end_copy`.
 * Off, and English: every input, picture and answer is today's.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const fs = require('fs');
const path = require('path');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { renderArt } = require('../../../shared/templates/web-quiz-art.template');
const Input = require('../../../shared/services/quiz/web-quiz-art-input');
const Card = require('../../../shared/services/quiz/web-quiz-card-switch');
const S = require('../../../shared/services/quiz/web-quiz-schools');

const KEY = 'web_quiz_end_copy_fix';
const OFFS = [[false], ['true'], [1]];
const seed = (settings, extra = {}) => { const f = makeFake({ app_settings: settings, ...extra }); Object.assign(supabase, { from: f.from, rpc: f.rpc }); Card._reset(); return f; };

// ─── the switch ─────────────────────────────────────────────────────────────

describe('the key in the card switches\' one read', () => {
  test('read once with the others, named in the page field only when on', async () => {
    expect(Card.END_COPY_KEY).toBe(KEY);
    const reads = [];
    const fake = makeFake({ app_settings: [{ key: KEY, value: true }] });
    Object.assign(supabase, { from: (t) => { const q = fake.from(t); if (t === 'app_settings') { const inF = q.in.bind(q); q.in = (col, keys) => { reads.push(keys); return inF(col, keys); }; } return q; } });
    Card._reset();
    await Card.on();
    expect(reads.length).toBe(1);
    expect(reads[0]).toContain(KEY);
    expect(Card.endCopyCached()).toBe(true);
    expect(await Card.field()).toEqual({ end_copy: true });
    for (const [value] of OFFS) {
      seed([{ key: KEY, value }]);
      await Card.on();
      expect(Card.endCopyCached()).toBe(false);
      expect(await Card.field()).toEqual({});
    }
    seed([]);
    await Card.on();
    expect(await Card.field()).toEqual({});
  });
});

// ─── UD-2: the Urdu class table picture's digits ────────────────────────────

const LIVE = { ur2: true, ink: true, ud: true, nf: true, us: true, pp: true, one: true, nb: true };
const rows = (n) => Array.from({ length: Math.max(1, n) }, (_, i) => ({ place: i + 1, animal: 'owl', correct: 6 - i, total: 6, ...(i === 0 ? { me: true, first: 'Sana' } : {}) }));
const cls = (played, of) => ({ topic: 'Proper Fraction', cls: '', played, ...(of ? { of } : {}), avgPct: 34, rows: rows(played) });
const art = (kind, size, lang, d, ui, fonts = false) => renderArt({ kind, size, brand: 'niete', lang, d, ui }, { fonts, pictures: false });
const RULE = ".art .head .num,.art .crow .num{font-family:'UrDigits','Lexend','NastaliqUrdu',sans-serif}";

describe('UD-2 the class table picture (ui.dg)', () => {
  test.each(['sq', 'og'])('%s, Urdu, on: the head line and the rows\' numbers in the digit face', (size) => {
    for (const [n, of] of [[1, 0], [1, 10], [3, 0]]) {
      const h = art('class', size, 'ur', cls(n, of), { ...LIVE, dg: true });
      expect(h).toContain(RULE);
      expect(/<h1 class="head">[\s\S]*?<span class="num">۱<\/span>/.test(h) || /<h1 class="head">[\s\S]*?<span class="num">۳<\/span>/.test(h)).toBe(true);
      expect(h).toMatch(/<span class="rk"><span class="num">۱<\/span><\/span>/);
    }
    // the face itself, embedded (Urdu digits only)
    const withFonts = art('class', size, 'ur', cls(1, 0), { ...LIVE, dg: true }, true);
    expect(withFonts).toMatch(/@font-face\{font-family:'UrDigits';font-weight:400 800;src:url\(data:font\/ttf;base64,[A-Za-z0-9+/=]{2000,}\);unicode-range:U\+06F0-06F9\}/);
  });
  test('the face: a small subset (the ten Urdu digits), shipped beside the other faces', () => {
    const f = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'shared', 'fonts', 'NotoNaskhArabic-UrduDigits-Bold.ttf'));
    expect(f.length).toBeGreaterThan(1000);
    expect(f.length).toBeLessThan(20000);
  });
  test.each(OFFS)('off (%j), English, and the other pictures: today\'s', (dg) => {
    for (const size of ['sq', 'og']) {
      expect(art('class', size, 'ur', cls(1, 10), { ...LIVE, dg })).toBe(art('class', size, 'ur', cls(1, 10), LIVE));
      expect(art('class', size, 'en', cls(1, 10), { ...LIVE, dg: true })).toBe(art('class', size, 'en', cls(1, 10), LIVE));
      expect(art('class', size, 'ur', cls(1, 10), LIVE)).not.toContain('UrDigits');
    }
    const card = { first: 'Sana', correct: 1, total: 7, topic: 'Proper Fraction', animal: 'owl' };
    expect(art('card', 'sq', 'ur', card, { ...LIVE, dg: true })).toBe(art('card', 'sq', 'ur', card, LIVE));
  });
  test('the input: carried with its own version (a new picture key) only when on', () => {
    const f = { lang: 'ur', d: cls(1) };
    expect(Input.artInput('class', 'sq', 'niete', f, { ...LIVE, dg: true }).ui).toMatchObject({ dg: true, dgv: Input.ART_DG_V });
    for (const [dg] of OFFS) expect(Input.artInput('class', 'sq', 'niete', f, { ...LIVE, dg })).toEqual(Input.artInput('class', 'sq', 'niete', f, LIVE));
  });
});

// ─── UD-4: a sector with no catalog row stays as stored ──────────────────────

describe('UD-4 a sector is named by the catalog only when it has a row', () => {
  test('the school picture: «آئی سی ٹی» from the catalog, "Urban-I" (no row) as stored', () => {
    const d = { rows: [{ rank: 1, name: 'School Alpha', sector: 'ict', points: 10, kids: 2, move: 0, you: true }, { rank: 2, name: 'School Beta', sector: 'Urban-I', points: 9, kids: 2, move: 0 }] };
    const h = art('school', 'sq', 'ur', d, { ...LIVE, nb: true });
    expect(h).toContain('آئی سی ٹی');
    expect(h).toContain('Urban-I');
  });
  test('the league answer: names only for a catalog row', () => {
    expect(S._sectorNames('ict')).toEqual({ en: 'ICT', ur: 'آئی سی ٹی' });
    expect(S._sectorNames('Urban-I')).toBeNull();
    expect(S._sectorNames(null)).toBeNull();
  });
});

// ─── UD-3: the school league's answer ───────────────────────────────────────

describe('UD-3 the school league names the sector by its catalog names', () => {
  const NOW = Date.parse('2026-10-07T05:00:00Z');
  const T1 = '11111111-1111-4111-8111-111111111111';
  const future = '2099-12-31T00:00:00.000Z';
  const world = (settings) => {
    S._reset();
    process.env.INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'route-key';
    seed(settings, {
      schools: [{ id: 'SA', name: 'School Alpha', region: 'ict', is_active: true, is_probable_test: false }],
      users: [{ id: T1, school_id: 'SA' }],
      quiz_share_codes: [{ id: 'c1', code: 'ALPHA1', quiz_id: 'q', teacher_user_id: T1, language: 'ur', active: true, expires_at: future }],
      quiz_sessions: [{ id: 's1', share_code_id: 'c1', student_id: 'ka1', mastery_percentage: 100, completed_at: '2026-10-05T05:00:00Z', status: 'completed', user_id: null }],
    });
  };
  test('on: mine.sector_name {en, ur} and end_copy', async () => {
    world([{ key: KEY, value: true }]);
    const b = await S.board('ALPHA1', { now: NOW });
    expect(b.mine).toEqual(expect.objectContaining({ sector: 'ict', sector_name: { en: 'ICT', ur: 'آئی سی ٹی' } }));
    expect(b.end_copy).toBe(true);
  });
  test.each([[[]], ...OFFS.map(([v]) => [[{ key: KEY, value: v }]])])('off (%j): today\'s answer, byte for byte', async (settings) => {
    world([]);
    const today = JSON.stringify(await S.board('ALPHA1', { now: NOW }));
    world(settings);
    expect(JSON.stringify(await S.board('ALPHA1', { now: NOW }))).toBe(today);
    expect(today).not.toMatch(/sector_name|end_copy/);
  });
});

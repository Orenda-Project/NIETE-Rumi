'use strict';
/**
 * The end screen's polish (app_settings web_quiz_end_polish, default OFF; on only as JSON true), the bot's side:
 *   - the key is read in the card switches' one settings read and named in the page field (`end_polish`) only when on;
 *   - DG-2: the Urdu class table picture says one child in words, «ایک بچے نے کھیلا» (a lone ۱ reads as alif), from the
 *     catalog (`Word_one` keys); carried as `ui.ep` with its own version (a new picture key).
 * Off, and English: every input, picture and answer is today's.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { renderArt } = require('../../../shared/templates/web-quiz-art.template');
const Input = require('../../../shared/services/quiz/web-quiz-art-input');
const Card = require('../../../shared/services/quiz/web-quiz-card-switch');
const UX = require('../../../shared/config/ux-strings');

const KEY = 'web_quiz_end_polish';
const OFFS = [[false], ['true'], [1]];
const seed = (settings) => { const f = makeFake({ app_settings: settings }); Object.assign(supabase, { from: f.from, rpc: f.rpc }); Card._reset(); return f; };

// ─── the switch ─────────────────────────────────────────────────────────────

describe('the key in the card switches\' one read', () => {
  test('read once with the others, named in the page field only when on', async () => {
    expect(Card.END_POLISH_KEY).toBe(KEY);
    const reads = [];
    const fake = makeFake({ app_settings: [{ key: KEY, value: true }] });
    Object.assign(supabase, { from: (t) => { const q = fake.from(t); if (t === 'app_settings') { const inF = q.in.bind(q); q.in = (col, keys) => { reads.push(keys); return inF(col, keys); }; } return q; } });
    Card._reset();
    await Card.on();
    expect(reads.length).toBe(1);
    expect(reads[0]).toContain(KEY);
    expect(Card.endPolishCached()).toBe(true);
    expect(await Card.field()).toEqual({ end_polish: true });
    for (const [value] of OFFS) {
      seed([{ key: KEY, value }]);
      await Card.on();
      expect(Card.endPolishCached()).toBe(false);
      expect(await Card.field()).toEqual({});
    }
    seed([]);
    await Card.on();
    expect(await Card.field()).toEqual({});
  });
  test('beside the end copy switch: both named', async () => {
    seed([{ key: KEY, value: true }, { key: 'web_quiz_end_copy_fix', value: true }]);
    await Card.on();
    expect(await Card.field()).toEqual({ end_copy: true, end_polish: true });
  });
});

// ─── DG-2: one child in words on the Urdu class table picture ───────────────

const LIVE = { ur2: true, ink: true, ud: true, nf: true, us: true, pp: true, one: true, nb: true, dg: true };
const rows = (n) => Array.from({ length: Math.max(1, n) }, (_, i) => ({ place: i + 1, animal: 'owl', correct: 6 - i, total: 6, ...(i === 0 ? { me: true, first: 'Sana' } : {}) }));
const cls = (played, of) => ({ topic: 'Proper Fraction', cls: '', played, ...(of ? { of } : {}), avgPct: 34, rows: rows(played) });
const art = (kind, size, lang, d, ui) => renderArt({ kind, size, brand: 'niete', lang, d, ui }, { fonts: false, pictures: false });
const head = (h) => /<h1 class="head">([\s\S]*?)<\/h1>/.exec(h)[1].replace(/<[^>]+>/g, '').replace(/ /g, ' ');

describe('DG-2 the class table picture (ui.ep)', () => {
  test.each(['sq', 'og'])('%s, Urdu, on: «ایک بچے نے کھیلا», with and without the class size', (size) => {
    expect(head(art('class', size, 'ur', cls(1, 0), { ...LIVE, ep: true }))).toBe('ایک بچے نے کھیلا');
    expect(head(art('class', size, 'ur', cls(1, 7), { ...LIVE, ep: true }))).toBe('۷ میں سے ایک بچے نے کھیلا');
    // without the other switches too
    expect(head(art('class', size, 'ur', cls(1, 0), { ep: true }))).toContain('ایک بچے نے کھیلا');
    // two or more keep their number
    expect(art('class', size, 'ur', cls(3, 0), { ...LIVE, ep: true })).toBe(art('class', size, 'ur', cls(3, 0), LIVE));
  });
  test.each(OFFS)('off (%j), English, and the other pictures: today\'s', (ep) => {
    for (const size of ['sq', 'og']) {
      expect(art('class', size, 'ur', cls(1, 0), { ...LIVE, ep })).toBe(art('class', size, 'ur', cls(1, 0), LIVE));
      expect(art('class', size, 'en', cls(1, 7), { ...LIVE, ep: true })).toBe(art('class', size, 'en', cls(1, 7), LIVE));
    }
  });
  test('the words are catalog data, both languages', () => {
    const S = UX.UX_STRINGS || UX;
    expect(S.wqArtPlayedWord_one).toEqual({ en: '{n} played', ur: 'ایک بچے نے کھیلا' });
    expect(S.wqArtPlayedOfWord_one).toEqual({ en: '{n} of {of} played', ur: '{of} میں سے ایک بچے نے کھیلا' });
  });
  test('the input: its own version only when on (a new picture key); off, today\'s input', () => {
    expect(Input.ART_EP_V).toBe(1);
    const f = { lang: 'ur', d: cls(1, 0) };
    expect(Input.artInput('class', 'sq', 'niete', f, { ...LIVE, ep: true }).ui).toMatchObject({ ep: true, epv: 1 });
    expect(Input.artInput('class', 'sq', 'niete', f, LIVE)).toEqual(Input.artInput('class', 'sq', 'niete', f, { ...LIVE, ep: false }));
    expect(JSON.stringify(Input.artInput('class', 'sq', 'niete', f, LIVE))).not.toContain('ep');
  });
});

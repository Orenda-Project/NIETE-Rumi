/**
 * Two no-break rules of the copy deck's Urdu (bot/shared/config/copy.v2.json, _meta.nbsp_rule).
 *
 *   1. No orphan verb: an Urdu string whose final word is «ہے», «ہیں», «گا», «گی» or «گے» joins it to the word
 *      before with U+00A0, so a narrow screen never wraps the verb alone onto the last line. Trailing punctuation
 *      («۔», «؟», «!», «:» …) and bidi isolates are not words; a one-word string has nothing to join.
 *   2. «واٹس ایپ» is one unit: U+00A0 between the two words, never a plain space.
 *
 * Every key is read (retired and held ones too: a lift copies the deck byte for byte, so the deck is fixed first).
 * The keys that broke a rule when this gate landed are listed by key in copy-deck-urdu-orphans.allowlist.json and
 * copy-deck-whatsapp-joiner.allowlist.json; each list only shrinks (a new key fails; a fixed key fails until removed).
 */
const fs = require('fs');
const path = require('path');
const ORPHANS = require('./copy-deck-urdu-orphans.allowlist.json');
const WHATSAPP = require('./copy-deck-whatsapp-joiner.allowlist.json');
const { REPO, urduOrphans, whatsappWithoutJoiner, listRatchet } = require('./test-seam-gates-lib');

const NBSP = ' ';
const deckInTree = () => JSON.parse(fs.readFileSync(path.join(REPO, 'bot/shared/config/copy.v2.json'), 'utf8'));

describe('the rules, on an in-memory deck', () => {
  const deck = {
    _meta: { nbsp_rule: 'x' },
    'a.space_hai': { en: 'x', ur: 'کھیل آپ کا انتظار کر رہا ہے۔' },
    'a.nbsp_hai': { en: 'x', ur: `کھیل آپ کا انتظار کر رہا${NBSP}ہے۔` },
    'a.space_gi': { en: 'x', ur: 'کل نئی کہانی آئے گی' },
    'a.space_hain_q': { en: 'x', ur: 'کیا سب الگ ہیں؟' },
    'a.isolate_end': { en: 'x', ur: 'باری ⁨{name}⁩ کی ہے⁩' },
    'a.nahin': { en: 'x', ur: 'ابھی نہیں' },
    'a.one_word': { en: 'x', ur: 'ہے' },
    'a.mid': { en: 'x', ur: 'یہ ہے آپ کا کھیل' },
    'a.gay_nbsp': { en: 'x', ur: `ستارے کھل جائیں${NBSP}گے۔`, retired: true },
    'w.space': { en: 'x', ur: 'واٹس ایپ پر بھیجیں' },
    'w.nbsp': { en: 'x', ur: `واٹس${NBSP}ایپ پر بھیجیں` },
    'w.joined': { en: 'x', ur: 'واٹسایپ پر' },
    'w.second': { en: 'x', ur: `واٹس${NBSP}ایپ اور واٹس  ایپ` },
  };

  test('an orphan verb after a plain space is a hit; U+00A0, نہیں, one word and a verb mid-string are not', () => {
    expect(urduOrphans(deck)).toEqual(['a.isolate_end', 'a.space_gi', 'a.space_hai', 'a.space_hain_q']);
  });

  test('«واٹس ایپ» without U+00A0 between the words is a hit, each string once', () => {
    expect(whatsappWithoutJoiner(deck)).toEqual(['w.joined', 'w.second', 'w.space']);
  });

  test('the shrink-only list: a new key and a fixed key both fail; equal passes', () => {
    expect(listRatchet(['a'], ['a'], 'x')).toEqual([]);
    expect(listRatchet(['a', 'b'], ['a'], 'x')[0]).toMatch(/^NEW: b/);
    expect(listRatchet([], ['a'], 'x')[0]).toMatch(/^CLEAN: a/);
  });
});

describe('the deck', () => {
  const deck = deckInTree();

  test('no new Urdu string ends on an orphan verb; the list matches today exactly', () => {
    expect(listRatchet(urduOrphans(deck), ORPHANS, 'ends on an orphan verb: put U+00A0 before it')).toEqual([]);
  });

  test('no new «واٹس ایپ» without U+00A0; the list matches today exactly', () => {
    expect(listRatchet(whatsappWithoutJoiner(deck), WHATSAPP, 'has «واٹس ایپ» without U+00A0 between the words')).toEqual([]);
  });
});

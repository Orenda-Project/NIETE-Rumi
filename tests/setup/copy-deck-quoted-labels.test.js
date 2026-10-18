/**
 * A deck line that quotes a button names it by that button's own words.
 *
 * bot/shared/config/copy.v2.json lines tell the reader which button to tap by quoting its label: the Urdu in «…», the
 * English in "…" (bot.round.invite: «اس ٹرم نہیں», «کھولیں»; "Not this term"). When a button is renamed and the line
 * that points at it is not, the reader is told to tap a button that is not there.
 *
 * The rule (the exact rule is quotedLabelGaps in test-seam-gates-lib.js):
 *   - live = neither `retired` nor `held`, the same rule as copyStates; only live keys are read, and only live keys'
 *     strings are labels;
 *   - every «…» inside a live key's UR string is byte-equal to the UR string of some live key; every "…" inside its
 *     EN string is byte-equal to the EN string of some live key. A DRAFT Urdu line is not read, and is no label;
 *   - a key with quotes that match no label has the state `en:<n>`, `ur:<n>` or `en:<n>+ur:<m>` (the unmatched counts).
 *
 * copy-deck-quoted-labels.allowlist.json: { "<key>": "<state>" } for every key with an unmatched quote today (key
 * names only, no copy text). It only shrinks: a key new to the gap fails (NEW), and so does a listed key whose gap
 * moved (CHANGED, e.g. ur:1 → en:1, or ur:1 → ur:2); a listed key now clean passes with a console.warn `CLEAN:`
 * line, and one with fewer unmatched quotes (en:1+ur:1 → ur:1, ur:2 → ur:1) passes with a `LESS:` line.
 */
const fs = require('fs');
const path = require('path');
const ALLOW = require('./copy-deck-quoted-labels.allowlist.json');
const { REPO, quotedLabelGaps, copyGapVerdict } = require('./test-seam-gates-lib');

const FILE = 'copy-deck-quoted-labels.allowlist.json';
const verdict = (states, allow) => copyGapVerdict(states, allow, {
  file: FILE, fix: "quote a live button's own words", gone: 'clean',
});

describe('the rule, on an in-memory deck', () => {
  const deck = {
    _meta: {},
    'bot.round.open_btn': { en: 'Open', ur: 'کھولیں' },
    'bot.round.not_now_btn': { en: 'Not this term', ur: 'اس ٹرم نہیں' },
    'bot.round.old_btn': { en: 'Skip', ur: 'چھوڑیں', retired: true },
    'bot.round.held_btn': { en: 'Later', ur: 'بعد میں', held: true },
    'jg.a.draft_btn': { en: 'Draft', ur: 'DRAFT مسودہ' },
  };

  test('a quote that matches a live label, in either language: clean', () => {
    expect(quotedLabelGaps({ ...deck,
      'bot.round.invite': { en: 'Tap "Not this term" or "Open".', ur: '«اس ٹرم نہیں» یا «کھولیں» دبائیں۔' },
    })).toEqual({});
  });

  test('a renamed button whose instruction still quotes the old label: a gap, counted per language', () => {
    const renamed = { ...deck, 'bot.round.open_btn': { en: 'See it', ur: 'دیکھیں' } };
    const invite = { en: 'Tap "Not this term" or "Open".', ur: '«اس ٹرم نہیں» یا «کھولیں» دبائیں۔' };
    expect(quotedLabelGaps({ ...renamed, 'bot.round.invite': invite })).toEqual({ 'bot.round.invite': 'en:1+ur:1' });
    expect(verdict(quotedLabelGaps({ ...renamed, 'bot.round.invite': invite }), {}).failures[0])
      .toMatch(/^NEW: bot.round.invite is en:1\+ur:1/);
  });

  test('a retired or held key is no label, and is not read; a DRAFT Urdu line is not read', () => {
    expect(quotedLabelGaps({ ...deck,
      'jg.a.x': { en: 'Tap "Skip" or "Later".', ur: '«چھوڑیں» یا «بعد میں»' },
      'jg.a.gone': { en: 'Tap "Nothing".', ur: '«کچھ نہیں»', retired: true },
      'jg.a.wip': { en: 'Tap "Draft".', ur: 'DRAFT «کچھ نہیں»' },
    })).toEqual({ 'jg.a.x': 'en:2+ur:2' });
  });

  test('byte-equal: a plain space for a no-break one is not the label', () => {
    expect(quotedLabelGaps({ _meta: {}, 'a.btn': { en: 'Go', ur: 'واٹس ایپ' }, 'a.line': { en: 'x', ur: '«واٹس ایپ»' } }))
      .toEqual({ 'a.line': 'ur:1' });
  });

  test('the allowlist check: new and moved gaps fail; clean and fewer pass with a warning', () => {
    expect(verdict({ k: 'ur:1' }, { k: 'ur:1' })).toEqual({ failures: [], cleans: [] });
    expect(verdict({ k: 'en:1' }, { k: 'ur:1' }).failures[0]).toMatch(/^CHANGED: k is en:1/);
    expect(verdict({ k: 'ur:2' }, { k: 'ur:1' }).failures[0]).toMatch(/^CHANGED: k is ur:2/);
    expect(verdict({}, { k: 'ur:1' })).toEqual({ failures: [], cleans: [`CLEAN: k is clean. Remove it from ${FILE}.`] });
    expect(verdict({ k: 'ur:1' }, { k: 'en:1+ur:1' }).cleans[0]).toMatch(/^LESS: k is ur:1 now/);
    expect(verdict({ k: 'ur:1' }, { k: 'ur:2' }).cleans[0]).toMatch(/^LESS: k is ur:1 now/);
  });
});

describe('the tree', () => {
  test("every quoted label in a live deck line is some live key's string, or listed; nothing new or moved", () => {
    const deck = JSON.parse(fs.readFileSync(path.join(REPO, 'bot/shared/config/copy.v2.json'), 'utf8'));
    for (const v of Object.values(ALLOW)) expect(typeof v).toBe('string');
    const { failures, cleans } = verdict(quotedLabelGaps(deck), ALLOW);
    for (const line of cleans) console.warn(line);
    expect(failures).toEqual([]);
  });
});

/**
 * The copy deck and what the code says agree, byte for byte.
 *
 * bot/shared/config/copy.v2.json is the deck: nothing reads it at runtime, every surface LIFTS its strings. A lift
 * that drifts (a plain space where the deck has U+00A0, a sentence edited in one place) ships words nobody
 * approved; a live key nobody lifted is a line the screen never shows.
 *
 * Which keys, and against what (the exact rule is copyStates in test-seam-gates-lib.js):
 *   - live = neither `retired` nor `held` (the deck's _meta: such a key is rendered or sent by no surface). The deck
 *     has no other switched/draft marker — every key names a `switch` — so every live key is in scope;
 *   - a live `bot.*` key (a WhatsApp line) is lifted in bot/shared/config/ux-strings.js UX_STRINGS under
 *     `jugnu<Tail>` or `<tail>`, camelCase of everything after `bot.` (bot.bind.saved → jugnuBindSaved,
 *     bot.guest.home → guestHome);
 *   - any other live key is checked when a template under bot/shared/templates claims it: a property line ending in
 *     `// <key>`, a `// <key>` comment over `const NAME = {`, or the key / its starred area (`jg.t.*`) named in the
 *     source; the lift is then read from that template's exported table, else from a template's `T` under
 *     camelCase of the key's last two parts or last part (jg.t.link_renew_go → tLinkRenewGo, jg.round.t_count → tCount);
 *   - EN is always compared; UR when the deck's UR does not say DRAFT. A function lift is called with `{param}`.
 * The child pages' lifts (dashboard/public/wq) are outside this gate.
 *
 * copy-deck-lift.allowlist.json: { "<key>": "<state>" } for every key not `same` when this gate landed (key names
 * only). It only shrinks: a key that drifts or goes missing fails; a listed key whose state changed (fixed, or
 * different) fails until the entry is updated or removed.
 */
const fs = require('fs');
const path = require('path');
const ALLOW = require('./copy-deck-lift.allowlist.json');
const { REPO, liftNames, liftText, liftSite, copyStates } = require('./test-seam-gates-lib');

function statesInTree() {
  const deck = JSON.parse(fs.readFileSync(path.join(REPO, 'bot/shared/config/copy.v2.json'), 'utf8'));
  const { UX_STRINGS } = require('../../bot/shared/config/ux-strings');
  const dir = path.join(REPO, 'bot/shared/templates');
  const templates = fs.readdirSync(dir).filter((n) => n.endsWith('.js')).map((n) => ({
    id: n,
    source: fs.readFileSync(path.join(dir, n), 'utf8'),
    exports: require(path.join(dir, n)),
  }));
  return copyStates(deck, UX_STRINGS, templates);
}

function gaps(states, allow) {
  const out = [];
  for (const key of [...new Set([...Object.keys(states), ...Object.keys(allow)])].sort()) {
    const now = states[key];
    const ok = allow[key];
    if (now === 'same' || now === undefined) { if (ok !== undefined) out.push(`CLEAN: ${key} is ${now || 'no longer checked'}. Remove it from the allowlist.`); continue; }
    if (ok === undefined) out.push(`NEW: ${key} is ${now}. Lift the deck's string byte for byte.`);
    else if (ok !== now) out.push(`CHANGED: ${key} is ${now}, the allowlist says ${ok}.`);
  }
  return out;
}

describe('the rule, on in-memory sources', () => {
  const NBSP = ' ';
  const deck = {
    _meta: {},
    'bot.bind.saved': { en: 'Saved.', ur: 'ہو گیا' },
    'bot.guest.home': { en: 'Play', ur: 'کھیلیں' },
    'bot.round.open_btn': { en: 'Open', ur: 'کھولیں' },
    'bot.bind.old': { en: 'Old', ur: 'پرانا', retired: true },
    'jg.round.start': { en: 'Start', ur: 'شروع' },
    'jg.round.t_count': { en: '{done} of {total}', ur: `{total} میں سے${NBSP}{done}` },
    'jg.t.saved': { en: 'Saved', ur: `واٹس${NBSP}ایپ` },
    'jg.t.new': { en: 'New', ur: 'DRAFT نیا' },
    'jg.shelf.title': { en: 'Shelf', ur: 'شیلف' },
  };
  const ux = { jugnuBindSaved: { en: 'Saved.', ur: 'ہو گیا' }, guestHome: { en: 'Play!', ur: 'کھیلیں' } };
  const templates = [
    { id: 'round.page.js', source: "start: 'Start', // jg.round.start\n// Copy: jg.round.*", exports: { T: { en: { start: 'Start', tCount: (done, total) => `${done} of ${total}` }, ur: { start: 'شروع', tCount: (done, total) => `${total} میں سے ${done}` } } } },
    { id: 'tab.page.js', source: '// Copy: jg.t.* → T.<lang>.t*', exports: { T: { en: { tSaved: 'Saved', tNew: 'New' }, ur: { tSaved: 'واٹس ایپ' } } } },
  ];

  test('the lift names: bot keys under jugnu<Tail> then <tail>; page keys under the last two parts, then the last', () => {
    expect(liftNames('bot.bind.stopped_phone_only')).toEqual(['jugnuBindStoppedPhoneOnly', 'bindStoppedPhoneOnly']);
    expect(liftNames('jg.t.link_renew_go')).toEqual(['tLinkRenewGo', 'linkRenewGo']);
    expect(liftNames('jg.round.t_count')).toEqual(['roundTCount', 'tCount']);
  });

  test('a function lift reads with {param} placeholders', () => {
    expect(liftText((name) => `${name}'s turn`)).toBe("{name}'s turn");
    expect(liftText(function f(done, total) { return `${done}/${total}`; })).toBe('{done}/{total}');
  });

  test('a template claims a key by its comment, by name, or by a starred area; else not', () => {
    expect(liftSite("cardTitle: 'x', // jg.round.card_title", 'jg.round.card_title')).toEqual({ prop: 'cardTitle' });
    expect(liftSite("// wa.t.fwd_text (the Urdu keeps its isolate)\nconst FWD = {", 'wa.t.fwd_text')).toEqual({ whole: 'FWD' });
    expect(liftSite('Copy: jg.t.* → T', 'jg.t.saved')).toEqual({ guess: true });
    expect(liftSite('Copy: jg.round.card_title_v2', 'jg.round.card_title')).toBe(null);
  });

  test('every state: same, drift (a plain space for a no-break one counts), missing, missing:ur; retired and unclaimed keys skipped; DRAFT Urdu not compared', () => {
    expect(copyStates(deck, ux, templates)).toEqual({
      'bot.bind.saved': 'same',
      'bot.guest.home': 'drift:en',
      'bot.round.open_btn': 'missing',
      'jg.round.start': 'same',
      'jg.round.t_count': 'drift:ur',
      'jg.t.saved': 'drift:ur',
      'jg.t.new': 'same',
    });
    const noUr = [{ ...templates[1], exports: { T: { en: { tSaved: 'Saved' }, ur: {} } } }];
    expect(copyStates({ 'jg.t.saved': deck['jg.t.saved'] }, {}, noUr)).toEqual({ 'jg.t.saved': 'missing:ur' });
  });

  test('the allowlist check: a new gap, a changed state and a fixed key all fail; equal passes', () => {
    expect(gaps({ a: 'same', b: 'missing' }, { b: 'missing' })).toEqual([]);
    expect(gaps({ a: 'drift:en' }, {})[0]).toMatch(/^NEW: a is drift:en/);
    expect(gaps({ b: 'drift:ur' }, { b: 'missing' })[0]).toMatch(/^CHANGED: b/);
    expect(gaps({ b: 'same' }, { b: 'missing' })[0]).toMatch(/^CLEAN: b/);
  });
});

describe('the tree', () => {
  test('every checked live deck key is lifted byte for byte, or listed; the list matches today exactly', () => {
    expect(gaps(statesInTree(), ALLOW)).toEqual([]);
  });
});

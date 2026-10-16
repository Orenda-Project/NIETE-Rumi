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
 * The child pages (dashboard/public/wq/*.js, browser scripts nothing can require) are read from their source, the
 * exact rule is wqCopyStates: a live non-`bot.*` key a script claims (a `// <key>` comment, or the key / its starred
 * area named in the source) is read from that script's `en: {…}` / `ur: {…}` tables under the claimed property, else
 * under camelCase of the key after its first part, of its last two parts or of its last part, or its last part as is
 * (jg.who.turn_of → whoTurnOf, jg.keep.notice_ok → noticeOk, jg.link.is_here → is_here). A value is evaluated on its
 * own (a string, or a self-contained function called with the deck's own {placeholders} in order); a value that is
 * not self-contained is missing. Those states sit in the same allowlist as `wq:<key>`.
 *
 * A `// <key>` comment alone on the line right above a property line claims that property, when it names one key.
 *
 * A server-carried line: a key a child page claims with no `en`/`ur` table lift at all is `carried`, not missing,
 * when a template under bot/shared/templates lifts it `same` (the bot-side state of the bare key): the page shows
 * the bytes the server sends it (wq-trail.js renders `d.round_handback`, lifted in class-round.page.js and sent by
 * web-quiz-challenge.js). `carried` is clean. When that template's lift drifts, the page key stays `missing` and the
 * bot-side key shows the drift. The exact rule is wqCopyStates' third argument.
 *
 * copy-deck-lift.allowlist.json: { "<key>": "<state>" } for every key not `same` today (key names only). It only
 * shrinks, and a PR that lifts a string is never failed for it: a key new to the gap fails (NEW), and so does a
 * listed key whose gap moved somewhere else (CHANGED, e.g. missing → drift); a listed key that is now `same` or no
 * longer checked passes with a console.warn `CLEAN:` line, and one whose gap got smaller (drift:en+ur → drift:ur,
 * missing → missing:ur) passes with a `LESS:` line, so the lift PR may lower the entry in its own commit.
 *
 * EN ⇒ UR in the same table: a key a child page lifts in an `en: {…}` table is lifted in the `ur: {…}` table of the
 * same object too (the Urdu child reads that table's other half), whenever the deck has an Urdu line that is not a
 * DRAFT. The exact rule is wqEnWithoutUr. copy-deck-en-only.allowlist.json: { "<key>": "<why>" }, the keys a page
 * shows in English only today; a new one fails, a listed one that gains its Urdu passes with a CLEAN line.
 *
 * copy-deck-lift.modules.json: the sorted repo paths of every bot/shared module this gate loads (ux-strings.js, every
 * template, and what those require inside bot/shared), read from require.cache after the tree's states are built,
 * never kept by hand. A tool that starts a run from a changed file reads it to know this gate covers that file. The
 * list is recomputed on every run; any drift fails until the file is updated.
 */
const fs = require('fs');
const path = require('path');
const ALLOW = require('./copy-deck-lift.allowlist.json');
const EN_ONLY = require('./copy-deck-en-only.allowlist.json');
const {
  REPO, liftNames, liftText, liftSite, copyStates, wqLiftNames, wqCopyStates, wqEnWithoutUr, copyGapVerdict, listVerdict,
} = require('./test-seam-gates-lib');

function treeInputs() {
  const deck = JSON.parse(fs.readFileSync(path.join(REPO, 'bot/shared/config/copy.v2.json'), 'utf8'));
  const wqDir = path.join(REPO, 'dashboard/public/wq');
  const scripts = fs.readdirSync(wqDir).filter((n) => n.endsWith('.js')).sort()
    .map((n) => ({ id: n, source: fs.readFileSync(path.join(wqDir, n), 'utf8') }));
  return { deck, scripts };
}

function statesInTree() {
  const { deck, scripts } = treeInputs();
  const { UX_STRINGS } = require('../../bot/shared/config/ux-strings');
  const dir = path.join(REPO, 'bot/shared/templates');
  const templates = fs.readdirSync(dir).filter((n) => n.endsWith('.js')).map((n) => ({
    id: n,
    source: fs.readFileSync(path.join(dir, n), 'utf8'),
    exports: require(path.join(dir, n)),
  }));
  const bot = copyStates(deck, UX_STRINGS, templates);
  const wq = {};
  for (const [k, v] of Object.entries(wqCopyStates(deck, scripts, bot))) wq[`wq:${k}`] = v;
  return { ...bot, ...wq };
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

  test('a child page script: its en/ur tables are read from source, a function with the deck placeholders', () => {
    const pageDeck = {
      _meta: {},
      'jg.link.is_here': { en: 'Is your name here?', ur: 'کیا آپ کا نام یہاں ہے؟' },
      'jg.who.turn': { en: 'Whose turn?', ur: 'کس کی باری ہے؟' },
      'jg.who.turn_of': { en: "{name}'s turn", ur: '⁨{name}⁩ کی باری' },
      'jg.keep.notice': { en: 'We keep it.', ur: 'ہم رکھتے ہیں۔' },
      'jg.keep.gone': { en: 'Gone', ur: 'گیا', retired: true },
      'jg.link.letter_q': { en: 'Tap a letter', ur: 'حرف دبائیں' },
      'bot.bind.saved': { en: 'Saved.', ur: 'ہو گیا' },
    };
    const scripts = [
      { id: 'class-link.js', source: [
        '(function () {',
        '  // copy.v2.json: jg.link.is_here, jg.who.turn, jg.keep.notice, jg.keep.gone, bot.bind.saved',
        '  var COPY = {',
        "    en: { is_here: 'Is your name here?', turn: 'Whose turn?', note: 'x, y' },",
        "    ur: { is_here: 'کیا آپ کا نام یہاں ہے؟', turn: 'کس کی باری', note: 'x' },",
        '  };',
        '})();',
      ].join('\n') },
      { id: 'wq-card.js', source: [
        '(function () {',
        '  // Copy: jg.who.turn_of',
        "  var W = { en: { whoTurnOf: function (n) { return n + '\\'s turn'; } },",
        "    ur: { whoTurnOf: function (n) { return '⁨' + n + '⁩ کی باری'; } } };",
        '})();',
      ].join('\n') },
    ];
    expect(wqLiftNames('jg.who.turn_of')).toEqual(['whoTurnOf', 'turnOf', 'turn_of']);
    expect(wqCopyStates(pageDeck, scripts)).toEqual({
      'jg.link.is_here': 'same',
      'jg.who.turn': 'drift:ur',
      'jg.who.turn_of': 'same',
      'jg.keep.notice': 'missing',
    });
  });

  test('a server-carried line: a page that names the key with no table lift, a template lifting it same → carried; drifted → missing', () => {
    const carryDeck = { _meta: {}, 'jg.round.c_handback': { en: 'Hand the phone back.', ur: 'فون واپس دیں۔' } };
    const page = [{ id: 'wq-trail.js', source: [
      '(function () {',
      '  // the one button hands the phone back to the round page (jg.round.c_handback)',
      "  var b = btn('wqc-handback', d.round_handback || '');",
      '})();',
    ].join('\n') }];
    const tpl = (en) => [{ id: 'class-round.page.js', source: `cHandback: '${en}', // jg.round.c_handback`, exports: { T: { en: { cHandback: en }, ur: { cHandback: 'فون واپس دیں۔' } } } }];
    const bot = copyStates(carryDeck, {}, tpl('Hand the phone back.'));
    expect(bot).toEqual({ 'jg.round.c_handback': 'same' });
    expect(wqCopyStates(carryDeck, page, bot)).toEqual({ 'jg.round.c_handback': 'carried' });
    expect(copyGapVerdict({ 'wq:jg.round.c_handback': 'carried' }, {})).toEqual({ failures: [], cleans: [] });
    const drifted = copyStates(carryDeck, {}, tpl('Give the phone back.'));
    expect(drifted).toEqual({ 'jg.round.c_handback': 'drift:en' });
    expect(wqCopyStates(carryDeck, page, drifted)).toEqual({ 'jg.round.c_handback': 'missing' });
    expect(wqCopyStates(carryDeck, page)).toEqual({ 'jg.round.c_handback': 'missing' });
  });

  test('a lone comment line right above a property claims it, when it names one key', () => {
    const src = [
      '  en: {',
      '    // jg.t.practice (the deck): the practice banner',
      "    teacherPractice: 'Practice',",
      '    // jg.keep.notice / jg.keep.notice_ok',
      "    noticeT: 'We keep it.',",
      '  },',
    ].join('\n');
    expect(liftSite(src, 'jg.t.practice')).toEqual({ prop: 'teacherPractice' });
    expect(liftSite(src, 'jg.keep.notice')).toEqual({ guess: true });
    expect(liftSite("// jg.t.practice\n// another line\nteacherPractice: 'x',", 'jg.t.practice')).toEqual({ guess: true });
  });

  test('the allowlist check: a new gap and a moved gap fail; a fixed key and a smaller gap pass with a warning', () => {
    expect(copyGapVerdict({ a: 'same', b: 'missing' }, { b: 'missing' })).toEqual({ failures: [], cleans: [] });
    expect(copyGapVerdict({ a: 'drift:en' }, {}).failures[0]).toMatch(/^NEW: a is drift:en/);
    expect(copyGapVerdict({ b: 'drift:ur' }, { b: 'missing' }).failures[0]).toMatch(/^CHANGED: b is drift:ur, the allowlist says missing/);
    expect(copyGapVerdict({ b: 'drift:en' }, { b: 'drift:ur' }).failures[0]).toMatch(/^CHANGED: b/);
    expect(copyGapVerdict({ b: 'same' }, { b: 'missing' })).toEqual({ failures: [], cleans: ['CLEAN: b is same. Remove it from copy-deck-lift.allowlist.json.'] });
    expect(copyGapVerdict({}, { gone: 'missing' })).toEqual({ failures: [], cleans: ['CLEAN: gone is no longer checked. Remove it from copy-deck-lift.allowlist.json.'] });
    expect(copyGapVerdict({ b: 'drift:ur' }, { b: 'drift:en+ur' })).toEqual({ failures: [], cleans: ['LESS: b is drift:ur now, the allowlist says drift:en+ur. Lower its entry in copy-deck-lift.allowlist.json.'] });
    expect(copyGapVerdict({ b: 'missing:ur' }, { b: 'missing' }).cleans[0]).toMatch(/^LESS: b is missing:ur now/);
  });
});

describe('EN ⇒ UR in the same table, on in-memory child pages', () => {
  const deck = {
    _meta: {},
    'jg.a.both': { en: 'Both', ur: 'دونوں' },
    'jg.a.en_only': { en: 'Only English', ur: 'صرف انگریزی' },
    'jg.a.split': { en: 'Split', ur: 'الگ' },
    'jg.a.draft': { en: 'Draft', ur: 'DRAFT مسودہ' },
    'jg.a.no_ur': { en: 'No Urdu line' },
    'jg.a.gone': { en: 'Gone', ur: 'گیا', retired: true },
    'bot.a.line': { en: 'Line', ur: 'لائن' },
  };
  const page = (lines) => ({ id: 'wq-x.js', source: ['(function () {', '  // Copy: jg.a.*, bot.a.line', ...lines, '})();'].join('\n') });

  test('a seeded-bad table, an EN key with no UR beside it, is a hit', () => {
    expect(wqEnWithoutUr(deck, [page([
      '  var T = {',
      "    en: { both: 'Both', enOnly: 'Only English' },",
      "    ur: { both: 'دونوں' },",
      '  };',
    ])])).toEqual(['jg.a.en_only']);
  });

  test('a UR lift in another object is not the same table; DRAFT and no-Urdu deck keys, retired and bot keys are not hits', () => {
    expect(wqEnWithoutUr(deck, [page([
      "  var A = { en: { split: 'Split', draft: 'Draft', noUr: 'No Urdu line', gone: 'Gone', line: 'Line' }, ur: {} };",
      "  var B = { en: {}, ur: { split: 'الگ' } };",
    ])])).toEqual(['jg.a.split']);
  });

  test('both halves in one object: no hit', () => {
    expect(wqEnWithoutUr(deck, [page([
      "  var T = { en: { both: 'Both', enOnly: 'Only English', split: 'Split' }, ur: { both: 'x', enOnly: 'y', split: 'z' } };",
    ])])).toEqual([]);
  });

  test('the EN-only list check: a new key fails, a key that gained its Urdu passes with a CLEAN line', () => {
    expect(listVerdict(['k'], [], 'x', 'f.json').failures).toEqual(['NEW: k x.']);
    expect(listVerdict([], ['k'], 'x', 'f.json')).toEqual({ failures: [], cleans: ['CLEAN: k is fixed or gone. Remove it from f.json.'] });
  });
});

/** The repo paths (sorted) of every bot/shared module loaded once the tree's states are built. */
function reachedModules() {
  statesInTree();
  return Object.keys(require.cache).map((f) => path.relative(REPO, f).split(path.sep).join('/'))
    .filter((f) => f.startsWith('bot/shared/')).sort();
}

describe('the tree', () => {
  test('the modules this gate reaches are the ones copy-deck-lift.modules.json lists', () => {
    const file = path.join(__dirname, 'copy-deck-lift.modules.json');
    const listed = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    const now = reachedModules();
    expect(now).toContain('bot/shared/config/ux-strings.js');
    const why = 'the deck-lift gate now reaches a different set of modules; update copy-deck-lift.modules.json (the train tool reads it to start a union run)';
    expect({ why, modules: listed }).toEqual({ why, modules: now });
  });

  test('every checked live deck key is lifted byte for byte, or listed; nothing new or moved', () => {
    const { failures, cleans } = copyGapVerdict(statesInTree(), ALLOW);
    for (const line of cleans) console.warn(line);
    expect(failures).toEqual([]);
  });

  test('every key a child page lifts in EN is lifted in UR in the same table, or listed as EN-only', () => {
    const { deck, scripts } = treeInputs();
    for (const k of Object.keys(EN_ONLY)) expect([k, String(EN_ONLY[k]).length >= 10]).toEqual([k, true]);
    const what = "is lifted in EN with no UR in the same table: lift the deck's Urdu beside it";
    const { failures, cleans } = listVerdict(wqEnWithoutUr(deck, scripts), Object.keys(EN_ONLY), what, 'copy-deck-en-only.allowlist.json');
    for (const line of cleans) console.warn(line);
    expect(failures).toEqual([]);
  });
});

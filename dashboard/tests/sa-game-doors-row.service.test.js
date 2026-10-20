/**
 * The big flight's row on the games door (wq-doors.js gamesBody, switch sa_game decided by the bot: the row arrives only
 * when the switch is on). Without the row the screen is today's, byte for byte; with it, one row in its own section,
 * through the same row() (the one button system), its title escaped inside <bdi>, its href only a /sa-game/ path, drawn in
 * the loaded state only, and it alone keeps the "no games" note away. Run in a vm beside wq-home.js. Invented values.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const KID = '0123456789abcdef';
const HUB = { lang: 'en', kids: [{ chip: KID, first: 'Zara', animal: 'owl', grade: '3' }], kid: KID, teacher: null, again: [], recs: [], challenge: { on: true, exercises: [] }, lib: null, brand: 'niete', rt: false };
const BIG = (lang) => ({ kind: 'bigtest', href: `/sa-game/${TOKEN}?kid=${KID}&lang=${lang}`, name: lang === 'ur' ? 'جگنو کی بڑی اڑان' : "Jugnu's big flight" });
const GAMES = [{ kind: 'numbers', stop: 'bigger', name: 'Which is bigger?' }];

function load() {
  const win = {};
  const sandbox = { window: win, localStorage: { getItem: () => null, setItem() {} }, JSON, Math, String, Number, Array, Object, encodeURIComponent, Date, isFinite, RegExp };
  vm.runInNewContext(fs.readFileSync(path.join(WQ, 'wq-home.js'), 'utf8'), sandbox);
  vm.runInNewContext(fs.readFileSync(path.join(WQ, 'wq-doors.js'), 'utf8'), sandbox);
  return win;
}
const W = load();
const B = (lang, extra = {}) => ({ ...HUB, lang, home_v3: 1, doors: { stories: [], games: [{ kind: 'numbers' }], videos: null }, ...extra });
const html = (lang, data, extra) => W.WQDOORS.html(B(lang, extra), { token: TOKEN, lang }, 'games', data);

test.each(['en', 'ur'])('%s: no row, the screen is unchanged; with the row, one more section and one more row', (lang) => {
  const off = html(lang, { games: GAMES });
  const on = html(lang, { games: [...GAMES, BIG(lang)] });
  expect(off).not.toContain('/sa-game/');
  expect(on).toContain(`href="/sa-game/${TOKEN}?kid=${KID}&amp;lang=${lang}"`);
  expect((on.match(/class="wq-row wq-drow"/g) || []).length).toBe((off.match(/class="wq-row wq-drow"/g) || []).length + 1);
  expect(on).toContain(`<bdi`);
  expect(on).toContain(BIG(lang).name.replace(/'/g, '&#39;'));
});

test('a row whose href is not a /sa-game/ path, or with no name, is never drawn', () => {
  const bad = html('en', { games: [...GAMES, { kind: 'bigtest', href: 'https://evil.example/x', name: 'x' }, { kind: 'bigtest', href: '/sa-game/x' }] });
  expect(bad).toBe(html('en', { games: GAMES }));
});

test('the row alone keeps the "no games" note away; failed and waiting states never draw it', () => {
  const none = W.WQDOORS.html(B('en', { doors: { stories: [], games: [], videos: null } }), { token: TOKEN, lang: 'en' }, 'games', { games: [] });
  const only = W.WQDOORS.html(B('en', { doors: { stories: [], games: [], videos: null } }), { token: TOKEN, lang: 'en' }, 'games', { games: [BIG('en')] });
  expect(only).toContain('/sa-game/');
  expect(only).not.toBe(none);
  const ls = { list_states: 1 };
  expect(html('en', { games: [BIG('en')], err: 1 }, ls)).not.toContain('/sa-game/');
  expect(html('en', null, ls)).not.toContain('/sa-game/');
});

/**
 * The previous school day's class quiz on the child's home (the hub's next.past_round, web_quiz_evening_round): the
 * shipped wq-home.js draws ONE row right under the Next tile, named by its weekday. Not finished: a tappable row (a
 * link to the round's code with the child's chip, a hit area of at least 48 px) that the home's own row tap opens;
 * finished: a greyed row that is not a link, with the child's stars (⭐ c/t, Urdu digits on an Urdu page). No
 * past_round: the home is today's, byte for byte. The row reuses the page's existing classes; no stylesheet changes.
 * Invented children only.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const KID = '0123456789abcdef';
const HOME = {
  lang: 'en', kids: [{ chip: KID, first: 'Zara', animal: 'owl', grade: '3' }], kid: KID, teacher: null, again: [], recs: [], challenge: { on: true }, lib: null,
  home_v3: 1, doors: { stories: [{ kind: 'passage', id: 'en.read.1.k07', fresh: true, title: 'The red kite' }], games: [{ kind: 'numbers' }], videos: null },
  head: { dots: 2, today: false, jar: { fresh: true } },
};
const GOLDEN = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'web-quiz-home-remember-golden.json'), 'utf8'));
const NEXT = {
  kind: 'quiz', variant: 'evening_round', id: 'ab12cd34ef', href: '/q/RND234?k=tonightchip', title: "Tonight's quiz", title_ur: 'آج شام کا کوئز',
  minutes: 5, tag: 'New', tag_ur: 'نیا', source: 'pinned', rank_src: 'pinned', arm: 'rank', alts: [],
};
const PAST = { code: 'RND233', href: '/q/RND233?k=pastchip', title: "Friday's quiz", title_ur: 'جمعہ کا کوئز', done: false };
const WQ_HOME_CSS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'wq', 'wq-home.css'), 'utf8');
const WQ_CSS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'wq', 'wq.css'), 'utf8');
const visible = (html) => html.replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]*>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

function load() {
  const win = { addEventListener() {}, scrollTo() {} };
  const document = { querySelector: () => null, createElement: () => ({ setAttribute() {}, addEventListener() {} }), head: { appendChild() {} }, documentElement: { classList: { contains: () => false } } };
  const store = {};
  const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'wq', 'wq-home.js'), 'utf8'),
    { window: win, document, navigator: {}, location: { hash: '', pathname: '/h/x', search: '' }, fetch: () => Promise.resolve({}), localStorage: ls, setTimeout, clearTimeout, Date, JSON, Math, String, Number, Array, Object, encodeURIComponent, RegExp, Promise });
  return win.WQHOME;
}
// the markup right after the Next tile (the tile is the one <a class="wq-next"…>…</a>)
function afterTile(html) {
  const at = html.indexOf('<a class="wq-next"');
  expect(at).toBeGreaterThan(-1);
  return html.slice(html.indexOf('</a>', at) + 4);
}

describe('no past_round: today\'s home, byte for byte', () => {
  test.each(['en', 'ur'])('%s: the golden home; and a home with a Next tile is the same with the field or without it, but for the row', (lang) => {
    const H = load();
    expect(H.html(HOME, { token: TOKEN, lang })).toBe(GOLDEN[lang]);
    const without = H.html({ ...HOME, next: NEXT }, { token: TOKEN, lang });
    const withRow = H.html({ ...HOME, next: { ...NEXT, past_round: PAST } }, { token: TOKEN, lang });
    const row = withRow.slice(withRow.length - afterTile(withRow).length, withRow.length - afterTile(without).length);
    expect(row.length).toBeGreaterThan(0);
    expect(withRow.replace(row, '')).toBe(without);
  });
});

describe('not finished: ONE tappable row right under the tile', () => {
  test.each([['en', "Friday's quiz"], ['ur', 'جمعہ کا کوئز']])('%s', (lang, words) => {
    const H = load();
    const html = H.html({ ...HOME, next: { ...NEXT, past_round: PAST } }, { token: TOKEN, lang });
    const rest = afterTile(html);
    // the very next element is the row's frame, and it holds exactly one link: the round's code with the child's chip
    expect(rest.startsWith('<div class="wq-social" data-past="open">')).toBe(true);
    const frame = rest.slice(0, rest.indexOf('</div>') + 6);
    expect(frame.match(/<a /g)).toHaveLength(1);
    expect(frame).toMatch(/<a class="wq-btn wq-soft wq-soc" data-tap="row" data-kind="past_round" href="\/q\/RND233\?k=pastchip">/);
    expect(visible(frame).trim()).toBe(words);
    expect((html.match(/RND233/g) || [])).toHaveLength(1);
    // one primary on the screen still: the tile
    expect((html.match(/data-primary/g) || []).length).toBe(1);
    expect(frame).not.toContain('data-primary');
  });

  test('a page_lang home names the child\'s language on the row\'s quiz link, as on the tile', () => {
    const H = load();
    const html = H.html({ ...HOME, page_lang: true, next: { ...NEXT, past_round: PAST } }, { token: TOKEN, lang: 'ur' });
    expect(html).toContain('href="/q/RND233?k=pastchip&amp;lang=ur"');
  });

  test('a row that would open anything but a quiz page is not drawn', () => {
    const H = load();
    const html = H.html({ ...HOME, next: { ...NEXT, past_round: { ...PAST, href: 'https://elsewhere.example/q/RND233' } } }, { token: TOKEN, lang: 'en' });
    expect(html).not.toContain('data-past');
  });

  test('its hit area: the reused button rule is at least 48 px tall (the page\'s own CSS, unchanged)', () => {
    const rule = /\.wq-social \.wq-soc\{[^}]*min-height:(\d+)px/.exec(WQ_HOME_CSS);
    expect(rule).not.toBeNull();
    expect(Number(rule[1])).toBeGreaterThanOrEqual(48);
    const look = /html\.wq-1b \.wq-social \.wq-btn\.wq-soft\.wq-soc[^{]*\{height:var\(--btn-h-2l\)/.test(WQ_CSS) && /--btn-h-2l:(\d+)px/.exec(WQ_CSS);
    expect(Number(look[1])).toBeGreaterThanOrEqual(48);
  });
});

describe('finished: a greyed row, not a link, with the child\'s stars', () => {
  test.each([['en', "Friday's quiz", '6/7'], ['ur', 'جمعہ کا کوئز', '۶/۷']])('%s', (lang, words, score) => {
    const H = load();
    const html = H.html({ ...HOME, next: { ...NEXT, past_round: { ...PAST, done: true, stars: { c: 6, t: 7 } } } }, { token: TOKEN, lang });
    const rest = afterTile(html);
    expect(rest.startsWith('<div class="wq-social" data-past="done">')).toBe(true);
    const frame = rest.slice(0, rest.indexOf('</div>') + 6);
    expect(frame).not.toMatch(/<a /);
    expect(html).not.toContain('RND233');
    // greyed by the button system's own disabled rule, and no tap of its own
    expect(frame).toMatch(/<button class="wq-btn wq-soft wq-soc" type="button" disabled>/);
    expect(frame).not.toContain('data-tap');
    expect(/\.wq-btn:disabled\{opacity:\.5/.test(WQ_CSS)).toBe(true);
    expect(frame).toContain(`<small>⭐ <bdi dir="ltr">${score}</bdi></small>`);
    expect(visible(frame).trim()).toBe(`${words} ⭐ ${score}`);
  });

  test('finished with no score on the sitting: the greyed row, no star line', () => {
    const H = load();
    const html = H.html({ ...HOME, next: { ...NEXT, past_round: { ...PAST, done: true } } }, { token: TOKEN, lang: 'en' });
    const frame = afterTile(html).slice(0, afterTile(html).indexOf('</div>') + 6);
    expect(frame).toContain('disabled>');
    expect(frame).not.toContain('⭐');
  });
});

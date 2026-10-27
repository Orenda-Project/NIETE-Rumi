/**
 * NO GRADE FORBIDS A GAME OR A VIDEO (bd-5gyspy.5), on the door screens (wq-doors.js, run in a vm as shipped):
 *   - Games: a folded grade picker ("All grades" / "Grades", no symbol glyph: no number on the screen until it opens), another grade's
 *     number games under that grade's own heading, each opening the practice play the server named (`href`); the pick
 *     is remembered on this phone per visitor and asked for as ?g=;
 *   - a teacher's «experience as a child» preview: the teacher's own quiz opens as the teacher's own preview (?p=);
 *   - Videos (the look's picker): «All grades» is a chip, the label names what the answer's `sel` says is on.
 * Invented children only.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const KID = '0123456789abcdef';
const HUB = { lang: 'en', kids: [{ chip: KID, first: 'Zara', animal: 'owl', grade: '3' }], kid: KID, teacher: null, again: [], recs: [], challenge: { on: true }, lib: null, home_v3: 1,
  doors: { stories: [{ kind: 'shelf' }], games: [{ kind: 'numbers' }], videos: { href: '/lib/x', watch: true, shelf: true } } };
const visible = (html) => html.replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]*>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const count = (html, rx) => (html.match(rx) || []).length;

function load({ adv = false, store = {}, gets = [] } = {}) {
  const ls = { getItem: (k) => (k in store ? store[k] : null), setItem(k, v) { store[k] = String(v); } };
  const win = { localStorage: ls };
  const document = { documentElement: { classList: { contains: (c) => adv && c === 'wq-adv' } } };
  const fetch = (url) => { gets.push(url); return new Promise(() => {}); };
  vm.runInNewContext(fs.readFileSync(path.join(WQ, 'wq-doors.js'), 'utf8'), { window: win, document, fetch, localStorage: ls, JSON, Math, String, Number, Array, Object, encodeURIComponent, Date, isFinite, RegExp });
  return win;
}
const ctx = (lang = 'en') => ({ token: TOKEN, lang });
const OWN = [{ kind: 'numbers', stop: 'missing', warm: true }, { kind: 'numbers', stop: 'bigger', name: 'Which is bigger?' }];
const OTHER = [{ kind: 'numbers', stop: 'bigger', name: 'Which is bigger?', g: 4, form: '5', href: '/c/PRTOK4?kid=#bigger' }];

describe('Games: every grade one tap away', () => {
  test('«All grades»: the folded picker says so; another grade\'s games under its own heading, opening the practice play', () => {
    for (const lang of ['en', 'ur']) {
      const W = load();
      const h = W.WQDOORS.html(HUB, ctx(lang), 'games', { games: [...OWN, ...OTHER], sel: 'all', first: [3] });
      expect(count(h, /data-primary/g)).toBe(1);
      expect(h).toContain(lang === 'en' ? '>All grades<i class="wq-caret" aria-hidden="true"></i></button>' : '>سب جماعتیں<i class="wq-caret" aria-hidden="true"></i></button>');
      expect(h).toContain('href="/c/PRTOK4?kid=#bigger"');
      expect(h).toContain(lang === 'en' ? '>Grade 4</bdi>' : '>جماعت ۴</bdi>');
      expect(h).not.toContain('·');
      expect(h).not.toContain('data-tap="gsel"');
    }
  });
  // P2-1 (design-qa): the Games picker names the selection as the Videos one does, en and ur
  const CARET = '<i class="wq-caret" aria-hidden="true"></i>';
  const label = (h) => ((/data-tap="gpk"[^>]*>([\s\S]*?)<\/button>/.exec(h) || [])[1] || '');
  test('the Games picker names the default selection: «Grade 3», «Grades 3, 4», «All grades» (en + ur); nothing else on the screen is a number', () => {
    const W = load();
    const PREVIEW = { ...HUB, practice: 1, practice_play: 1, kid: null, kids: [], grade: 3 };
    const cases = [
      [HUB, { games: OWN }, 'Grade 3', 'جماعت ۳'],
      [PREVIEW, { games: OWN, sel: [3, 4], first: [3, 4] }, 'Grades 3, 4', 'جماعت ۳، ۴'],
      [HUB, { games: OWN, sel: 'all', first: [3] }, 'All grades', 'سب جماعتیں'],
    ];
    for (const [B, data, en, ur] of cases) {
      expect(label(W.WQDOORS.html(B, ctx('en'), 'games', data))).toBe(en + CARET);
      expect(label(W.WQDOORS.html(B, ctx('ur'), 'games', data))).toBe(ur + CARET);
    }
    const h = W.WQDOORS.html(HUB, ctx(), 'games', { games: OWN });
    expect(visible(h.replace(/<button[^>]*data-tap="gpk"[\s\S]*?<\/button>/, ''))).not.toMatch(/\d/);
  });
  test('the pick is remembered per visitor and asked for as ?g=', () => {
    const gets = [];
    const W = load({ store: { [`wq_sel_games.${KID}`]: 'all' }, gets });
    expect(W.WQDOORS.html(HUB, ctx(), 'games', { games: OWN })).toContain('>All grades' + CARET + '</button>');
    const root = { innerHTML: '', setAttribute() {}, getAttribute: () => null, removeAttribute() {}, querySelector: () => null, querySelectorAll: () => [] };
    W.WQDOORS.mount(root, HUB, ctx(), 'games');
    expect(gets.some((u) => /\/api\/wq\/doors\/h\/[^?]+\?kid=0123456789abcdef&d=games&l=en&g=all$/.test(u))).toBe(true);
    // another child on the same phone keeps their own
    const W2 = load({ store: { [`wq_sel_games.${KID}`]: 'all' } });
    expect(W2.WQDOORS.html({ ...HUB, kid: 'fedcba9876543210', kids: [{ chip: 'fedcba9876543210', grade: '3' }] }, ctx(), 'games', { games: OWN })).toContain('>Grade 3' + CARET + '</button>');
  });
  test('a teacher\'s preview: the teacher\'s own quiz is a look-only tile (no link of any kind), saying the class plays it from the teacher\'s link', () => {
    for (const lang of ['en', 'ur']) {
      const W = load();
      const B = { ...HUB, practice: 1, practice_play: 1, kid: null, kids: [], grade: 3,
        doors: { ...HUB.doors, games: [{ kind: 'quiz', look: 1, topic: 'Nouns', subject: 'english', done: false, from: 'teacher' }, { kind: 'numbers' }] } };
      const h = W.WQDOORS.html(B, ctx(lang), 'games', { games: OWN });
      const tile = (h.match(/<li class="wq-dli[^"]*">(?:(?!<\/li>)[\s\S])*Nouns[\s\S]*?<\/li>/) || [''])[0];
      expect(tile).toContain('data-tap="look"');
      expect(tile).not.toMatch(/href=|\/q\//);
      expect(tile).toContain(lang === 'en' ? 'Your class plays this from your link' : 'آپ کی کلاس یہ آپ کے لنک سے کھیلتی ہے');
      expect(count(h, /data-primary/g)).toBe(1);
      expect(tile).not.toContain('data-primary');
    }
  });
});

describe('Videos: «All grades» in the look\'s picker', () => {
  const LIB = { grade: '3', grades: [{ g: '1' }, { g: '3' }, { g: '4' }], subjects: [{ key: 'Science', n: 1 }, { key: 'Maths', n: 1 }] };
  test('the label names the selection the answer says is on', () => {
    const W = load({ adv: true });
    const C = '<i class="wq-caret" aria-hidden="true"></i></button>';
    expect(W.WQDOORS.html(HUB, ctx(), 'videos', { lib: { ...LIB, sel: 'all', first: ['3'] } })).toContain('All grades' + C);
    expect(W.WQDOORS.html(HUB, ctx(), 'videos', { lib: { ...LIB, sel: ['3', '4'], first: ['3', '4'] } })).toContain('Grades 3, 4' + C);
    expect(W.WQDOORS.html(HUB, ctx(), 'videos', { lib: LIB })).toContain('Grade 3' + C);
    expect(W.WQDOORS.html(HUB, ctx('ur'), 'videos', { lib: { ...LIB, sel: ['3', '4'] } })).toContain('جماعت ۳، ۴' + C);
  });
  // P2-2 (design-qa): ONE caret rule for every picker: a CSS-drawn caret element, never a glyph
  test('no picker carries ▾ or any symbol glyph; Games and Videos carry the same caret element, drawn in CSS', () => {
    const W = load({ adv: true });
    const SYM = /[\u2190-\u2BFF\u{1F000}-\u{1FAFF}]/u;
    for (const lang of ['en', 'ur']) {
      for (const h of [W.WQDOORS.html(HUB, ctx(lang), 'games', { games: OWN }), W.WQDOORS.html(HUB, ctx(lang), 'videos', { lib: LIB })]) {
        expect(h).not.toMatch(SYM);
        expect(h).toContain('<i class="wq-caret" aria-hidden="true"></i>');
      }
    }
    const css = fs.readFileSync(path.join(WQ, 'wq-doors.css'), 'utf8');
    expect(css).toMatch(/\.wq-caret\s*\{[^}]*border-top:[^}]*\}/);
    expect(css).not.toMatch(/\.wq-caret[^{]*\{[^}]*content:\s*['"][^'"]/);
  });
});

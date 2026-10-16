/**
 * Jugnu's Book: the dashed next lamp carries its name (the deck's jg.rung.* for the next step), EN and UR.
 * The shipped wq-book.js runs in a vm; the bot's JSON is the only input. Invented children only.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BOOK_SRC = path.join(__dirname, '..', 'public', 'wq', 'wq-book.js');
const CSS_SRC = path.join(__dirname, '..', 'public', 'wq', 'wq-book.css');
const COPY = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'bot', 'shared', 'config', 'copy.v2.json'), 'utf8'));
const deck = (key, lang) => (COPY.keys || COPY)[key][lang];

function loadBook() {
  const win = { scrollTo() {} };
  vm.runInNewContext(fs.readFileSync(BOOK_SRC, 'utf8'), { window: win, JSON, Math, String, Number, Array, Object, encodeURIComponent });
  return win.WQBOOK;
}
const ladderOf = (h, ladder) => h.split(`data-ladder="${ladder}"`)[1].split('</ol>')[0];
const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&(#39|amp|lt|gt|quot);/g, ' ');
const nextName = (h, ladder) => {
  const m = ladderOf(h, ladder).match(/<li class="wq-bk-nextname"[^>]*>([\s\S]*?)<\/li>/);
  return m ? text(m[1]).trim() : null;
};
const BOOK = {
  name: 'Zara Testwala', trail_stickers: ['missing', 'listen'], story_stickers: [{ passage_id: 'p-1', title: 'The kite' }],
  lamps: { reading: 1, numbers: 1 }, next_outline: { reading: true, numbers: true }, days_this_week: [true, false, false, false, false, false, false],
  class_lights: { shown: false }, grade_band: 'G2-3',
};
const ctxOf = (lang) => ({ token: 't', kid: '0123456789abcdef', lang });
const LOCK = /lock|locked|🔒|تالا|بند/i;

describe('the next lamp has its name', () => {
  test.each(['en', 'ur'])('%s: one lit lamp, the dashed next lamp is named for the next step', (lang) => {
    const B = loadBook();
    const h = B._bookHtml(BOOK, ctxOf(lang), false);
    expect(nextName(h, 'reading')).toBe(deck('jg.rung.r2', lang));
    expect(nextName(h, 'numbers')).toBe(deck('jg.rung.n2', lang));
    // the ring itself stays a picture; the name is visible text right after it
    expect(ladderOf(h, 'reading')).toContain('<li class="wq-bk-outline" aria-hidden="true"></li><li class="wq-bk-nextname">');
    expect(LOCK.test(text(ladderOf(h, 'reading')) + text(ladderOf(h, 'numbers')))).toBe(false);
  });
  test('Urdu: every next name, no digit of any kind', () => {
    const B = loadBook();
    for (let lit = 0; lit < 5; lit++) {
      const h = B._bookHtml({ ...BOOK, lamps: { reading: lit, numbers: lit } }, ctxOf('ur'), false);
      expect(nextName(h, 'reading')).toBe(deck(`jg.rung.r${lit + 1}`, 'ur'));
      expect(nextName(h, 'numbers')).toBe(deck(`jg.rung.n${lit + 1}`, 'ur'));
      expect(/[0-9۰-۹٠-٩]/.test(nextName(h, 'reading') + nextName(h, 'numbers'))).toBe(false);
    }
  });
  test('no name without a ring: none at 5 lit, none when the bot sends no outline', () => {
    const B = loadBook();
    const h = B._bookHtml({ ...BOOK, lamps: { reading: 5, numbers: 2 }, next_outline: { reading: true, numbers: false } }, ctxOf('en'), false);
    expect(ladderOf(h, 'reading')).not.toContain('wq-bk-nextname');
    expect(ladderOf(h, 'numbers')).not.toContain('wq-bk-nextname');
  });
  test('golden: the lit lamps and the stickers are unchanged', () => {
    const B = loadBook();
    const h = B._bookHtml(BOOK, ctxOf('en'), false);
    expect(ladderOf(h, 'reading')).toBe('><h3>Reading</h3><ol><li class="wq-bk-lamp"><span class="wq-bk-glow" aria-hidden="true">🪔</span><span>Starting a story</span></li><li class="wq-bk-outline" aria-hidden="true"></li><li class="wq-bk-nextname">Reading a short story</li>');
    expect(h).toContain('<div class="wq-bk-trails"><span class="wq-bk-trail" aria-hidden="true">🔢</span><span class="wq-bk-trail" aria-hidden="true">🎧</span></div>');
    expect(h).toContain('<a class="wq-bk-st" data-pid="p-1" href="/c/t?kid=0123456789abcdef&amp;lang=en&amp;room=story&amp;pid=p-1"><span aria-hidden="true">⭐</span><span dir="auto">The kite</span></a>');
  });
  test('the name sits beside the ring and is a child-size Urdu line', () => {
    const css = fs.readFileSync(CSS_SRC, 'utf8');
    expect(css).toMatch(/\.wq-bk-outline\+\.wq-bk-nextname\{[^}]*padding-inline-start/);
    expect(css).toMatch(/html\[lang=ur\][^{]*\.wq-bk-nextname[^{]*\{font-size:20px/);
  });
});

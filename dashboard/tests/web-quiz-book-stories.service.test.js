/**
 * Jugnu's Book page (wq-book.js, run in a vm): a storybook sticker per finished book when the Book's JSON carries
 * `book_stickers` (web_quiz_stories); without the key the Book's HTML is exactly today's. Invented names and books only.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BOOK_SRC = path.join(__dirname, '..', 'public', 'wq', 'wq-book.js');
function loadBook() {
  const win = { scrollTo() {} };
  vm.runInNewContext(fs.readFileSync(BOOK_SRC, 'utf8'), { window: win, JSON, Math, String, Number, Array, Object, encodeURIComponent });
  return win.WQBOOK;
}
const BOOK = {
  name: 'Sami', trail_stickers: ['read'], story_stickers: [{ passage_id: 'p-1', title: 'The kite' }],
  lamps: { reading: 1, numbers: 0 }, next_outline: { reading: true, numbers: true }, days_this_week: [true, false, false, false, false, false, false],
  class_lights: null, grade_band: 'G2-3',
};
const ctx = (lang) => ({ token: 't', kid: 'k', lang });

describe('storybook stickers on the Book page', () => {
  test('no book_stickers key: the HTML is the same as before (the sticker list holds only the story stickers)', () => {
    const B = loadBook();
    const html = B._bookHtml(BOOK, ctx('en'), false);
    expect(html).not.toContain('wq-bk-sb');
    expect(B._bookHtml({ ...BOOK, book_stickers: [] }, ctx('en'), false)).toBe(html);
  });
  test('each finished storybook is a sticker with its title, Urdu titles isolated rtl', () => {
    const B = loadBook();
    const html = B._bookHtml({ ...BOOK, book_stickers: [{ book_id: 'b1', title: 'Book One Testwala', cover: '/s/b1/cover-a.webp' }, { book_id: 'b2', title: 'کتاب <b>', cover: null }] }, ctx('ur'), false);
    expect(html).toContain('class="wq-bk-st wq-bk-sb"');
    expect(html).toContain('Book One Testwala');
    expect(html).toContain('<span dir="auto">کتاب &lt;b&gt;</span>');
    expect((html.match(/wq-bk-sb/g) || []).length).toBe(2);
  });
  test('a Book with no story stickers but a storybook sticker still shows the sticker list', () => {
    const B = loadBook();
    const html = B._bookHtml({ ...BOOK, story_stickers: [], book_stickers: [{ book_id: 'b1', title: 'Book One Testwala' }] }, ctx('en'), false);
    expect(html).toContain('<div class="wq-bk-sts">');
  });
});

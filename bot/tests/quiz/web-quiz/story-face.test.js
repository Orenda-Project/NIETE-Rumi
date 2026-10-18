'use strict';
/**
 * The loader's face check (story-face.js, called by story-load.js planBook): an Urdu book whose text uses an Urdu
 * letter or mark the child pages' Urdu face does not draw is NAMED in the plan (face_holes) and on the loader's line,
 * so the face (and its frozen fixture, dashboard/tests/fixtures/face-lite-child-codepoints.json) is extended before
 * children read it. It never changes READY or the rows: a book without such a character plans exactly as before.
 * Invented "Testwala" books only.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../../../shared/services/quiz/story-load');
const F = require('../../../shared/services/quiz/story-face');

let dir;
afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); dir = null; });

// two pages, no pictures on disk (the plan still reads the text), one question file
function plan({ lang = 'ur', title = 'ٹیسٹ والا کی کتاب', author = 'ٹیسٹ والا', p1 = 'کُرۂ اَرض کی سیر۔', p2 = 'نظامِ شمسی، ۱۲۳؟', option = 'ٹیسٹ والی' } = {}) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wqsf-'));
  const page = (n, text) => ({ n, lang, image: { file: `p0${n}.webp`, w: 720, h: 1083 }, text, words: text.split(' ').map((t, i) => ({ i, t })), is_picture: false });
  const book = { source_id: 'src-testwala-face', slug: 'g4-ur-testwala', title, grade: 4, lang, author, text_ready: true, unsettled_pages: [], pages: [page(1, p1), page(2, p2)] };
  const qfile = path.join(dir, 'q.json');
  fs.writeFileSync(qfile, JSON.stringify({ questions: [{ n: 1, q: 'کس نے پڑھا؟', options: [{ t: option }, { t: 'ٹیسٹ والا' }], answer_i: 0, review_status: 'reviewed' }] }));
  return L.planBook({ book, serveDir: dir, questionsFile: qfile, cleared: true });
}

describe('the loader names an Urdu character the child face cannot draw', () => {
  it('a book in the face\'s characters plans as before: no face_holes', () => {
    const p = plan();
    expect('face_holes' in p).toBe(false);
  });

  it('a letter outside the face in page text, title, author or an option is named, once, in code point order', () => {
    // ٻ U+067B (Sindhi), ݨ U+0768 (Saraiki), ڱ U+06B1: none is in the face
    const p = plan({ p2: 'نظامِ ٻ شمسی', option: 'ٹیسٹ ݨ والی', author: 'ٹیسٹ ڱ ٻ' });
    expect(p.face_holes).toEqual(['U+067B', 'U+06B1', 'U+0768']);
    expect(plan({ title: 'کتاب ٻ' }).face_holes).toEqual(['U+067B']);
  });

  it('it changes nothing else: same READY, same reasons, same rows', () => {
    const a = plan();
    const b = plan({ p1: 'کُرۂ اَرض ٻ کی سیر۔' });
    const { face_holes: fh, ...rest } = b;
    expect(fh).toEqual(['U+067B']);
    expect(rest.ready).toBe(a.ready);
    expect(rest.why).toEqual(a.why);
    expect(rest.bookRow).toEqual(a.bookRow);
    expect(rest.questions).toEqual(a.questions);
  });

  it('Latin punctuation, digits and curly quotes are not holes (the next font draws them, as today)', () => {
    expect('face_holes' in plan({ p1: 'کُرۂ "اَرض" (2) – “سیر”.' })).toBe(false);
  });

  it('only Urdu books are checked', () => {
    expect('face_holes' in plan({ lang: 'en', p1: 'A ٻ B' })).toBe(false);
  });

  it('holes(): the face\'s range draws ۂ ئ ؤ ، ۔ ؟ zer, the Urdu digits, ZWNJ and ZWJ', () => {
    expect(F.holes(['ۂئؤ،۔؟ِ۰۹‌‍'])).toEqual([]);
    expect(F.holes(['ٻ', null, undefined, 7])).toEqual(['U+067B']);
  });
});

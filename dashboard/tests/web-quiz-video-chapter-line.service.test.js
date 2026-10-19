/**
 * The Videos see-all with the adventure look (<html class="wq-adv">): each card's small chapter line (`wq-vch`).
 *  - A lesson whose name is its chapter's name ("A، An اور The کا استعمال" under the same chapter) showed the same words
 *    twice. The chapter line is left out on that card only; every other card keeps it.
 *  - On an Urdu page the line was set at the Latin line height (1.3) with overflow hidden, so Nastaliq's deep tails
 *    (a final ل or ق) were cut into stray «،»-like marks («متعلق، فعل ،»). The Urdu line gets the Urdu one-line height.
 * Without the look the see-all is today's (the goldens in web-quiz-video-shelf stand). Invented content only.
 */
const fs = require('fs');
const path = require('path');
const F = require('./web-quiz-video-shelf.fixture');

const DOC = { document: { documentElement: { classList: { contains: (c) => c === 'wq-adv' } } } };
const SHELF = { href: '/lib/x', watch: true, shelf: true };
const SAME = 'A، An اور The کا استعمال';
const LIB = {
  grade: '3', subject: 'English', quiz: true,
  chapters: [{ name: 'Articles', name_ur: SAME, videos: [
    { vid: F.VID, title: 'Using A, An and The', title_ur: SAME, secs: 143 },
    { vid: F.VID2, title: 'When to Use A and An', title_ur: 'A اور An کب استعمال کریں؟', secs: 200 },
  ] }],
};
const vch = (h) => h.match(/<small class="wq-vch">.*?<\/small>/g) || [];

describe('the Videos see-all: a lesson named like its chapter', () => {
  test('ur: that card has no chapter line; the other card keeps it', () => {
    const W = F.load({ globals: DOC });
    const h = W.WQDOORS.html(F.boot('ur', SHELF), { token: F.TOKEN, lang: 'ur' }, 'videos', { subject: 'English', lib: LIB });
    expect(vch(h)).toEqual([`<small class="wq-vch"><bdi>${SAME}</bdi></small>`]);
    expect(h).toContain('A اور An کب استعمال کریں؟');
  });
  test('en: different names, so both cards keep their chapter line', () => {
    const W = F.load({ globals: DOC });
    const h = W.WQDOORS.html(F.boot('en', SHELF), { token: F.TOKEN, lang: 'en' }, 'videos', { subject: 'English', lib: LIB });
    expect(vch(h)).toHaveLength(2);
  });
});

describe('the chapter line on an Urdu page (in the Videos sheet: the look\'s own sheet is at its cap)', () => {
  const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-doors.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  test('is set at the Urdu one-line height, so Nastaliq tails are whole', () => {
    expect(CSS).toMatch(/html\.wq-adv\[lang=ur\] \.wq-vch\{[^}]*line-height:var\(--ulh1,2\)/);
  });
});

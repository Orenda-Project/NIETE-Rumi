/** The Videos door's screens with web_quiz_video_shelf OFF (no `shelf` on the boot's videos door): the pure render, both
 * languages, used to write and check the switch-off golden. Invented children and lessons only. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const KID = '0123456789abcdef';
const VID = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VID2 = 'aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const HUB = { lang: 'en', kids: [{ chip: KID, first: 'Zara Testwala', animal: 'owl', grade: '3' }], kid: KID, teacher: null, again: [], recs: [], challenge: { on: true, exercises: [] }, lib: null, brand: 'niete', rt: false };
const LIB_SUBJECTS = { grade: '3', subjects: [{ key: 'Science', n: 12, art: '/wq/art/subject-science.webp' }, { key: 'Maths', n: 9, art: '/wq/art/subject-maths.webp' }] };
const LIB_CHAPTERS = {
  grade: '3', subject: 'Science', art: '/wq/art/subject-science.webp', tile: 'neutral',
  chapters: [{ name: 'Chapter 1', art: 'https://r2.example.test/p1_poster.jpg?sig', videos: [
    { vid: VID, title: 'Life cycle of a hen', secs: 143, done: true, poster: 'https://r2.example.test/p1_poster.jpg?sig' },
    { vid: VID2, title: 'Parts of a flower', secs: 200, code: 'SCI002', k: 'kk2', poster: 'https://r2.example.test/p2_poster.jpg?sig' },
  ] }],
};
const WATCH = { vid: VID, url: 'https://r2.example.test/v1_web.mp4?sig', poster: 'https://r2.example.test/p1_poster.jpg?sig', title: 'Life cycle of a hen', after: true };

function load(extra = {}) {
  const win = { ...(extra.win || {}) };
  const sandbox = { window: win, localStorage: { getItem: () => null, setItem() {} }, JSON, Math, String, Number, Array, Object, encodeURIComponent, Date, isFinite, RegExp, ...(extra.globals || {}) };
  vm.runInNewContext(fs.readFileSync(path.join(WQ, 'wq-home.js'), 'utf8'), sandbox);
  vm.runInNewContext(fs.readFileSync(path.join(WQ, 'wq-doors.js'), 'utf8'), sandbox);
  return win;
}
function boot(lang, videos) {
  return { ...HUB, lang, home_v3: 1, doors: { stories: [], games: [], videos } };
}
// Every Videos screen for a class-less child (watch: true) and a class child, both languages.
function offScreens() {
  const W = load();
  const out = {};
  for (const lang of ['en', 'ur']) {
    const c = { token: TOKEN, lang };
    for (const [who, videos] of [['classless', { href: '/lib/x', watch: true }], ['class', { href: '/lib/x' }]]) {
      const B = boot(lang, videos);
      out[`${lang}.${who}.wait`] = W.WQDOORS.html(B, c, 'videos', null);
      out[`${lang}.${who}.subjects`] = W.WQDOORS.html(B, c, 'videos', { lib: LIB_SUBJECTS });
      out[`${lang}.${who}.chapters`] = W.WQDOORS.html(B, c, 'videos', { subject: 'Science', lib: LIB_CHAPTERS });
      out[`${lang}.${who}.watch`] = W.WQDOORS.html(B, c, `watch/${VID}`, { watch: WATCH, next: { kind: 'quiz', title: 'Play the quiz', sub: WATCH.title, href: '#' } });
      out[`${lang}.${who}.watchNoQuiz`] = W.WQDOORS.html(B, c, `watch/${VID}`, { watch: { ...WATCH, after: false }, next: { kind: 'video', title: 'More videos', sub: '', href: '#videos' } });
    }
  }
  return out;
}

module.exports = { load, boot, offScreens, TOKEN, KID, VID, VID2, HUB, LIB_SUBJECTS, LIB_CHAPTERS, WATCH };

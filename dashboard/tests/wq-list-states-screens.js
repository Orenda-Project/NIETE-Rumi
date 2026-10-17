/**
 * The door screens' markup (wq-doors.js beside wq-home.js in a vm) for the list-states suite and its golden: every
 * screen from the boot alone, from rows, empty, failed, and the video lists before their data. `extra` is spread into
 * the boot (e.g. {list_states: 1}). Invented rows only.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const KID = '0123456789abcdef';
const HUB = { lang: 'en', kids: [{ chip: KID, first: 'Zara', animal: 'owl', grade: '3' }], kid: KID, teacher: null, again: [], recs: [], challenge: { on: true, exercises: [] }, lib: null, brand: 'niete', rt: false };
const BOOT_GAMES = [{ kind: 'quiz', code: 'MATH01', k: 'kk', topic: 'Fractions', subject: 'Maths', done: false, from: 'teacher' }, { kind: 'numbers' }];
const GAMES = { games: [{ kind: 'numbers', stop: 'missing', warm: true }, { kind: 'numbers', stop: 'bigger', name: 'Which is bigger?' }, { kind: 'passage', id: 'en.read.1.k02', title: 'The red kite' }] };
const LIB_SUBJECTS = { grade: '3', subjects: [{ key: 'Science', n: 12, art: '/wq/art/subject-science.webp' }] };
const LIB_CHAPTERS = { grade: '3', subject: 'Science', chapters: [{ name: 'Chapter 1', videos: [{ vid: 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Life cycle of a hen', secs: 143 }] }] };

function load(extra = {}) {
  const win = { ...(extra.win || {}) };
  const sandbox = { window: win, localStorage: { getItem: () => null, setItem() {} }, JSON, Math, String, Number, Array, Object, encodeURIComponent, Date, isFinite, RegExp, ...(extra.globals || {}) };
  vm.runInNewContext(fs.readFileSync(path.join(WQ, 'wq-home.js'), 'utf8'), sandbox);
  vm.runInNewContext(fs.readFileSync(path.join(WQ, 'wq-doors.js'), 'utf8'), sandbox);
  return win;
}
function bootOf(lang, extra) {
  return { ...HUB, lang, home_v3: 1, stories: { on: true }, doors: { stories: [{ kind: 'shelf' }], games: BOOT_GAMES, videos: { href: '/lib/x', watch: true } }, ...extra };
}
function screensFor(lang, extra, W = load()) {
  const B = bootOf(lang, extra);
  const c = { token: TOKEN, lang };
  const none = { ...B, doors: { stories: [], games: [], videos: null } };
  return {
    storiesBoot: W.WQDOORS.html(B, c, 'stories', null),
    storiesRows: W.WQDOORS.html(B, c, 'stories', { stories: [], shelf: true }),
    storiesNone: W.WQDOORS.html(none, c, 'stories', { stories: [], shelf: false }),
    gamesBoot: W.WQDOORS.html(B, c, 'games', null),
    gamesRows: W.WQDOORS.html(B, c, 'games', GAMES),
    gamesNone: W.WQDOORS.html(none, c, 'games', { games: [] }),
    videosWait: W.WQDOORS.html(B, c, 'videos', null),
    videosSubjects: W.WQDOORS.html(B, c, 'videos', { lib: LIB_SUBJECTS }),
    videosErr: W.WQDOORS.html(B, c, 'videos', { lib: { err: true } }),
    chaptersWait: W.WQDOORS.html(B, c, 'videos', { subject: 'Science', lib: null }),
    chapters: W.WQDOORS.html(B, c, 'videos', { subject: 'Science', lib: LIB_CHAPTERS }),
  };
}
module.exports = { load, bootOf, screensFor, TOKEN, KID, HUB, GAMES, LIB_SUBJECTS, LIB_CHAPTERS };

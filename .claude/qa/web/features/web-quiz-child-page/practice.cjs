// web-quiz-child-page/practice — the teacher's class preview that PLAYS (app_settings web_quiz_practice_play) and the
// storybook voices as mp3 for a phone that cannot play Ogg Opus (web_quiz_story_mp3). The preview link is a hub token
// that names no child, only a grade ({k:'h', ids:[], pr:1, g}), signed with this run's key; every check goes through
// the bot's internal API as the portal calls it, and the database is read before and after to prove nothing was written.
'use strict';
const L = require('./lib.cjs');
const { expect, sleep, q } = L;
const modes = {}, runs = {};
const on = (id, mode, fn) => { modes[id] = mode; runs[id] = fn; };

const DEVICE = 'e2eLanePreview00000001';   // 22 of [A-Za-z0-9_-], the bot's device_ref shape
const CHILD_TABLES = ['students', 'quiz_sessions', 'web_quiz_challenge_runs', 'story_events', 'child_phone_bindings'];
const preview = (ctx, g = 3) => L.tokens(ctx).sign({ k: 'h', ids: [], pr: 1, g, lang: 'en', exp: Math.floor(Date.now() / 1000) + 3600 });
const H = { 'x-wq-device': DEVICE };
const api = (ctx, method, p, body) => L.bot(ctx, method, '/api/internal/wq' + p, body, H);

async function counts(ctx) {
  const out = {};
  for (const t of CHILD_TABLES) {
    // a table this lane's database does not have counts as absent, never as a failure of the scenario
    out[t] = await L.one(ctx, 'select count(*) from ' + t).catch(() => 'absent');
  }
  return out;
}
// The switch, then the bot's 30 s settings caches waited out (the hub answer says practice_play once it is read).
async function playing(ctx, page, value) {
  await L.setFlag(ctx, page, 'web_quiz_practice_play', value, null);
}
// The preview hub exists only under the child home (web_quiz_home_v3): practiceHub (web-quiz-hub-home.js) returns null
// with the home off, and the hub then reads the grade-only token as a child's and refuses it (401 bad_token). The
// lane seeds the home off, so WQ258/WQ259 turn it on with the play switch they test, in ONE cache wait, and put both
// back (absent) after, waiting the cache out again so the next scenario meets the lane's default.
async function previewOn(ctx, play) {
  await L.base.setSetting(ctx, 'web_quiz_home_v3', 'true');
  if (play) await L.base.setSetting(ctx, 'web_quiz_practice_play', 'true');
  else await ctx.sql("delete from app_settings where key = 'web_quiz_practice_play'");
  await sleep(31000);
}
async function previewOff(ctx) {
  await ctx.sql("delete from app_settings where key in ('web_quiz_home_v3', 'web_quiz_practice_play')");
  await sleep(31000);
}

on('WQ258', 'off', async (page, ctx) => {
  await previewOn(ctx, true);
  try {
    const t = preview(ctx, 3);
    const before = await counts(ctx);
    const hub = await api(ctx, 'GET', '/hub/' + encodeURIComponent(t));
    expect(hub.status === 200 && hub.json && hub.json.practice === 1, 'the preview hub → ' + hub.status);
    expect(hub.json.practice_play === 1, 'the hub does not say it plays: ' + JSON.stringify(hub.json).slice(0, 200));
    const shelf = await api(ctx, 'GET', '/stories/shelf/h/' + encodeURIComponent(t) + '?l=en');
    const stories = shelf.status === 404 ? 'stories off on this lane' : null;
    let book = null;
    if (!stories) {
      expect(shelf.status === 200 && Number(shelf.json.grade) === 3, 'the shelf → ' + shelf.status + ' ' + JSON.stringify(shelf.json).slice(0, 120));
      const first = (shelf.json.books || [])[0];
      if (first) {
        const b = await api(ctx, 'GET', '/stories/book/' + first.id + '/h/' + encodeURIComponent(t));
        expect(b.status === 200 && Array.isArray(b.json.pages) && b.json.lr3 === false, 'the book → ' + b.status);
        book = { pages: b.json.pages.length, voiced: b.json.pages.filter((p) => p.audio).length };
        const ev = await api(ctx, 'POST', '/stories/event/h/' + encodeURIComponent(t), { book_id: first.id, event: 'story_opened', data: {} });
        expect(ev.status === 200 && ev.json.ok === true, 'a story event → ' + ev.status);
      }
    }
    const games = await api(ctx, 'GET', '/doors/h/' + encodeURIComponent(t) + '?d=games&l=en');
    expect(games.status === 200 && Array.isArray(games.json.games), 'the Games door → ' + games.status);
    const numbers = games.json.games.filter((g) => g.kind === 'numbers').map((g) => g.stop);
    let scored = null;
    if (numbers.includes('bigger')) {
      const g = await api(ctx, 'GET', '/ch/' + encodeURIComponent(t) + '/bigger?lang=en');
      expect(g.status === 200 && g.json.practice_play === 1 && g.json.items.length, 'a game → ' + g.status);
      const r = await api(ctx, 'POST', '/ch/result', { ct: g.json.ct, taps: g.json.items.map((it, i) => ({ i, pick: Math.max(it.a, it.b), ms: 900 })), ms: 9000 });
      expect(r.status === 200 && r.json.score.correct === g.json.items.length, 'the game\'s score → ' + r.status + ' ' + JSON.stringify(r.json));
      scored = r.json.score;
    }
    const lib = await api(ctx, 'GET', '/lib/h/' + encodeURIComponent(t) + '?l=en');
    expect(lib.status === 200 && String(lib.json.grade) === '3', 'the library → ' + lib.status);
    let video = null;
    const subject = (lib.json.subjects || [])[0];
    if (subject) {
      const s = await api(ctx, 'GET', '/lib/h/' + encodeURIComponent(t) + '?l=en&s=' + encodeURIComponent(subject.key));
      const vid = ((((s.json || {}).chapters || [])[0] || {}).videos || [])[0];
      if (vid) {
        const v = await api(ctx, 'POST', '/videos/start', { hub: t, kid: '', vid: vid.vid });
        expect(v.status === 200 && v.json.watch && v.json.watch.after === false, 'a video → ' + v.status + ' ' + JSON.stringify(v.json).slice(0, 120));
        video = vid.vid;
      }
    }
    const after = await counts(ctx);
    expect(JSON.stringify(after) === JSON.stringify(before), 'a child table changed: ' + JSON.stringify(before) + ' → ' + JSON.stringify(after));
    return { stories: stories || (book ? 'book ' + JSON.stringify(book) : 'no book of grade 3 on this lane'), numbers, scored, video, tables: after };
  } finally { await previewOff(ctx); }
});

on('WQ259', 'off', async (page, ctx) => {
  await previewOn(ctx, false);
  try {
    const t = preview(ctx, 3);
    const hub = await api(ctx, 'GET', '/hub/' + encodeURIComponent(t));
    expect(hub.status === 200 && hub.json.practice === 1 && hub.json.practice_play === undefined, 'the look-only hub → ' + JSON.stringify(hub.json).slice(0, 160));
    const asks = [
      ['GET', '/stories/shelf/h/' + encodeURIComponent(t) + '?l=en'], ['GET', '/doors/h/' + encodeURIComponent(t) + '?d=games&l=en'],
      ['GET', '/lib/h/' + encodeURIComponent(t) + '?l=en'], ['GET', '/ch/' + encodeURIComponent(t) + '?lang=en'],
    ];
    const got = [];
    for (const [m, p] of asks) got.push((await api(ctx, m, p)).status);
    got.push((await api(ctx, 'POST', '/videos/start', { hub: t, kid: '', vid: '00000000-0000-4000-8000-000000000000' })).status);
    // the shelf answers 404 when stories are off on the lane; any other refusal is the 401 the preview meets today
    expect(got.every((s) => s === 401 || s === 404), 'a refusal expected for every content route: ' + got.join(','));
    await sleep(500);
    const refused = L.botLog(ctx).split('\n').filter((l) => /web_quiz\.content_refused/.test(l) && /"practice":1/.test(l)).length;
    expect(refused > 0, 'no content_refused with practice 1 in the bot log');
    return { statuses: got, refusedLogged: refused };
  } finally { await previewOff(ctx); }
});

on('WQ260', 'off', async (page, ctx) => {
  await playing(ctx, page, 'true');
  try {
    const t = preview(ctx, 3);
    const read = await api(ctx, 'GET', '/ch/' + encodeURIComponent(t) + '/read?lang=en');
    expect(read.status === 404, 'the counted read aloud was served to a preview: ' + read.status);
    const g = await api(ctx, 'GET', '/ch/' + encodeURIComponent(t) + '/bigger?lang=en');
    expect(g.status === 200 && g.json.ct, 'a preview run → ' + g.status);
    const up = await api(ctx, 'POST', '/ch/upload', { ct: g.json.ct, type: 'audio/webm', size: 1000 });
    const live = await api(ctx, 'POST', '/ch/live', { ct: g.json.ct, lang: 'en' });
    expect(up.status === 403 && live.status === 403, 'the microphone routes → ' + up.status + ' / ' + live.status);
    // a read-along story from the Games door, when this lane's bank has one for the grade
    const games = await api(ctx, 'GET', '/doors/h/' + encodeURIComponent(t) + '?d=games&l=en');
    const story = ((games.json || {}).games || []).find((x) => x.kind === 'passage' && x.id);
    let along = 'no read-along story for grade 3 on this lane';
    if (story) {
      const s = await api(ctx, 'GET', '/ch/' + encodeURIComponent(t) + '/read?lang=en&room=story&pid=' + encodeURIComponent(story.id));
      expect(s.status === 200 && s.json.practice_play === 1 && s.json.live === false, 'the read-along → ' + s.status);
      along = story.id;
    }
    return { read: read.status, upload: up.status, live: live.status, along };
  } finally { await playing(ctx, page, null); }
});

on('WQ261', 'off', async (page, ctx) => {
  const row = await L.rows(ctx, "select b.id, v.audio_key from story_page_voices v join story_pages p on p.id = v.page_id join story_books b on b.id = p.book_id where v.is_current and b.status = 'ready' and v.audio_key like '%.ogg' limit 1").catch(() => []);
  if (!row.length) return { blocked: 'this lane\'s database has no ready storybook with a stored voice (the demo seed carries no story audio in local storage)' };
  const [bookId, key] = row[0];
  const mp3 = ctx.baseUrl + '/s/' + bookId + '/' + String(key).split('/').pop().replace(/\.ogg$/, '.mp3');
  await L.base.setSetting(ctx, 'web_quiz_stories', 'true');
  await L.base.setSetting(ctx, 'web_quiz_story_mp3', 'true');
  try {
    await sleep(31000);   // the edge reads both switches with a 30 s cache
    const r = await page.request.get(mp3);
    expect(r.status() === 200 && /audio\/mpeg/.test(r.headers()['content-type'] || ''), 'the .mp3 → ' + r.status() + ' ' + r.headers()['content-type']);
    return { mp3: r.status(), bytes: (await r.body()).length };
  } finally { await ctx.sql("delete from app_settings where key = 'web_quiz_story_mp3'"); }
});

// "Your turn" in the class preview (bd-21q0kr; app_settings web_quiz_practice_your_turn): the preview link names its
// teacher (`tu`). Off: today's book (lr3 false) and the key refused 401. On, with live reading: the book offers Your turn
// with lr3_keep false, and the key route admits the preview (200 with a key where this lane has Redis and a speech key;
// 503 live_unavailable where it has not, never 401), and nothing is written under any child either way.
const LIVE_SWITCHES = ['web_quiz_stories', 'web_quiz_live_read_v3', 'web_quiz_challenge_realtime'];
on('WQ262', 'off', async (page, ctx) => {
  const TEACHER = '77777777-7777-4777-8777-777777777777';
  const t = L.tokens(ctx).sign({ k: 'h', ids: [], pr: 1, g: 3, lang: 'en', tu: TEACHER, exp: Math.floor(Date.now() / 1000) + 3600 });
  const kept = await L.rows(ctx, "select key, value::text from app_settings where key in ('" + LIVE_SWITCHES.join("','") + "')").catch(() => []);
  for (const k of LIVE_SWITCHES) await L.base.setSetting(ctx, k, 'true');
  await playing(ctx, page, 'true');
  try {
    const shelf = await api(ctx, 'GET', '/stories/shelf/h/' + encodeURIComponent(t) + '?l=en');
    const first = shelf.status === 200 ? (shelf.json.books || [])[0] : null;
    if (!first) return { blocked: 'no Grade 3 English storybook on this lane (shelf ' + shelf.status + ')' };
    const pages = await L.rows(ctx, "select n from story_pages where book_id = " + q(first.id) + " and not coalesce(is_picture, false) order by n limit 1").catch(() => []);
    const pageN = pages.length ? Number(pages[0][0]) : 1;
    const before = await counts(ctx);
    const keyRows = await L.one(ctx, 'select count(*) from web_quiz_live_read_keys').catch(() => 'absent');
    // the switch off: today's preview
    const offBook = await api(ctx, 'GET', '/stories/book/' + first.id + '/h/' + encodeURIComponent(t));
    expect(offBook.status === 200 && offBook.json.lr3 === false && !('lr3_keep' in offBook.json), 'switch off: the book → ' + offBook.status + ' lr3 ' + (offBook.json || {}).lr3);
    const offKey = await api(ctx, 'POST', '/lr/key', { st: t, kid: null, book: first.id, page: pageN, lang: 'en' });
    expect(offKey.status === 401, 'switch off: the key → ' + offKey.status);
    // the switch on
    await L.setFlag(ctx, page, 'web_quiz_practice_your_turn', 'true', null);
    const onBook = await api(ctx, 'GET', '/stories/book/' + first.id + '/h/' + encodeURIComponent(t));
    expect(onBook.status === 200 && onBook.json.lr3 === true && onBook.json.lr3_keep === false, 'switch on: the book → ' + onBook.status + ' ' + JSON.stringify({ lr3: (onBook.json || {}).lr3, keep: (onBook.json || {}).lr3_keep }));
    const onKey = await api(ctx, 'POST', '/lr/key', { st: t, kid: null, book: first.id, page: pageN, lang: 'en' });
    expect(onKey.status === 200 || (onKey.status === 503 && onKey.json && onKey.json.error === 'live_unavailable'), 'switch on: the key → ' + onKey.status + ' ' + JSON.stringify(onKey.json).slice(0, 80));
    if (onKey.status === 200) expect(typeof onKey.json.api_key === 'string' && onKey.json.run, 'switch on: a key with no run');
    const ev = await api(ctx, 'POST', '/stories/event/h/' + encodeURIComponent(t), { book_id: first.id, page_n: pageN, event: 'story_page_read', data: { words_total: 5, words_read: 5, ms: 4000, ended: 'last_word' } });
    expect(ev.status === 200 && ev.json.ok === true, 'the page read → ' + ev.status);
    const after = await counts(ctx);
    expect(JSON.stringify(after) === JSON.stringify(before), 'a child table changed: ' + JSON.stringify(before) + ' → ' + JSON.stringify(after));
    const keyRowsAfter = await L.one(ctx, 'select count(*) from web_quiz_live_read_keys').catch(() => 'absent');
    expect(keyRowsAfter === keyRows, 'a child key row was written: ' + keyRows + ' → ' + keyRowsAfter);
    return { book: first.id, page: pageN, key: onKey.status === 200 ? 'minted' : 'lane has no Redis or speech key (503)', tables: after };
  } finally {
    await ctx.sql("delete from app_settings where key = 'web_quiz_practice_your_turn'");
    await ctx.sql("delete from app_settings where key in ('" + LIVE_SWITCHES.join("','") + "')");
    for (const [k, v] of kept) await L.base.setSetting(ctx, k, v);
    await playing(ctx, page, null);
  }
});

module.exports = { runs, modes };

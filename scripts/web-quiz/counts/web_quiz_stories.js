#!/usr/bin/env node
'use strict';
/**
 * count: web_quiz_stories — what the storybook shelf serves, per grade × language, and what the smallest-served
 * children would see with the switch on. Read-only.
 *
 *   node scripts/web-quiz/counts/web_quiz_stories.js olvritwoqujtjvwfulbh
 *
 * Per grade × language: live books (status ready) and books not live yet (by status), their text and picture pages,
 * text pages with a voice (word-timed / line-timed) and without one, and live books with at least one reviewed
 * question. Then two brand-new children nobody has seen (a random id with no rows), an English grade-2 child and an
 * Urdu grade-1 child: their shelf and the storybooks the next-thing slot may offer them, with the switch forced ON in
 * this process only (nothing in app_settings is changed). Only counts are printed: never a title, a page's words, a
 * name, a phone or a raw id.
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY; refuses unless the ref on argv is the sandbox's and SUPABASE_URL
 * carries it ("REFUSED: not sandbox"). Exit 0; 1 = a child's shelf is empty; 2 = refused or usage.
 */
const crypto = require('crypto');
const path = require('path');

const SANDBOX_REF = 'olvritwoqujtjvwfulbh';
const GRADES = [1, 2, 3, 4, 5];
const LANGS = ['en', 'ur'];

/** The per grade × language table from the storybook rows. Pure. */
function tableOf({ books = [], pages = [], voices = [], questions = [] } = {}) {
  const voiceOf = new Map(voices.filter((v) => v.is_current).map((v) => [v.page_id, v]));
  const pagesOf = new Map();
  pages.forEach((p) => { if (!pagesOf.has(p.book_id)) pagesOf.set(p.book_id, []); pagesOf.get(p.book_id).push(p); });
  const asked = new Set(questions.filter((q) => q.review_status === 'reviewed').map((q) => q.book_id));
  const rows = [];
  GRADES.forEach((grade) => LANGS.forEach((lang) => {
    const mine = books.filter((b) => Number(b.grade) === grade && b.lang === lang);
    const live = mine.filter((b) => b.status === 'ready');
    const r = { grade, lang, live: live.length, waiting: {}, text: 0, picture: 0, word_timed: 0, line_timed: 0, no_voice: 0, with_questions: 0 };
    mine.filter((b) => b.status !== 'ready').forEach((b) => { r.waiting[b.status || 'none'] = (r.waiting[b.status || 'none'] || 0) + 1; });
    live.forEach((b) => {
      if (asked.has(b.id)) r.with_questions += 1;
      (pagesOf.get(b.id) || []).forEach((p) => {
        if (p.is_picture) { r.picture += 1; return; }
        r.text += 1;
        const v = voiceOf.get(p.id);
        if (!v) r.no_voice += 1;
        else if (v.quality === 'low') r.line_timed += 1;
        else r.word_timed += 1;
      });
    });
    rows.push(r);
  }));
  const live = books.filter((b) => b.status === 'ready').length;
  return { rows, live, waiting: books.length - live };
}

function print(io, t) {
  io.stdout.write(`${t.live} live; ${t.waiting} not live yet\n\n`);
  io.stdout.write('  grade lang  live  not-live            text  picture  word-timed  line-timed  no-voice  with-questions\n');
  t.rows.forEach((r) => {
    const w = Object.entries(r.waiting).map(([k, n]) => `${k} ${n}`).join(', ') || '-';
    io.stdout.write(`  ${String(r.grade).padStart(5)} ${r.lang.padEnd(4)} ${String(r.live).padStart(5)}  ${w.padEnd(18)} ${String(r.text).padStart(5)}  ${String(r.picture).padStart(7)}  ${String(r.word_timed).padStart(10)}  ${String(r.line_timed).padStart(10)}  ${String(r.no_voice).padStart(8)}  ${String(r.with_questions).padStart(14)}\n`);
  });
}

async function readAll(supabase, table, cols) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(cols).range(from, from + 999); // eslint-disable-line no-await-in-loop
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}

async function main({ argv = process.argv.slice(2), env = process.env, io = process } = {}) {
  const say = (s) => io.stderr.write(`${s}\n`);
  if (argv[0] !== SANDBOX_REF || !String(env.SUPABASE_URL || '').includes(SANDBOX_REF) || !env.SUPABASE_SERVICE_ROLE_KEY) {
    say('REFUSED: not sandbox (usage: web_quiz_stories.js olvritwoqujtjvwfulbh, with the sandbox SUPABASE_URL and key)');
    return 2;
  }
  if (!env.WEB_QUIZ_TOKEN_SECRET) env.WEB_QUIZ_TOKEN_SECRET = crypto.randomBytes(24).toString('hex'); // links only; never printed
  const ROOT = path.join(__dirname, '..', '..', '..', 'bot', 'shared');
  const supabase = require(path.join(ROOT, 'config', 'supabase'));
  const t = tableOf({
    books: await readAll(supabase, 'story_books', 'id, grade, lang, status'),
    pages: await readAll(supabase, 'story_pages', 'id, book_id, is_picture'),
    voices: await readAll(supabase, 'story_page_voices', 'page_id, quality, is_current'),
    questions: await readAll(supabase, 'story_questions', 'book_id, review_status'),
  });
  print(io, t);
  // the switch forced ON in this process only: the stories module's settings read answers "on"
  const realFrom = supabase.from.bind(supabase);
  supabase.from = (table) => (table === 'app_settings'
    ? { select: () => ({ in: async () => ({ data: [{ key: 'web_quiz_stories', value: true }], error: null }) }) }
    : realFrom(table));
  const Q = path.join(ROOT, 'services', 'quiz');
  const S = require(path.join(Q, 'web-quiz-stories'));
  const Next = require(path.join(Q, 'web-quiz-storybook-next'));
  const T = require(path.join(Q, 'web-quiz-token'));
  S._reset();
  const children = [
    { label: 'new-en-g2 (nothing read)', id: crypto.randomUUID(), lang: 'en', grade: 2 },
    { label: 'new-ur-g1 (nothing read)', id: crypto.randomUUID(), lang: 'ur', grade: 1 },
  ];
  let empty = 0;
  for (const c of children) {
    const { ordered } = await S.orderedBooks(c.id, { grade: c.grade, lang: c.lang }); // eslint-disable-line no-await-in-loop
    const rows = await Next.candidates({ studentId: c.id, lang: c.lang, grade: c.grade, token: T.signHub([c.id]), chip: 'a' }); // eslint-disable-line no-await-in-loop
    const covers = ordered.filter((b) => S.fileUrl(b.id, b.cover_file)).length;
    io.stdout.write(`\n${c.label}: shelf ${ordered.length} books (${covers} with a cover); next-thing slot: ${rows.length} storybooks`
      + ` (resume ${rows.filter((r) => r.rule === 'resume').length}, unread ${rows.filter((r) => !r.rule).length})\n`);
    if (!ordered.length) empty += 1;
  }
  return empty ? 1 : 0;
}

if (require.main === module) {
  main().then((code) => process.exit(code), (e) => { process.stderr.write(`${e && e.stack ? e.stack : e}\n`); process.exit(2); });
}

module.exports = { main, tableOf, SANDBOX_REF };

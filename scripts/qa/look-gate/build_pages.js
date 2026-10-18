#!/usr/bin/env node
/**
 * The look gate's pages: the REAL page shells (dashboard renderHubPage / renderQuizPage) around invented boots, so
 * run_look.py can open every child screen as a phone and measure it (the page gutter, the button system, the
 * grown-ups hold). `--on` adds the one-button switch's field (`one_button: true`) to every boot, exactly as the bot's
 * answers carry it when app_settings web_quiz_one_button is on; without it the boots are today's. `--adv` adds the
 * adventure look's field (`adv: true`, web_quiz_adventure_look) on top of `--on` (the look is drawn only with it).
 *
 *   node build_pages.js <out_dir> [--on] [--adv]   → <out_dir>/pages/<name>-<lang>.html + manifest.json
 *
 * Invented children only ("Sana Testwala"). Needs no network, no database.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'look-gate';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';

const { renderHubPage } = require(path.join(ROOT, 'dashboard/routes/web-quiz.routes'));
const Matrix = require(path.join(ROOT, 'scripts/qa/render-matrix/build_matrix'));

const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const KID = '0123456789abcdef';
const ORIGIN = 'http://127.0.0.1';

function hubBoot(lang) {
  const ur = lang === 'ur';
  return {
    lang, kids: [{ chip: KID, first: 'Sana Testwala', animal: 'owl', grade: '3' }], kid: KID,
    teacher: null, again: [], recs: [], challenge: { on: true, exercises: [] }, lib: { href: `/lib/${TOKEN}?kid=${KID}&l=${lang}` }, brand: 'niete', rt: false,
    home_v3: 1, head: { dots: 3, today: false, jar: { fresh: true } },
    doors: {
      stories: [{ kind: 'passage', id: 'en.read.1.k07', fresh: true, title: ur ? 'لال پتنگ' : 'The red kite' }, { kind: 'listen', id: 'en.listen.1.k02', fresh: false }],
      games: [{ kind: 'quiz', code: 'MATH01', k: 'kk', topic: ur ? 'کسریں' : 'Fractions', subject: 'Maths', done: false, from: 'teacher' }, { kind: 'numbers' }, { kind: 'quiz', code: 'SCI001', k: 'k2', topic: ur ? 'پودے' : 'Plants', subject: 'Science', done: true }],
      videos: { href: `/lib/${TOKEN}?kid=${KID}&l=${lang}` },
    },
  };
}

function main() {
  const out = path.resolve(process.argv[2] || path.join(__dirname, 'out'));
  const adv = process.argv.includes('--adv');
  const on = adv || process.argv.includes('--on');
  const field = (p) => (on ? { ...p, one_button: true, ...(adv ? { adv: true } : {}) } : p);
  fs.mkdirSync(path.join(out, 'pages'), { recursive: true });
  const manifest = [];
  for (const lang of ['en', 'ur']) {
    const hub = renderHubPage({ payload: field(hubBoot(lang)), token: TOKEN, origin: ORIGIN, assetV: 'look' });
    fs.writeFileSync(path.join(out, 'pages', `hub-${lang}.html`), hub);
    manifest.push({ name: `hub-${lang}`, kind: 'hub', lang, path: `/h/hub-${lang}` });
    // the storybook shelf on: its wait (the shelf answer held) and its retry (the shelf answer failed)
    const sb = hubBoot(lang);
    sb.doors.stories = [{ kind: 'shelf' }, ...sb.doors.stories];
    sb.stories = { on: true };
    fs.writeFileSync(path.join(out, 'pages', `shelf-${lang}.html`), renderHubPage({ payload: field(sb), token: TOKEN, origin: ORIGIN, assetV: 'look' }));
    manifest.push({ name: `shelf-${lang}`, kind: 'shelf', lang, path: `/h/shelf-${lang}` });
    const shape = Matrix.shapes(lang).find((s) => s.id === `${lang}-single-3`);
    const q = Matrix.pageFor(shape);
    const { renderQuizPage } = require(path.join(ROOT, 'dashboard/routes/web-quiz.routes'));
    // a class child's own run with the always-on Home and Back (sandbox's web_quiz_home_button / web_quiz_back_nav)
    const html = renderQuizPage({ payload: field({ ...q.payload, nav: { home: true, back: true } }), code: q.code, view: 'quiz', origin: ORIGIN, assetV: 'look', url: `${ORIGIN}/q/${q.code}` });
    fs.writeFileSync(path.join(out, 'pages', `quiz-${lang}.html`), html);
    manifest.push({ name: `quiz-${lang}`, kind: 'quiz', lang, path: `/q/quiz-${lang}`, code: q.code, filler: q.fillerQid, answer: Matrix.answers(q.item).right });
  }
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ on, adv, token: TOKEN, kid: KID, pages: manifest }, null, 1));
  process.stdout.write(`look gate: ${manifest.length} pages (${adv ? 'one_button + adventure look on' : on ? 'one_button on' : 'today'}) → ${out}\n`);
}

if (require.main === module) main();
module.exports = { hubBoot, TOKEN, KID };

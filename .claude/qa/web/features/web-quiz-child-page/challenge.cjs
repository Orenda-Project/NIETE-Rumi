// web-quiz-child-page/challenge — Jugnu's Challenge (/c/<token>): the menu and what it offers, eligibility, "Which is
// bigger?" with its server re-scoring, "Missing number" and its keypad, the Trail (badges, practice rounds, the help
// question, waiting stops), the record rule, the daily cap, Urdu digits, the no-microphone branches. Read aloud and
// "Listen and answer" need a microphone, a live speech vendor or a story clip none of which this lane has; those say so.
// Entry: /c/<session token> (web-quiz-challenge.js entryOf accepts a session token with a student). Screens are
// section.wq-screen.wqc[data-screen="…"]; the mascot's line is #wqc-say.
'use strict';
const L = require('./lib.cjs');
const { expect, WAIT, CODES, text, inner, count, onScreen, openQuiz, startAsNew, play, toResults, sleep, q } = L;
const modes = {}, runs = {};
const on = (id, mode, fn) => { modes[id] = mode; runs[id] = fn; };
const S = (name) => '.wqc[data-screen="' + name + '"]';
const MIC = 'needs a microphone (getUserMedia + MediaRecorder) and the speech vendor (Soniox) to score the reading; headless Chromium has no microphone and this lane replays cassettes that hold no child reading';
const CLIP = '"Listen and answer" is offered only once the story clip exists in the quiz-audio bucket, which the voice vendor records; no vendor on this lane';

async function api(page, ctx, method, p, body) {
  const url = ctx.baseUrl + '/api/wq/' + p;
  const r = method === 'GET' ? await page.request.get(url) : await page.request.post(url, { data: body });
  let json = null; try { json = await r.json(); } catch (_) { /* not JSON */ }
  return { status: r.status(), json };
}
// A finished child on `code` (today's path), with the page's storage set so /c/<st> is this phone's child.
// The lane's database is cloned from the e2e baseline (supabase/baseline/schema.sql, a sandbox dump of 2026-10-14),
// which predates the runs' provenance columns (via, mode, …: infrastructure/supabase/00_complete-schema.sql, 2026-10-15).
// Under the record rule the menu reads those columns and FAILS CLOSED (503, web_quiz.ch_runs_read_failed) when they
// are missing — the deploy's migration adds them. Applied here once per run, straight from the repo's schema file.
let provenanceDone = null;
async function ensureProvenance(ctx) {
  if (!provenanceDone) provenanceDone = (async () => {
    const fs = require('fs'), path = require('path');
    const schema = fs.readFileSync(path.resolve(__dirname, '../../../../..', 'infrastructure/supabase/00_complete-schema.sql'), 'utf8');
    const alters = schema.split('\n').filter((l) => /^ALTER TABLE web_quiz_challenge_runs ADD COLUMN IF NOT EXISTS /.test(l));
    expect(alters.length >= 20, 'the repo schema carries ' + alters.length + ' provenance columns for web_quiz_challenge_runs');
    await ctx.sql(alters.join('\n'));
    return alters.length;
  })();
  return provenanceDone;
}
async function child(page, ctx, code, name) {
  await ensureProvenance(ctx);
  const { st } = await L.finishFast(page, ctx, code, name);
  expect(st, 'no session token after the finish');
  return st;
}
async function openChallenge(page, ctx, st, extra) {
  await page.goto(ctx.baseUrl + '/c/' + encodeURIComponent(st) + (extra || ''), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.wqc[data-screen], .wq-closed, main .wq-screen', { state: 'attached', timeout: WAIT });
}
const screenName = (page) => page.$eval('.wqc[data-screen]', (e) => e.getAttribute('data-screen')).catch(() => null);
const tiles = (page) => page.$$eval('.wqc-tile, .wqc-stop', (els) => els.map((e) => ({ id: e.id.replace('wqc-ex-', ''), text: e.innerText.replace(/\s+/g, ' ').trim(), badge: e.getAttribute('data-badge') })));
// The menu or trail, from the entry screen (the help question or a mic notice may come first on the trail).
async function toMenu(page) {
  await page.waitForSelector(S('menu') + ', ' + S('trail') + ', ' + S('help-ask'), { state: 'attached', timeout: WAIT });
  if (await page.$(S('help-ask'))) { await page.click('#wqc-help-no'); await page.waitForSelector(S('menu') + ', ' + S('trail'), { state: 'attached', timeout: WAIT }); }
  return screenName(page);
}
// Play "Which is bigger?" in the browser, tapping at once (right or wrong by `right`), through to the result screen.
async function playBigger(page, right) {
  await page.click('#wqc-ex-bigger');
  await page.waitForSelector(S('help-ask') + ', ' + S('intro'), { state: 'attached', timeout: WAIT });
  if (await page.$(S('help-ask'))) { await page.click('#wqc-help-no'); await page.waitForSelector(S('intro'), { state: 'attached', timeout: WAIT }); }
  await page.click('#wqc-go');
  // practice pairs, then the run: tap the bigger (or the smaller) number each time (a "go" screen between them waits).
  // Taps are forced and non-fatal: a card replaced by the next pair mid-tap must not hold the loop for 30 s.
  for (let i = 0; i < 40; i++) {
    const scr = await page.waitForSelector(S('bigger-practice') + ', ' + S('bigger-go') + ', ' + S('bigger-play') + ', ' + S('bigger-wait') + ', ' + S('bigger-result'), { state: 'attached', timeout: 20000 });
    const name = await scr.getAttribute('data-screen');
    if (name === 'bigger-result') return;
    if (name === 'bigger-wait') { await page.waitForSelector(S('bigger-result'), { state: 'attached', timeout: 20000 }); return; }
    if (name === 'bigger-go') { await sleep(1200); continue; }
    const a = Number(await inner(page, '#wqc-a').catch(() => NaN)), b = Number(await inner(page, '#wqc-b').catch(() => NaN));
    if (Number.isFinite(a) && Number.isFinite(b)) await page.click((a > b) === right ? '#wqc-a' : '#wqc-b', { force: true, timeout: 3000 }).catch(() => {});
    await sleep(name === 'bigger-practice' ? 1900 : 300);
  }
  await page.waitForSelector(S('bigger-result'), { state: 'attached', timeout: 20000 });
}

on('WQ095', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const st = await child(page, ctx, CODES.OPEN, 'Chal95');
  await openChallenge(page, ctx, st);
  const scr = await toMenu(page);
  const ex = await tiles(page);
  const ids = ex.map((e) => e.id);
  expect(ids.includes('bigger') && ids.includes('missing'), 'the menu lacks a built exercise: ' + ids.join(','));
  expect(!ids.includes('listen'), '"Listen and answer" is offered although its story clip cannot exist here');
  expect(ids.every((i) => ['bigger', 'missing', 'read', 'listen'].includes(i)), 'an unbuilt exercise is offered: ' + ids.join(','));
  const names = ex.map((e) => e.text);
  expect(names.some((n) => /Which is bigger\?/.test(n)) && names.some((n) => /Missing number/.test(n)), 'tile names: ' + names.join(' | '));
  return { screen: scr, exercises: ids };
});

on('WQ096', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const st = await child(page, ctx, CODES.G1, 'Tiny96');
  const r = await page.request.get(ctx.baseUrl + '/c/' + encodeURIComponent(st));
  const html = await r.text();
  expect(/This challenge is for classes 2 to 5\./.test(html), 'a grade-1 child got: ' + html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 160));
  const ok = await child(page, ctx, CODES.G3, 'Three96');
  await openChallenge(page, ctx, ok); await toMenu(page);
  expect((await tiles(page)).length >= 1, 'a grade-3 child was not offered the Challenge');
  return { grade1: 'not eligible', grade3: 'offered', note: 'no grade-6 quiz in the demo seed' };
});

on('WQ097', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const hub = async (code, name) => {
    await page.evaluate(() => localStorage.clear()).catch(() => {});
    await L.finishFast(page, ctx, code, name);
    await page.click('#wq-hubdoor'); await page.waitForURL(/\/h\//, { timeout: WAIT });
    await page.waitForSelector(onScreen('H2'), { state: 'attached', timeout: WAIT });
    return Boolean(await page.$('#wq-h-ch'));
  };
  const g4 = await hub(CODES.OPEN, 'Hub97');
  expect(g4, 'a grade-4 child\'s hub has no Challenge tile');
  await page.goto(ctx.baseUrl + '/wq/probe.html', { waitUntil: 'domcontentloaded' });
  const g1 = await hub(CODES.G1, 'Hub97b');
  expect(!g1, 'a grade-1 child\'s hub shows the Challenge tile');
  return { grade4: 'tile', grade1: 'no tile' };
});

on('WQ098', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const st = await child(page, ctx, CODES.OPEN, 'Big98');
  // the served items and the run token
  const ex = await api(page, ctx, 'GET', 'ch/' + encodeURIComponent(st) + '/bigger?lang=en');
  expect(ex.status === 200 && ex.json.ct && Array.isArray(ex.json.items), 'serve → ' + ex.status + ' ' + JSON.stringify(ex.json).slice(0, 120));
  const items = ex.json.items;
  // every pick is the bigger number, but each took 10001 ms: the server scores them all wrong
  const slow = await api(page, ctx, 'POST', 'ch/result', { ct: ex.json.ct, taps: items.map((it, i) => ({ i, pick: Math.max(it.a, it.b), ms: 10001 })), ms: 10001 * items.length });
  expect(slow.status === 200 && slow.json.score && slow.json.score.correct === 0, 'slow right picks scored ' + JSON.stringify(slow.json.score));
  // a second submit on the same run is refused
  const again = await api(page, ctx, 'POST', 'ch/result', { ct: ex.json.ct, taps: items.map((it, i) => ({ i, pick: Math.max(it.a, it.b), ms: 800 })), ms: 9000 });
  expect(again.status === 409, 'a second submit answered ' + again.status);
  // a new run: the first four wrong, the rest right → stopped after four, the later picks not counted
  const ex2 = await api(page, ctx, 'GET', 'ch/' + encodeURIComponent(st) + '/bigger?lang=en');
  const items2 = ex2.json.items;
  const stop = await api(page, ctx, 'POST', 'ch/result', { ct: ex2.json.ct, taps: items2.map((it, i) => ({ i, pick: i < 4 ? Math.min(it.a, it.b) : Math.max(it.a, it.b), ms: 900 })), ms: 9000 });
  expect(stop.status === 200 && stop.json.score && stop.json.score.stopped === true && stop.json.score.correct === 0, 'four wrong in a row did not stop the run: ' + JSON.stringify(stop.json.score));
  return { slowPicks: slow.json.score, stop: stop.json.score };
});

on('WQ105', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const st = await child(page, ctx, CODES.OPEN, 'Rec105');
  await openChallenge(page, ctx, st); await toMenu(page);
  await playBigger(page, true);
  expect(/You got \d+ out of 10!/.test(await inner(page, '#wqc-score').catch(() => '')), 'no score on the result screen');
  await page.click('#wqc-menu'); await toMenu(page);
  const bigger = (await tiles(page)).find((e) => e.id === 'bigger');
  expect(bigger && /Done/.test(bigger.text) && !/\d\s*\/\s*10|\d+ words/.test(bigger.text), 'the menu shows a number for a recorded stop: "' + bigger.text + '"');
  const rows = await L.rows(ctx, "select status, score::text from web_quiz_challenge_runs where exercise = 'bigger' order by created_at desc limit 1");
  expect(rows.length && rows[0][0] === 'scored', 'the run row is ' + JSON.stringify(rows));
  return { menu: bigger.text };
});

on('WQ111', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const st = await child(page, ctx, CODES.OPEN, 'Items111');
  const ex = await api(page, ctx, 'GET', 'ch/' + encodeURIComponent(st) + '/bigger?lang=en');
  await api(page, ctx, 'POST', 'ch/result', { ct: ex.json.ct, taps: ex.json.items.map((it, i) => ({ i, pick: i % 3 === 0 ? Math.min(it.a, it.b) : Math.max(it.a, it.b), ms: 700 + i * 50 })), ms: 9000 });
  const [[meta]] = await L.rows(ctx, "select meta::text from web_quiz_challenge_runs where exercise = 'bigger' order by created_at desc limit 1");
  const m = JSON.parse(meta);
  const items = m.items || m.rows || null;
  expect(Array.isArray(items) && items.length === ex.json.items.length, 'the row keeps no per-item verdicts: ' + meta.slice(0, 200));
  // numbers, booleans and one-letter codes (side: 'a'|'b' = which card was tapped); never a word about the child
  const noText = items.every((it) => Object.values(it).every((v) => typeof v === 'number' || typeof v === 'boolean' || v === null || (typeof v === 'string' && v.length <= 1)));
  expect(noText, 'an item row carries text: ' + JSON.stringify(items[0]));
  return { items: items.length, sample: items[0] };
});

on('WQ114', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await L.setFlag(ctx, page, 'web_quiz_challenge_record', 'false');
  try {
    const st = await child(page, ctx, CODES.OPEN, 'Norec114');
    await openChallenge(page, ctx, st);
    await page.waitForSelector(S('menu') + ', ' + S('trail'), { state: 'attached', timeout: WAIT });
    expect(await screenName(page) === 'menu', 'the trail is shown without the record rule');
    const ids = (await tiles(page)).map((e) => e.id);
    expect(!ids.includes('missing'), '"Missing number" is offered without the record rule: ' + ids.join(','));
    return { screen: 'menu', exercises: ids };
  } finally { await L.setFlag(ctx, page, 'web_quiz_challenge_record', 'true'); }
});

on('WQ115', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const st = await child(page, ctx, CODES.OPEN, 'Trail115');
  await openChallenge(page, ctx, st);
  const scr = await toMenu(page);
  expect(scr === 'trail', 'the trail is not shown: ' + scr);
  const before = (await tiles(page)).find((e) => e.id === 'bigger');
  expect(before && before.badge === '0', 'the stop is already done: ' + JSON.stringify(before));
  await playBigger(page, false);                      // a poor score on purpose
  expect((await inner(page, '#wqc-medal').catch(() => '')) === '⭐ Stop done!', 'no medal after the first play');
  await page.click('#wqc-menu'); await toMenu(page);
  const after = (await tiles(page)).find((e) => e.id === 'bigger');
  expect(after && after.badge === '1' && /Done/.test(after.text), 'the stop carries no finish badge: ' + JSON.stringify(after));
  return { before: before.badge, after: after.badge, medal: '⭐ Stop done!' };
});

on('WQ116', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const st = await child(page, ctx, CODES.OPEN, 'Miss116');
  await openChallenge(page, ctx, st); await toMenu(page);
  await page.click('#wqc-ex-missing');
  await page.waitForSelector(S('help-ask') + ', ' + S('intro'), { state: 'attached', timeout: WAIT });
  if (await page.$(S('help-ask'))) { await page.click('#wqc-help-no'); await page.waitForSelector(S('intro'), { state: 'attached', timeout: WAIT }); }
  await page.click('#wqc-go');
  // the keypad: ✓ disabled while empty, ⌫ deletes, digits capped at the answer's length
  await page.waitForSelector(S('missing-practice') + ' .wqc-cell, ' + S('missing-play') + ' .wqc-cell', { state: 'attached', timeout: WAIT });
  expect(await page.$eval('#wqc-kok', (e) => e.disabled), '✓ is enabled while the field is empty');
  await page.click('#wqc-k7'); expect((await inner(page, '#wqc-gap')) === '7', 'the gap does not show the typed digit');
  await page.click('#wqc-kdel');
  const gap = await inner(page, '#wqc-gap');                                  // emptied: the page clears the cell (the "?" is the first render's)
  expect(gap === '' || gap === '?', '⌫ did not delete: the gap reads "' + gap + '"');
  expect(await page.$eval('#wqc-kok', (e) => e.disabled), '✓ stays enabled after ⌫ emptied the field');
  // answer every item right (the cells name the sequence) through practice and the run
  for (let i = 0; i < 40; i++) {
    const scr = await page.waitForSelector(S('missing-practice') + ', ' + S('missing-go') + ', ' + S('missing-play') + ', ' + S('missing-result'), { state: 'attached', timeout: 20000 });
    const name = await scr.getAttribute('data-screen');
    if (name === 'missing-result') break;
    if (name === 'missing-go') { await sleep(1200); continue; }
    const cells = await page.$$eval('.wqc-cell', (els) => els.map((e) => e.innerText.trim()));
    const nums = cells.map((c) => (/^\d+$/.test(c) ? Number(c) : null));
    const gapAt = nums.findIndex((n) => n === null);
    const known = nums.filter((n) => n !== null);
    const step = known.length >= 2 ? known[1] - known[0] : 1;
    const answer = gapAt === 0 ? known[0] - step : known[gapAt - 1] + step;
    for (const d of String(answer)) await page.click('#wqc-k' + d, { force: true, timeout: 3000 }).catch(() => {});
    await page.click('#wqc-kok', { force: true, timeout: 3000 }).catch(() => {});
    await sleep(name === 'missing-practice' ? 1900 : 350);
  }
  await page.waitForSelector(S('missing-result'), { state: 'attached', timeout: 20000 });
  const score = await inner(page, '#wqc-score').catch(() => '');
  expect(/You got \d+ out of 10!/.test(score), 'the result reads "' + score + '"');
  const [[sc]] = await L.rows(ctx, "select score::text from web_quiz_challenge_runs where exercise = 'missing' order by created_at desc limit 1");
  const parsed = JSON.parse(sc);
  expect('correct' in parsed && 'correct_5s' in parsed, 'the server did not score two ways: ' + sc);
  return { score, server: parsed };
});

on('WQ117', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const st = await child(page, ctx, CODES.OPEN, 'Prac117');
  await openChallenge(page, ctx, st); await toMenu(page);
  await playBigger(page, true);
  expect(!(await page.$('#wqc-practice')), 'the first play is marked practice');
  await page.click('#wqc-menu'); await toMenu(page);
  await playBigger(page, true);
  const banner = await inner(page, '#wqc-practice').catch(() => '');
  expect(banner === 'Practice round. Play as much as you like!', 'no practice banner on the replay: "' + banner + '"');
  expect(!(await page.$('#wqc-medal')), 'a medal on a practice round');
  expect(!(await page.$('#wqc-again')), '"Try again" on the trail');
  return { banner };
});

on('WQ118', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await page.addInitScript(() => { try { Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true }); } catch (_) { /* fine */ } });
  const st = await child(page, ctx, CODES.OPEN, 'Nomic118');
  await openChallenge(page, ctx, st); await toMenu(page);
  const read = (await tiles(page)).find((e) => e.id === 'read');
  expect(read && /needs a microphone/.test(read.text) && read.badge !== 'failed', 'the read stop is not shown waiting: ' + JSON.stringify(read));
  await page.click('#wqc-ex-read');
  await page.waitForSelector(S('mic-wait') + ', ' + S('help-ask'), { state: 'attached', timeout: WAIT });
  if (await page.$(S('help-ask'))) { await page.click('#wqc-help-no'); await page.waitForSelector(S('mic-wait'), { state: 'attached', timeout: WAIT }); }
  expect(/This stop needs a microphone\. It will wait for you!/.test(await text(page)), 'no waiting line');
  expect((await inner(page, '#wqc-menu')) === 'Go to another stop', 'no way to another stop');
  return { stop: read.text };
});

on('WQ102', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await L.setFlag(ctx, page, 'web_quiz_challenge_trail', 'false');
  try {
    await page.addInitScript(() => { try { Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true }); } catch (_) { /* fine */ } });
    const st = await child(page, ctx, CODES.OPEN, 'Wa102');
    await openChallenge(page, ctx, st); await toMenu(page);
    await page.click('#wqc-ex-read');
    await page.waitForSelector(S('intro'), { state: 'attached', timeout: WAIT });
    await page.click('#wqc-go');
    await page.waitForSelector(S('no-mic'), { state: 'attached', timeout: WAIT });
    expect(/Your WhatsApp browser can't use the microphone\./.test(await text(page)), 'the no-mic line is missing');
    expect((await inner(page, '#wqc-skip')) === 'Skip this one', 'no "Skip this one"');
    return { screen: 'no-mic', note: '"Open in Chrome" shows for an Android user agent only' };
  } finally { await L.setFlag(ctx, page, 'web_quiz_challenge_trail', 'true'); }
});

on('WQ119', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const st = await child(page, ctx, CODES.OPEN, 'Help119');
  await openChallenge(page, ctx, st);
  await page.waitForSelector(S('trail') + ', ' + S('help-ask'), { state: 'attached', timeout: WAIT });
  if (await page.$(S('trail'))) await page.click('#wqc-ex-bigger');
  await page.waitForSelector(S('help-ask'), { state: 'attached', timeout: WAIT });
  expect(/On your own, or with help\?/.test(await text(page)), 'the help question is missing');
  expect((await inner(page, '#wqc-help-no')) === 'On my own' && (await inner(page, '#wqc-help-yes')) === 'With help', 'the answers read differently');
  await page.click('#wqc-help-yes');
  await page.waitForSelector(S('intro'), { state: 'attached', timeout: WAIT });
  await page.click('#wqc-go');
  await playBigger(page, true).catch(() => {});
  await page.waitForSelector(S('bigger-result'), { state: 'attached', timeout: 20000 });
  await page.click('#wqc-menu'); await toMenu(page);
  await page.click('#wqc-ex-missing');
  await page.waitForSelector(S('intro') + ', ' + S('help-ask'), { state: 'attached', timeout: WAIT });
  expect(await screenName(page) === 'intro', 'the help question was asked a second time in the sitting');
  const [[meta]] = await L.rows(ctx, "select meta::text from web_quiz_challenge_runs where exercise = 'bigger' order by created_at desc limit 1");
  expect(/"helped":\s*(true|"helped")/.test(meta), 'the row does not carry the help answer: ' + meta.slice(0, 160));
  return { asked: 'once', helped: true };
});

on('WQ120', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const st = await child(page, ctx, CODES.UR, 'Urdu120');
  await openChallenge(page, ctx, st, '?lang=ur');
  const scr = await toMenu(page);
  expect(scr === 'trail', 'no trail: ' + scr);
  const sub = await inner(page, '#wqc-trail-sub');
  expect(/[0-9]/.test(sub) && !/[۰-۹]/.test(sub), 'the trail line uses Urdu digits: "' + sub + '"');
  expect((await page.$eval('html', (e) => e.getAttribute('lang'))) === 'ur', 'not an Urdu page');
  return { sub };
});

on('WQ122', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await L.setFlag(ctx, page, 'web_quiz_challenge_record', 'false');
  try {
    const st = await child(page, ctx, CODES.UR, 'Urdu122');
    const ex = await api(page, ctx, 'GET', 'ch/' + encodeURIComponent(st) + '/bigger?lang=ur');
    await api(page, ctx, 'POST', 'ch/result', { ct: ex.json.ct, taps: ex.json.items.map((it, i) => ({ i, pick: Math.max(it.a, it.b), ms: 800 })), ms: 8000 });
    await openChallenge(page, ctx, st, '?lang=ur');
    await page.waitForSelector(S('menu'), { state: 'attached', timeout: WAIT });
    const badge = await page.$eval('#wqc-ex-bigger .wqc-badge', (e) => e.innerText.trim());
    expect(/[0-9]/.test(badge) && !/[۰-۹]/.test(badge), 'the old menu\'s badge reads "' + badge + '"');
    expect((await page.$eval('html', (e) => e.className)).includes('wq-ur2'), 'the Urdu polish class is not on the page');
    return { badge };
  } finally { await L.setFlag(ctx, page, 'web_quiz_challenge_record', 'true'); }
});

on('WQ123', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await L.setFlag(ctx, page, 'web_quiz_challenge_daily_reads', '0');
  try {
    const st = await child(page, ctx, CODES.OPEN, 'Cap123');
    await openChallenge(page, ctx, st); await toMenu(page);
    const ids = (await tiles(page)).map((e) => e.id);
    expect(!ids.includes('read') && ids.includes('bigger'), 'with the cap reached the menu offers ' + ids.join(','));
    const r = await api(page, ctx, 'GET', 'ch/' + encodeURIComponent(st) + '/read?lang=en');
    expect(r.status === 429, 'a read past the cap answered ' + r.status);
    return { exercises: ids, read: 429 };
  } finally { await L.setFlag(ctx, page, 'web_quiz_challenge_daily_reads', null); }
});

on('WQ242', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const scripts = new Set(); page.on('request', (r) => { if (r.resourceType() === 'script') scripts.add(new URL(r.url()).pathname.split('/').pop()); });
  const st = await child(page, ctx, CODES.OPEN, 'V2off242');
  const menu = await api(page, ctx, 'GET', 'ch/' + encodeURIComponent(st) + '?lang=en');
  expect(menu.status === 200, 'the menu answered ' + menu.status + ' ' + JSON.stringify(menu.json).slice(0, 120));
  expect(!menu.json.v2 && !menu.json.menu_v2, 'the menu payload carries v2 keys: ' + Object.keys(menu.json).join(','));
  await openChallenge(page, ctx, st); await toMenu(page);
  expect(![...scripts].some((s) => /wq-trail/.test(s)), 'the Trail v2 script loaded: ' + [...scripts].join(', '));
  return { scripts: [...scripts].filter((s) => /wq/.test(s)) };
});

for (const [id, why] of [
  ['WQ099', MIC], ['WQ100', MIC], ['WQ101', MIC], ['WQ103', MIC], ['WQ104', MIC],
  ['WQ106', 'the microphone check (3 s of audio above a level) ' + MIC], ['WQ107', 'the guard\'s minute and the "too hard" window follow a live recording; ' + MIC],
  ['WQ108', MIC], ['WQ109', MIC], ['WQ110', MIC], ['WQ112', 'keeping a recording under kept/ needs a recording; ' + MIC], ['WQ113', 'the purge command works on kept recordings; none can be made here: ' + MIC],
  ['WQ121', CLIP], ['WQ124', 'the live read streams to the speech vendor over a WebSocket with a minted key (SONIOX_API_KEY): no vendor on this lane'], ['WQ125', 'live read: ' + MIC], ['WQ126', 'live read fallback: ' + MIC], ['WQ127', 'live keys are minted by the speech vendor: no vendor on this lane'],
  ['WQ128', 'questions after Read aloud need a scored reading: ' + MIC], ['WQ129', 'the taps follow a scored reading: ' + MIC], ['WQ130', 'the taps follow a scored reading: ' + MIC], ['WQ131', 'the questions switch is reached only after a scored reading: ' + MIC],
  ['WQ132', CLIP], ['WQ133', CLIP], ['WQ134', CLIP + '; the reviewed-question pool is data of the story bank'],
  ['WQ243', 'the mic notice is under web_quiz_challenge_v2 + audio_consent + keep_audio, all off on this lane, and leads to the microphone: ' + MIC],
  ['WQ244', 'Trail v2 (web_quiz_challenge_v2) is off on this lane; the v1 help question is proved in WQ119'],
  ['WQ245', 'Trail v2 (web_quiz_challenge_v2) is off on this lane; whose_turn / on_its_way are v2 serves'],
  ['WQ246', 'Trail v2 end cards need a scored reading: ' + MIC],
  ['WQ247', 'the grade-1 "numbers" exercise is under web_quiz_challenge_v2 + web_quiz_challenge_g1, off on this lane'],
  ['WQ248', 'Story Time needs web_quiz_challenge_v2 + web_quiz_challenge_story and story rows with recorded clips: ' + CLIP],
]) on(id, 'off', async () => ({ blocked: why }));

module.exports = { runs, modes };

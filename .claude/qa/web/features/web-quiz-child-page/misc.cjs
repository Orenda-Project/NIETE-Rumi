// web-quiz-child-page/misc — the link preview and the share pictures as the edge serves them (fast previews answered
// without a quiz load, pictures drawn at the finish, the trace each fetch leaves in the logs), and the video library,
// which needs the lesson bank the demo seed does not carry.
'use strict';
const L = require('./lib.cjs');
const { expect, WAIT, CODES, text, inner, onScreen, openQuiz, sleep, q } = L;
const M = (m) => onScreen(m);
const modes = {}, runs = {};
const on = (id, mode, fn) => { modes[id] = mode; runs[id] = fn; };
const BANK = 'the video library is the lesson bank (student_videos rows with lesson videos in the file store), absent from the demo seed';
const WA_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36 WhatsApp/2.24.10.74 A';

async function api(page, ctx, method, p, body) {
  const url = ctx.baseUrl + '/api/wq/' + p;
  const r = method === 'GET' ? await page.request.get(url) : await page.request.post(url, { data: body });
  let json = null; try { json = await r.json(); } catch (_) { /* not JSON */ }
  return { status: r.status(), json };
}
async function apiFinish(page, ctx, code, name, wrongAt) {
  const quiz = await api(page, ctx, 'GET', 'quiz/' + code); const qs = quiz.json.quiz.questions;
  const s = await api(page, ctx, 'POST', 'session', { code, new: { name, cls: String(quiz.json.quiz.grade || ''), force: true } });
  await api(page, ctx, 'POST', 'answers', { st: s.json.st, a: qs.map((x, i) => ({ qid: x.qid, slot: i === wrongAt ? x.options.map((o) => o.slot).find((sl) => sl !== x.correct_slot) : x.correct_slot.split(',')[0], ms: 900 })) });
  const f = await api(page, ctx, 'POST', 'finish', { st: s.json.st });
  return { st: s.json.st, result: f.json };
}
const botQuizLoads = (ctx, code) => L.botLog(ctx).split('\n').filter((l) => /web_quiz\.session_timing|getQuiz|"route":"\/quiz\/:code"/.test(l) && new RegExp(code).test(l)).length;
const portalBotCalls = (ctx, code) => L.portalLog(ctx).split('\n').filter((l) => /web_quiz\.bot_call/.test(l) && new RegExp('/wq/quiz/' + code).test(l)).length;

on('WQ175', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await openQuiz(page, ctx, CODES.G3);                       // the edge has served this link: it knows the preview facts
  await sleep(800);
  const before = portalBotCalls(ctx, CODES.G3);
  const head = await page.request.fetch(ctx.baseUrl + '/q/' + CODES.G3, { method: 'HEAD' });
  const ua = await page.request.get(ctx.baseUrl + '/q/' + CODES.G3, { headers: { 'user-agent': WA_UA } });
  const html = await ua.text();
  expect(head.status() === 200 && ua.status() === 200, 'preview fetches answered ' + head.status() + ' / ' + ua.status());
  expect(/property="og:title"/.test(html) && /property="og:image"/.test(html), 'the preview page has no og tags');
  await sleep(800);
  const after = portalBotCalls(ctx, CODES.G3);
  expect(after === before, 'the preview fetch asked the bot for the quiz (' + before + ' → ' + after + ' quiz loads)');
  expect(!/<script id="boot"/.test(html), 'the preview fetch got the whole quiz');
  const live = await (await page.request.get(ctx.baseUrl + '/q/' + CODES.G3)).text();
  expect(/<script id="boot"/.test(live), 'a browser no longer gets the live quiz');
  return { previewQuizLoads: 0, note: 'the picture answered from the edge after a warm-up is WQ180/WQ183\'s check' };
});

on('WQ178', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const me = await apiFinish(page, ctx, CODES.OPEN, 'Og178', -1);
  await openQuiz(page, ctx, CODES.OPEN);                      // a page load teaches the bot the preview facts
  const og = await L.bot(ctx, 'GET', '/api/internal/wq/og/' + CODES.OPEN);
  expect(og.status === 200 && og.json && og.json.quiz, 'the bot remembers no link facts: ' + og.status + ' ' + JSON.stringify(og.json).slice(0, 120));
  const before = portalBotCalls(ctx, CODES.OPEN);
  const html = await (await page.request.get(ctx.baseUrl + '/q/' + CODES.OPEN + '?a=' + encodeURIComponent(me.result.art.card), { headers: { 'user-agent': WA_UA } })).text();
  expect(/og:image" content="[^"]*\/art\/card\.jpg/.test(html), 'the card link does not preview with the card picture');
  await sleep(800);
  expect(portalBotCalls(ctx, CODES.OPEN) === before, 'the preview fetch loaded a whole quiz');
  return { factsRemembered: true, note: 'the local portal runs ONE worker (CLUSTER_ENABLED=false); the "other worker" path is the bot\'s og memory, exercised here through /api/internal/wq/og' };
});

on('WQ180', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const t0 = Date.now();
  const me = await apiFinish(page, ctx, CODES.OPEN, 'Warm180', -1);
  const finishMs = Date.now() - t0;
  expect(me.result.art && me.result.art.card && me.result.art.invite, 'the finish names no card/invite picture ids');
  await sleep(2500);
  const log = L.botLog(ctx);
  const drawn = log.split('\n').filter((l) => /web_quiz\.art_served|web_quiz\.art_drawn|share_warm|art_warm/.test(l) && /card|invite/.test(l));
  expect(drawn.length >= 1, 'no card/invite picture was drawn after the finish (bot log)');
  const pic = await page.request.get(ctx.baseUrl + '/q/' + CODES.OPEN + '/art/card.jpg?a=' + encodeURIComponent(me.result.art.card));
  const t1 = Date.now(); const pic2 = await page.request.get(ctx.baseUrl + '/q/' + CODES.OPEN + '/art/card.jpg?a=' + encodeURIComponent(me.result.art.card)); const servedMs = Date.now() - t1;
  expect(pic.status() === 200 && pic2.status() === 200, 'the card picture answered ' + pic.status());
  return { finishMs, pictureFetchMs: servedMs, drawnLines: drawn.length, note: 'the finish answered in ' + finishMs + ' ms; the picture is drawn after the answer (ShareWarm.afterFinish)' };
});

on('WQ183', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const me = await apiFinish(page, ctx, CODES.OPEN, 'Jpeg183', 0);
  await sleep(2000);
  const url = ctx.baseUrl + '/q/' + CODES.OPEN + '?a=' + encodeURIComponent(me.result.art.card);
  const html = await (await page.request.get(url)).text();
  const img = L.og(html, 'og:image'), type = L.og(html, 'og:image:type'), alt = L.og(html, 'og:image:alt');
  expect(type === 'image/jpeg' && alt, 'the head does not name the picture\'s type and alt: ' + type + ' / ' + alt);
  const r = await page.request.get(img);
  const buf = await r.body();
  let w = 0, h = 0; for (let i = 2; i < buf.length - 9; i++) { if (buf[i] === 0xFF && (buf[i + 1] === 0xC0 || buf[i + 1] === 0xC2)) { h = buf.readUInt16BE(i + 5); w = buf.readUInt16BE(i + 7); break; } }
  expect(r.status() === 200 && /image\/jpeg/.test(r.headers()['content-type'] || ''), 'the picture answered ' + r.status() + ' ' + r.headers()['content-type']);
  expect(w === 1200 && h === 630, 'the picture is ' + w + '×' + h);
  expect(buf.length > 10000 && buf.length < 120000, 'the picture is ' + Math.round(buf.length / 1024) + ' KB');
  return { size: w + '×' + h, kb: Math.round(buf.length / 1024), type, note: 'the address is http on this local stack (https in production), so og:image:secure_url is absent here by design' };
});

on('WQ184', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const me = await apiFinish(page, ctx, CODES.OPEN, 'Trace184', -1);
  await sleep(1500);
  const before = L.portalLog(ctx).split('\n').filter((l) => /web_quiz\.art_edge/.test(l)).length;
  await page.request.get(ctx.baseUrl + '/q/' + CODES.OPEN + '/art/card.jpg?a=' + encodeURIComponent(me.result.art.card), { headers: { 'user-agent': WA_UA } });
  await page.request.get(ctx.baseUrl + '/q/' + CODES.OPEN + '/art/card.jpg?a=' + encodeURIComponent(me.result.art.card));
  await sleep(800);
  const lines = L.portalLog(ctx).split('\n').filter((l) => /web_quiz\.art_edge/.test(l)).slice(before);
  expect(lines.length >= 2, 'the portal logged ' + lines.length + ' art_edge lines for two fetches');
  for (const l of lines) {
    expect(/"kind":"card"/.test(l), 'no picture kind: ' + l.slice(0, 200));
    expect(/"(held|hit|from|cached)"/.test(l), 'the line does not say whether the portal held it: ' + l.slice(0, 200));
    expect(/"(ms|took|elapsed|duration_ms)"/.test(l), 'no time taken: ' + l.slice(0, 200));
    expect(/"(fetcher|ua|agent|who)"/.test(l), 'no fetcher kind: ' + l.slice(0, 200));
    expect(!new RegExp(CODES.OPEN).test(l) && !/Trace184/.test(l) && !new RegExp(me.result.art.card.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(l), 'the line carries the code, the picture id or the name: ' + l.slice(0, 200));
  }
  return { lines: lines.length };
});

on('WQ188', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const me = await apiFinish(page, ctx, CODES.OPEN, 'Tbl188', -1);
  await sleep(2000);
  const art = me.result.art && (me.result.art.table || me.result.art.class);
  expect(art, 'the finish names no table picture');
  const html = await (await page.request.get(ctx.baseUrl + '/q/' + CODES.OPEN + '/class?v=3')).text();
  const img = L.og(html, 'og:image');
  expect(/\/art\/class\.jpg\?a=/.test(img), 'the table link previews as ' + img);
  const before = L.botLog(ctx).split('\n').filter((l) => /web_quiz\.art_served/.test(l) && /"from":"drawn"/.test(l)).length;
  const r = await page.request.get(img);
  expect(r.status() === 200, 'the table picture answered ' + r.status());
  await sleep(600);
  const drawnNow = L.botLog(ctx).split('\n').filter((l) => /web_quiz\.art_served/.test(l) && /"from":"drawn"/.test(l)).length;
  return { picture: 200, drawnOnFetch: drawnNow - before, note: drawnNow === before ? 'served from memory/storage: already drawn' : 'drawn on this fetch' };
});

on('WQ189', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const before = L.botLog(ctx).split('\n').filter((l) => /art_served|art_warm|share_warm/.test(l) && /"kind":"(class|table|l)"|class/.test(l)).length;
  await apiFinish(page, ctx, CODES.OPEN, 'Cls189', -1);
  await sleep(3000);
  const after = L.botLog(ctx).split('\n').filter((l) => /art_served|art_warm|share_warm/.test(l) && /"kind":"(class|table|l)"|class/.test(l)).length;
  expect(after > before, 'no class/table picture was drawn when the child finished, before anyone opened the table');
  return { warmed: after - before };
});

on('WQ166', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await L.setFlag(ctx, page, 'web_quiz_library', 'false');
  try {
    await L.finishAsNew(page, ctx, CODES.OPEN, 'Lib166');
    expect(await page.$('#wq-more'), 'no "Watch another video"');
    await page.click('#wq-more');
    await page.waitForSelector(M('M15') + ', ' + M('M15-error') + ', ' + M('M15-wait'), { state: 'attached', timeout: WAIT });
    await sleep(1500);
    const body = await text(page);
    expect(!/Download/.test(body), 'a Download button shows with the library off');
    const items = await L.count(page, '.wq-vitem');
    expect(items <= 8, items + ' lessons listed (at most 8)');
    return { lessons: items, note: items === 0 ? BANK + ', so today\'s list is empty here' : 'today\'s list' };
  } finally { await L.setFlag(ctx, page, 'web_quiz_library', 'true'); }
});

for (const [id, why] of [
  ['WQ174', 'the WhatsApp composer\'s own preview render cannot be driven from this lane (no WhatsApp); the og tags and the picture it would fetch are proved in WQ139/WQ141/WQ183'],
  ['WQ161', BANK], ['WQ162', BANK], ['WQ163', BANK], ['WQ164', BANK], ['WQ165', BANK], ['WQ167', BANK], ['WQ168', BANK], ['WQ169', BANK],
]) on(id, 'off', async () => ({ blocked: why }));

module.exports = { runs, modes };

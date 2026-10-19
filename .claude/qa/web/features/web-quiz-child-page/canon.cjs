// web-quiz-child-page/canon — the polished Urdu look (web_quiz_ur_polish), the child-identity store
// (web_quiz_identity_canon: merged records fold to one, a typed name is one child across a teacher's codes), and the
// switches that are not on this lane (phone binding needs WQ_TOMB_SALT; Jugnu's Book, the lantern and the shelf are
// Trail v2) — those say so.
'use strict';
const L = require('./lib.cjs');
const { expect, WAIT, CODES, text, inner, count, onScreen, openQuiz, startAsNew, play, toResults, sleep, q } = L;
const M = (m) => onScreen(m);
const modes = {}, runs = {};
const on = (id, mode, fn) => { modes[id] = mode; runs[id] = fn; };
// The polished Urdu look is one switch (app_settings web_quiz_ur_polish → payload ui.ur2 → the edge's wq-ur2 root class).
// Off in the seed snapshot: switched on here for its scenarios, and removed again after.
async function urPolish(ctx, page, on) {
  await L.setFlag(ctx, page, 'web_quiz_ur_polish', on ? 'true' : null, null);
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const html = await (await page.request.get(ctx.baseUrl + '/q/' + CODES.UR)).text();
    if (/class="wq-ur2"/.test(html) === on) return;
    await L.sleep(2000);
  }
  throw new Error('the Urdu page does not reflect web_quiz_ur_polish=' + on + ' after 60 s');
}
const BIND = 'family phone binding (web_quiz_phone_bind) also needs WQ_TOMB_SALT on the bot (web-quiz-identity-flags.js: phoneBind = switch && canon && salt); the salt is not set on this lane';
const V2 = 'a Trail v2 feature (web_quiz_challenge_v2 and its children: book, story, lantern), off on this lane';

on('WQ213', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await urPolish(ctx, page, true);
  try {
  const html = await (await page.request.get(ctx.baseUrl + '/q/' + CODES.UR)).text();
  const root = (html.match(/<html[^>]*>/) || [''])[0];
  expect(/lang="ur"/.test(root) && /dir="rtl"/.test(root) && /class="wq-ur2"/.test(root), 'the Urdu root is ' + root);
  expect(/<link rel="preload" href="\/wq\/fonts\/wq-nastaliq-2\.woff2" as="font"/.test(html), 'the second Urdu face is not preloaded');
  const font = await page.request.get(ctx.baseUrl + '/wq/fonts/wq-nastaliq-2.woff2');
  const bytes = (await font.body()).length;
  expect(font.status() === 200 && bytes > 50000 && bytes < 200000, 'the face answered ' + font.status() + ' with ' + bytes + ' bytes');
  await openQuiz(page, ctx, CODES.UR);
  const styles = await page.evaluate(() => {
    const runs = [...document.querySelectorAll('h1, h2, p, button, .wq-say')].filter((e) => /[؀-ۿ]/.test(e.innerText)).slice(0, 12);
    return runs.map((e) => { const cs = getComputedStyle(e); return { fam: cs.fontFamily.split(',')[0], weight: cs.fontWeight, lh: parseFloat(cs.lineHeight) / parseFloat(cs.fontSize), fsa: cs.fontSizeAdjust, ws: cs.wordSpacing, synth: cs.fontSynthesis }; });
  });
  expect(styles.length && new Set(styles.map((s) => s.fam)).size === 1, 'Urdu runs use several faces: ' + [...new Set(styles.map((s) => s.fam))].join(' | '));
  expect(styles.every((s) => s.fsa === 'none' && (s.ws === 'normal' || s.ws === '0px')), 'size-adjust or word spacing on an Urdu run: ' + JSON.stringify(styles[0]));
  expect(styles.every((s) => s.lh >= 1.9), 'an Urdu run has a tight line height: ' + styles.map((s) => s.lh.toFixed(2)).join(','));
  const en = await (await page.request.get(ctx.baseUrl + '/q/' + CODES.OPEN)).text();
  expect(!/wq-ur2/.test(en) && !/wq-nastaliq/.test(en), 'the English page carries the Urdu class or font');
  await urPolish(ctx, page, false);
  const off = await (await page.request.get(ctx.baseUrl + '/q/' + CODES.UR)).text();
  expect(!/wq-ur2/.test(off) && /wq-nastaliq-1\.woff2/.test(off), 'with the switch off the page is not today\'s');
  return { root: root.slice(0, 60), face: styles[0] && styles[0].fam, bytes };
  } finally { await L.setFlag(ctx, page, 'web_quiz_ur_polish', null, null).catch(() => {}); }
});

on('WQ215', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await urPolish(ctx, page, true);
  try {
  await openQuiz(page, ctx, CODES.UR);
  const body = await text(page);
  expect(/السلام علیکم! کوئز کھیلیں؟/.test(body), 'the landing greeting is not the child\'s: ' + body.slice(0, 120));
  const meta = await inner(page, '#wq .wq-small');
  expect(/6 سوال، 4 منٹ|\d سوال، \d منٹ/.test(meta), 'the meta line reads "' + meta + '" (Western digits expected)');
  const bdi = await page.$$eval('#wq .wq-small bdi, #wq .wq-small [dir="ltr"], #wq .wq-small', (els) => els.map((e) => e.outerHTML).join(''));
  expect(/⁦|dir="ltr"|<bdi/.test(bdi), 'the numbers are not on their own left-to-right runs');
  const sub = await page.$$eval('#wq .wq-sub', (els) => els.map((e) => e.innerText.trim()));
  expect(sub.length && sub[0].split('\n').length >= 1, 'no teacher line');
  await page.click('#wq-play'); await page.waitForSelector('#wq-new', { state: 'visible', timeout: WAIT }); await page.click('#wq-new');
  await page.fill('#wq-name', 'عائشہ'); await page.click('#wq-start');
  await page.waitForSelector(M('M6') + ' .wq-qof', { state: 'visible', timeout: WAIT });
  const qof = await inner(page, '.wq-qof');
  expect(/6 میں سے سوال 1/.test(qof) && !/از/.test(qof), 'the counter reads "' + qof + '"');
  const b = await L.boot(page); const qq = await L.current(page, b.quiz.questions);
  await page.click('.wq-opt[data-slot="' + L.wrongSlot(qq) + '"]'); await page.waitForSelector('#wq-fb .wq-no', { state: 'visible', timeout: WAIT });
  const fb = await inner(page, '#wq-fb');
  expect(!/ٹیپ کریں|تقریباً|جشن|ہم جماعت/.test(fb), 'an adult word remains in the feedback: ' + fb);
  const again = fb.split('\n').find((l) => /آخر میں|واپس/.test(l)) || '';
  return { greeting: 'child\'s', meta, counter: qof, againWords: again.split(/\s+/).filter(Boolean).length };
  } finally { await urPolish(ctx, page, false).catch(() => {}); }
});

on('WQ219', 'v2', async (page, ctx) => {
  await L.setMode(ctx, page, 'v2');
  await L.setFlag(ctx, page, 'web_quiz_identity_canon', 'true');
  try {
    const before = Number(await L.one(ctx, "select count(*) from students where student_name = 'Canon Testwala'"));
    const typeIn = async (p, code) => {
      await openQuiz(p, ctx, code);
      if (await p.$('#wq-someone')) await p.click('#wq-someone'); else await p.click('#wq-play');
      await p.waitForSelector(M('M4-name') + ', ' + M('M4-class'), { state: 'attached', timeout: WAIT });
      if (await p.$(M('M4-class'))) await p.click('#wq-cls-0');
      await p.fill('#wq-name', 'Canon Testwala'); await p.click('#wq-start');
      await p.waitForSelector(M('M4-notfound') + ', ' + M('M6'), { state: 'attached', timeout: WAIT });
      if (await p.$('#wq-force')) await p.click('#wq-force');
      await p.waitForSelector(M('M6') + ' .wq-opt', { state: 'visible', timeout: WAIT });
    };
    await typeIn(page, CODES.OPEN);
    await typeIn(page, CODES.NEXT);                              // another code of the same teacher, same phone
    const same = Number(await L.one(ctx, "select count(*) from students where student_name = 'Canon Testwala'"));
    expect(same === before + 1, 'the same phone made ' + (same - before) + ' records across the teacher\'s codes');
    const B = await L.newPhone(page);
    try { await typeIn(B.page, CODES.OPEN); } finally { await B.close(); }
    const other = Number(await L.one(ctx, "select count(*) from students where student_name = 'Canon Testwala'"));
    expect(other === before + 2, 'another phone did not make its own record (' + other + ')');
    await typeIn(page, 'SC2ABC');                                 // another teacher's code: a new record
    const otherTeacher = Number(await L.one(ctx, "select count(*) from students where student_name = 'Canon Testwala'"));
    expect(otherTeacher === before + 3, 'another teacher\'s code reused the record (' + otherTeacher + ')');
    return { samePhoneSameTeacher: 1, otherPhone: '+1', otherTeacher: '+1' };
  } finally { await L.setFlag(ctx, page, 'web_quiz_identity_canon', null); }
});

on('WQ217', 'roster', async (page, ctx) => {
  await L.setMode(ctx, page, 'roster');
  // a loose record merged into a class-list child; another merged into a record that is itself merged
  const hina = await L.studentNamed(ctx, 'Hina Testwala');
  const looseA = await L.one(ctx, "insert into students (student_name, list_id, enrolled_by_user_id, is_active, status, merged_into) values ('Hina (loose)', null, (select teacher_user_id from quiz_share_codes where code = 'AB12CD'), true, 'merged', " + q(hina) + ') returning id');
  const looseB = await L.one(ctx, "insert into students (student_name, list_id, enrolled_by_user_id, is_active, status, merged_into) values ('Hina (loose 2)', null, (select teacher_user_id from quiz_share_codes where code = 'AB12CD'), true, 'merged', " + q(looseA) + ') returning id');
  try {
    const T = L.tokens(ctx);
    const canonOn = async (on) => { await L.setFlag(ctx, page, 'web_quiz_identity_canon', on ? 'true' : null); };
    await canonOn(true);
    // the hub for a link naming the class child and both loose records: the merged one folds, the double-merged one stops after one hop
    const tok = T.signHub([hina, looseA, looseB]);
    const hub = await L.bot(ctx, 'GET', '/api/internal/wq/hub/' + encodeURIComponent(tok) + '?src=link');
    expect(hub.status === 200 && Array.isArray(hub.json.kids), 'hub → ' + hub.status + ' ' + JSON.stringify(hub.json).slice(0, 120));
    const chips = hub.json.kids.map((k) => k.chip);
    expect(chips.includes(T.chipId('h', hina)), 'the class-list child\'s chip is missing: ' + JSON.stringify(hub.json).slice(0, 300));
    expect(!chips.includes(T.chipId('h', looseA)), 'the merged loose record kept its own chip');
    expect(chips.includes(T.chipId('h', looseA)) === false && chips.length === 2, 'kids: ' + JSON.stringify(hub.json.kids.map((k) => k.first)) + ' (the double-merged record maps to the merged one, not further)');
    await canonOn(false);
    const hub0 = await L.bot(ctx, 'GET', '/api/internal/wq/hub/' + encodeURIComponent(tok) + '?src=link');
    expect(hub0.json.kids.length === 3, 'with canon off the ids did not map as before: ' + JSON.stringify(hub0.json).slice(0, 300));
    return { canon: chips.length, off: hub0.json.kids.length };
  } finally { await ctx.sql('delete from students where id in (' + q(looseA) + ', ' + q(looseB) + ')'); }
});

on('WQ218', 'roster', async (page, ctx) => {
  await L.setMode(ctx, page, 'roster');
  const hina = await L.studentNamed(ctx, 'Hina Testwala'), omar = await L.studentNamed(ctx, 'Omar Testwala');
  const loose = await L.one(ctx, "insert into students (student_name, list_id, enrolled_by_user_id, is_active, status, merged_into) values ('Hina (loose)', null, (select teacher_user_id from quiz_share_codes where code = 'AB12CD'), true, 'merged', " + q(hina) + ') returning id');
  try {
    await L.setFlag(ctx, page, 'web_quiz_identity_canon', 'true');
    const T = L.tokens(ctx);
    const tok = T.signHub([hina, omar, loose]);
    await page.goto(ctx.baseUrl + '/h/' + tok, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(M('H1'), { state: 'attached', timeout: WAIT });
    const kids = await page.$$eval('.wq-kid', (els) => els.map((e) => e.innerText.trim()));
    expect(kids.length === 2 && kids.filter((k) => /Hina/.test(k)).length === 1, 'chips: ' + JSON.stringify(kids));
    expect(JSON.parse(Buffer.from(tok.split('.')[0], 'base64url').toString()).ids.length === 3, 'the link lost an id');
    await page.click('.wq-kid:has-text("Hina")'); await page.waitForSelector(M('H2'), { state: 'attached', timeout: WAIT });
    expect(/Hi Hina!/.test(await text(page)) && !/Omar/.test(await inner(page, '.wq-hcard').catch(() => '')), 'the hub is not Hina\'s alone');
    await L.setFlag(ctx, page, 'web_quiz_identity_canon', null);
    const off = await L.bot(ctx, 'GET', '/api/internal/wq/hub/' + encodeURIComponent(tok) + '?src=link');
    expect(off.json.kids.length === 3, 'with canon off the hub does not list three: ' + JSON.stringify(off.json).slice(0, 300));
    return { chips: kids };
  } finally { await ctx.sql('delete from students where id = ' + q(loose)); await L.setFlag(ctx, page, 'web_quiz_identity_canon', null).catch(() => {}); }
});

on('WQ223', 'roster', async (page, ctx) => {
  await L.setMode(ctx, page, 'roster');
  await L.setFlag(ctx, page, 'web_quiz_identity_canon', 'true');
  try {
    const T = L.tokens(ctx);
    const tooba = await L.studentNamed(ctx, 'Tooba Testwala'), yusra = await L.studentNamed(ctx, 'Yusra Testwala');
    const tok = T.signHub([tooba, yusra]);
    await page.goto(ctx.baseUrl + '/h/' + tok, { waitUntil: 'domcontentloaded' }); await page.waitForSelector(M('H1'), { state: 'attached', timeout: WAIT });   // this phone opens the link
    const device = await L.stored(page, 'wq_d');                      // the phone the link opened on (x-wq-device, as the page sends it)
    const dev = device ? { 'x-wq-device': String(device) } : {};
    const menu = await L.bot(ctx, 'GET', '/api/internal/wq/ch/' + encodeURIComponent(tok), null, dev);
    const ask = menu.json && (menu.json.error === 'whose_turn' || menu.json.whose_turn || menu.json.ask);
    expect(ask, 'no "Whose turn?" ask for two children and no chip: ' + JSON.stringify(menu.json).slice(0, 160));
    const kids = (menu.json.kids || menu.json.whose_turn || menu.json.ask || []);
    expect(Array.isArray(kids) && kids.length === 2 && kids.every((k) => k.chip && k.first), 'the ask names ' + JSON.stringify(kids));
    const runs0 = Number(await L.one(ctx, 'select count(*) from web_quiz_challenge_runs'));
    const one = T.signHub([tooba]);
    const single = await L.bot(ctx, 'GET', '/api/internal/wq/ch/' + encodeURIComponent(one) + '?kid=' + T.chipId('h', tooba), null, dev);
    expect(single.status === 200 && Array.isArray(single.json.exercises), 'one child is not served as today: ' + single.status);
    expect(Number(await L.one(ctx, 'select count(*) from web_quiz_challenge_runs')) === runs0, 'the ask started or stored a run');
    await L.setFlag(ctx, page, 'web_quiz_identity_canon', null);
    const off = await L.bot(ctx, 'GET', '/api/internal/wq/ch/' + encodeURIComponent(tok), null, dev);
    expect(off.status === 400 && off.json.error === 'pick_kid', 'with the switch off the route answers ' + off.status + ' ' + JSON.stringify(off.json));
    return { ask: kids.map((k) => k.first) };
  } finally { await L.setFlag(ctx, page, 'web_quiz_identity_canon', null).catch(() => {}); }
});

on('WQ224', 'roster', async (page, ctx) => {
  await L.setMode(ctx, page, 'roster');
  const T = L.tokens(ctx);
  const zains = await L.rows(ctx, "select id from students where student_name = 'Zain Testwala' order by roll_number");
  const hina = await L.studentNamed(ctx, 'Hina Testwala');
  const tok = T.signHub([zains[0][0], zains[1][0], hina]);
  await page.goto(ctx.baseUrl + '/h/' + tok, { waitUntil: 'domcontentloaded' }); await page.waitForSelector(M('H1'), { state: 'attached', timeout: WAIT });
  const chips = await page.$$eval('.wq-kid', (els) => els.map((e) => ({ text: e.innerText.replace(/\s+/g, ' ').trim(), lines: e.innerText.trim().split('\n').length })));
  const zainChips = chips.filter((c) => /Zain/.test(c.text));
  expect(zainChips.length === 2 && zainChips.every((c) => /Khalid|Tahir/.test(c.text)), 'the two Zains are not told apart by the father\'s name: ' + JSON.stringify(zainChips));
  expect(chips.find((c) => /Hina/.test(c.text)) && !/Imran/.test(chips.find((c) => /Hina/.test(c.text)).text), 'the unique child carries a father line');
  const hub = await L.bot(ctx, 'GET', '/api/internal/wq/hub/' + encodeURIComponent(tok) + '?src=link');
  const kids = hub.json.kids || [];
  const homonyms = kids.filter((k) => /Zain/.test(k.first));
  expect(homonyms.length === 2 && homonyms.every((k) => k.homonym_in_list === true), 'homonym_in_list is not true on both: ' + JSON.stringify(homonyms));
  const unique = kids.find((k) => /Hina/.test(k.first));
  expect(unique && unique.homonym_in_list === false, 'the unique child is marked as a homonym: ' + JSON.stringify(unique));
  return { zains: zainChips.map((c) => c.text), note: '"Played on this phone before" and the pick confidence are written on the pick (id_pick); the chips and flags are checked here' };
});

on('WQ225', 'roster', async (page, ctx) => {
  await L.setMode(ctx, page, 'roster');
  const T = L.tokens(ctx);
  const ids = await Promise.all(['Tooba Testwala', 'Yusra Testwala', 'Omar Testwala'].map((n) => L.studentNamed(ctx, n)));
  const tok = T.signHub(ids);
  const ev = L.events(page);
  await page.goto(ctx.baseUrl + '/h/' + tok, { waitUntil: 'domcontentloaded' }); await page.waitForSelector(M('H1'), { state: 'attached', timeout: WAIT });
  await page.click('.wq-kid:has-text("Yusra")'); await page.waitForSelector(M('H2'), { state: 'attached', timeout: WAIT });
  const body = await text(page);
  expect(/Hi Yusra!/.test(body) && !/Tooba|Omar/.test(await inner(page, '.wq-hcard, .wq-hlast, .wq-vitem').catch(() => '')), 'the hub is not Yusra\'s alone');
  const ch = await page.$eval('#wq-h-ch', (e) => e.getAttribute('href')).catch(() => '');
  expect(new RegExp('kid=' + T.chipId('h', ids[1])).test(ch), 'the challenge link is not Yusra\'s: ' + ch);
  await ev.flush();
  const picks = ev.of('id_pick');
  const raw = JSON.stringify(picks);
  expect(!picks.length || (!/"st"|"device_ref"|"code"/.test(raw) && picks.every((p) => p.w === 's')), 'id_pick carries a session, device or code: ' + raw.slice(0, 160));
  return { hub: 'Yusra', idPick: picks.length, note: 'id_pick is written only under web_quiz_identity_canon (the pick store); the 24-hour keep and the three-phone limit are canon rules not driven here' };
});

for (const [id, why] of [
  ['WQ216', 'the Urdu share pictures at preview size are pixels (headline 44 px, kicker 32 …): not readable headless; the renderer\'s cache key rule is server code'],
  ['WQ220', BIND], ['WQ221', BIND], ['WQ222', BIND],
  ['WQ232', V2 + '; the lantern names what the v2 draw chose'], ['WQ233', V2 + '; the Story Time shelf needs story rows'],
  ['WQ236', V2 + ' (web_quiz_challenge_book)'], ['WQ237', V2 + ' (web_quiz_class_wall under the Book)'], ['WQ238', V2 + ' (the Book\'s week dots)'], ['WQ239', V2 + ' (the Book\'s lamps)'], ['WQ240', V2 + ' (the Book\'s Trail sticker)'],
]) on(id, 'off', async () => ({ blocked: why }));

module.exports = { runs, modes };

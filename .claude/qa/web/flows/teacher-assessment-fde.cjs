// teacher-assessment-fde — TA03, TA04, TA05, TA07, TA08 (bd-q8wt5e.6.5): the FDE board pattern in the teacher app's New
// paper. Joined to the teacher-assessment driver as gen_page_features.py EXTRA does.
//
// The REAL portal and bot answer /assessment/options here: the board-pattern switch (app_settings
// assessment_fde_pattern_enabled) is set on THIS run's own database and put back, and the Grade 5 books the class picker
// needs are added where missing (the demo data has none; the same rows fde-board-pattern.cjs adds). The pattern's lines
// (sections, files, You add, the FDE syllabus) are therefore the bot's own data. Only Make my paper is caught by
// page.route where the scenario is about the request and the wait (TA05): this lane's bot cannot write a real paper
// (vendor calls replay-only), so a real request would turn into "failed" mid-check. TA07's three refusals are the
// server's own answers, provoked for real (switch off, a paper just queued, ten papers this hour).
'use strict';
const crypto = require('crypto');
const { DEMO, expect, asRole, visit, setSetting } = require('../lib.cjs');

const HUB = '/portal/teacher/assessment';
const NEW = HUB + '/new/';
const PICKS_KEY = 'teacher-v2-assessment-new:v1';
const PATTERN = 'fde_g5_2027';
const TEACHER_PHONE = '92' + DEMO.teacher.slice(1);
const TEACHER = "(select id from users where phone_number = '" + TEACHER_PHONE + "')";
const unisolate = (s) => String(s || '').replace(/[⁦-⁩‎‏]/g, '');
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const patternSwitch = (ctx, on) => setSetting(ctx, 'assessment_fde_pattern_enabled', on ? 'true' : 'false');
const limitSwitch = (ctx, on) => setSetting(ctx, 'assessment_rate_limit_enabled', on ? 'true' : 'false');

// Grade 5 books (the door's subjects, Islamiat among them) and a Grade 3 Science book (TA08's "any other grade").
const BOOKS = [[5, 'english'], [5, 'maths'], [5, 'science'], [5, 'islamiat'], [3, 'science']];
async function catalogue(ctx) {
  const subjects = [...new Set(BOOKS.map(([, s]) => s))].map((s) => "('" + s + "')").join(', ');
  await ctx.sql('insert into subjects (code) select s from (values ' + subjects + ') as x(s) on conflict (code) do nothing');
  await ctx.sql('insert into textbooks (curriculum, grade, subject, filename, total_pages) '
    + "select 'ict', x.g, x.s, 'e2e-fde-g' || x.g || '-' || x.s || '.pdf', 100 from (values "
    + BOOKS.map(([g, s]) => '(' + g + ", '" + s + "')").join(', ') + ') as x(g, s) '
    + "where not exists (select 1 from textbooks t where t.curriculum = 'ict' and t.grade = x.g and t.subject = x.s)");
}

async function withPattern(ctx, on, body) {
  await catalogue(ctx);
  await patternSwitch(ctx, on);
  try { return await body(); } finally { await patternSwitch(ctx, false); }
}

const stepIs = (page, label) => page.getByRole('progressbar', { name: label }).first().waitFor({ state: 'attached', timeout: 15000 }).then(() => true, () => false);
const picks = (page) => page.evaluate((k) => JSON.parse(sessionStorage.getItem(k) || 'null'), PICKS_KEY);
const reason = async (page) => ((await page.getByTestId('button-reason').count()) ? (await page.getByTestId('button-reason').innerText()).trim() : '');

// Hub → the FDE door → Class (Step 1 of 2) → a Grade 5 subject → Check and make.
async function door(page, ctx, subject) {
  await visit(page, ctx, HUB, { heading: /^Assessment$/ });
  await page.getByTestId('fde-door').click();
  await page.waitForURL('**' + NEW + 'class');
  await page.getByRole('button', { name: /Select grade and subject/ }).click();
  await page.getByRole('button', { name: new RegExp('^Grade 5 · ' + subject) }).click();
  await page.waitForURL('**' + NEW + 'check');
  await page.getByTestId('fde-row-inside').waitFor({ state: 'visible', timeout: 15000 });
}
const closeTray = (page, id) => page.getByTestId(id).getByRole('button', { name: 'Close' }).first().click()
  .then(() => page.getByTestId(id).waitFor({ state: 'detached', timeout: 5000 }).catch(() => {}));

async function setLang(ctx, lang) {
  const prev = String(await ctx.sql('select coalesce(preferred_language, \'\') from users where phone_number = \'' + TEACHER_PHONE + "'"));
  await ctx.sql('update users set preferred_language = ' + (lang ? "'" + lang + "'" : 'null') + " where phone_number = '" + TEACHER_PHONE + "'");
  return prev || null;
}

/* ── TA03 ───────────────────────────────────────────────────────────────────── */
async function ta03(page, ctx) {
  return withPattern(ctx, true, async () => {
    await asRole(page, ctx, 'teacher', 'teacherV2');
    await visit(page, ctx, HUB, { heading: /^Assessment$/ });
    await page.getByTestId('fde-door').click();
    await page.waitForURL('**' + NEW + 'class');
    expect(await stepIs(page, 'Step 1 of 2'), 'the door\'s Class step should say Step 1 of 2');
    await page.getByRole('button', { name: /Select grade and subject/ }).click();
    const subjectBtn = page.getByRole('button', { name: /^Grade \d+ · / });
    await subjectBtn.first().waitFor({ timeout: 15000 });
    const offered = (await subjectBtn.allInnerTexts()).map((t) => t.trim().split('\n').pop().trim());
    expect(offered.length > 0 && offered.every((t) => /^Grade 5 · /.test(t)), 'the picker should offer only Grade 5\'s subjects, got ' + JSON.stringify(offered));
    expect(await page.getByRole('radio', { name: /^Grade \d/ }).count() === 0, 'the door\'s picker should have no grade to choose');
    await page.getByRole('button', { name: /^Grade 5 · Maths/ }).click();
    await page.waitForURL('**' + NEW + 'check');
    await page.getByTestId('fde-row-inside').waitFor({ state: 'visible', timeout: 15000 });
    expect(await stepIs(page, 'Step 2 of 2'), 'Check and make should say Step 2 of 2');
    const rows = {};
    for (const [id, label] of [['fde-row-style', 'Paper style'], ['fde-row-class', 'Class'], ['fde-row-syllabus', 'Syllabus'], ['fde-row-inside', 'Inside']]) {
      rows[id] = (await page.getByTestId(id).innerText()).trim();
      expect(rows[id].split('\n')[0].trim() === label, id + ' should be labelled ' + label + ', got ' + JSON.stringify(rows[id]));
    }
    const hint = (await page.getByTestId('step-hint').innerText()).trim();
    expect(hint === 'Ready in about 3 min', 'the hint over Make my paper should read "Ready in about 3 min", got ' + hint);
    return { offered, hint };
  });
}

/* ── TA04 ───────────────────────────────────────────────────────────────────── */
async function ta04(page, ctx) {
  return withPattern(ctx, true, async () => {
    const prevLang = await setLang(ctx, 'en');
    try {
      await asRole(page, ctx, 'teacher', 'teacherV2');
      await door(page, ctx, 'Science');
      const amber = (await page.getByTestId('fde-row-youadd').innerText()).trim();
      expect(/^You add: .+ · before photocopying$/.test(amber), 'the amber line should say what she adds before photocopying, got ' + amber);

      await page.getByTestId('fde-row-inside').click();
      const inside = page.getByTestId('fde-inside-tray');
      await inside.waitFor({ state: 'visible' });
      const tray = await inside.innerText();
      for (const sec of ['A', 'B', 'C']) expect(new RegExp('(^|\\n)' + sec + '(\\n|$)').test(tray), 'Inside should list section ' + sec);
      expect(tray.includes('Paper + marking scheme · two PDFs'), 'Inside should say "Paper + marking scheme · two PDFs"');
      expect(tray.includes('Practice paper · not an official FDE paper'), 'Inside should say "Practice paper · not an official FDE paper"');
      await closeTray(page, 'fde-inside-tray');

      await page.getByTestId('fde-row-syllabus').click();
      const syl = page.getByTestId('fde-syllabus-tray');
      await syl.waitFor({ state: 'visible' });
      await syl.getByRole('checkbox', { checked: true }).last().click();
      await syl.getByRole('button', { name: 'Done', exact: true }).click();
      const sylRow = (await page.getByTestId('fde-row-syllabus').innerText()).trim();
      expect(/customised/.test(sylRow), 'the Syllabus row should say customised, got ' + sylRow);
      await page.getByTestId('fde-row-inside').click();
      await inside.getByRole('button', { name: 'Use FDE syllabus' }).waitFor({ timeout: 10000 });
      await closeTray(page, 'fde-inside-tray');

      // "Units 1–4, 6–8": a Maths paper keeping units 1, 2, 3, 4, 6, 7 and 8 (Science's FDE syllabus is units 1–7, so
      // the spec's unit list is only reachable on a pattern that has units 5 and 8: Maths, units 1–8, 11, 12).
      await page.getByTestId('fde-row-class').click();
      await page.waitForURL('**' + NEW + 'class');
      await page.getByRole('button', { name: /Select grade and subject|Grade 5 · Science/ }).first().click();
      await page.getByRole('button', { name: /^Grade 5 · Maths/ }).click();
      await page.waitForURL('**' + NEW + 'check');
      await page.getByTestId('fde-row-syllabus').click();
      await syl.waitFor({ state: 'visible' });
      const boxes = syl.getByRole('checkbox');
      const labels = await boxes.allInnerTexts();
      // the FDE units in order: Maths 1–8, 11, 12 → untick 5, 11 and 12 (the 5th, 9th and 10th boxes)
      expect(labels.length === 10, 'Maths should offer its 10 FDE units, got ' + labels.length);
      for (const i of [4, 8, 9]) await boxes.nth(i).click();
      await syl.getByRole('button', { name: 'Done', exact: true }).click();
      const en = (await page.getByTestId('fde-row-syllabus').innerText()).trim();
      expect(en.includes('Units 1–4, 6–8 · customised'), 'the Syllabus row should read "Units 1–4, 6–8 · customised", got ' + en);

      await setLang(ctx, 'ur');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByTestId('fde-row-syllabus').waitFor({ timeout: 15000 });
      let ur = '';
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        ur = unisolate(await page.getByTestId('fde-row-syllabus').innerText());
        if (ur.includes('یونٹ')) break;
        await page.waitForTimeout(300);
      }
      expect(ur.includes('یونٹ 1–4، 6–8 · حسبِ ضرورت'), 'in Urdu the row should read «یونٹ 1–4، 6–8 · حسبِ ضرورت», got ' + ur);
      await setLang(ctx, 'en');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByTestId('fde-row-style').waitFor({ timeout: 15000 });

      await page.getByTestId('fde-row-style').click();
      const style = page.getByTestId('fde-style-tray');
      await style.waitFor({ state: 'visible' });
      await style.getByRole('radio', { name: /My own paper/ }).click();
      await style.getByTestId('fde-style-next').click();
      await page.waitForURL('**' + NEW + 'questions');
      expect(await stepIs(page, 'Step 3 of 4'), "today's Questions should open at Step 3 of 4");
      const p = await picks(page);
      expect(JSON.stringify(p && p.chapters) === '[1,2,3,4,5,6,7,8,11,12]', 'the FDE units should be ticked, got ' + JSON.stringify(p && p.chapters));
      expect(p.pattern == null && p.style === 'own', 'her own paper carries no pattern');
      return { amber, en, ur, chapters: p.chapters };
    } finally {
      await setLang(ctx, prevLang);
    }
  });
}

/* ── TA05 ───────────────────────────────────────────────────────────────────── */
async function ta05(page, ctx) {
  return withPattern(ctx, true, async () => {
    await asRole(page, ctx, 'teacher', 'teacherV2');
    const sent = [];
    let status = 'generating';
    const rid = 'e2e-ta05-' + crypto.randomUUID().slice(0, 8);
    await page.route('**/api/portal/assessment/generate', (r) => { sent.push(r.request().postDataJSON()); return json(r, { success: true, requestId: rid }, 202); });
    await page.route('**/api/portal/assessment/status/**', (r) => json(r, status === 'ready'
      ? { success: true, status: 'ready', paperId: 'p-' + rid, pattern: PATTERN } : { success: true, status, pattern: PATTERN }));
    await door(page, ctx, 'Maths');
    await page.getByTestId('step-next').click();
    await page.waitForURL('**/request/' + rid);
    expect(sent.length === 1, 'Make my paper should send one request');
    const b = sent[0];
    expect(b.pattern === PATTERN && b.scope === 'fde', 'the request should carry pattern ' + PATTERN + ' and scope fde, got ' + JSON.stringify({ pattern: b.pattern, scope: b.scope }));
    expect(!('totalMarks' in b) || b.totalMarks == null, 'the request should carry no totalMarks, got ' + b.totalMarks);

    await page.getByText('~3 min', { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText('This page checks by itself.', { exact: true }).waitFor();
    const main = await page.evaluate(() => document.body.innerText);
    expect(/My papers/.test(main) && !/Make another/.test(main), 'the dock should be My papers only');

    // the same class again while it is being made: Make waits, and says why
    await page.goto(ctx.baseUrl + NEW + 'check', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('fde-row-inside').waitFor({ timeout: 15000 });
    expect(await page.getByTestId('step-next').isDisabled(), 'Make my paper should be off while this class\'s paper is being made');
    const why = await reason(page);
    expect(why === 'A paper for this class is being made', 'Make should say "A paper for this class is being made", got ' + why);

    // until it is ready
    status = 'ready';
    const deadline = Date.now() + 40000;
    while (Date.now() < deadline && (await page.getByTestId('step-next').isDisabled())) await page.waitForTimeout(500);
    expect(!(await page.getByTestId('step-next').isDisabled()), 'Make my paper should come back once the paper is ready');
    return { request: { pattern: b.pattern, scope: b.scope, totalMarks: b.totalMarks ?? null }, why };
  });
}

/* ── TA07 ───────────────────────────────────────────────────────────────────── */
const REFUSAL = {
  en: { PATTERN_OFF: 'Board-pattern papers are off for now. Make your own paper or try later.',
    ALREADY_GENERATING: 'A paper for this class is being made · see My papers', RATE_LIMITED: /^Paper limit reached · try again at \d\d?:\d\d/ },
  ur: { PATTERN_OFF: 'بورڈ pattern کے پرچے فی الحال بند ہیں۔ اپنی مرضی کا پرچہ بنائیں یا بعد میں کوشش کریں۔',
    ALREADY_GENERATING: 'اس کلاس کا پرچہ تیار ہو رہا ہے · «میرے پرچے» دیکھیں', RATE_LIMITED: /^پرچوں کی حد پوری ہو گئی · .+ پر دوبارہ کوشش کریں$/ },
};
const SUBJECT = { en: 'Maths', ur: null };

async function seedTen(ctx) {
  const ids = Array.from({ length: 10 }, () => crypto.randomUUID());
  await ctx.sql('insert into assessment_requests (id, user_id, surface, grade_code, subject_code, textbook_id, chapter_number, question_count, created_at) '
    + "select x.id::uuid, u.id, 'portal', 'grade_5', 'english', "
    + "(select id from textbooks where curriculum = 'ict' and grade = 5 and subject = 'english' limit 1), 1, 10, now() - (x.n || ' minutes')::interval "
    + 'from users u, (values ' + ids.map((id, i) => "('" + id + "', " + (i + 1) * 3 + ')').join(', ') + ') as x(id, n) '
    + "where u.phone_number = '" + TEACHER_PHONE + "'");
  return ids;
}
const dropRequests = (ctx, ids) => (ids.length ? ctx.sql('delete from assessment_requests where id in (' + ids.map((id) => "'" + id + "'").join(', ') + ')') : null);

async function ta07(page, ctx) {
  return withPattern(ctx, true, async () => {
    const prevLang = await setLang(ctx, 'en');
    const made = [];
    const seen = {};
    try {
      await asRole(page, ctx, 'teacher', 'teacherV2');
      for (const lang of ['en', 'ur']) {
        await setLang(ctx, lang);
        for (const code of ['PATTERN_OFF', 'ALREADY_GENERATING', 'RATE_LIMITED']) {
          await patternSwitch(ctx, true);
          await page.goto(ctx.baseUrl + HUB, { waitUntil: 'domcontentloaded' });
          await page.getByTestId('fde-door').click();
          await page.waitForURL('**' + NEW + 'class');
          await page.getByRole('button', { name: /Select grade and subject|جماعت/ }).first().click();
          await page.getByRole('button', { name: /Maths/ }).last().click();
          await page.waitForURL('**' + NEW + 'check');
          await page.getByTestId('fde-row-inside').waitFor({ timeout: 15000 });
          let seeded = [];
          if (code === 'PATTERN_OFF') await patternSwitch(ctx, false);
          if (code === 'ALREADY_GENERATING') {
            // a board-pattern request for this class queued a moment ago, its paper not yet started: the row the bot's
            // in-flight check reads (assessment-request.service.js findGenerating), removed afterwards
            const id = crypto.randomUUID();
            await ctx.sql('insert into assessment_requests (id, user_id, surface, grade_code, subject_code, textbook_id, chapter_number, question_count, question_types, created_at) '
              + "select '" + id + "'::uuid, u.id, 'portal', 'grade_5', 'maths', "
              + "(select id from textbooks where curriculum = 'ict' and grade = 5 and subject = 'maths' limit 1), 1, 48, "
              + "'[{\"slot\": \"maths.A.Q1a\", \"type\": \"MCQs\", \"count\": 1}]'::jsonb, now() from users u where u.phone_number = '" + TEACHER_PHONE + "'");
            seeded = [id];
          }
          if (code === 'RATE_LIMITED') { await limitSwitch(ctx, true); seeded = await seedTen(ctx); }
          try {
            const answer = page.waitForResponse((r) => r.url().includes('/api/portal/assessment/generate'), { timeout: 30000 });
            await page.getByTestId('step-next').click();
            const res = await answer;
            const body = await res.json().catch(() => ({}));
            if (body && typeof body.requestId === 'string' && code !== 'ALREADY_GENERATING') made.push(body.requestId);
            expect(body.errorCode === code, lang + ' ' + code + ': the server answered ' + res.status() + ' ' + (body.errorCode || body.error));
            const alert = page.getByRole('alert').first();
            await alert.waitFor({ timeout: 10000 });
            const line = unisolate((await alert.innerText()).split('\n')[0].trim());
            const want = REFUSAL[lang][code];
            expect(want instanceof RegExp ? want.test(line) : line === want, lang + ' ' + code + ': the line should be ' + want + ', got ' + line);
            // above the rows
            const [a, rows] = await Promise.all([alert.boundingBox(), page.getByTestId('fde-row-style').boundingBox()]);
            expect(a && rows && a.y < rows.y, lang + ' ' + code + ': the error line should sit above the rows');
            seen[lang + ':' + code] = line;
          } finally {
            await dropRequests(ctx, seeded);
            if (code === 'RATE_LIMITED') await limitSwitch(ctx, false);
            await dropRequests(ctx, made.splice(0));
          }
        }
      }
      return seen;
    } finally {
      await dropRequests(ctx, made);
      await setLang(ctx, prevLang);
    }
  });
}

/* ── TA08 ───────────────────────────────────────────────────────────────────── */
// The Chapters step's main column as an image, once its reads have settled.
async function chaptersShot(page, ctx, grade, subject, name) {
  await page.evaluate(([k, v]) => sessionStorage.setItem(k, v), [PICKS_KEY,
    JSON.stringify({ grade, subject, subjectName: name, coverBy: 'chapters', chapters: [], ranges: [] })]);
  await page.goto(ctx.baseUrl + NEW + 'cover', { waitUntil: 'networkidle' });
  await page.getByRole('progressbar').first().waitFor({ state: 'attached', timeout: 15000 });
  await page.waitForTimeout(1500);
  const fde = await page.getByTestId('fde-side-door').count();
  const now = await picks(page);
  expect(now && now.grade === grade && now.subject === subject, 'the Chapters step should be for Grade ' + grade + ' ' + subject + ', picks are ' + JSON.stringify(now));
  const shot = await page.locator('main').first().screenshot({ animations: 'disabled' });
  return { fde, shot };
}

async function ta08(page, ctx) {
  await catalogue(ctx);
  await asRole(page, ctx, 'teacher', 'teacherV2');
  const out = {};
  // flag off: the Grade 5 Maths Chapters step has no FDE card
  await patternSwitch(ctx, false);
  const off5 = await chaptersShot(page, ctx, 5, 'maths', 'Maths');
  expect(off5.fde === 0, 'with the switch off there should be no FDE card');
  const off3 = await chaptersShot(page, ctx, 3, 'science', 'Science');
  const offI = await chaptersShot(page, ctx, 5, 'islamiat', 'Islamiat');
  await patternSwitch(ctx, true);
  try {
    // a fresh page load per read: patternOffer is read once per load
    const on3 = await chaptersShot(page, ctx, 3, 'science', 'Science');
    expect(on3.fde === 0, 'Grade 3 Science should get no FDE card with the switch on');
    expect(on3.shot.equals(off3.shot), 'Grade 3 Science Chapters should be pixel-identical with the switch on and off');
    out.pixelIdentical = ['grade 3 science'];

    // the door's Class step: Islamiat off from the first paint, before any read answers. Each per-subject options read
    // is held back, so what shows is what the page drew before an answer came.
    let release;
    const gate = new Promise((r) => { release = r; });
    await page.route('**/api/portal/assessment/options?*subject=*', async (r) => { await gate; return r.continue(); });
    try {
      await page.goto(ctx.baseUrl + HUB, { waitUntil: 'domcontentloaded' });
      await page.getByTestId('fde-door').click();
      await page.waitForURL('**' + NEW + 'class');
      await page.getByTestId('fde-held-note').waitFor({ timeout: 15000 });
      const note = (await page.getByTestId('fde-held-note').innerText()).trim();
      expect(note === 'FDE pattern for Islamiat: after review', 'the Class step should say "FDE pattern for Islamiat: after review", got ' + note);
      await page.getByRole('button', { name: /Select grade and subject/ }).click();
      const isl = page.getByRole('button', { name: /^Grade 5 · Islamiat/ });
      await isl.waitFor({ timeout: 10000 });
      expect(await isl.isDisabled(), 'Islamiat should be off before any read answers');
      out.note = note;
    } finally {
      release();
      await page.unroute('**/api/portal/assessment/options?*subject=*');
    }

    // Grade 5 Islamiat: no FDE card, pixel-identical. Last, because the bot now offers the Islamiat board paper.
    const onI = await chaptersShot(page, ctx, 5, 'islamiat', 'Islamiat');
    expect(onI.fde === 0 && onI.shot.equals(offI.shot), 'Grade 5 Islamiat Chapters shows the FDE board pattern card with the switch on '
      + '(spec line stale: the bot offers the G5 Islamiat board paper since 024d8b1d4f, bd-5jmnfj.39.1, "Islamiat moves from '
      + 'held_subjects into the offered subjects of fde_g5_2027"; the portal shows it as designed)');
    return out;
  } finally {
    await patternSwitch(ctx, false);
  }
}

module.exports = [
  { id: 'TA03', title: 'FDE door: Class, then one Check screen', run: ta03 },
  { id: 'TA04', title: 'FDE Check: the three trays', run: ta04 },
  { id: 'TA05', title: 'FDE Make: the request and the wait', run: ta05 },
  { id: 'TA07', title: "FDE refusals in the teacher's language", run: ta07 },
  { id: 'TA08', title: 'Nothing new without the pattern', run: ta08 },
];

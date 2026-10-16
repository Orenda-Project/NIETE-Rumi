// fde-board-pattern — web-lane driver for tests/features/web/fde-board-pattern.feature. Runs the @FBnn scenarios: the
// ones the local stack can prove without a model call (the switch, the door, Check and make, the refusals, the soft
// limit). The @sandbox scenarios need a real paper and are run on sandbox by .claude/qa/agents/niete-fde-board-pattern-agent.md.
// Controls are found by the app's data-testids (fde-door, fde-side-door, fde-row-inside, fde-inside-tray, step-next);
// what the teacher reads is asserted by its visible words (the copy deck).
'use strict';
const crypto = require('crypto');
const { DEMO, expect, asRole, visit, setSetting } = require('../lib.cjs');

const PATTERN = 'fde_g5_2027';
const HUB = '/portal/teacher/assessment';
// users.phone_number of the demo teacher, built from the login form's number (0 → 92).
const TEACHER_PHONE = '92' + DEMO.teacher.slice(1);

const patternSwitch = (ctx, on) => setSetting(ctx, 'assessment_fde_pattern_enabled', on ? 'true' : 'false');
const limitSwitch = (ctx, on) => setSetting(ctx, 'assessment_rate_limit_enabled', on ? 'true' : 'false');

// The browser's own session calls the portal API, exactly as the app does.
async function api(page, ctx, method, path, body) {
  const url = ctx.baseUrl + '/api/portal' + path;
  const r = method === 'GET' ? await page.request.get(url) : await page.request.post(url, { data: body });
  let json = null;
  try { json = await r.json(); } catch (_) { /* not JSON */ }
  return { status: r.status(), json };
}

const fdeBody = (grade, subject) => ({ grade, subject, pattern: PATTERN, scope: 'fde', questionCount: 0,
  contentSource: 'unseen', seenCount: null, questionTypes: [], answerLines: true, outputFormat: 'pdf' });

// Ten requests in the last hour for the demo teacher, with ids we keep, so clean-up deletes exactly these. Grade 5
// Maths, on the book catalogue() guarantees: the columns are foreign keys and the demo data has no subjects or books.
async function seedTenThisHour(ctx) {
  const ids = Array.from({ length: 10 }, () => crypto.randomUUID());
  await ctx.sql('insert into assessment_requests (id, user_id, surface, grade_code, subject_code, textbook_id, chapter_number, question_count, created_at) '
    + 'select x.id::uuid, u.id, \'portal\', \'grade_5\', \'maths\', '
    + "(select id from textbooks where curriculum = 'ict' and grade = 5 and subject = 'maths' limit 1), 1, 10, now() - (x.n || ' minutes')::interval "
    + 'from users u, (values ' + ids.map((id, i) => "('" + id + "', " + (i + 1) * 3 + ')').join(', ') + ') as x(id, n) '
    + "where u.phone_number = '" + TEACHER_PHONE + "'");
  return ids;
}
const unseed = (ctx, ids) => ctx.sql('delete from assessment_requests where id in (' + ids.map((id) => "'" + id + "'").join(', ') + ')');

// The Grade 5 books the generator offers. The class picker lists only grades and subjects with an ICT book
// (assessment-browse listGrades/listSubjects), and the demo data (DATA=demo, the default) has none: every grade is greyed
// out and no scenario can reach Grade 5. Added only where missing, so a sandbox copy keeps its own books; the run's
// database is its own and is dropped at the end of the run.
const G5_SUBJECTS = ['english', 'maths', 'science'];
async function catalogue(ctx) {
  const list = G5_SUBJECTS.map((s) => "('" + s + "')").join(', ');
  await ctx.sql('insert into subjects (code) select s from (values ' + list + ') as x(s) on conflict (code) do nothing');
  await ctx.sql("insert into textbooks (curriculum, grade, subject, filename, total_pages) "
    + "select 'ict', 5, s, 'e2e-fde-g5-' || s || '.pdf', 100 from (values " + list + ') as x(s) '
    + "where not exists (select 1 from textbooks t where t.curriculum = 'ict' and t.grade = 5 and t.subject = x.s)");
}

async function bodyText(page) { return page.evaluate(() => document.body.innerText); }


const scenarios = [
  { id: 'FB01', title: 'The hub offers FDE pattern papers when the switch is on', run: async (page, ctx) => {
    await patternSwitch(ctx, true);
    await asRole(page, ctx, 'teacher', 'teacherV2');
    await visit(page, ctx, HUB, { heading: /^Assessment$/ });
    await page.getByTestId('fde-door').waitFor({ state: 'visible', timeout: 15000 });
    expect((await page.getByTestId('fde-door').innerText()).includes('FDE pattern papers'), 'the door does not say FDE pattern papers');
    const o = await api(page, ctx, 'GET', '/assessment/options?grade=5&subject=maths');
    expect(o.status === 200, 'options answered ' + o.status);
    expect(Array.isArray(o.json.patternGrades) && o.json.patternGrades.includes(5), 'no patternGrades [5] in options');
    expect((o.json.patterns || []).some((p) => p.id === PATTERN), 'Grade 5 Maths options do not name ' + PATTERN);
    return { patterns: o.json.patterns.map((p) => p.id) };
  } },

  { id: 'FB02', title: 'Check and make says what is inside before the paper is made', run: async (page, ctx) => {
    await patternSwitch(ctx, true);
    await asRole(page, ctx, 'teacher', 'teacherV2');
    await visit(page, ctx, HUB, { heading: /^Assessment$/ });
    await page.getByTestId('fde-door').click();
    // The door's picker opens straight on Grade 5's subjects (no grade step).
    await page.getByRole('button', { name: /Select grade and subject/ }).click();
    await page.getByRole('button', { name: /^Grade 5 · Science/ }).click();
    await page.getByTestId('step-next').waitFor({ state: 'visible', timeout: 15000 });
    // Words above Make my paper: everything the teacher reads before the button.
    const above = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="step-next"]');
      if (!btn) return null;
      const top = btn.getBoundingClientRect().top;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const words = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!el || !el.offsetParent || btn.contains(el)) continue;
        if (el.getBoundingClientRect().bottom <= top) words.push(...n.textContent.trim().split(/\s+/).filter(Boolean));
      }
      return words.length;
    });
    expect(above !== null, 'no Make my paper button on Check and make');
    expect(above <= 40, above + ' words above Make my paper (at most 40)');
    await page.getByTestId('fde-row-inside').click();
    const tray = page.getByTestId('fde-inside-tray');
    await tray.waitFor({ state: 'visible', timeout: 15000 });
    const text = await tray.innerText();
    for (const want of ['3 sections', '100 marks', '3 hrs', 'You add']) expect(text.includes(want), 'Inside tray lacks "' + want + '"');
    expect(/diagram to label/i.test(text), 'Inside tray lacks "the diagram to label"');
    return { wordsAboveMake: above };
  } },

  { id: 'FB03', title: 'A teacher on plain New paper takes the side door', run: async (page, ctx) => {
    await patternSwitch(ctx, true);
    await asRole(page, ctx, 'teacher', 'teacherV2');
    await visit(page, ctx, HUB, { heading: /^Assessment$/ });
    await page.getByText('New paper').first().click();
    // The class picker is a collapsed trigger; its tray holds the grade radios and the subject buttons.
    await page.getByRole('button', { name: /Select grade and subject/ }).click();
    await page.getByRole('radio', { name: /^Grade 5/ }).click();
    await page.getByRole('button', { name: /^Grade 5 · English/ }).click();
    const card = page.getByTestId('fde-side-door');
    await card.waitFor({ state: 'visible', timeout: 15000 });
    await card.getByRole('radio').first().click();
    await page.getByTestId('step-next').click();
    await page.getByLabel('Step 2 of 2').first().waitFor({ state: 'attached', timeout: 15000 });
    await page.getByTestId('fde-row-inside').waitFor({ state: 'visible', timeout: 15000 });
    return { landed: 'check' };
  } },

  { id: 'FB04', title: 'With the switch off, nothing new appears and a stale request is refused clearly', run: async (page, ctx) => {
    await patternSwitch(ctx, false);
    await asRole(page, ctx, 'teacher', 'teacherV2');
    await visit(page, ctx, HUB, { heading: /^Assessment$/ });
    expect(!(await page.getByTestId('fde-door').count()), 'the hub shows the FDE door with the switch off');
    expect(!(await bodyText(page)).includes('FDE pattern papers'), 'the hub says FDE pattern papers with the switch off');
    // The side-door card renders only from options' `patterns` (the app's own tests pin that), so options without
    // the keys is the proof that Chapters or pages shows no card.
    const o = await api(page, ctx, 'GET', '/assessment/options?grade=5&subject=maths');
    expect(!('patterns' in (o.json || {})) && !('patternGrades' in (o.json || {})), 'options carry pattern keys with the switch off');
    const r = await api(page, ctx, 'POST', '/assessment/generate', fdeBody(5, 'maths'));
    expect(r.status === 400, 'stale pattern request answered ' + r.status + ', not 400');
    expect(r.json && r.json.errorCode === 'PATTERN_OFF', 'errorCode ' + (r.json && r.json.errorCode) + ', not PATTERN_OFF');
    expect(/Board-pattern papers are off right now/.test(r.json.error), 'message: ' + r.json.error);
    return { status: r.status, errorCode: r.json.errorCode };
  } },

  { id: 'FB05', title: 'A Grade 4 request cannot carry the pattern', run: async (page, ctx) => {
    await patternSwitch(ctx, true);
    await asRole(page, ctx, 'teacher', 'teacherV2');
    const r = await api(page, ctx, 'POST', '/assessment/generate', fdeBody(4, 'maths'));
    expect(r.status === 400, 'Grade 4 pattern request answered ' + r.status + ', not 400');
    expect(r.json && r.json.errorCode === 'PATTERN_INELIGIBLE', 'errorCode ' + (r.json && r.json.errorCode));
    expect(!r.json.requestId, 'a request id came back: something was queued');
    return { status: r.status, errorCode: r.json.errorCode };
  } },

  { id: 'FB06', title: 'A teacher who has made 10 papers this hour is told when the next one can be made', run: async (page, ctx) => {
    await limitSwitch(ctx, true);
    const ids = await seedTenThisHour(ctx);
    try {
      await asRole(page, ctx, 'teacher', 'teacherV2');
      const r = await api(page, ctx, 'POST', '/assessment/generate', fdeBody(5, 'maths'));
      expect(r.status === 429, 'the 11th request answered ' + r.status + ', not 429');
      expect(r.json.errorCode === 'RATE_LIMITED', 'errorCode ' + r.json.errorCode);
      expect(/^You have made 10 papers this hour\. The next one can be made at \d\d:\d\d\.$/.test(r.json.error), 'message: ' + r.json.error);
      expect(!Number.isNaN(Date.parse(r.json.retryAt)), 'retryAt is not a time: ' + r.json.retryAt);
      expect(!r.json.requestId, 'a request id came back: something was queued');
      return { status: r.status, retryAt: r.json.retryAt };
    } finally {
      await unseed(ctx, ids);
      await limitSwitch(ctx, false);
    }
  } },

  { id: 'FB07', title: 'With the soft limit off, a teacher past 10 papers this hour is not refused', run: async (page, ctx) => {
    await limitSwitch(ctx, false);
    const ids = await seedTenThisHour(ctx);
    try {
      await asRole(page, ctx, 'teacher', 'teacherV2');
      const r = await api(page, ctx, 'POST', '/assessment/generate', { grade: 5, subject: 'maths', chapterNumbers: [1],
        contentSource: 'unseen', questionCount: 5, questionTypes: [{ type: 'mcq', count: 5 }], answerLines: true, outputFormat: 'pdf' });
      // A request the bot accepted is ours to remove too (its paper rows go with it: ON DELETE CASCADE).
      if (r.json && typeof r.json.requestId === 'string') ids.push(r.json.requestId);
      expect(r.status !== 429 && !(r.json && r.json.errorCode === 'RATE_LIMITED'), 'refused for the limit with the limit off');
      return { status: r.status };
    } finally {
      await unseed(ctx, ids);
    }
  } },

  { id: 'FB08', title: "A board-pattern choice switched off mid-way goes back to today's Chapters step", run: async (page, ctx) => {
    await patternSwitch(ctx, true);
    try {
      await asRole(page, ctx, 'teacher', 'teacherV2');
      await visit(page, ctx, HUB, { heading: /^Assessment$/ });
      await page.getByText('New paper').first().click();
      // The class picker is a collapsed trigger; its tray holds the grade radios and the subject buttons.
      await page.getByRole('button', { name: /Select grade and subject/ }).click();
      await page.getByRole('radio', { name: /^Grade 5/ }).click();
      await page.getByRole('button', { name: /^Grade 5 · English/ }).click();
      const card = page.getByTestId('fde-side-door');
      await card.waitFor({ state: 'visible', timeout: 15000 });
      await card.getByRole('radio').first().click();
      await page.getByText('Chapters are not used for the FDE board pattern').waitFor({ state: 'visible', timeout: 15000 });
      // The switch goes off while the teacher is on the step; a reload reads the options again (the app reads them once per load).
      await patternSwitch(ctx, false);
      await page.reload();
      const tab = page.getByRole('tab', { name: 'Chapters' });
      await tab.waitFor({ state: 'visible', timeout: 15000 });
      expect((await tab.getAttribute('aria-selected')) === 'true', 'the Chapters tab is not selected after the switch went off');
      expect(!(await page.getByTestId('fde-side-door').count()), 'the FDE board pattern card is still on Chapters or pages');
      await page.getByText('Select at least one chapter').first().waitFor({ state: 'visible', timeout: 15000 });
      expect(await page.getByTestId('step-next').isDisabled(), 'Next is not off on Chapters or pages');
      return { landed: 'chapters' };
    } finally {
      await patternSwitch(ctx, false);
    }
  } },
];

// Every scenario starts on the catalogue, so a new one cannot forget it.
const withCatalogue = scenarios.map((s) => ({ ...s, run: async (page, ctx) => { await catalogue(ctx); return s.run(page, ctx); } }));

module.exports = { feature: 'fde-board-pattern', spec: 'tests/features/web/fde-board-pattern.feature', scenarios: withCatalogue };

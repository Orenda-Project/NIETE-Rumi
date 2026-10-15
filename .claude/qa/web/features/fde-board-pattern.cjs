// fde-board-pattern — web-lane driver for tests/features/web/fde-board-pattern.feature. Runs the @FBnn scenarios: the
// ones the local stack can prove without a model call (the switch, the door, Check and make, the refusals, the soft
// limit). The @sandbox scenarios need a real paper and are run on sandbox by .claude/qa/agents/niete-fde-board-pattern-agent.md.
// Screens are found by their visible words (the copy deck), so a renamed label fails here, not silently.
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

// Ten requests in the last hour for the demo teacher, with ids we keep, so clean-up deletes exactly these.
async function seedTenThisHour(ctx) {
  const ids = Array.from({ length: 10 }, () => crypto.randomUUID());
  await ctx.sql('insert into assessment_requests (id, user_id, surface, grade_code, subject_code, textbook_id, chapter_number, question_count, created_at) '
    + 'select x.id::uuid, u.id, \'portal\', (select code from grade_levels order by code limit 1), (select code from subjects order by code limit 1), '
    + '(select id from textbooks limit 1), 1, 10, now() - (x.n || \' minutes\')::interval '
    + 'from users u, (values ' + ids.map((id, i) => "('" + id + "', " + (i + 1) * 3 + ')').join(', ') + ') as x(id, n) '
    + "where u.phone_number = '" + TEACHER_PHONE + "'");
  return ids;
}
const unseed = (ctx, ids) => ctx.sql('delete from assessment_requests where id in (' + ids.map((id) => "'" + id + "'").join(', ') + ')');

async function bodyText(page) { return page.evaluate(() => document.body.innerText); }

async function waitForText(page, text, ms) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: ms || 15000 });
}

const scenarios = [
  { id: 'FB01', title: 'The hub offers FDE pattern papers when the switch is on', run: async (page, ctx) => {
    await patternSwitch(ctx, true);
    await asRole(page, ctx, 'teacher', 'teacherV2');
    await visit(page, ctx, HUB, { heading: /^Assessment$/ });
    await waitForText(page, 'FDE pattern papers');
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
    await page.getByText('FDE pattern papers').first().click();
    await page.getByText('Science', { exact: true }).first().click();
    await waitForText(page, 'Make my paper');
    // Words above Make my paper: everything the teacher reads before the button.
    const above = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => /Make my paper/.test(b.innerText));
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
    await page.getByText('Inside', { exact: false }).first().click();
    const text = await bodyText(page);
    for (const want of ['3 sections', '100 marks', '3 hrs', 'You add']) expect(text.includes(want), 'Inside tray lacks "' + want + '"');
    expect(/diagram to label/i.test(text), 'Inside tray lacks "the diagram to label"');
    return { wordsAboveMake: above };
  } },

  { id: 'FB03', title: 'A teacher on plain New paper takes the side door', run: async (page, ctx) => {
    await patternSwitch(ctx, true);
    await asRole(page, ctx, 'teacher', 'teacherV2');
    await visit(page, ctx, HUB, { heading: /^Assessment$/ });
    await page.getByText('New paper').first().click();
    await page.getByText('Grade 5', { exact: false }).first().click();
    await page.getByText('English', { exact: true }).first().click();
    await waitForText(page, 'FDE board pattern');
    await page.getByText('FDE board pattern').first().click();
    await page.getByRole('button', { name: /^Next/ }).click();
    await waitForText(page, 'Step 2 of 2');
    await waitForText(page, 'Make my paper');
    return { landed: 'check' };
  } },

  { id: 'FB04', title: 'With the switch off, nothing new appears and a stale request is refused clearly', run: async (page, ctx) => {
    await patternSwitch(ctx, false);
    await asRole(page, ctx, 'teacher', 'teacherV2');
    await visit(page, ctx, HUB, { heading: /^Assessment$/ });
    expect(!(await bodyText(page)).includes('FDE pattern papers'), 'the hub shows FDE pattern papers with the switch off');
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
      expect(r.status !== 429 && !(r.json && r.json.errorCode === 'RATE_LIMITED'), 'refused for the limit with the limit off');
      return { status: r.status };
    } finally {
      await unseed(ctx, ids);
    }
  } },
];

module.exports = { feature: 'fde-board-pattern', spec: 'tests/features/web/fde-board-pattern.feature', scenarios };

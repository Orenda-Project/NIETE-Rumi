// teacher-assessment-papers — the hand-written teacher-assessment scenarios after a paper is made (bd-q8wt5e.6.5): FDE
// Ready's two files (TA06), Edit paper and Versions on an FDE paper (TA09–TA11), and a plain paper's Paper ready with its
// answer key (TA16, TA17). Joined to the teacher-assessment driver.
//
// The local stack's demo data has no papers, so every assessment read the pages make is answered by page.route with the
// shapes the portal reads (portal/src/portal/services/api.ts; the fixtures of the unit suites named per scenario), and
// every write (validate, save) is caught and answered there: nothing is sent to the bot. GET /config is the real one with
// its two assessment switches forced on in the answer, so Edit shows whatever the run database says. Signing in is real.
'use strict';
const { DEMO, asRole, expect } = require('../lib.cjs');

const B = '/portal/teacher/assessment';
const PATTERN = 'fde_g5_2027';
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const NOW = () => new Date().toISOString();
const FILE_HOST = 'https://e2e-files.r2.dev';

// A one-page PDF whose page reads `text` (pdf.js draws it on a canvas): offsets computed, so the xref is valid.
function pdf(text) {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = 'BT /F1 28 Tf 72 760 Td (' + text + ') Tj ET';
  objs[3] = '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream';
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const xref = out.length;
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(out, 'latin1');
}

// Every scenario here reads its words in English: the page follows her stored language (GET /me/language), which
// another scenario on the same stack may have set to Urdu for a moment; this lane checks the English copy.
async function english(page) {
  await page.route('**/api/portal/me/language', (r) => (r.request().method() === 'GET'
    ? json(r, { success: true, language: 'en', locked: false }) : r.continue()));
}

// GET /config as the server answers it, with the generator and editing switches on in the answer only.
async function editingOn(page) {
  await english(page);
  await page.route('**/api/portal/config', async (route) => {
    try {
      const res = await route.fetch();
      const body = await res.json().catch(() => ({}));
      body.features = { ...(body.features || {}), assessmentGenerator: true, assessmentEditing: true };
      await json(route, body);
    } catch (_) { /* the page went on (a navigation, a closed tab) before the answer: nothing to answer */ }
  });
}

const paperRow = (over = {}) => ({
  paper_id: 'p-f', grade: 5, subject_key: 'maths', subject: 'Maths', chapter_number: null, question_count: 48, total_marks: 100,
  ready_at: NOW(), has_answer_key: true, version: 1, pattern: PATTERN, pages: { paper: 4, scheme: 4 }, ...over,
});
async function papers(page, rows) {
  await page.route('**/api/portal/assessment/papers**', (r) => json(r, { success: true, total: rows.length, page: 1, pageSize: 20, papers: rows }));
}
// The download link each file row asks for: its own file (paper or answer_key), on a host the hand-off page forwards to.
async function downloads(page, asked) {
  await page.route('**/api/portal/assessment/paper/*/download**', (r) => {
    const artifact = new URL(r.request().url()).searchParams.get('artifact') || 'paper';
    asked.push(artifact);
    return json(r, { success: true, available: true, url: FILE_HOST + '/p-f/' + artifact + '.pdf', filename: artifact + '.pdf' });
  });
}
const text = (page) => page.evaluate(() => document.body.innerText);
const seen = (loc, ms = 15000) => loc.first().waitFor({ timeout: ms }).then(() => true, () => false);

/* ── TA06 — FDE Ready: two named files ─────────────────────────────────────────────────────────────────────────── */

// One context per browser: the WhatsApp in-app browsers are told apart by their user agent (lib/runtime.ts classifyBrowser).
const UA = {
  android: 'Mozilla/5.0 (Linux; Android 13; SM-A135F Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) '
    + 'Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36 WhatsApp/2.24.1.6',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/24.1.80',
};

async function fdeReadyPage(page, ctx) {
  await asRole(page, ctx, 'teacher', 'teacherV2');
  await editingOn(page);
  await papers(page, [paperRow()]);
  await page.route('**/api/portal/assessment/status/**', (r) => json(r, { success: true, status: 'ready', paperId: 'p-f', pattern: PATTERN }));
  await page.route('**/api/portal/assessment/paper/p-f/view', (r) => json(r, { success: true, paper: {}, sections: [] }));
  const asked = [];
  await downloads(page, asked);
  return asked;
}

// Where a file row sent her: a new tab (a download as today), or the intent:// hand-off to the phone's browser.
async function tapFileRow(page, testIdOrName, how) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.enable');
  const navs = [];
  cdp.on('Page.frameRequestedNavigation', (e) => navs.push(e.url));
  const pop = page.context().waitForEvent('page', { timeout: 5000 }).catch(() => null);
  if (how === 'testid') await page.getByTestId(testIdOrName).click();
  else await page.getByRole('button', { name: testIdOrName }).click();
  const tab = await pop;
  await page.waitForTimeout(800);
  const out = { tab: tab ? tab.url() : null, handoff: navs.find((u) => u.startsWith('intent://')) || null };
  if (tab) await tab.close().catch(() => {});
  await cdp.detach().catch(() => {});
  return out;
}
const handedOff = (h, artifact) => {
  if (!h) return false;
  const m = /open-file\.html\?f=([^#]+)/.exec(h);
  if (!m) return false;
  const f = Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  return f === FILE_HOST + '/p-f/' + artifact + '.pdf';
};

async function fdeReady(page, ctx) {
  const failures = [];
  const check = (ok, msg) => { if (!ok) failures.push(msg); };

  // 1. a phone browser at 360×740: the two rows, no "With marking scheme", the tiles clear of the dock, the dock's two buttons
  await page.setViewportSize({ width: 360, height: 740 });
  await fdeReadyPage(page, ctx);
  await page.goto(ctx.baseUrl + B + '/request/req-fde', { waitUntil: 'domcontentloaded' });
  const paperBtn = page.getByTestId('fde-ready-paper');
  await paperBtn.waitFor({ timeout: 20000 });
  const paperText = (await paperBtn.innerText()).replace(/\s*\n\s*/g, ' · ');
  const schemeText = (await page.getByTestId('fde-ready-scheme').innerText()).replace(/\s*\n\s*/g, ' · ');
  check(paperText === 'Question paper · 4 pages · for the class', 'the paper row reads "' + paperText + '"');
  check(schemeText === 'Marking scheme · 4 pages · for the teacher', 'the scheme row reads "' + schemeText + '"');
  check(!/With marking scheme/.test(await text(page)), 'Ready shows a "With marking scheme" chip');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(400);
  const box = await page.evaluate(() => {
    const dock = document.querySelector('[data-testid="share-actions"]');
    const wrap = dock && dock.parentElement;
    const tile = (re) => [...document.querySelectorAll('a, button')].find((e) => re.test(e.innerText.trim()));
    const r = (el) => (el ? el.getBoundingClientRect() : null);
    return { dock: r(wrap), open: r(tile(/^Open$/)), another: r(tile(/^Make another$/)) };
  });
  check(box.dock && box.open && box.another, 'no dock, Open or Make another on Ready');
  if (box.dock && box.open && box.another) {
    check(box.open.bottom <= box.dock.top + 0.5 && box.another.bottom <= box.dock.top + 0.5,
      'at 360×740 the Open / Make another tiles sit behind the dock (tiles end at ' + Math.round(Math.max(box.open.bottom, box.another.bottom)) + ', dock starts at ' + Math.round(box.dock.top) + ')');
  }
  const dockText = await page.getByTestId('share-actions').innerText();
  check(/Send on WhatsApp/.test(dockText) && /Open in another app/.test(dockText), 'the dock is not Send on WhatsApp + Open in another app: ' + JSON.stringify(dockText));
  check(await page.getByTestId('share-send').count() === 1 && await page.getByTestId('share-open').count() === 1, 'the dock should hold exactly its two buttons');

  // 2. outside WhatsApp's browser each row downloads as today: its own file in a new tab, no hand-off, no "If Download…" line
  check(await page.getByTestId('fde-if-no-download').count() === 0, 'the "If Download does nothing" line shows outside WhatsApp');
  const outPaper = await tapFileRow(page, 'fde-ready-paper', 'testid');
  const outScheme = await tapFileRow(page, 'fde-ready-scheme', 'testid');
  check(outPaper.tab === FILE_HOST + '/p-f/paper.pdf' && !outPaper.handoff, 'outside WhatsApp, Question paper did not download its own file: ' + JSON.stringify(outPaper));
  check(outScheme.tab === FILE_HOST + '/p-f/answer_key.pdf' && !outScheme.handoff, 'outside WhatsApp, Marking scheme did not download its own file: ' + JSON.stringify(outScheme));

  // 3. the paper page: the key is "Marking scheme" (never "Answer key"), and no Edit
  await page.goto(ctx.baseUrl + B + '/paper/p-f', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('assessment-paper').waitFor({ timeout: 20000 });
  const keyRow = page.getByRole('button', { name: /^Marking scheme$/ });
  check(await seen(keyRow), 'the paper page has no "Marking scheme" row');
  check(await page.getByRole('button', { name: /^Answer key$/ }).count() === 0, 'the paper page labels the key "Answer key"');
  await page.getByRole('link', { name: /^Versions$/ }).first().waitFor({ timeout: 10000 }).catch(() => {});
  const editOffered = await page.getByRole('link', { name: /^Edit$/ }).count();
  check(editOffered === 0, 'the paper page offers Edit on a board-pattern paper. Root cause: the spec line is stale — '
    + 'portal/src/portal/teacher/assessment/model.ts:46 FDE_EDITING = true since bf9bad0d96 (bd-cj8ggk.6, "turn on Edit for FDE '
    + 'board-pattern papers"), and PaperPage.tsx:114 shows Edit when FDE_EDITING; TA09-TA11 and fde.pages.test.tsx ("Edit is offered on a '
    + 'board-pattern paper (#2336 editor live)") rely on it');

  // 4. WhatsApp's browser on Android: each row hands its OWN file to the phone's browser, on Ready and on the paper page,
  //    and the "If Download does nothing here" line is shown
  const browser = page.context().browser();
  const droid = await browser.newContext({ userAgent: UA.android, viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
  try {
    const p2 = await droid.newPage();
    await fdeReadyPage(p2, ctx);
    await p2.goto(ctx.baseUrl + B + '/request/req-fde', { waitUntil: 'domcontentloaded' });
    await p2.getByTestId('fde-ready-paper').waitFor({ timeout: 20000 });
    const line = p2.getByTestId('fde-if-no-download');
    check(await seen(line, 5000) && (await line.innerText()).trim() === 'If Download does nothing here, use Open in another app',
      'inside WhatsApp on Android, Ready lacks the "If Download does nothing here" line');
    const aScheme = await tapFileRow(p2, 'fde-ready-scheme', 'testid');
    const aPaper = await tapFileRow(p2, 'fde-ready-paper', 'testid');
    check(handedOff(aScheme.handoff, 'answer_key') && !aScheme.tab, 'Android WhatsApp, Ready: Marking scheme did not hand its own file to the browser: ' + JSON.stringify(aScheme));
    check(handedOff(aPaper.handoff, 'paper') && !aPaper.tab, 'Android WhatsApp, Ready: Question paper did not hand its own file to the browser: ' + JSON.stringify(aPaper));
    await p2.goto(ctx.baseUrl + B + '/paper/p-f', { waitUntil: 'domcontentloaded' });
    await p2.getByTestId('assessment-paper').waitFor({ timeout: 20000 });
    check(await seen(p2.getByTestId('fde-if-no-download'), 5000), 'inside WhatsApp on Android, the paper page lacks the "If Download does nothing here" line');
    const bScheme = await tapFileRow(p2, /^Marking scheme$/, 'role');
    const bPaper = await tapFileRow(p2, /Download · Question paper/, 'role');
    check(handedOff(bScheme.handoff, 'answer_key'), 'Android WhatsApp, paper page: Marking scheme did not hand its own file off: ' + JSON.stringify(bScheme));
    check(handedOff(bPaper.handoff, 'paper'), 'Android WhatsApp, paper page: Question paper did not hand its own file off: ' + JSON.stringify(bPaper));
  } finally { await droid.close(); }

  // 5. WhatsApp on iPhone: each row downloads as today (intent:// does not exist there)
  const ios = await browser.newContext({ userAgent: UA.iphone, viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
  try {
    const p3 = await ios.newPage();
    await fdeReadyPage(p3, ctx);
    await p3.goto(ctx.baseUrl + B + '/request/req-fde', { waitUntil: 'domcontentloaded' });
    await p3.getByTestId('fde-ready-paper').waitFor({ timeout: 20000 });
    const iScheme = await tapFileRow(p3, 'fde-ready-scheme', 'testid');
    const iPaper = await tapFileRow(p3, 'fde-ready-paper', 'testid');
    check(iScheme.tab === FILE_HOST + '/p-f/answer_key.pdf' && !iScheme.handoff, 'iPhone WhatsApp: Marking scheme did not download its own file: ' + JSON.stringify(iScheme));
    check(iPaper.tab === FILE_HOST + '/p-f/paper.pdf' && !iPaper.handoff, 'iPhone WhatsApp: Question paper did not download its own file: ' + JSON.stringify(iPaper));
  } finally { await ios.close(); }

  expect(!failures.length, failures.join(' | '));
  return { paperRow: paperText, schemeRow: schemeText };
}

/* ── TA09–TA11 — an FDE paper in Edit paper and Versions (fixtures: fde.r5.edit / editPages / versions tests) ─────── */

const fields = (q, marks) => ({ shape: 'standard', question: q, marks: String(marks), answer: 'An answer to ' + q, lines: '2',
  lines_default: 2, lines_options: [], show_lines: true });
const item = (id, number, slot, section, marks) => ({ id, number, removed: false, type: 'Short Answer', section, marks,
  text: 'Question ' + id, fields: fields('Question ' + id, marks), ...(slot ? { slot } : {}) });
const CHOICES = [{ slot: 'maths.B.Q2', label_en: 'Q2', label_ur: 'سوال 2', generate: 12, attempt: 8, marks_each: 5 }];
const FDE_PAPER = () => {
  const items = [item('a1', 1, 'maths.A.Q1a', 'objective', 1), item('a2', 2, 'maths.A.Q1a', 'objective', 1),
    ...Array.from({ length: 12 }, (_, i) => item('b' + (i + 1), i + 3, 'maths.B.Q2', 'subjective', 5)),
    item('c1', 15, 'maths.C.Q3', 'subjective', 10)];
  return { success: true, paper: { paperId: 'p-f', version: 1, grade: 5, subject: 'Mathematics', subjectKey: 'maths', chapterNumber: null,
    rtl: false, questionCount: items.length, marks: 100, pattern: PATTERN, choices: CHOICES }, items };
};
const PLAIN_PAPER = { success: true, paper: { paperId: 'p-1', version: 2, grade: 4, subject: 'Science', chapterNumber: 2, rtl: false, questionCount: 3, marks: 7 },
  items: [item('q1', 1, null, 'objective', 1), item('q2', 2, null, 'objective', 1), item('q3', 3, null, 'subjective', 5)] };

// The editor's reads (and its writes caught): `save` answers every Save.
async function editor(page, ctx, paper, save) {
  await asRole(page, ctx, 'teacher', 'teacherV2');
  await editingOn(page);
  const sent = [];
  await page.route('**/api/portal/assessment/edit/*/questions', (r) => json(r, paper));
  await page.route('**/api/portal/assessment/edit/*/add-kinds', (r) => json(r, { success: false, errorCode: 'PATTERN_NO_ADD', error: 'Board-pattern papers keep their shape.' }, 400));
  await page.route('**/api/portal/assessment/edit/*/validate', (r) => { sent.push(['validate', r.request().postDataJSON()]); return json(r, { ok: true, marks: 5, text: 'Changed' }); });
  await page.route('**/api/portal/assessment/edit/*/save', (r) => { sent.push(['save', r.request().postDataJSON()]); return save(r); });
  return sent;
}
const refuse = (code, msg) => (r) => json(r, { success: false, errorCode: code, error: msg }, 400);
const q2Lines = (page) => page.$$eval('[data-testid="will-say"]', (els) => els.map((e) => e.innerText.trim()).filter((t) => /^Q2 /.test(t)));

async function fdeEditKeepsShape(page, ctx) {
  await editor(page, ctx, FDE_PAPER(), refuse('PATTERN_NO_ADD', 'Board-pattern papers keep their shape.'));
  await page.goto(ctx.baseUrl + B + '/paper/p-f/edit', { waitUntil: 'domcontentloaded' });
  const both = page.getByTestId('edit-both');
  await both.waitFor({ timeout: 20000 });
  expect((await both.innerText()).trim() === 'Changes the paper and the marking scheme', 'the top line reads ' + (await both.innerText()));
  const sections = await page.$$eval('[data-testid="edit-section"]', (els) => els.map((e) => e.innerText.trim()));
  expect(JSON.stringify(sections.map((s) => s.toLowerCase())) === JSON.stringify(['section a', 'section b', 'section c']),
    'the questions should be grouped as Section A, B and C, got ' + JSON.stringify(sections));
  let lines = await q2Lines(page);
  expect(lines.length === 12 && lines.every((l) => l === 'Q2 will then say: any eight of eleven'),
    "under each of Q2's twelve questions: \"Q2 will then say: any eight of eleven\", got " + JSON.stringify([...new Set(lines)]) + ' x' + lines.length);
  const marksChip = async () => (await text(page)).match(/\b(\d+) marks\b/)?.[1];
  const before = await marksChip();

  await page.getByRole('checkbox', { name: 'Remove question 3' }).click();
  lines = await q2Lines(page);
  const ten = lines.filter((l) => l === 'Q2 will then say: any eight of ten').length;
  const twelve = lines.filter((l) => l === 'Q2 will then say: any eight of twelve').length;
  expect(ten === 11 && twelve === 1, 'after removing one Q2 question: 11 × "any eight of ten" and 1 × "any eight of twelve", got ' + JSON.stringify(lines));
  const after = await marksChip();
  expect(before && before === after, 'the marks chip should stay the same, ' + before + ' → ' + after);

  const add = page.getByTestId('add-disabled');
  expect(await add.isDisabled(), 'Add question should be off on a board-pattern paper');
  const reason = (await page.getByTestId('button-reason').innerText()).trim();
  expect(reason === 'Board-pattern papers keep their shape', 'Add question\'s reason reads ' + reason);
  // the server's PATTERN_NO_ADD (a stale save) is said in the same words
  await page.getByRole('button', { name: /^Save as/ }).click();
  const alert = page.getByRole('alert');
  await alert.waitFor({ timeout: 10000 });
  expect((await alert.innerText()).trim() === 'Board-pattern papers keep their shape', 'PATTERN_NO_ADD reads ' + (await alert.innerText()));
  // and a typed Add link, whose kinds the server refuses, comes back to the editor, which says why
  await page.goto(ctx.baseUrl + B + '/paper/p-f/edit/add/MCQs', { waitUntil: 'domcontentloaded' });
  await page.waitForURL('**' + B + '/paper/p-f/edit', { timeout: 15000 });
  await page.getByTestId('add-disabled').waitFor({ timeout: 10000 });
  return { sections, marks: after };
}

async function fdeVersions(page, ctx) {
  await asRole(page, ctx, 'teacher', 'teacherV2');
  await editingOn(page);
  const day = NOW();
  const VERS = [
    { paperId: 'v2', version: 2, status: 'ready', createdAt: day, questionCount: 47, marks: 100, editedFrom: 'v1', latest: true },
    { paperId: 'v1', version: 1, status: 'ready', createdAt: day, questionCount: 48, marks: 100, editedFrom: null, latest: false },
  ];
  let versionsAnswer = { success: true, versions: VERS, pattern: PATTERN };
  await page.route('**/api/portal/assessment/edit/*/versions', (r) => json(r, versionsAnswer));
  let papersFail = false;
  await page.route('**/api/portal/assessment/papers**', (r) => (papersFail
    ? json(r, { success: false, error: 'boom' }, 500)
    : json(r, { success: true, total: 2, page: 1, pageSize: 20, papers: [paperRow({ paper_id: 'v2' }), paperRow({ paper_id: 'p-plain', pattern: null, grade: 4, subject: 'Science', subject_key: 'science' }),
      paperRow({ paper_id: 'v9', pattern: null, grade: 4, subject: 'Science', subject_key: 'science' })] })));
  const asked = [];
  await page.route('**/api/portal/assessment/paper/*/download**', (r) => {
    const u = new URL(r.request().url());
    asked.push(u.pathname.split('/').slice(-2)[0] + ':' + (u.searchParams.get('artifact') || 'paper'));
    return json(r, { success: true, available: true, url: FILE_HOST + u.pathname, filename: 'x.pdf' });
  });

  // FDE: the chip, and a "Marking scheme" row under each ready version that opens that version's key file
  await page.goto(ctx.baseUrl + B + '/paper/v2/versions', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('assessment-versions').waitFor({ timeout: 20000 });
  await page.getByTestId('versions-list').waitFor({ state: 'attached', timeout: 15000 });
  expect(await seen(page.getByText('FDE pattern', { exact: true }), 5000), 'Versions shows no FDE pattern chip');
  const schemes = page.getByTestId('version-scheme');
  expect(await schemes.count() === 2, 'a "Marking scheme" row under each of the 2 ready versions, got ' + (await schemes.count()));
  for (let i = 0; i < 2; i++) {
    const pop = page.context().waitForEvent('page', { timeout: 5000 }).catch(() => null);
    await schemes.nth(i).click();
    const tab = await pop; if (tab) await tab.close();
  }
  expect(JSON.stringify(asked) === JSON.stringify(['v2:answer_key', 'v1:answer_key']), 'each Marking scheme row should open its own version\'s key, asked ' + JSON.stringify(asked));

  // a plain paper: no chip, no scheme rows, no FDE wrapper (the branch point's page)
  versionsAnswer = { success: true, versions: VERS.map((v) => ({ ...v, paperId: v.paperId + 'p' })), pattern: null };
  await page.goto(ctx.baseUrl + B + '/paper/p-plain/versions', { waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: /^Edit$/ }).first().waitFor({ timeout: 15000 });
  expect(await page.getByTestId('version-scheme').count() === 0 && await page.getByTestId('versions-list').count() === 0
    && !(await seen(page.getByText('FDE pattern', { exact: true }), 1000)), 'a plain paper\'s Versions carries FDE marks');

  // My papers read fails (an older server sends no `pattern`): "Could not load" with Try again, and no Edit until it is read
  versionsAnswer = { success: true, versions: VERS };
  papersFail = true;
  await page.goto(ctx.baseUrl + B + '/paper/v9/versions', { waitUntil: 'domcontentloaded' });
  await page.getByText('Could not load').first().waitFor({ timeout: 20000 });
  const retry = page.getByRole('button', { name: /Try again/ });
  expect(await retry.count() > 0, 'no Try again beside Could not load');
  expect(await page.getByRole('link', { name: /^Edit$/ }).count() === 0, 'Edit is offered before the paper is read');
  papersFail = false;
  await retry.first().click();
  expect(await seen(page.getByRole('link', { name: /^Edit$/ }), 15000), 'once My papers is read (a plain paper), Edit should be offered');

  return {
    blocked: '"a plain paper\'s Versions and Edit paper screens are pixel-identical to today\'s" needs a screenshot of the '
      + 'pre-pattern build to compare with, which this lane keeps none of. Proved: the FDE chip, a Marking scheme row under '
      + 'each ready version opening that version\'s own key, a plain paper with no FDE chip / scheme rows, and "Could not '
      + 'load" with Try again and no Edit while My papers cannot be read',
    asked,
  };
}

async function fdeFixedMarks(page, ctx) {
  const failures = [];
  // an FDE question: there is no question form to open (remove / put back only)
  await editor(page, ctx, FDE_PAPER(), refuse('PATTERN_FIXED_MARKS', 'Board-pattern papers fix each question\'s marks.'));
  await page.goto(ctx.baseUrl + B + '/paper/p-f/edit', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('edit-both').waitFor({ timeout: 20000 });
  const links = await page.$$eval('a[href*="/edit/q/"]', (els) => els.length);
  await page.goto(ctx.baseUrl + B + '/paper/p-f/edit/q/b1', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const form = await page.getByTestId('assessment-edit-question').count();
  if (!form) {
    failures.push('an FDE question does not open (' + links + ' question links on the editor; /edit/q/b1 goes back to ' + new URL(page.url()).pathname
      + '), so "the question and its answer can still be changed" cannot hold. Root cause: the spec line is stale — a6af60e536 (bd-cj8ggk.7, '
      + '"FDE board-pattern papers are remove / put back only") made board-pattern rows plain text (EditPages.tsx "never edited '
      + '(PATTERN_NO_EDIT): no editor to open") and EditQuestionPage redirects mode=edit on a pattern paper to the editor');
  } else {
    if (await page.locator('#aq-marks').count()) failures.push('an FDE question shows a Marks box');
    if (!(await page.getByRole('textbox').count())) failures.push('an FDE question has no question / answer box');
  }
  // the server's PATTERN_FIXED_MARKS, in the page's language
  await page.goto(ctx.baseUrl + B + '/paper/p-f/edit', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('edit-both').waitFor({ timeout: 20000 });
  await page.getByRole('checkbox', { name: 'Remove question 3' }).click();
  await page.getByRole('button', { name: /^Save as/ }).click();
  const alert = page.getByRole('alert');
  await alert.waitFor({ timeout: 10000 });
  const said = (await alert.innerText()).trim();
  if (said !== "Board-pattern papers fix each question's marks.") failures.push('PATTERN_FIXED_MARKS reads "' + said + '"');

  // a plain paper's question still shows its Marks box
  await page.unroute('**/api/portal/assessment/edit/*/questions');
  await page.route('**/api/portal/assessment/edit/*/questions', (r) => json(r, PLAIN_PAPER));
  await page.goto(ctx.baseUrl + B + '/paper/p-1/edit/q/q3', { waitUntil: 'domcontentloaded' });
  const plainForm = await seen(page.getByTestId('assessment-edit-question'), 15000);
  if (!plainForm || !(await page.locator('#aq-marks').count())) failures.push('a plain paper\'s question shows no Marks box');

  expect(!failures.length, failures.join(' | '));
  return { fixedMarks: said };
}

/* ── TA16, TA17 — a plain paper's Paper ready and its answer key (fixture: paperReady.test.tsx) ──────────────────── */

const PHONES = ['92' + DEMO.teacher.slice(1), DEMO.teacher, '+92' + DEMO.teacher.slice(1)];
async function plainReady(page, ctx, { key }) {
  await asRole(page, ctx, 'teacher', 'teacherV2');
  await editingOn(page);
  // her job, as the app keeps it in sessionStorage under her number (components/assessment-jobs/usePaperJobs.ts)
  const job = [{ requestId: 'req-plain', label: 'Living Things', startedAt: Date.now(), status: 'writing',
    spec: { grade: 4, subject: 'science', questionCount: 15, totalMarks: 30 } }];
  await page.addInitScript(([phones, v]) => { for (const p of phones) sessionStorage.setItem('assessment-jobs:v1:' + p, v); }, [PHONES, JSON.stringify(job)]);
  await page.route('**/api/portal/assessment/status/**', (r) => json(r, { success: true, status: 'ready', paperId: 'p-9' }));
  await papers(page, []);
  const files = [];
  await page.route('**/api/portal/assessment/paper/p-9/file**', (r) => {
    const artifact = new URL(r.request().url()).searchParams.get('artifact') || 'paper';
    files.push(artifact);
    if (artifact === 'answer_key' && !key) return json(r, { success: false, error: 'not found' }, 404);
    return r.fulfill({ status: 200, contentType: 'application/pdf', body: pdf(artifact === 'answer_key' ? 'ANSWER KEY' : 'THE PAPER') });
  });
  const tabs = [];
  page.context().on('page', (p) => tabs.push(p.url()));
  await page.goto(ctx.baseUrl + B + '/request/req-plain', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('lesson-plan-viewer').waitFor({ timeout: 20000 });
  return { files, tabs };
}
const drawn = (page) => page.waitForFunction(() => {
  const c = document.querySelector('[data-testid="lesson-plan-viewer"] canvas');
  return !!c && c.width > 0 && c.height > 0;
}, null, { timeout: 20000 }).then(() => true, () => false);
const lastFile = async (files, want) => { for (let i = 0; i < 40 && files[files.length - 1] !== want; i++) await new Promise((r) => setTimeout(r, 250)); return files[files.length - 1]; };

async function plainPaperReady(page, ctx) {
  const { files, tabs } = await plainReady(page, ctx, { key: true });
  const t = await text(page);
  for (const chip of ['Ready', '15 questions', '30 marks']) expect(new RegExp('(^|\\n)' + chip + '(\\n|$)').test(t), 'Paper ready lacks the chip "' + chip + '"');
  expect(await drawn(page), 'the paper\'s pages are not drawn in the app');
  expect(files[0] === 'paper', 'the viewer should read the paper, read ' + JSON.stringify(files));
  expect(await page.getByRole('button', { name: 'Zoom in' }).count() === 1 && await page.getByRole('button', { name: 'Zoom out' }).count() === 1, 'no zoom buttons on the viewer');
  expect(tabs.length === 0, 'something opened in another tab: ' + JSON.stringify(tabs));
  // Edit (editing on) and Answer key sit ABOVE the paper
  const pos = await page.evaluate(() => {
    const v = document.querySelector('[data-testid="lesson-plan-viewer"]').getBoundingClientRect().top;
    const by = (re) => [...document.querySelectorAll('a, button')].find((e) => re.test(e.innerText.trim()));
    const e = by(/^Edit$/), k = by(/^Answer key$/);
    return { viewer: v, edit: e ? e.getBoundingClientRect().bottom : null, key: k ? k.getBoundingClientRect().bottom : null };
  });
  expect(pos.edit != null && pos.edit <= pos.viewer, 'Edit is not above the paper');
  expect(pos.key != null && pos.key <= pos.viewer, 'Answer key is not above the paper');
  const dock = await page.getByTestId('share-actions').innerText();
  expect(/Send on WhatsApp/.test(dock) && /Download PDF/.test(dock), 'the dock is not Send on WhatsApp + Download PDF: ' + JSON.stringify(dock));
  const body = await text(page);
  expect(!/Make another/.test(body), 'Paper ready offers Make another');
  expect(!/\bWord\b/i.test(body), 'Paper ready mentions Word');
  return { chips: ['Ready', '15 questions', '30 marks'], files };
}

async function answerKeyToggle(page, ctx) {
  const { files } = await plainReady(page, ctx, { key: true });
  expect(await drawn(page), 'the paper is not drawn');
  await page.getByRole('button', { name: /^Answer key$/ }).click();
  const back = page.getByRole('button', { name: /^Back to paper$/ });
  expect(await seen(back, 10000), 'the button should read "Back to paper"');
  expect(await lastFile(files, 'answer_key') === 'answer_key' && await drawn(page), 'the viewer did not show the answer key, read ' + JSON.stringify(files));
  await back.click();
  expect(await seen(page.getByRole('button', { name: /^Answer key$/ }), 10000), 'Back to paper did not return');
  expect(await lastFile(files, 'paper') === 'paper' && await drawn(page), 'the viewer did not show the paper again, read ' + JSON.stringify(files));

  // a paper made before answer keys were kept: "No answer key", and the paper again
  // a fresh browser context (its own session) for the paper with no key
  const other = await page.context().browser().newContext({ viewport: { width: 412, height: 915 } });
  try {
    const p2 = await other.newPage();
    const second = await plainReady(p2, ctx, { key: false });
    await drawn(p2);
    await p2.getByRole('button', { name: /^Answer key$/ }).click();
    expect(await seen(p2.getByText('No answer key', { exact: true }), 10000), 'a paper with no key should say "No answer key"');
    expect(await seen(p2.getByRole('button', { name: /^Answer key$/ }), 10000) && await lastFile(second.files, 'paper') === 'paper',
      'with no key the viewer should show the paper again, read ' + JSON.stringify(second.files));
    return { files, noKey: second.files };
  } finally { await other.close(); }
}

module.exports = [
  { id: 'TA06', title: 'FDE Ready: two named files', run: fdeReady },
  { id: 'TA09', title: 'Editing an FDE paper keeps its shape', run: fdeEditKeepsShape },
  { id: 'TA10', title: 'Versions of an FDE paper', run: fdeVersions },
  { id: 'TA11', title: "The marks of an FDE paper's questions are the board's", run: fdeFixedMarks },
  { id: 'TA16', title: 'A plain paper that is ready opens in the app, with no Make another and no Word', run: plainPaperReady },
  { id: 'TA17', title: 'Answer key shows the key in the same viewer, and Back to paper shows the paper again', run: answerKeyToggle },
];

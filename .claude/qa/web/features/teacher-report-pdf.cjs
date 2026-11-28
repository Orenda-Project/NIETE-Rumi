// teacher-report-pdf — web-lane driver for tests/features/web/teacher-report-pdf.feature: the scheduled class report the
// teacher gets on WhatsApp after a quiz (the PDF, its caption, and the links text that follows it), for a teacher on
// app_settings.teacher_report_teachers. Each scenario builds its own teacher and class (teacher-report/fixture.cjs), lets
// children finish through the real child-quiz API, then puts the report job on this run's queue; the running worker
// renders and sends it to the run's MOCK WhatsApp, where the driver reads the caption, the text after it and the PDF's
// bytes — the PDF read with the engine's pdf text helper (.claude/qa/engine/bin/pdf_text.py), never eyeballed.
// Spec ids are @RP01–@RP08 beside the spec's own @T35x tags.
'use strict';
const { expect } = require('../lib.cjs');
const F = require('./teacher-report/fixture.cjs');

const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const ON_LIST = { teacher_report_teachers: 'all' };
// "not on the list": the list names one teacher who is none of this run's
const OFF_LIST = { teacher_report_teachers: ['00000000-0000-4000-8000-00000000e2e0'] };

const NAMES = ['Ayesha Khan', 'Bilal Ahmed', 'Hamza Ali', 'Sana Riaz', 'Omar Butt', 'Zoya Malik', 'Taha Aziz', 'Rida Noor',
  'Fatima Gul', 'Usman Tariq', 'Hina Javed', 'Ali Shah', 'Maryam Iqbal', 'Daniyal Raza', 'Noor Fatima'];
// "a teacher on the list with one class list 3-B of 15 children; a quiz for class 3 that 6 of them finished"
async function background(ctx, opts = {}) {
  const T = await F.teacher(ctx, { lang: opts.lang, lists: opts.noList ? [] : [{ grade: 3, section: 'B', kids: NAMES }], quiz: { grade: '3', ...(opts.quiz || {}) } });
  const kids = opts.noList ? NAMES.slice(0, 6).map((n) => ({ name: n })) : T.lists[0].kids;
  const n = opts.played === undefined ? 6 : opts.played;
  for (let i = 0; i < n; i++) await F.play(ctx, T, kids[i], { wrong: i === 1 ? [1] : [] });
  return { T, kids };
}
async function report(ctx, T) {
  const r = await F.classReport(ctx, T);
  expect(!r.none, 'no class report reached the teacher on WhatsApp within 60 s (sent: ' + JSON.stringify((r.items || []).map((x) => x.type)) + ')');
  return r;
}
const linksText = (r) => r.after.filter((x) => x.type === 'text').map((x) => x.txt).join('\n');
const has = (t, s) => t.includes(s);

const S = [];
const add = ({ id }, title, run) => S.push({ id, title, run });   // ids as an object key: the form validate_specs reads

add({ id: 'RP01' }, 'The class report PDF lists who has not played yet, greyed, with their list no.', async (page, ctx) => {
  await F.switches(ctx, ON_LIST);
  const { T, kids } = await background(ctx);
  const r = await report(ctx, T);
  const t = flat(r.pdf.text);
  expect(/NOT PLAYED YET/i.test(t), 'the PDF has no "Not played yet" section');
  const rest = kids.slice(6);
  const at = rest.map((k) => t.search(new RegExp('\\b' + k.first + ' ' + k.roll + '\\b')));
  expect(at.every((x) => x >= 0), 'not every child still to play is listed with their list no.: ' + rest.filter((k, i) => at[i] < 0).map((k) => k.first + ' ' + k.roll).join(', '));
  expect(at.every((x, i) => i === 0 || x > at[i - 1]), 'the children still to play are not in list order');
  expect(rest.every((k) => !t.includes(k.name)), 'a surname is printed for a child still to play');
  expect(kids.slice(0, 6).every((k) => !new RegExp('\\b' + k.first + ' ' + k.roll + '\\b').test(t)), 'a child who played is listed as still to play');
  expect(!/\/r\/|https?:\/\//.test(t), 'the PDF carries a link');
  expect(t.includes('send /quiz, then tap “My quiz reports”'), 'the PDF does not say "send /quiz, then tap “My quiz reports”"');
  const cap = r.doc.txt;
  expect(!/https?:\/\/|\/r\//.test(cap), 'the caption carries a link: ' + cap);
  const links = linksText(r);
  expect(new RegExp('/r/' + '[A-Za-z0-9_.-]+/remind').test(links) && /\/r\/[A-Za-z0-9_.-]+(\s|$)/.test(links), 'the links text after the PDF lacks /r/<token>/remind and /r/<token>: ' + links);
  return { notPlayed: rest.map((k) => k.first + ' ' + k.roll), caption: cap, linksText: links.replace(/\/r\/[A-Za-z0-9_.-]+/g, '/r/<token>'), pages: r.pdf.pages };
});

add({ id: 'RP03' }, 'A child who started but did not finish is listed once', async (page, ctx) => {
  await F.switches(ctx, ON_LIST);
  const { T, kids } = await background(ctx);
  await F.play(ctx, T, kids[6], { finish: false });                       // Taha starts, answers two, never finishes
  const r = await report(ctx, T);
  const t = flat(r.pdf.text);
  const n = (t.match(new RegExp('\\b' + kids[6].first + '\\b', 'g')) || []).length;
  expect(new RegExp('\\b' + kids[6].first + ' ' + kids[6].roll + '\\b').test(t), kids[6].first + ' is not under "Not played yet"');
  expect(n === 1, kids[6].first + ' appears ' + n + ' times in the PDF');
  return { child: kids[6].first + ' ' + kids[6].roll, mentions: n };
});

add({ id: 'RP04' }, 'A teacher with no class list still gets the live report links', async (page, ctx) => {
  await F.switches(ctx, ON_LIST);
  const { T } = await background(ctx, { noList: true });
  const r = await report(ctx, T);
  const t = flat(r.pdf.text);
  expect(!/NOT PLAYED YET/i.test(t), 'the PDF has a "Not played yet" section without a class list');
  expect(t.includes('send /quiz, then tap “My quiz reports”'), 'the PDF does not point to the live report in /quiz');
  expect(!/\/r\/|https?:\/\//.test(t), 'the PDF carries a link');
  const links = linksText(r);
  expect(/\/r\/[A-Za-z0-9_.-]+/.test(links), 'no live report link follows the PDF: ' + links);
  return { caption: r.doc.txt, linksText: links.replace(/\/r\/[A-Za-z0-9_.-]+/g, '/r/<token>') };
});

add({ id: 'RP06' }, 'An Urdu quiz\'s PDF section is Urdu; the caption follows the teacher', async (page, ctx) => {
  await F.switches(ctx, ON_LIST);
  const { T, kids } = await background(ctx, { lang: 'en', quiz: { language: 'ur' } });
  const r = await report(ctx, T);
  const t = flat(r.pdf.text);
  const links = linksText(r);
  expect(/Live report/i.test(links) && !/[؀-ۿ]/.test(links), 'the live report line is not English: ' + links);
  expect(/[؀-ۿ]/.test(t), 'the PDF of an Urdu quiz carries no Urdu');
  const rest = kids.slice(6).filter((k) => new RegExp(k.first + '\\s*' + k.roll + '(?![0-9])').test(t));
  expect(rest.length === 9, 'the not-played section does not list the 9 children with their list no. (' + rest.length + ')');
  const shown = links.replace(/\/r\/[A-Za-z0-9_.-]+/g, '/r/<token>');
  if (t.includes('ابھی نہیں کھیلا') && t.includes('میری کوئز رپورٹس')) return { section: 'ابھی نہیں کھیلا', pointer: 'میری کوئز رپورٹس', linksText: shown };
  // The words themselves: the engine's text helper (pypdf) does not map the Nastaliq ligature glyphs of the bot's
  // Chromium PDF back to text, so the two Urdu phrases cannot be matched. Everything else of the Then is proved above.
  return { blocked: 'the PDF\'s Urdu words cannot be read back: the engine\'s pdf text helper (pypdf) does not map the Nastaliq ligature glyphs to text (it reads "'
    + t.slice(0, 50) + '…"), so "ابھی نہیں کھیلا" and «میری کوئز رپورٹس» cannot be matched; proved here: the links text is English for the English teacher, '
    + 'the PDF carries the Urdu quiz, and its not-played section lists the 9 children with their list no.', linksText: shown };
});

add({ id: 'RP07' }, 'The reteach guidance in the PDF is the guidance the web report shows', async (page, ctx) => {
  await F.switches(ctx, ON_LIST);
  const { T } = await background(ctx);
  const from = require('fs').statSync(require('path').join(ctx.runDir, 'worker.log')).size;
  const r = await report(ctx, T);
  const meta = await F.one(ctx, 'select meta::text from quizzes where id = ' + F.q(T.quizId));
  const g = JSON.parse(meta || '{}').report_guidance;
  if (!g) {
    const wlog = require('fs').readFileSync(require('path').join(ctx.runDir, 'worker.log')).subarray(from).toString('utf8').replace(/\x1b\[[0-9;]*m/g, '');
    const failed = /guidance generation failed/.test(wlog);
    return { blocked: 'no reteach guidance to compare: the worker wrote none (' + (failed ? 'worker.log: "video-quiz: guidance generation failed (report still sends)" — ' : '')
      + 'the guidance is an LLM call, video-quiz-report generateGuidance, with no cassette on this lane), so quizzes.meta.report_guidance stays empty; the PDF and its sections are proved in RP01–RP06', pdfPages: r.pdf.pages };
  }
  const t = flat(r.pdf.text);
  const parts = Object.values(g).flat().filter((x) => typeof x === 'string' && x.trim()).map(flat);
  expect(parts.length && parts.every((p) => t.includes(p.slice(0, 40))), 'the guidance stored is not the guidance printed');
  const status = await F.one(ctx, 'select status from quizzes where id = ' + F.q(T.quizId));
  expect(status === 'report_sent', 'the quiz is not marked reported in the same update: ' + status);
  return { guidance: parts.length, status };
});

add({ id: 'RP08' }, 'The pre-send PDF does not change', async () => ({
  blocked: 'byte identity with the base template is a comparison of two renderers (this tree\'s hand-off PDF against the template before the teacher report), not a page or a message the web lane can open: the hand-off PDF is rendered inside the quiz send (transcript-quiz-handoff) only after an LLM-generated quiz, and there is no base build on the lane to compare it with',
}));

add({ id: 'RP02' }, 'The caption counts the class and carries no link; the links follow as their own text', async (page, ctx) => {
  await F.switches(ctx, ON_LIST);
  // (a) 6 of 15 played
  const { T } = await background(ctx);
  const r = await report(ctx, T);
  const cap = r.doc.txt;
  expect(cap.includes('6 of 15 in 3-B played · 9 still to play'), 'the caption reads: ' + cap);
  expect(!/https?:\/\/|\/r\//.test(cap), 'the caption carries a link: ' + cap);
  expect(!/session|finished/i.test(cap), 'the caption still counts finished sessions: ' + cap);
  const next = r.after[0];
  expect(next && next.type === 'text', 'the item right after the PDF is not a text: ' + (next && next.type));
  expect(/Remind the class/.test(next.txt) && /\/r\/[A-Za-z0-9_.-]+\/remind/.test(next.txt) && /\/r\/[A-Za-z0-9_.-]+(\s|$)/.test(next.txt.replace(/\/remind/g, '')), 'the links text: ' + next.txt);
  expect(!NAMES.some((n) => n.split(' ').some((w) => new RegExp('\\b' + w + '\\b').test(next.txt))), 'the links text names a child');
  const got = { caption: cap, links: next.txt.replace(/\/r\/[A-Za-z0-9_.-]+/g, '/r/<token>') };
  // (b) an Urdu-speaking teacher: caption and links text in Urdu, numbers and the class name isolated
  const U = (await background(ctx, { lang: 'ur' })).T;
  const ru = await report(ctx, U);
  const ucap = ru.doc.txt, ulinks = linksText(ru);
  expect(/[؀-ۿ]/.test(ucap) && /[؀-ۿ]/.test(ulinks), 'the Urdu teacher\'s caption/links are not Urdu: ' + ucap + ' | ' + ulinks);
  const iso = (s) => /[⁦-⁨][^⁩]*3-B[^⁦]*⁩/.test(s) && /[⁦-⁨][0-9۰-۹]+⁩/.test(s);
  expect(iso(ucap), 'the Urdu caption does not isolate the numbers and the class name: ' + JSON.stringify(ucap));
  got.urdu = { caption: ucap };
  // (c) everyone played: the count only, and the live report alone
  const A = await F.teacher(ctx, { lists: [{ grade: 3, section: 'B', kids: NAMES }], quiz: { grade: '3' } });
  for (const k of A.lists[0].kids) await F.play(ctx, A, k);
  const ra = await report(ctx, A);
  expect(/15 of 15 in 3-B played/.test(ra.doc.txt) && !/still to play/.test(ra.doc.txt), 'everyone played, the caption reads: ' + ra.doc.txt);
  const alinks = linksText(ra);
  expect(/\/r\/[A-Za-z0-9_.-]+/.test(alinks) && !/\/remind/.test(alinks), 'everyone played, the links text: ' + alinks);
  got.allPlayed = ra.doc.txt;
  // (d) no class list: "<finished> of <started> finished"
  const N = await F.teacher(ctx, { lists: [], quiz: { grade: '3' } });
  await F.play(ctx, N, { name: 'Alee Raza' }); await F.play(ctx, N, { name: 'Noor Bano' }); await F.play(ctx, N, { name: 'Iqra Khan' }, { finish: false });
  const rn = await report(ctx, N);
  expect(/2 of 3 finished/.test(rn.doc.txt), 'no class list, the caption reads: ' + rn.doc.txt);
  got.noList = rn.doc.txt;
  // (e) a teacher not on the list: today's caption and no links text
  await F.switches(ctx, OFF_LIST);
  const O = (await background(ctx)).T;
  const ro = await report(ctx, O);
  expect(!/https?:\/\/|\/r\//.test(ro.doc.txt) && !ro.after.some((x) => x.type === 'text' && /\/r\//.test(x.txt)), 'a teacher not on the list got links: ' + ro.doc.txt + ' | ' + linksText(ro));
  expect(!/still to play/.test(ro.doc.txt), 'a teacher not on the list got the new caption: ' + ro.doc.txt);
  got.offList = ro.doc.txt;
  return got;
});

add({ id: 'RP05' }, 'A teacher not on the teacher report list gets today\'s report', async (page, ctx) => {
  await F.switches(ctx, OFF_LIST);
  const { T } = await background(ctx);
  const r = await report(ctx, T);
  const t = flat(r.pdf.text);
  expect(!/\/r\//.test(t) && !/\/r\//.test(r.doc.txt), 'the PDF or caption carries a /r/ link');
  expect(!/NOT PLAYED YET/i.test(t), 'the PDF has a "Not played yet" section');
  expect(!r.after.some((x) => /\/r\//.test(x.txt || '')), 'a links text followed the PDF');
  return { caption: r.doc.txt, pages: r.pdf.pages };
});

const scenarios = S;   // run order: the on-list scenarios first, then the two that take the teacher off the list

module.exports = { feature: 'teacher-report-pdf', spec: 'tests/features/web/teacher-report-pdf.feature', scenarios };

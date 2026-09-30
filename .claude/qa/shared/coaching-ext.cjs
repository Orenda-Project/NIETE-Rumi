'use strict';
/**
 * coaching-ext — the 40 coaching scenarios coaching.cjs did not drive (COA16–COA55), on the mock lane.
 *
 * coaching.cjs owns the first pipeline run (COA01–COA15) and hands its observations here (`r1`). This
 * module then drives SIX more pipeline runs, each on one branch of the flow the first run could not take
 * (a typed plan, Urdu, v2 photos with a screenshot, a scripted grader fault, a scripted ASR fault, a
 * nameless teacher with the voice note down), and the coaching-ask family (the teacher_nudges sweeper
 * run in-process through bot/scripts/e2e/sweep.js, with rows seeded straight into the sandbox DB).
 *
 * Every scenario is isolated: a throw records BLOCKED with the error, never aborts the feature. Results
 * come back as a Map id → [verdict, evidence]; coaching.cjs emits them with literal ids so the coverage
 * gate can see every one. Levers: stack-control.cjs (restart, redis, sweep, job, faults) and the
 * niete_coaching_db.py commands (session-get, seed-nudge, nudge-rows, purge-nudges, age-sessions …).
 */
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const run = promisify(execFile);
const SC = require('./stack-control.cjs');

const MEDIA = path.resolve(__dirname, '..', 'fixtures', 'whatsapp', 'niete', 'media');
const FX = {
  classroom : MEDIA + '/hameeda_16min.m4a',
  alt       : MEDIA + '/hameeda_15min_alt.m4a',   // 15.5 min, different bytes → a new hash (COA21)
  eleven    : MEDIA + '/hameeda_11min.m4a',       // 11 min, 2.8 MB → probed, "too short to coach" (COA44)
  photo     : MEDIA + '/textbook_page.png',
  screenshot: MEDIA + '/phone_screenshot.png',
  lpPdf     : MEDIA + '/lesson_plan_fractions_g5.pdf',
  board     : MEDIA + '/board_fractions.png',            // a board that matches the fractions plan (COA19 needs a photo-credited move)
  notAPlan  : MEDIA + '/staff_meeting_notes.txt',
};
const UR = /[\u0600-\u06FF]/;
const RX = {
  detected     : /I detected a (\d+)-minute audio recording|آڈیو ریکارڈنگ ملی/i,
  yesAnalyze   : /Yes,? Analyze|تجزیہ کریں/i,
  no           : /^(No|نہیں)$/i,
  yes          : /^(Yes|ہاں|جی ہاں)$/i,
  stepAny      : /Step (\d)\/5|مرحلہ\s*\u2066?(\d)\s*\/\s*5/,
  photoPrompt  : /add up to \d+ photos|تصاویر بھی شامل|تصویر/i,
  photoSend    : /Send the photos now|تصاویر بھیجیں|بورڈ/i,
  addAnother   : /Add another|مزید تصویر/i,
  done         : /^Done$|مکمل/i,
  lpPrompt     : /lesson plan for this class|do you have a lesson plan|link a recent lesson plan|سبق کا منصوبہ ہے|حالیہ سبق/i,
  lpSend       : /Send your lesson plan as a document|paste it here|منصوبہ .*بھیجیں/i,
  lpReceived   : /Lesson plan received|منصوبہ موصول/i,
  notLessonPlan: /doesn'?t look like a lesson plan|not a lesson plan|isn'?t a lesson plan|منصوبے جیسا نہیں لگتا/i,
  noPlanAck    : /without the lesson plan|بغیر.*منصوبہ|منصوبے کے بغیر/i,
  reportReady  : /Observation Report is ready|رپورٹ تیار/i,
  survey       : /Was this coaching report useful|کوچنگ رپورٹ .*مفید|مفید/i,
  complete     : /coaching session is complete|کوچنگ سیشن یہاں مکمل/i,
  commit       : /Will you commit|عہد کریں/i,
  quizOffer    : /quiz for your (class|students)|make a quiz|کوئز/i,
  duplicate    : /heard this recording before|پہلے بھی سنی/i,
  awaitingAudio: /Please send your classroom audio or video/i,
  tooShort     : /too short to coach|sounds like a classroom recording, but it is about \d+ minutes|بہت مختصر/i,
  lpAsk        : /You planned (a|this) lesson with me|میرے ساتھ .*سبق کی تیاری/i,
  lpAskDeclined: /Classroom Coaching is in the menu|مینو میں کلاس روم کوچنگ/i,
  menuAsks     : /WhatsApp mic|واٹس ایپ کے مائیک/i,
  menuLength   : /20 to 45 minutes|20 سے 45 منٹ/i,
  cancelledTap : /This session was cancelled|سیشن منسوخ ہو چکا/i,
  resumeOffer  : /we did not finish|مکمل نہیں کر سکے/i,
  sendAsDoc    : /send (it|the recording) as a document|document instead|بطور دستاویز/i,
  reflectNudge : /Continue Now|Get Report Now/i,
};
const PASTE_PLAN = [
  'Lesson Plan: Grade 5 Maths — Equivalent Fractions (40 minutes)',
  'Objectives: students identify equivalent fractions with strips and explain why 1/2 = 2/4.',
  'Materials: fraction strips, chart paper, markers, whiteboard.',
  'Activities: 1) warm-up with 1/2 shaded on the board; 2) fold strips into halves, quarters, eighths;',
  '3) pairs find three fractions equal to 1/2; 4) pairs share, teacher records on chart.',
  'Assessment: exit ticket — write two fractions equivalent to 2/3 and explain one.',
].join('\n');
const BRIEF_PLAN = 'Topic: equivalent fractions\nActivity: fold paper strips into halves and quarters, pairs find three fractions equal to 1/2\nCheck: exit ticket, two fractions equal to 2/3';
const NONPLAN_TEXT = 'Reminder for all staff: the monthly meeting is on Friday at 2 pm in the main hall. '
  + 'Agenda: attendance registers, the sports day rota, the parent-teacher evening, and the new duty timetable. '
  + 'Please bring your class registers and the completed leave forms. Tea will be served after the meeting. '
  + 'Anyone unable to attend should inform the office by Thursday noon.';
const REFLECT_ANSWER = 'I think the pacing worked well, and next time I would give the quieter students more time to answer.';
const MID_QUESTION = 'Quick question while that runs: what is a good way to explain place value to grade 3?';
const HOWTO_URL = 'https://pub-0000.r2.dev/feature_videos/coaching_intro.mp4';   // any URL: the mock never fetches it

const V = (c, ev) => [c ? 'PASS' : 'FAIL', ev];
const B = (reason, extra = {}) => ['BLOCKED', { reason, ...extra }];
const short = (s, n = 220) => String(s == null ? '' : s).replace(/\s+/g, ' ').slice(0, n);
const digits = (s) => (String(s || '').match(/\d+(?:\.\d+)?\s*%|\bout of\b|\bmarks?\b|\d+\s*\/\s*\d+/gi) || []);
const bandWords = /Excellent|Good|Average|Below average|Needs support|بہترین|اچھا|اوسط|مدد درکار/;
const latinOnly = (s) => !UR.test(s || '');

/** JSON from a db lever (the last JSON line the script printed). */
function dbJson(api, action, extra) {
  const r = api.db(action, extra || []);
  const line = String(r.out || '').trim().split('\n').reverse().find((l) => l.trim().startsWith('{') || l.trim().startsWith('['));
  try { return line ? JSON.parse(line) : { ok: false, raw: short(r.out || r.err, 200) }; } catch (_) { return { ok: false, raw: short(r.out || r.err, 200) }; }
}
async function pdfText(mediaId) {
  const p = SC.ports(); if (!p || !mediaId) return { ok: false, err: 'no port/media' };
  try {
    const { stdout } = await run('python3', [path.join(__dirname, 'pdf_text.py'), `http://127.0.0.1:${p.mock}/media/${mediaId}/bytes`], { encoding: 'utf8', timeout: 60000 });
    return JSON.parse(String(stdout).trim().split('\n').pop());
  } catch (e) { return { ok: false, err: short(e.message, 200) }; }
}
async function reportTextOf(report, sessionId) {
  if (!report) return { ok: false, err: 'no report' };
  if (report.kind === 'image') { const h = await SC.heroText(sessionId); return h && h.ok ? { ok: true, text: h.text, caption: h.caption, via: 'hero-text re-render' } : { ok: false, err: 'hero re-render: ' + (h && (h.err || h.out)) }; }
  return pdfText(report.mediaId);
}
const mediaIdOf = (r) => (r && r.media && (r.media.id || r.media.mediaId)) || (r && r.raw && r.raw.document && r.raw.document.id) || (r && r.raw && r.raw.image && r.raw.image.id) || null;
const faultFired = (sinceMs) => { try { const log = fs.readFileSync(path.join(SC.runDir(), 'worker.log'), 'utf8'); const lines = log.split('\n').filter((l) => l.includes('scripted FAULT answered')); const last = lines[lines.length - 1] || ''; const m = last.match(/\[(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)/); return !!m && (Date.parse(m[1].replace(' ', 'T') + '+05:00') >= sinceMs - 5000); } catch (_) { return false; } };
const notAssessedReason = (sessionId) => { try { const log = fs.readFileSync(path.join(SC.runDir(), 'worker.log'), 'utf8'); const i = log.indexOf(String(sessionId)); const seg = log.slice(Math.max(0, i - 200000)); const m = seg.match(/not_assessed_reason[^"]*"([a-z_]+)"/); return m ? m[1] : null; } catch (_) { return null; } };
const rowKind = (r) => r.audio ? 'audio' : r.doc ? 'document' : r.img ? 'image' : (r.raw && r.raw.type === 'interactive' ? 'interactive' : 'text');
const btnOf = (r, rx) => (r.btns || []).find((b) => rx.test(b));

module.exports.run = async function runExt(ctx) {
  const { api, rec, sleep, fresh, r1, mainRec } = ctx;
  const out = new Map();
  const set = (id, verdict, ev) => out.set(id, [verdict, ev]);
  const guard = async (ids, fn) => {
    try { await fn(); }
    catch (e) { for (const id of [].concat(ids)) if (!out.has(id)) set(id, ...B('threw: ' + short(e && e.message, 240), { stack: short(e && e.stack, 300) })); }
  };
  const env = process.env.E2E_ENV || 'sandbox';
  const driver = process.env.E2E_DRIVER || '';
  const t = () => Date.now();
  const stateOf = (u) => JSON.stringify((u && u.conversation_state) || null);

  // ── the one-run pipeline walker ─────────────────────────────────────────────────────────────────
  async function collect(pred, ms) {
    const t0 = t(); const seen = [];
    while (t() - t0 < ms) {
      const batch = await fresh();
      for (const r of batch) { seen.push(r); if (pred(r)) return { ok: true, hit: r, seen }; }
      await sleep(1500);
    }
    return { ok: false, hit: null, seen };
  }
  async function tapRow(r, rx, ms = 60000) { const b = btnOf(r, rx); if (!b) return null; return api.tapAndWait(b, ms); }

  /**
   * One coaching pipeline on the given branches. Returns everything it saw, in order.
   *  photo   : 'no' | 'yes' | 'screenshot' | 'ignore'
   *  lp      : 'no' | 'paste' | 'brief' | 'nonplan' | 'pdf' | 'recent'   (recent = pick the seeded lesson-plan download from the list)
   *  reflect : 'answer' | 'report' | 'none'
   *  viaMenu : open the menu's Classroom Coaching row first (sets the AWAITING_CLASSROOM_AUDIO wait)
   *  midQuestion : a text sent right after "Yes, Analyze" (COA49)
   */
  async function pipeline(o) {
    const obs = { label: o.label, rows: [], steps: [], events: [], sessionId: null, photoPrompt: null, photoReply: null,
      lpPrompt: null, lpSend: null, lpReply: null, reflective: null, reflectiveAck: null, report: null, reportText: null,
      survey: [], complete: [], commit: null, quizOffer: null, midReply: null, greeting: null, stalled: null, confirmed: false };
    const note = (k, r) => obs.events.push({ k, i: obs.rows.length - 1, kind: rowKind(r), txt: short(r.txt, 120), btns: r.btns });
    await fresh();
    if (o.viaMenu) { const m = await api.sendWait('/menu'); await api.openList(btnOf(m, /See what I do|فہرست دیکھیں/) || 'See what I do'); await api.pickRowAndWait(UR.test(m.txt || '') ? 'کلاس روم کوچنگ' : 'Classroom Coaching'); await fresh(); }
    if (o.faults) SC.faults(o.faults); else SC.clearFaults();
    const up = await api.upload(o.file || FX.classroom, o.asVoiceNote ? 'Audio' : 'Document', 180000);
    let card = up; const t0 = t();
    while (!btnOf(card, RX.yesAnalyze) && t() - t0 < 30000) { const b = (await fresh()).find((r) => btnOf(r, RX.yesAnalyze)); if (b) { card = b; break; } await sleep(1000); }
    obs.card = { txt: short(up.txt || card.txt, 200), btns: card.btns };
    if (!btnOf(card, RX.yesAnalyze)) { obs.stalled = 'no Yes/Analyze card after the upload'; return obs; }
    await fresh();
    const yes = await api.tapAndWait(btnOf(card, RX.yesAnalyze), 120000);
    obs.confirmed = true; obs.confirmReply = short(yes.txt, 160);
    const sess = dbJson(api, 'session-get'); obs.sessionId = sess && sess.id;
    if (o.midQuestion) { const mr = await api.sendWait(o.midQuestion, 90000); obs.midReply = short(mr.txt, 240); }
    const budget = o.budgetMs || 15 * 60 * 1000; const stallMs = o.stallMs || 240000;   // live (uncached) analysis + hero render run ~100 s each
    const t1 = t(); let lastProgress = t(); let prevSig = ''; let reportAt = 0;
    const sendLp = async () => {
      if (o.lp === 'pdf') { const d = await api.upload(FX.lpPdf, 'Document', 120000); obs.lpReply = { via: 'pdf', txt: short(d.txt, 200), btns: d.btns }; }
      else { const text = o.lp === 'paste' ? PASTE_PLAN : o.lp === 'brief' ? BRIEF_PLAN : NONPLAN_TEXT;
             const d = await api.sendWait(text, 120000); obs.lpReply = { via: o.lp, txt: short(d.txt, 200), btns: d.btns }; }
    };
    while (t() - t1 < budget) {
      const batch = await fresh();
      for (const r of batch) {
        obs.rows.push(r); const x = r.txt || '';
        const m = RX.stepAny.exec(x); const stepNo = m && (m[1] || m[2] || m[3]);
        if (stepNo && !obs.steps.includes(stepNo)) { obs.steps.push(stepNo); note('step' + stepNo, r); }
        if (!obs.photoPrompt && RX.photoPrompt.test(x) && (r.btns || []).length) {
          obs.photoPrompt = { txt: short(x, 240), btns: r.btns }; note('photoPrompt', r);
          if (o.photo === 'no') { const rep = await tapRow(r, RX.no); obs.photoReply = short(rep && rep.txt, 200); }
          else if (o.photo === 'ignore') { obs.photoAt = t(); }
          else if (o.photo === 'yes' || o.photo === 'screenshot') {
            await tapRow(r, RX.yes);
            const p1 = await api.upload(o.firstPhoto || FX.photo, 'Photos & videos', 120000);
            let last = p1;
            if (o.photo === 'screenshot') { await tapRow(p1, RX.addAnother); last = await api.upload(FX.screenshot, 'Photos & videos', 120000); }
            const d = await tapRow(last, RX.done, 90000);
            obs.photoReply = { first: short(p1.txt, 160), afterDone: short(d && d.txt, 200), doneBtns: last.btns };
          }
          continue;
        }
        if (!obs.lpPrompt && RX.lpPrompt.test(x)) {
          obs.lpPrompt = { txt: short(x, 240), btns: r.btns, list: r.list ? 'list' : 'buttons' }; note('lpPrompt', r);
          if (o.lp === 'no') {
            if (btnOf(r, RX.no)) { const rep = await tapRow(r, RX.no, 90000); obs.lpReply = { via: 'No', txt: short(rep && rep.txt, 200) }; }
            else { const opener = btnOf(r, /Select|منتخب/i); if (opener) { await api.openList(opener); const rep = await api.pickRowAndWait('نہیں', 90000); obs.lpReply = { via: 'list:No', txt: short(rep && rep.txt, 200) }; } }
          } else if (o.lp === 'recent') {
            const opener = btnOf(r, /Select|منتخب/i);
            if (!opener) { obs.lpReply = { via: 'recent', err: 'the LP prompt was Yes/No, not a list — no recent lesson plan was offered', btns: r.btns }; const rep = await tapRow(r, RX.no, 90000); obs.lpSend = short(rep && rep.txt, 120); }
            else { const list = await api.openList(opener); const rows = (list && list.rows) || []; const pick = rows.find((x) => !/upload|اپلوڈ|^No\b|^نہیں|new|none|no lesson/i.test(x)); const rep = pick ? await api.pickRowAndWait(pick, 90000) : null; obs.lpReply = { via: 'recent', rows, picked: pick || null, txt: short(rep && rep.txt, 200) }; obs.lpSend = 'picked from the list'; }
          } else {
            const rep = await tapRow(r, RX.yes, 90000);
            // whatever the ask's wording (English or Urdu), "Yes" is answered by sending the plan
            if (rep) { obs.lpSend = short(rep.txt, 200); await sendLp(); }
            else obs.lpSend = 'no reply after Yes';
          }
          continue;
        }
        if (obs.lpPrompt && !obs.lpSend && RX.lpSend.test(x) && o.lp !== 'no') { obs.lpSend = short(x, 200); await sendLp(); continue; }
        if (RX.lpReceived.test(x) || RX.notLessonPlan.test(x)) { note(RX.notLessonPlan.test(x) ? 'lpRejected' : 'lpReceived', r); obs.lpVerdict = short(x, 240); }
        if (/putting together your coaching report|کوچنگ رپورٹ تیار کر/i.test(x)) { obs.greeting = short(x, 200); note('greeting', r); }
        const voiceQ = r.audio && obs.steps.includes('3') && !obs.report && !obs.reflective;
        const textQ = !obs.reflective && obs.steps.includes('3') && /\?/.test(x) && !RX.reflectNudge.test(x) && !stepNo && !RX.photoPrompt.test(x) && !RX.lpPrompt.test(x);
        if ((voiceQ || textQ) && !obs.report) {
          obs.reflective = { kind: voiceQ ? 'audio' : 'text', txt: short(x, 260) }; note('reflectiveQ', r);
          if (o.reflect === 'answer') { const a = await api.sendWait(REFLECT_ANSWER, 120000); obs.reflectiveAck = short(a.txt, 200); }
          else if (o.reflect === 'report') { await api.tapId('button', 'coaching_finish_' + obs.sessionId, 'Get Report Now'); obs.reflectiveAck = 'tapped coaching_finish_'; }
          continue;
        }
        if (!obs.report && (r.doc || r.img) && obs.steps.length) { obs.report = { kind: rowKind(r), mediaId: mediaIdOf(r), caption: short(x, 200), btns: r.btns }; note('report', r); reportAt = t(); continue; }
        if (RX.reportReady.test(x)) note('reportReady', r);
        if (r.audio && obs.report) note('audio-after-report', r);
        if (RX.survey.test(x) && (r.btns || []).length) { obs.survey.push({ i: obs.rows.length - 1, txt: short(x, 160), btns: r.btns }); note('survey', r); continue; }
        if (RX.complete.test(x) || RX.commit.test(x)) { obs.complete.push({ i: obs.rows.length - 1, txt: short(x, 260), btns: r.btns, hasComplete: RX.complete.test(x), hasCommit: RX.commit.test(x) }); note('complete/commit', r); if (RX.commit.test(x)) obs.commit = obs.complete[obs.complete.length - 1]; continue; }
        if (obs.report && RX.quizOffer.test(x) && (r.btns || r.list)) { obs.quizOffer = { i: obs.rows.length - 1, txt: short(x, 160) }; note('quizOffer', r); }
      }
      if (o.photo === 'ignore' && obs.photoAt && !obs.gateSwept && t() - obs.photoAt > 70000) {
        obs.gateSwept = await SC.sweep('stale', { COACHING_PHOTO_GATE_MINUTES: '1', COACHING_REMINDER_MINUTES: '60', COACHING_AUTO_COMPLETE_MINUTES: '720' });
        lastProgress = t();
      }
      if (obs.commit && obs.quizOffer) break;
      if (obs.commit && t() - reportAt > 45000) break;
      if (obs.report && t() - reportAt > 120000) break;
      const sig = [obs.steps.length, !!obs.photoPrompt, !!obs.lpPrompt, !!obs.reflective, !!obs.report, obs.survey.length, obs.complete.length].join('/');
      if (sig !== prevSig) { prevSig = sig; lastProgress = t(); }
      if (t() - lastProgress > stallMs) { obs.stalled = `no progress for ${Math.round((t() - lastProgress) / 1000)}s at steps [${obs.steps}]`; break; }
      await sleep(3000);
    }
    obs.elapsedSec = Math.round((t() - t1) / 1000);
    if (obs.report) obs.reportText = await reportTextOf(obs.report, obs.sessionId);
    obs.session = dbJson(api, 'session-get', ['--session-id', obs.sessionId || 'latest']);
    SC.clearFaults();
    return obs;
  }
  // nothing in flight AND no completed session left behind: the audio-hash cache (bd-7beiz) answers every later
  // upload of the same file with "I've heard this recording before" + the old report (run 20260930-0621: runs 3–7
  // never started). reset-history archives them (status completed → archived), which the cache's filter skips.
  const cleanSlate = async () => { try { api.db('cancel-stuck'); api.db('reset-history'); } catch (_) {} SC.clearFaults(); await api.resetFlow(); await fresh(); };

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // A — judged from the FIRST run (coaching.cjs handed us its rows + session)
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // the account must be English for every English run: the previous run left it locked to Urdu once
  // (run 20260930-0649: the menu came out in Urdu and run 2 could not find its row)
  const pickLanguage = async (row) => {
    const r = await api.sendWait('/language');
    const opener = (r.btns || []).find((b) => /Languages|زبانیں/.test(b)) || 'Languages';
    await api.openList(opener); const p = await api.pickRowAndWait(row, 60000); return p;
  };
  try { const u0 = dbJson(api, 'user-get'); if (u0.preferred_language !== 'en' || u0.language_locked) { await pickLanguage('English'); } } catch (_) {}
  await guard(['COA16', 'COA25', 'COA30', 'COA31'], async () => {
    const sess = dbJson(api, 'session-get', ['--status', 'completed']);
    const rows = (r1 && r1.rows) || [];
    const rep = rows.find((r) => r.doc || r.img);
    const text = rep ? await reportTextOf({ kind: rep.img ? 'image' : 'document', mediaId: mediaIdOf(rep) }, sess.id) : { ok: false, err: 'no report row in run 1' };
    const debrief = String((sess.analysis || {}).voice_debrief_script || '');
    const nums = text.ok ? digits(text.text) : [];
    set('COA16', ...(text.ok
      ? V(bandWords.test(text.text) && nums.length === 0 && !/\d+\s*%|out of/i.test(debrief),
          { reportKind: rep.doc ? 'document' : 'image', textVia: text.via || 'pdf', bandWordFound: (text.text.match(bandWords) || [])[0] || null, numericScoreMentions: nums.slice(0, 8),
            debriefHasScore: /\d+\s*%|out of/i.test(debrief), debriefHead: short(debrief, 160), pages: text.pages })
      : B('the report text could not be read: ' + text.err)));
    const q = (sess.questions || [])[0];
    set('COA25', ...(q ? V(latinOnly(q.question) && String(q.language || 'en').startsWith('en'), { question: short(q.question, 200), language: q.language, transcriptLanguage: sess.transcript_language })
                       : B('run 1 stored no reflective question on the session', { sessionId: sess.id, state: sess.conversation_state })));
    const idx = (rx, from = 0) => rows.findIndex((r, i) => i >= from && rx.test(r.txt || ''));
    const iReport = rows.findIndex((r) => r.doc || r.img);
    const iDebrief = rows.findIndex((r, i) => i > iReport && r.audio);
    const iSurvey = idx(RX.survey, Math.max(iReport, 0)); const nSurvey = rows.filter((r) => RX.survey.test(r.txt || '')).length;
    const iComplete = idx(RX.complete, Math.max(iReport, 0));
    const iQuiz = idx(RX.quizOffer, Math.max(iReport, 0));
    set('COA30', ...(iSurvey >= 0 ? V(iDebrief >= 0 && iSurvey > iDebrief && (iComplete < 0 || iSurvey < iComplete) && nSurvey === 1,
        { reportIdx: iReport, debriefAudioIdx: iDebrief, surveyIdx: iSurvey, completeIdx: iComplete, surveyCount: nSurvey, survey: short(rows[iSurvey].txt, 120), btns: rows[iSurvey].btns })
      : B('no "was this useful?" survey arrived in run 1', { rowsAfterReport: rows.slice(iReport).map((r) => short(r.txt, 60)) })));
    const comp = iComplete >= 0 ? rows[iComplete] : null;
    const separateComplete = rows.filter((r) => RX.complete.test(r.txt || '') && !RX.commit.test(r.txt || '')).length;
    set('COA31', ...(comp ? V(RX.commit.test(comp.txt) && separateComplete === 0 && (iQuiz < 0 || iComplete < iQuiz) && latinOnly(comp.txt),
        { message: short(comp.txt, 240), btns: comp.btns, separateCompleteMessages: separateComplete, quizOfferIdx: iQuiz, completeIdx: iComplete })
      : B('no session-complete message arrived in run 1')));
  });

  // COA17 — the known issue: two doors, two minimum lengths (documented, asserted as "they differ")
  await guard('COA17', async () => {
    await api.sendWait('/menu'); await api.openList('See what I do'); const row = await api.pickRowAndWait('Classroom Coaching');
    await api.resetFlow();
    const kw = await api.sendWait('Can you give me feedback on my teaching?', 60000);
    const menuMin = (row.txt || '').match(/\d+ to \d+ minutes|at least \d+ minutes/i); const kwMin = (kw.txt || '').match(/up to \d+ minutes|at least \d+ minutes|\d+ to \d+ minutes/i);
    set('COA17', ...V(!!menuMin && (!kwMin || kwMin[0] !== menuMin[0]),
      { menuDoor: menuMin && menuMin[0], keywordDoor: kwMin ? kwMin[0] : '(no length stated)', keywordReply: short(kw.txt, 160), note: '@known-issue — the spec documents that the two doors differ; PASS = still differ, FAIL = they now agree (retire the known issue)' }));
    await api.resetFlow();
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // B — run 2 (English): the menu wait, a brief typed plan, a report without the reflection, a question mid-run
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  let r2 = null;
  await guard(['COA35', 'COA18', 'COA49'], async () => {
    await cleanSlate();
    r2 = await pipeline({ label: 'run2', viaMenu: true, photo: 'no', lp: 'brief', reflect: 'report', midQuestion: MID_QUESTION });
    const s = r2.session || {};
    const step2AfterPlan = r2.events.some((e) => e.k === 'step2');
    set('COA35', ...(r2.lpPrompt
      ? V(step2AfterPlan && !r2.events.some((e) => e.k === 'lpReceived') && !r2.events.some((e) => e.k === 'lpRejected') && s.has_lesson_plan === true && s.lesson_plan_link_method === 'pasted',
          { planSent: r2.lpReply, stepsSeen: r2.steps, lpReceivedAck: r2.events.some((e) => e.k === 'lpReceived'), rejected: r2.events.some((e) => e.k === 'lpRejected'),
            has_lesson_plan: s.has_lesson_plan, link_method: s.lesson_plan_link_method, extraction: s.lesson_plan_extraction_status, lpTextLen: s.lesson_plan_text_len })
      : B(r2.stalled || 'the pipeline never asked for a lesson plan', { steps: r2.steps, card: r2.card })));
    const txt = r2.reportText && r2.reportText.ok ? r2.reportText.text : '';
    set('COA18', ...(r2.report
      ? (r2.reportText && r2.reportText.ok
          ? V(/based on classroom audio analysis only|reflective conversation was skipped/i.test(txt) && !/[0-3]\/3 reflective|of 3 reflective|all three reflection|three reflect/i.test(txt),
              { reflectTap: r2.reflectiveAck, noteFound: (txt.match(/Note: [^\n]{0,160}/) || [])[0] || null, claimsThree: /[0-3]\/3 reflective|of 3 reflective|three reflect/i.test(txt), reportKind: r2.report.kind, reflectMentions: (txt.match(/[^.]{0,80}reflect[^.]{0,80}/gi) || []).slice(0, 3), textVia: r2.reportText.via, note: 'the hero (FICO) report carries no partial-report note at all when the reflection is skipped — the transformer builds one (buildPartialNote) that the hero template does not show' })
          : B('report arrived but its text could not be read: ' + (r2.reportText && r2.reportText.err), { report: r2.report }))
      : B(r2.stalled || 'no report arrived after Get Report Now', { steps: r2.steps, reflective: r2.reflective })));
    set('COA49', ...(r2.confirmed
      ? V(!!r2.midReply && !RX.awaitingAudio.test(r2.midReply), { question: MID_QUESTION, reply: r2.midReply, waitWasSet: 'menu row opened first (AWAITING_CLASSROOM_AUDIO)', note: 'spec places this after the report; the contract — the recording ended the wait — is checked right after "Yes, Analyze"' })
      : B('the recording was never confirmed', { card: r2.card })));
  });

  // COA20 / COA21 / COA22 — after run 2 completed
  await guard(['COA20', 'COA21', 'COA22'], async () => {
    if (!r2 || !r2.report) { set('COA20', ...B('needs a completed report from run 2')); set('COA21', ...B('needs run 2')); }
    else {
      await fresh();
      // The hash check lives in the transcription job (bd-7beiz), so the detection card and "Yes, Analyze" still
      // come first; the short-circuit answers the confirmation — no transcription, no Step 2, the old report back.
      const dup = await api.upload(FX.classroom, 'Document', 120000);
      let dcard = dup; const td = t();
      while (!btnOf(dcard, RX.yesAnalyze) && t() - td < 30000) { const b = (await fresh()).find((r) => btnOf(r, RX.yesAnalyze)); if (b) { dcard = b; break; } await sleep(1000); }
      let all = [dup, dcard];
      if (btnOf(dcard, RX.yesAnalyze)) { await fresh(); const y = await api.tapAndWait(btnOf(dcard, RX.yesAnalyze), 90000); all.push(y); const seen = await collect((r) => (r.doc || r.img), 60000); all = all.concat(seen.seen); const tail = await collect(() => false, 8000); all = all.concat(tail.seen); }
      const said = all.find((r) => RX.duplicate.test(r.txt || ''));
      const resent = all.find((r) => r.doc || r.img);
      const step2 = all.some((r) => /Step 2\/5|مرحلہ\s*\u2066?2/.test(r.txt || ''));
      const sess = dbJson(api, 'session-get');
      set('COA20', ...V(!!said && !!resent && !step2 && !!sess.duplicate_of_session_id && !!resent.img,
        { saidHeardBefore: !!said, reply: short(said && said.txt, 160), resentKind: resent ? rowKind(resent) : null, resentAsImage: !!(resent && resent.img), step2Started: step2,
          duplicate_of: sess.duplicate_of_session_id, status: sess.status, step1MessageStillSent: all.some((r) => /Step 1\/5/.test(r.txt || '')),
          note: 'the resend must be an IMAGE (spec, bd-5tgzv); a PDF resend is the FEAT-098 shape. The check runs after confirmation on this build, so the detection card and Step 1/5 still go out first.' }));
      await fresh();
      const alt = await api.upload(FX.alt, 'Document', 120000);
      let altCard = alt; const t0 = t();
      while (!btnOf(altCard, RX.yesAnalyze) && t() - t0 < 30000) { const b = (await fresh()).find((r) => btnOf(r, RX.yesAnalyze)); if (b) { altCard = b; break; } await sleep(1000); }
      const altDup = RX.duplicate.test(alt.txt || '') || RX.duplicate.test(altCard.txt || '');
      set('COA21', ...V(!!btnOf(altCard, RX.yesAnalyze) && !altDup, { reply: short(altCard.txt, 160), btns: altCard.btns, saidHeardBefore: altDup, fixture: 'hameeda_15min_alt.m4a (15.5 min, different bytes)' }));
      let cancelledId = null;
      if (btnOf(altCard, RX.yesAnalyze)) { await tapRow(altCard, RX.no, 60000); cancelledId = (dbJson(api, 'session-get') || {}).id; }
      if (!cancelledId) set('COA22', ...B('no cancelled session to tap against'));
      else {
        await fresh();
        const taps = [['photo_yes_' + cancelledId, 'Yes'], ['coaching_continue_' + cancelledId, 'Continue Now'], ['coaching_finish_' + cancelledId, 'Get Report Now']];
        const replies = [];
        for (const [id, title] of taps) { await api.tapId('button', id, title); const c = await collect((r) => !!(r.txt || '').trim(), 20000); replies.push({ id: id.split('_').slice(0, 2).join('_'), reply: short(c.hit && c.hit.txt, 140), refused: !!(c.hit && RX.cancelledTap.test(c.hit.txt)) }); }
        const after = dbJson(api, 'session-get', ['--session-id', cancelledId]);
        set('COA22', ...V(replies.every((x) => x.refused) && after.status === 'cancelled', { taps: replies, statusAfter: after.status, photos: after.conversation_state && after.conversation_state.classroom_photos }));
      }
    }
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // C — run 3 (Urdu): five steps in Urdu with digits; gender-neutral copy; the Urdu duplicate answer
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  let r3ref = null;
  await guard(['COA24', 'COA55'], async () => {
    await cleanSlate();
    const sw = await pickLanguage('اردو');
    const u = dbJson(api, 'user-get');
    if (u.preferred_language !== 'ur') throw new Error('language switch to Urdu did not take: ' + short(sw.txt, 100) + ' db=' + u.preferred_language);
    const r3 = await pipeline({ label: 'run3-ur', photo: 'no', lp: 'paste', reflect: 'answer' });
    r3ref = r3;
    const stepRows = r3.rows.filter((r) => RX.stepAny.test(r.txt || '')).map((r) => r.txt);
    const urduSteps = stepRows.filter((x) => UR.test(x)); const englishSteps = stepRows.filter((x) => /Step \d\/5/.test(x));
    const counters = stepRows.map((x) => (x.match(/\u2066?\d\u2069?\/5|[۰-۹] از [۰-۹]|\d\s*\/\s*5/) || [''])[0]);
    const urduGlyphs = stepRows.some((x) => /[۰-۹]/.test(x));
    const lri = stepRows.filter((x) => /\u2066\d\/5\u2069/.test(x)).length;
    set('COA24', ...(stepRows.length
      ? V(stepRows.length >= 5 && englishSteps.length === 0 && urduSteps.length === stepRows.length && !urduGlyphs,
          { stepsSeen: r3.steps, stepMessages: stepRows.map((x) => short(x, 70)), englishStepMessages: englishSteps.length, urduNumeralGlyphs: urduGlyphs, countersWrappedLriPdi: lri, counters })
      : B(r3.stalled || 'no step messages arrived', { card: r3.card })));
    // gender-neutral copy: photo offer, commitment, LP prompt, duplicate answer
    let dupTxt = '';
    if (r3.report) {
      await fresh(); const d = await api.upload(FX.classroom, 'Document', 120000);
      let dc = d; const td = t(); while (!btnOf(dc, RX.yesAnalyze) && t() - td < 30000) { const b = (await fresh()).find((r) => btnOf(r, RX.yesAnalyze)); if (b) { dc = b; break; } await sleep(1000); }
      if (btnOf(dc, RX.yesAnalyze)) { await fresh(); await api.tapAndWait(btnOf(dc, RX.yesAnalyze), 90000); }
      const c = await collect((r) => RX.duplicate.test(r.txt || ''), 45000); dupTxt = (c.hit && c.hit.txt) || '';
    }
    const gendered = /چاہیں گے|چاہتے ہوں|کریں گے|چاہتی ہوں|کرتے ہیں|کرتی ہیں/;
    const photoTxt = (r3.photoPrompt && r3.photoPrompt.txt) || ''; const commitTxt = (r3.commit && r3.commit.txt) || ''; const lpTxt = (r3.lpPrompt && r3.lpPrompt.txt) || '';
    const checks = { photoOffer: { txt: short(photoTxt, 120), neutral: /شامل کریں؟/.test(photoTxt) && !gendered.test(photoTxt) },
      commitment: { txt: short(commitTxt, 160), neutral: /عہد کریں؟/.test(commitTxt) && !gendered.test(commitTxt) },
      lpPrompt: { txt: short(lpTxt, 120), neutral: !!lpTxt && !gendered.test(lpTxt) },
      duplicate: { txt: short(dupTxt, 160), neutral: !!dupTxt && !gendered.test(dupTxt) } };
    const flowTexts = r3.rows.map((r) => r.txt || '').filter((x) => UR.test(x));
    const anyGendered = flowTexts.filter((x) => gendered.test(x)).map((x) => short(x, 100));
    set('COA55', ...(r3.confirmed
      ? V(checks.photoOffer.neutral && checks.commitment.neutral && checks.lpPrompt.neutral && checks.duplicate.neutral && anyGendered.length === 0,
          { ...checks, genderedMessagesInFlow: anyGendered.slice(0, 5), reportDelivered: !!r3.report })
      : B(r3.stalled || 'the Urdu run never started', { card: r3.card })));
  });
  // back to English whatever run 3 did (run 20260930-0832 stayed Urdu: the picker row is 'انگریزی' on an Urdu account)
  await guard([], async () => {
    try { const r = await api.sendWait('/language'); const opener = (r.btns || []).find((b) => /Languages|زبانیں/.test(b)) || 'Languages'; const list = await api.openList(opener); const row = ((list && list.rows) || []).find((x) => /English|انگریزی/.test(x)) || 'English'; await api.pickRowAndWait(row, 60000); } catch (_) {}
    const back = dbJson(api, 'user-get'); if (back.preferred_language !== 'en' || back.language_locked) await api.setUser({ preferred_language: 'en', language_locked: false });
    await fresh();
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // D — run 4 (English, worker on COACHING_PHOTO_VISION=v2 + LP_FIDELITY_PHOTO=on): a real LP PDF, a board
  //     photo + a screenshot, and the fidelity grader's first answer scripted empty
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  await guard(['COA19', 'COA27', 'COA28'], async () => {
    await cleanSlate();
    // LP_FIDELITY_ENABLED gates BOTH the recent-plan list (bot, lp-step _recentLpsFor) and the grading (worker); the lane
    // env does not set it (production sets it on Railway), so both processes get it for the two fidelity runs
    const rs = await SC.restart('worker', { COACHING_PHOTO_VISION: 'v2', LP_FIDELITY_PHOTO: 'on', LP_FIDELITY_ENABLED: 'true' });
    if (!rs.ok) throw new Error('worker restart failed: ' + rs.err);
    const rb4 = await SC.restart('bot', { LP_FIDELITY_ENABLED: 'true' }); if (!rb4.ok) throw new Error('bot restart failed: ' + rb4.err);
    let lpSeed = null; try { lpSeed = dbJson(api, 'seed-lp-download'); } catch (_) {}
    const r4 = await pipeline({ label: 'run4-v2', photo: 'screenshot', firstPhoto: FX.board, lp: 'recent', reflect: 'answer', budgetMs: 15 * 60 * 1000,
      faults: [{ kind: 'llm', match: '/FIDELITY GRADER/', times: 1, content: '' }] });
    const a = (r4.session && r4.session.analysis) || {};
    const reads = a.photo_reads || []; const fid = a.lp_fidelity || {};
    const excluded = (Array.isArray(reads) ? reads : Object.values(reads)).find((p) => p && p.status === 'excluded');
    const boardRead = (Array.isArray(reads) ? reads : Object.values(reads)).find((p) => p && p.status === 'read');
    const captions = r4.reportText && r4.reportText.ok ? (r4.reportText.text.match(/From your photo[^\n]{0,80}/g) || []) : null;
    set('COA27', ...(r4.report
      ? V(!!excluded && /not_a_classroom_photo|instruction_text/.test(String(excluded && excluded.kind || excluded && excluded.reason)) && !!boardRead && (captions === null || captions.length <= 1),
          { photo_vision: a.photo_vision, photo_reads: reads, photo_mode: a.photo_mode, photo_count_analysed: a.photo_count_analysed, fromYourPhotoCaptions: captions, reportKind: r4.report.kind })
      : B(r4.stalled || 'no report arrived on run 4', { steps: r4.steps, photo: r4.photoReply, lp: r4.lpReply })));
    const cites = JSON.stringify(fid).match(/\[photo \d+\]/g) || [];
    const pe = a.photo_evidence; const moves = (fid.moves || fid.per_move || []);
    const notDoneCitingPhoto = (Array.isArray(moves) ? moves : []).filter((m) => /not_done/.test(String(m.verdict || m.status)) && /\[photo/.test(JSON.stringify(m)));
    set('COA19', ...(r4.report && r4.session.has_lesson_plan
      ? (cites.length ? V(notDoneCitingPhoto.length === 0, { photoCitations: cites, photo_evidence: short(JSON.stringify(pe), 200), photo_citations: fid.photo_citations, fidelity_pct: fid.fidelity_pct, notDoneCitingPhoto: notDoneCitingPhoto.length })
                      : B(Object.keys(fid).length ? 'content-driven: no lesson-plan move was credited from a photo in this lesson (the contract cannot be asserted without one)' : 'the fidelity grader never ran (worker: not_assessed_reason ' + notAssessedReason(r4.sessionId) + '), so no move could be credited from the photo', { photo_evidence: short(JSON.stringify(pe), 200), fidelity_status: fid.status, fidelity_pct: fid.fidelity_pct, photo_reads: reads, lpLink: r4.lpReply }))
      : B(r4.stalled || (r4.report ? 'the lesson plan was not linked (has_lesson_plan false)' : 'no report arrived'), { lp: r4.lpReply, lpVerdict: r4.lpVerdict, extraction: r4.session && r4.session.lesson_plan_extraction_status })));
    const left = SC.faultsLeft();
    set('COA28', ...(r4.report && r4.session.has_lesson_plan
      ? V(fid.empty_retry === true || !!fid.empty_retry, { empty_retry: fid.empty_retry, framework: a.framework, fidelityKeys: Object.keys(fid), reasoning_effort: fid.reasoning_effort || (fid.runs && fid.runs.map((x) => x.reasoning_effort)), runs: Array.isArray(fid.runs) ? fid.runs.length : fid.runs, model: fid.model, status: fid.status, faultConsumed: left.length === 0,
          note: 'the scripted fault answered the first grader call with an empty completion; the blob must record empty_retry and the retry must not carry effort "low"' })
      : B(r4.stalled || 'no graded lesson on run 4', { faultsLeft: left, fidelity: short(JSON.stringify(fid), 200), analysisKeys: Object.keys(a) })));
    if (r4.report && r4.session.has_lesson_plan && !Object.keys(fid).length) { const why = notAssessedReason(r4.sessionId); set('COA28', ...B('Section B was not assessed (worker: not_assessed_reason ' + why + '): the analysis read the session before the lesson-plan extraction had finished — on this lane the cassette makes transcription instant, so the analysis job runs seconds after the PDF lands. The grader never ran, so the empty-answer retry cannot be observed here.', { not_assessed_reason: why, extraction: r4.session.lesson_plan_extraction_status, faultsLeft: left })); }
    await SC.restart('worker', {});
    try { api.db('seed-lp-download', ['--restore']); } catch (_) {}
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // E — run 5 (English): the ASR answer scripted WITHOUT timestamps, a real LP PDF → "not scored", never 0%
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  await guard('COA29', async () => {
    await cleanSlate();
    // the recorded Soniox answer for this fixture, with every token's timing removed
    const cas = fs.readdirSync(path.resolve(__dirname, '..', 'fixtures', 'cassettes')).filter((f) => f.startsWith('asr-')).map((f) => path.resolve(__dirname, '..', 'fixtures', 'cassettes', f));
    const pick = cas.map((f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } }).find((c) => c && c.value && Array.isArray(c.value.tokens) && c.value.tokens.length > 200);
    if (!pick) throw new Error('no recorded ASR cassette with tokens to derive a stamp-less answer from');
    const value = { text: pick.value.text, language: pick.value.language, tokens: [] };
    try { dbJson(api, 'seed-lp-download'); } catch (_) {}
    { const rw = await SC.restart('worker', { LP_FIDELITY_ENABLED: 'true' }); if (!rw.ok) throw new Error('worker restart failed: ' + rw.err); const rb = await SC.restart('bot', { LP_FIDELITY_ENABLED: 'true' }); if (!rb.ok) throw new Error('bot restart failed: ' + rb.err); }
    const r5 = await pipeline({ label: 'run5-nostamps', photo: 'no', lp: 'recent', reflect: 'answer', budgetMs: 15 * 60 * 1000,
      faults: [{ kind: 'asr', match: '/./', times: 1, value }] });
    const a = (r5.session && r5.session.analysis) || {}; const fid = a.lp_fidelity || {};
    const txt = r5.reportText && r5.reportText.ok ? r5.reportText.text : '';
    const pctInLp = (txt.match(/[Ll]esson [Pp]lan[\s\S]{0,400}?(\d+\s*%)/) || [])[1] || null;
    set('COA29', ...(r5.report && r5.session.has_lesson_plan
      ? V(fid.status === 'ok' && (fid.fidelity_pct === null || fid.fidelity_pct === undefined) && fid.recording_unusable === true && String((fid.moderators || {}).note || fid.unusable_guard || '').length > 0 && !fid.model && !pctInLp,
          { status: fid.status, fidelity_pct: fid.fidelity_pct, recording_unusable: fid.recording_unusable, moderators: fid.moderators, unusable_guard: fid.unusable_guard, model: fid.model, runs: fid.runs, lpSectionPercent: pctInLp, framework: a.framework, analysisKeys: Object.keys(a), transcriptHasStamps: /\[\d\d:\d\d\]/.test(String(r5.session.transcript_head || '')), transcriptHead: short(r5.session.transcript_head, 120) })
      : B(r5.stalled || (r5.report ? 'lesson plan not linked on run 5' : 'no report on run 5 (the stamp-less ASR answer may have broken transcription)'), { steps: r5.steps, lp: r5.lpReply, faultsLeft: SC.faultsLeft() })));
    try { api.db('seed-lp-download', ['--restore']); } catch (_) {}
    await SC.restart('worker', {}); await SC.restart('bot', {});
    if (r5.report && r5.session.has_lesson_plan && !Object.keys(fid).length) { const why = notAssessedReason(r5.sessionId); set('COA29', ...B('Section B was not assessed (worker: not_assessed_reason ' + why + '): the analysis read the session before the lesson-plan extraction had finished, so the no-timestamps guard never ran. The transcript itself DID arrive without stamps (the scripted ASR answer worked).', { not_assessed_reason: why, transcriptHasStamps: /\[\d\d:\d\d\]/.test(String(r5.session.transcript_head || '')), extraction: r5.session.lesson_plan_extraction_status })); }
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // F — run 6 (English, no saved name, voice note down): the photo gate closed by the sweep with a greeting
  //     that never says "null"; the reflective question arrives as TEXT; a full typed plan is attached
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  await guard('COA26', async () => {
    await cleanSlate();
    await api.setUser({ name: null });
    // photo:'ignore' — the walker leaves the photo prompt unanswered and, 70 s later, runs the stale-session
    // sweep itself (COACHING_PHOTO_GATE_MINUTES=1), which closes the gate with the greeting under test
    const r6 = await pipeline({ label: 'run6a-nameless', photo: 'ignore', lp: 'no', reflect: 'answer', budgetMs: 12 * 60 * 1000, stallMs: 240000 });
    const greetings = r6.rows.map((r) => r.txt || '').filter((x) => /putting together your coaching report/i.test(x));
    set('COA26', ...(r6.greeting
      ? V(greetings.every((g) => !/null|Hi !|Hi\s*!/.test(g)), { greeting: r6.greeting, allGreetings: greetings.map((g) => short(g, 100)), savedName: null, gateSweep: r6.gateSwept && (r6.gateSwept.result || r6.gateSwept), note: greetings.length > 1 ? 'the recovery sweep advanced the same session more than once (each sub-sweep queued the analysis) — reported as evidence, not judged here' : undefined })
      : B(r6.stalled || 'no report-preparation greeting arrived (the photo gate was not closed by the sweep)', { steps: r6.steps, photoPrompt: !!r6.photoPrompt, gateSweep: r6.gateSwept })));
    await api.setUser({ name: 'E2E Driver' });
  });
  await guard('COA23', async () => {
    await cleanSlate();
    const t6b = Date.now();
    const r6b = await pipeline({ label: 'run6b-tts-down', photo: 'no', lp: 'no', reflect: 'answer', budgetMs: 12 * 60 * 1000,
      faults: [{ kind: 'tts', match: '/./', times: 6, throw: 'e2e: voice note delivery down' }] });
    const fired = faultFired(t6b);
    set('COA23', ...(r6b.reflective
      ? V(r6b.reflective.kind === 'text' && !!r6b.reflectiveAck, { question: r6b.reflective, acknowledgement: r6b.reflectiveAck, delivery: ((r6b.session || {}).questions || []).map((q) => q.delivery || q.format), faultFired: fired, reportDelivered: !!r6b.report })
      : (fired && r6b.steps.includes('3')
          ? V(false, { reason: 'the voice step failed (scripted TTS fault answered "Generating voice for reflective question") and NO text question followed — the session sat at Step 3/5 until the walker gave up', steps: r6b.steps, events: r6b.events.map((e) => e.k), faultFired: true, note: 'the text fallback (bd-dsx0c) covers a voice send that returns false; a throw from speech generation leaves the teacher with no question' })
          : B(r6b.stalled || 'the reflective step was not reached', { steps: r6b.steps, events: r6b.events.map((e) => e.k), faultFired: fired }))));
  });
  await guard('COA32', async () => {
    const s3 = (r3ref && r3ref.session) || {};
    set('COA32', ...(r3ref && r3ref.lpPrompt
      ? V(r3ref.events.some((e) => e.k === 'step2') && !r3ref.events.some((e) => e.k === 'lpReceived') && s3.has_lesson_plan === true && s3.lesson_plan_link_method === 'pasted',
          { run: 'run3 (Urdu account)', planSent: r3ref.lpReply, has_lesson_plan: s3.has_lesson_plan, link_method: s3.lesson_plan_link_method, lpReceivedAck: r3ref.events.some((e) => e.k === 'lpReceived'), reAsked: r3ref.rows.filter((r) => RX.lpSend.test(r.txt || '')).length })
      : B('run 3 never reached the lesson-plan prompt', { steps: r3ref && r3ref.steps })));
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // G — run 7 (English): pasted text that is NOT a plan → the same rejection a file gets, recording still analysed
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  await guard('COA34', async () => {
    await cleanSlate();
    const r7 = await pipeline({ label: 'run7-nonplan', photo: 'no', lp: 'nonplan', reflect: 'answer' });
    const s7 = r7.session || {};
    set('COA34', ...(r7.lpPrompt
      ? V(r7.events.some((e) => e.k === 'lpRejected') && r7.steps.includes('2') && s7.has_lesson_plan !== true,
          { pasted: short(NONPLAN_TEXT, 80), rejection: r7.lpVerdict, stepsSeen: r7.steps, has_lesson_plan: s7.has_lesson_plan, extraction: s7.lesson_plan_extraction_status, reportDelivered: !!r7.report })
      : B(r7.stalled || 'the pipeline never asked for a lesson plan', { steps: r7.steps })));
  });

  // the three OBSOLETE lesson-plan-step scenarios (bd-cq1go): the pre-filter they describe is gone by decision
  for (const [id, why] of [['COA33', 'a short reply at the LP step'], ['COA36', 'saying "I have no plan"'], ['COA37', 'talking about a plan']])
    set(id, 'SKIP', { why: '@obsolete (bd-cq1go, 2026-09-22): whatever the teacher sends at the lesson-plan step is considered; the length/marker/layout pre-filter this scenario asserts no longer exists. Its successor is COA34/COA35.', was: why });

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // H — the coaching ask (teacher_nudges) family: rows seeded on the sandbox DB, the sweeper run in-process
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const ASK_ENV = { TEACHER_NUDGES_ENABLED: 'true', LP_COACHING_ASK_ENABLED: 'true', LP_COACHING_ASK_WEEKLY_CAP: '99', LP_COACHING_HOWTO_VIDEO_EN: HOWTO_URL, NUDGE_QUIET_HOURS_PKT: 'off' };
  const NOW10 = () => new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const sweepAsk = (extra = {}) => SC.sweep('teacher-nudges', { ...ASK_ENV, E2E_SWEEP_NOW: NOW10(), ...extra });
  const nudgeRows = (kind) => dbJson(api, 'nudge-rows', kind ? ['--kind', kind] : []);
  const uid = (dbJson(api, 'user-get') || {}).id;
  const seedAsk = (o = {}) => { try { api.db('age-sessions'); } catch (_) {} return dbJson(api, 'seed-nudge', [].concat(o.deliveredAt ? ['--delivered-at', o.deliveredAt] : [], o.nudgeDate ? ['--nudge-date', o.nudgeDate] : [], o.firstTime ? ['--first-time'] : [])); };
  const askOnScreen = async () => { api.db('purge-nudges'); const s = seedAsk(); const sw = await sweepAsk(); const c = await collect((r) => RX.lpAsk.test(r.txt || ''), 25000); return { seed: s, sweep: sw, ask: c.hit, seen: c.seen }; };
  let askReady = false;
  await guard(['COA38', 'COA43'], async () => {
    await cleanSlate();
    const rb = await SC.restart('bot', ASK_ENV); if (!rb.ok) throw new Error('bot restart failed: ' + rb.err);
    askReady = true;
    api.db('age-sessions'); api.db('purge-nudges'); api.db('purge-first-use', ['--feature', 'lp_coaching_howto']);
    await fresh();
    const seed = seedAsk();
    const sw = await sweepAsk();
    const c = await collect((r) => RX.lpAsk.test(r.txt || ''), 25000);
    const ask = c.hit; const rows = nudgeRows('coaching_after_lp'); const row = Array.isArray(rows) ? rows[0] : null;
    set('COA38', ...(ask
      ? V(/^You planned a lesson with me today/.test(ask.txt || '') && btnOf(ask, /^Record my lesson$/) && btnOf(ask, /^Not today$/) && c.seen.filter((r) => RX.lpAsk.test(r.txt || '')).length === 1,
          { ask: short(ask.txt, 160), btns: ask.btns, seed, sweep: sw.result || sw, row: row && { status: row.status, sent_at: row.sent_at, context: row.context } })
      : B('no coaching ask arrived after the sweep', { seed, sweep: sw, rows: Array.isArray(rows) ? rows.slice(0, 2) : rows, seen: c.seen.map((r) => short(r.txt, 60)) })));
    const raw = ask && ask.raw; const hdr = raw && raw.interactive && raw.interactive.header;
    const videoMsgs = c.seen.filter((r) => r.raw && r.raw.type === 'video').length;
    set('COA43', ...(ask
      ? V(!!hdr && hdr.type === 'video' && /How to record a lesson with the WhatsApp mic/.test((raw.interactive.footer && raw.interactive.footer.text) || '') && videoMsgs === 0 && !!(row && row.context && row.context.howto === true) && Array.isArray(row.context.message_ids) && row.context.message_ids.length > 0,
          { headerType: hdr && hdr.type, headerLink: hdr && hdr.video && hdr.video.link, footer: raw.interactive.footer && raw.interactive.footer.text, separateVideoMessages: videoMsgs, rowContext: row && row.context })
      : B('no ask to inspect')));
  });
  await guard('COA41', async () => {
    if (!askReady) throw new Error('ask block not ready');
    const c = await collect(() => false, 1); void c;
    const rows = nudgeRows('coaching_after_lp'); const row = Array.isArray(rows) ? rows[0] : null;
    if (!row || row.status !== 'sent') throw new Error('no sent ask on screen to decline');
    await fresh();
    const rep = await api.tapId('button', 'lpask_no_' + row.id, 'Not today');
    const c2 = await collect((r) => !!(r.txt || '').trim(), 20000);
    const after = (nudgeRows('coaching_after_lp') || [])[0] || {};
    const more = await collect((r) => /coach/i.test(r.txt || ''), 8000);
    set('COA41', ...V(!!(c2.hit && RX.lpAskDeclined.test(c2.hit.txt)) && after.choice === 'no' && !more.hit,
      { reply: short(c2.hit && c2.hit.txt, 160), choice: after.choice, answered_at: after.answered_at, furtherCoachingMessages: !!more.hit, tap: rep }));
  });
  await guard('COA40', async () => {
    if (!askReady) throw new Error('ask block not ready');
    const second = seedAsk();
    const sw = await sweepAsk();
    const c = await collect((r) => RX.lpAsk.test(r.txt || ''), 12000);
    set('COA40', ...V(second.created === false && !c.hit, { secondSeed: second, sweep: sw.result || sw, secondAskArrived: !!c.hit, note: 'the teacher_nudges UNIQUE (user_id, nudge_date, kind) refuses the second booking — that refusal is the mechanism' }));
  });
  await guard(['COA39', 'COA42'], async () => {
    if (!askReady) throw new Error('ask block not ready');
    api.db('purge-nudges'); await fresh();
    const y = new Date(Date.now() - 24 * 3600 * 1000); y.setUTCHours(11, 30, 0, 0);   // 16:30 PKT yesterday
    const seed = seedAsk({ deliveredAt: y.toISOString() });
    const sw = await sweepAsk();
    const c = await collect((r) => RX.lpAsk.test(r.txt || ''), 25000);
    const ask = c.hit;
    set('COA39', ...(ask
      // "yesterday" when the send day is the next PKT day; the date form ("on 29 Sep") when the run crossed PKT midnight and
      // the planning day is two days back — both are the NextDay body, and neither may say "today" (run 20260930-1915)
      ? V(/^You planned this lesson with me (yesterday|on \d{1,2} [A-Z][a-z]{2})/.test(ask.txt || '') && !/\btoday\b/i.test(ask.txt || '') && btnOf(ask, /^Record my lesson$/) && btnOf(ask, /^Not today$/),
          { ask: short(ask.txt, 160), btns: ask.btns, deliveredAt: y.toISOString(), seed, sendDayPkt: seed.nudge_date })
      : B('no ask arrived for the yesterday-16:30 booking', { seed, sweep: sw })));
    if (!ask) { set('COA42', ...B('no ask on screen')); return; }
    const row = (nudgeRows('coaching_after_lp') || [])[0];
    await fresh();
    await api.tapId('button', 'lpask_yes_' + row.id, 'Record my lesson');
    const rep = await collect((r) => RX.menuAsks.test(r.txt || ''), 20000);
    const u = dbJson(api, 'user-get');
    const fu = dbJson(api, 'first-use-rows');
    const howtoRow = Array.isArray(fu) ? fu.find((x) => x.feature === 'lp_coaching_howto') : null;
    set('COA42', ...V(!!rep.hit && RX.menuLength.test(rep.hit.txt || '') && stateOf(u).includes('AWAITING_CLASSROOM_AUDIO'),
      { reply: short(rep.hit && rep.hit.txt, 200), conversation_state: u.conversation_state, expires: u.conversation_state_expires_at, howtoShownCount: howtoRow && (howtoRow.intro_shown_count || howtoRow.feature_used_at), askRowChoice: ((nudgeRows('coaching_after_lp') || [])[0] || {}).choice }));
  });
  await guard('COA44', async () => {
    if (!askReady) throw new Error('ask block not ready');
    await fresh();
    const rep = await api.upload(FX.eleven, 'Audio', 120000);
    const more = await collect((r) => RX.tooShort.test(r.txt || '') || RX.detected.test(r.txt || ''), 15000);
    const all = [rep, ...more.seen]; const ts = all.find((r) => RX.tooShort.test(r.txt || ''));
    const analysed = all.some((r) => RX.detected.test(r.txt || '') || btnOf(r, RX.yesAnalyze) || /Step 1\/5/.test(r.txt || ''));
    const chatty = all.some((r) => !RX.tooShort.test(r.txt || '') && !RX.detected.test(r.txt || '') && (r.txt || '').length > 200);
    set('COA44', ...V(!!ts && /11 minutes|\u206611\u2069/.test(ts.txt) && !analysed && !chatty, { reply: short(ts && ts.txt, 200), analysedAsClassroom: analysed, answeredAsChat: chatty, others: all.filter((r) => r !== ts).map((r) => short(r.txt, 80)) }));
  });
  await guard('COA51', async () => {
    if (!askReady) throw new Error('ask block not ready');
    const u = dbJson(api, 'user-get');
    if (!stateOf(u).includes('AWAITING_CLASSROOM_AUDIO')) throw new Error('no coaching wait to expire: ' + short(JSON.stringify(u.conversation_state), 120));
    await api.setUser({ conversation_state_expires_at: new Date(Date.now() - 60000).toISOString() });
    await fresh();
    let sw = await SC.sweep('resume', { NUDGE_QUIET_HOURS_PKT: 'off' });
    for (let i = 0; i < 6 && sw && sw.result && sw.result.skippedLocked; i++) { await sleep(20000); await SC.redis(['DEL', 'lock:conversation-resume-sweep']); sw = await SC.sweep('resume', { NUDGE_QUIET_HOURS_PKT: 'off' }); }
    const c = await collect((r) => RX.resumeOffer.test(r.txt || ''), 20000);
    set('COA51', ...V(!!c.hit && /classroom observation/i.test(c.hit.txt || ''), { offer: short(c.hit && c.hit.txt, 200), btns: c.hit && c.hit.btns, sweep: sw.result || sw }));
    if (c.hit) { const no = btnOf(c.hit, /No|Not now|نہیں/i); if (no) await api.tapAndWait(no, 30000); }
    const u2 = dbJson(api, 'user-get'); if (u2.conversation_state) await api.setUser({ conversation_state: null, conversation_state_expires_at: null });
  });
  await guard(['COA47', 'COA54'], async () => {
    if (!askReady) throw new Error('ask block not ready');
    const key = 'lp_feedback_pending:' + uid;
    api.db('purge-nudges'); await fresh();
    await SC.redis(['SET', key, JSON.stringify({ lpFeedbackId: '__orphan__', lessonPlanId: 'qa-ext', promptedAt: Date.now() }), 'EX', '900']);
    const seed = seedAsk();
    const sw1 = await sweepAsk();
    const c1 = await collect((r) => RX.lpAsk.test(r.txt || ''), 10000);
    const row1 = (nudgeRows('coaching_after_lp') || [])[0] || {};
    // the open question closes: clear the window, sweep again
    await SC.redis(['DEL', key]);
    const sw2 = await sweepAsk({ E2E_SWEEP_NOW: new Date(Date.now() + 25 * 60 * 1000).toISOString() });   // the row was handed back until the window closed (+10 min)
    const c2 = await collect((r) => RX.lpAsk.test(r.txt || ''), 25000);
    const row2 = (nudgeRows('coaching_after_lp') || [])[0] || {};
    set('COA47', ...V(!c1.hit && (sw1.result && sw1.result.deferred >= 1) && row1.status === 'pending' && !!(row1.context && row1.context.deferred_for === 'lp_survey') && !!c2.hit && row2.status === 'sent',
      { seed, firstSweep: sw1.result || sw1, askDuringOpenQuestion: !!c1.hit, rowAfterFirstSweep: { status: row1.status, deferred_for: row1.context && row1.context.deferred_for, scheduled_at: row1.scheduled_at },
        secondSweep: sw2.result || sw2, askAfterWindowClosed: short(c2.hit && c2.hit.txt, 120), rowAfterSecond: { status: row2.status, context: row2.context },
        note: 'the survey window is the Redis key lp-feedback sets after "Not really" (open-question.js); the typed-answer half needs a real lp_feedback row and is not driven here' }));
    // kill switch: NUDGE_OPEN_QUESTION_DEFER=off → sent on the first sweep
    api.db('purge-nudges'); await fresh();
    await SC.redis(['SET', key, JSON.stringify({ lpFeedbackId: '__orphan__', lessonPlanId: 'qa-ext', promptedAt: Date.now() }), 'EX', '900']);
    const seedB = seedAsk();
    const sw3 = await sweepAsk({ NUDGE_OPEN_QUESTION_DEFER: 'off' });
    const c3 = await collect((r) => RX.lpAsk.test(r.txt || ''), 25000);
    const row3 = (nudgeRows('coaching_after_lp') || [])[0] || {};
    await SC.redis(['DEL', key]);
    set('COA54', ...V(!!c3.hit && (sw3.result && sw3.result.deferred === 0 && sw3.result.sent >= 1) && row3.status === 'sent' && !(row3.context && row3.context.deferred_for),
      { seed: seedB, sweep: sw3.result || sw3, ask: short(c3.hit && c3.hit.txt, 120), row: { status: row3.status, context: row3.context } }));
    if (c3.hit) { await api.tapId('button', 'lpask_no_' + row3.id, 'Not today'); await collect((r) => !!(r.txt || '').trim(), 15000); }
  });
  await guard('COA48', async () => {
    if (!askReady) throw new Error('ask block not ready');
    const lps = dbJson(api, 'lesson-plans'); const lp = Array.isArray(lps) && lps[0];
    if (!lp) throw new Error('the driver has no lesson_plans row to answer a survey on');
    api.db('purge-nudges'); await fresh();
    const seed = seedAsk(); const sw = await sweepAsk();
    const c = await collect((r) => RX.lpAsk.test(r.txt || ''), 25000);
    if (!c.hit) throw new Error('no ask on screen: ' + short(JSON.stringify(sw), 160));
    const row = (nudgeRows('coaching_after_lp') || [])[0];
    await fresh();
    await api.tapId('button', 'lpask_yes_' + row.id, 'Record my lesson');
    const a1 = await collect((r) => RX.menuAsks.test(r.txt || ''), 20000);
    await api.tapId('button', 'lp_feedback_yes_' + lp.id, '👍 Yes, useful');
    const a2 = await collect((r) => /glad it helped|Thanks for the feedback|thank|شکریہ|Did you get to use it|use it in class|استعمال/i.test(r.txt || ''), 30000);
    const rowAfter = (nudgeRows('coaching_after_lp') || [])[0] || {};
    set('COA48', ...V(!!a1.hit && !!a2.hit && rowAfter.choice === 'yes', { askReply: short(a1.hit && a1.hit.txt, 120), surveyReply: short(a2.hit && a2.hit.txt, 120), surveyBtns: a2.hit && a2.hit.btns, askChoice: rowAfter.choice, lessonPlanId: lp.id, seed, note: 'a positive survey tap is answered with the usage prompt ("Did you get to use it in class?"), which is the acknowledgement on this build' }));
    const u = dbJson(api, 'user-get'); if (u.conversation_state) await api.setUser({ conversation_state: null, conversation_state_expires_at: null });
  });
  await guard('COA46', async () => {
    if (!askReady) throw new Error('ask block not ready');
    api.db('purge-nudges'); await fresh();
    let dl = null; try { dl = dbJson(api, 'seed-lp-download'); } catch (_) {}
    const seed = seedAsk(); const sw = await sweepAsk();
    const c = await collect((r) => RX.lpAsk.test(r.txt || ''), 25000);
    if (!c.hit) throw new Error('no ask on screen');
    const row = (nudgeRows('coaching_after_lp') || [])[0];
    await api.tapId('button', 'lpask_yes_' + row.id, 'Record my lesson');
    await collect((r) => RX.menuAsks.test(r.txt || ''), 20000);
    const nowPkt = new Date(Date.now() + 5 * 3600 * 1000);
    const qEnv = { ...ASK_ENV, LP_QUIZ_OFFER_ENABLED: 'true', LP_QUIZ_OFFER_SEND_HOUR_PKT: String(nowPkt.getUTCHours()), LP_QUIZ_OFFER_SEND_MINUTE_PKT: '0' };
    const prep = await SC.sweep('quiz-offer-prepare', { ...qEnv, E2E_SWEEP_NOW: NOW10() });
    const sw2 = await SC.sweep('teacher-nudges', { ...qEnv, E2E_SWEEP_NOW: NOW10() });
    const offer = await collect((r) => RX.quizOffer.test(r.txt || ''), 12000);
    const qrows = nudgeRows('lp_quiz_offer'); const q = Array.isArray(qrows) ? qrows[0] : null;
    set('COA46', ...(q
      ? V(!offer.hit && q.status === 'skipped' && String((q.context || {}).skip_reason || '').includes('coaching_yes_today') && (Array.isArray(qrows) ? qrows.length === 1 : true),
          { quizOfferRow: { status: q.status, context: q.context, nudge_date: q.nudge_date }, offerArrived: !!offer.hit, prepare: prep.result || prep, sweep: sw2.result || sw2, lpDownloadSeed: dl })
      : B('no lp_quiz_offer row was built for the driver — the cohort build is time-gated (LP_QUIZ_OFFER_SEND_HOUR_PKT) and skips a day already built or a non-school day', { prepare: prep.result || prep, sweep: sw2.result || sw2, lpDownloadSeed: dl, offerArrived: !!offer.hit })));
    try { api.db('seed-lp-download', ['--restore']); } catch (_) {}
    const u = dbJson(api, 'user-get'); if (u.conversation_state) await api.setUser({ conversation_state: null, conversation_state_expires_at: null });
  });
  await guard('COA45', async () => {
    if (!askReady) throw new Error('ask block not ready');
    await cleanSlate();
    { const m = await api.sendWait('/menu'); await api.openList(btnOf(m, /See what I do|فہرست دیکھیں/) || 'See what I do'); await api.pickRowAndWait(UR.test(m.txt || '') ? 'کلاس روم کوچنگ' : 'Classroom Coaching'); await fresh(); }
    const rep = await api.upload(FX.classroom, 'Audio', 180000);
    let card = rep; const t0 = t();
    while (!btnOf(card, RX.yesAnalyze) && t() - t0 < 30000) { const b = (await fresh()).find((r) => btnOf(r, RX.yesAnalyze)); if (b) { card = b; break; } await sleep(1000); }
    const extra = await collect(() => false, 4000);
    const warned = [rep, card, ...extra.seen].some((r) => RX.sendAsDoc.test(r.txt || ''));
    set('COA45', ...V(!!btnOf(card, RX.yesAnalyze) && RX.detected.test(card.txt || rep.txt || '') && !warned, { reply: short(card.txt || rep.txt, 160), btns: card.btns, sendAsDocumentWarning: warned, sentAs: 'audio (voice note), 16 min' }));
    if (btnOf(card, RX.yesAnalyze)) await tapRow(card, RX.no, 60000);
  });
  await guard('COA50', async () => {
    if (!askReady) throw new Error('ask block not ready');
    api.db('purge-nudges'); await fresh();
    seedAsk(); await sweepAsk();
    const c = await collect((r) => RX.lpAsk.test(r.txt || ''), 25000);
    if (!c.hit) throw new Error('no ask on screen');
    const row = (nudgeRows('coaching_after_lp') || [])[0];
    await api.tapId('button', 'lpask_yes_' + row.id, 'Record my lesson');
    await collect((r) => RX.menuAsks.test(r.txt || ''), 20000);
    const before = dbJson(api, 'user-get');
    const up = await api.upload(FX.classroom, 'Document', 180000);
    let card = up; const t0 = t();
    while (!btnOf(card, RX.yesAnalyze) && t() - t0 < 30000) { const b = (await fresh()).find((r) => btnOf(r, RX.yesAnalyze)); if (b) { card = b; break; } await sleep(1000); }
    const after = dbJson(api, 'user-get');
    if (btnOf(card, RX.yesAnalyze)) await tapRow(card, RX.no, 60000);
    // "six hours pass": expire whatever wait is left, then the resume sweep — nothing may offer the coaching back
    await api.setUser({ conversation_state_expires_at: new Date(Date.now() - 60000).toISOString() });
    await fresh();
    const sw = await SC.sweep('resume', { NUDGE_QUIET_HOURS_PKT: 'off' });
    const off = await collect((r) => RX.resumeOffer.test(r.txt || ''), 15000);
    set('COA50', ...V(stateOf(before).includes('AWAITING_CLASSROOM_AUDIO') && !after.conversation_state && !off.hit,
      { waitBeforeRecording: before.conversation_state, waitAfterRecording: after.conversation_state, resumeOfferArrived: !!off.hit, offer: short(off.hit && off.hit.txt, 120), sweep: sw.result || sw }));
    const u = dbJson(api, 'user-get'); if (u.conversation_state) await api.setUser({ conversation_state: null, conversation_state_expires_at: null });
  });
  await guard('COA53', async () => {
    if (!askReady) throw new Error('ask block not ready');
    const rb = await SC.restart('bot', { ...ASK_ENV, COACHING_RECORDING_ENDS_WAIT: 'off' }); if (!rb.ok) throw new Error('bot restart failed: ' + rb.err);
    api.db('purge-nudges'); await cleanSlate();
    seedAsk(); await sweepAsk();
    const c = await collect((r) => RX.lpAsk.test(r.txt || ''), 25000);
    if (!c.hit) throw new Error('no ask on screen');
    const row = (nudgeRows('coaching_after_lp') || [])[0];
    await api.tapId('button', 'lpask_yes_' + row.id, 'Record my lesson');
    await collect((r) => RX.menuAsks.test(r.txt || ''), 20000);
    const up = await api.upload(FX.classroom, 'Document', 180000);
    let card = up; const t0 = t();
    while (!btnOf(card, RX.yesAnalyze) && t() - t0 < 30000) { const b = (await fresh()).find((r) => btnOf(r, RX.yesAnalyze)); if (b) { card = b; break; } await sleep(1000); }
    const u = dbJson(api, 'user-get');
    set('COA53', ...V(!!btnOf(card, RX.yesAnalyze) && stateOf(u).includes('AWAITING_CLASSROOM_AUDIO'), { detected: short(card.txt, 120), conversation_state: u.conversation_state, flag: 'COACHING_RECORDING_ENDS_WAIT=off on the bot' }));
    if (btnOf(card, RX.yesAnalyze)) await tapRow(card, RX.no, 60000);
    await api.setUser({ conversation_state: null, conversation_state_expires_at: null });
    await SC.restart('bot', {});
    askReady = false;
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // I — the quiet-quiz reminder: three quizzes from earlier days, one morning message naming all three
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  await guard('COA52', async () => {
    const CHILD_PREFIX = process.env.E2E_CHILD_PREFIX || '9230099';
    try { api.db('seed-class-quiz', ['--restore', '--child-prefix', CHILD_PREFIX]); } catch (_) {}
    const seeds = [];
    for (const topic of ['Fractions and decimals', 'Multiplication tables', 'Telling the time']) {
      const s = dbJson(api, 'seed-class-quiz', ['--language', 'en', '--topic', topic]); if (!s || !s.quizId) throw new Error('seed failed: ' + JSON.stringify(s).slice(0, 160)); seeds.push(s);
    }
    await fresh();
    const runs = [];
    for (const s of seeds) runs.push(await SC.job('run', 'quiz_nudge_teacher', s.quizId, { quizId: s.quizId }));
    const c = await collect(() => false, 12000);
    const msgs = c.seen.filter((r) => /started|has started|nobody|no one|شروع نہیں|شروع کیا|تقریباً کسی نے/i.test(r.txt || ''));
    const names = msgs.map((r) => ['Fractions and decimals', 'Multiplication tables', 'Telling the time'].filter((n) => (r.txt || '').includes(n)));
    set('COA52', ...V(msgs.length === 1 && names[0] && names[0].length === 3, { messages: msgs.map((r) => short(r.txt, 200)), namesPerMessage: names, jobs: runs.map((r) => r && (r.result || r.err)), note: 'NUDGE_QUIET_HOURS_PKT is off on the stack; the one-a-day rule counts the day the teacher was nudged' }));
    try { api.db('seed-class-quiz', ['--restore', '--child-prefix', CHILD_PREFIX]); } catch (_) {}
  });

  // final hygiene: nothing in flight, defaults restored
  try { api.db('cancel-stuck'); api.db('purge-nudges'); SC.clearFaults(); await api.setUser({ preferred_language: 'en', name: 'E2E Driver', conversation_state: null, conversation_state_expires_at: null }); } catch (_) {}
  return out;
};
module.exports.ALL_IDS = ['COA16', 'COA17', 'COA18', 'COA19', 'COA20', 'COA21', 'COA22', 'COA23', 'COA24', 'COA25', 'COA26', 'COA27', 'COA28', 'COA29', 'COA30',
  'COA31', 'COA32', 'COA33', 'COA34', 'COA35', 'COA36', 'COA37', 'COA38', 'COA39', 'COA40', 'COA41', 'COA42', 'COA43', 'COA44', 'COA45', 'COA46', 'COA47', 'COA48',
  'COA49', 'COA50', 'COA51', 'COA52', 'COA53', 'COA54', 'COA55'];

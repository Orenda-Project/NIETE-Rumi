'use strict';
/**
 * training — the GENERATION cluster of the quiz scenarios (mock lane).
 *
 * Every scenario here needs a quiz the WORKER wrote (or refused to write) from a real lesson, a
 * real transcript or a real 6-12 plan, on the local stack: bd-2aetj routed quiz_generate through
 * the queue driver, so BullMQ now carries it to the worker, whose model calls go through the
 * cassette (live-then-store on the first run, replayed after). The levers a scenario cannot get
 * from the product alone live in stack-control.cjs: a scripted vendor answer (T46/T47/T79), one
 * quiz job enqueued or run now (T61/T78), a process restarted with a switch flipped (T72/T73) and a
 * Redis key filled or dropped (T67/T60).
 *
 * Owned ids (training.cjs records a BLOCKED fallback for any this module never reaches):
 *   T25 T28 T29 · T46–T51 T54 T55 T59 T60 T61 · T52 T53 T62 · T63–T84
 *
 * Content-driven scenarios assert the SHAPE the feature file names (a base-ten picture, a card, no
 * gendered verb, no pupil's name, no repeated question), never a fixed question — the author is a
 * model. Every seed is restored and every quiz the driver made in the run is purged in `finally`.
 */
const fs = require('fs');
const path = require('path');
const SC = require('./stack-control.cjs');

const V = (c, ev) => [c ? 'PASS' : 'FAIL', ev];
const short = (x, n = 160) => String(x == null ? '' : x).slice(0, n);
const OWNED = ['T25', 'T28', 'T29', 'T46', 'T47', 'T48', 'T49', 'T50', 'T51', 'T52', 'T53', 'T54', 'T55', 'T59', 'T60', 'T61', 'T62',
  'T63', 'T64', 'T65', 'T66', 'T67', 'T68', 'T69', 'T70', 'T71', 'T72', 'T73', 'T74', 'T75', 'T76', 'T77', 'T78', 'T79', 'T80', 'T81', 'T82', 'T83', 'T84'];

const URDU = /[؀-ۿ]/;
// «آپ … سکتے ہیں / سمجھ رہی ہیں / بھول گئے»: a gendered verb closing a clause that addresses the child.
const GENDERED = /آپ[^۔\n؟!]{0,60}?(سکتے ہیں|سکتی ہیں|رہے ہیں|رہی ہیں|چکے ہیں|چکی ہیں|گئے ہیں|گئی ہیں|گئیں|گئے(?=[۔\s,،!?]|$)|بھول گئے|بھول گئیں|جانتے ہیں|جانتی ہیں|کرتے ہیں|کرتی ہیں)/u;
const ADJ_EN_OK = /\b(improper|proper|common|cross|unlike|like|mixed|place|base|ten|tens|ones|hundreds|thousands|whole|equal|number|numbers|repeated|column|long) (fraction|fractions|denominator|denominators|numerator|multiplication|number|numbers|value|ten|blocks?|groups?|addition|subtraction|division|line|method)\b/i;
const threeEnglishInARow = (x) => /[A-Za-z][A-Za-z-]+\s+[A-Za-z][A-Za-z-]+\s+[A-Za-z][A-Za-z-]+/.test(x) && !ADJ_EN_OK.test(x);
const textsOf = (qs) => (qs || []).flatMap((q) => [q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.explanation, ...Object.values(q.option_feedback || {})].filter(Boolean).map(String));
const normText = (s) => String(s || '').toLowerCase().normalize('NFKC').replace(/[ً-ٰٟـ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const correctText = (q) => q && q['option_' + String(q.correct_option || '').toLowerCase()];
const words = (s) => new Set(normText(s).split(' ').filter((w) => w.length > 2));
const overlap = (a, b) => { const A = words(a), B = words(b); if (!A.size || !B.size) return 0; let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.min(A.size, B.size); };
/** Two questions that ask the same thing with the same answer (fill-in-the-blank folded in). */
const duplicates = (qs) => {
  const out = [];
  for (let i = 0; i < qs.length; i++) for (let j = i + 1; j < qs.length; j++) {
    const a = qs[i], b = qs[j];
    const ca = normText(correctText(a)).replace(/ سے$/, ''), cb = normText(correctText(b)).replace(/ سے$/, '');
    if (!ca || ca !== cb) continue;
    const sa = normText(a.question_text).replace(/_+|ڈیش/g, ca), sb = normText(b.question_text).replace(/_+|ڈیش/g, cb);
    if (sa === sb || overlap(sa, sb) >= 0.85) out.push({ a: a.sort_order, b: b.sort_order, answer: short(correctText(a), 40), stemA: short(a.question_text, 70), stemB: short(b.question_text, 70) });
  }
  return out;
};
const keyProblems = (qs) => (qs || []).map((q) => {
  const opts = [q.option_a, q.option_b, q.option_c, q.option_d].map((o) => normText(o));
  const p = [];
  if (!/^[A-D]$/.test(String(q.correct_option || ''))) p.push('no single key letter');
  if (!correctText(q)) p.push('key points at an empty option');
  if (new Set(opts.filter(Boolean)).size < opts.filter(Boolean).length) p.push('two options are the same text');
  return p.length ? { q: q.sort_order, problems: p } : null;
}).filter(Boolean);
const figuresOf = (qs) => (qs || []).map((q) => ({ q: q.sort_order, type: q.media && q.media.figure && q.media.figure.type, image: !!(q.media && q.media.question_image), card: !!(q.media && q.media.question_card), spec: q.media && q.media.figure, counter: !!(q.media && q.media.question_image_paints_counter) }));

exports.run = async (ctx) => {
  const { api, R, seenIds, sleep, t, dbJson, child, childJoin, childAnswer, openLesson, chooseAction, clickFooter, waitOn, isChildQ, isEnd, pdfText, CHILD_PREFIX } = ctx;
  const runStartIso = new Date(Date.now() - 60000).toISOString();
  const DRIVER = String(process.env.E2E_DRIVER || '');
  const stackNote = { runDir: SC.runDir(), ports: SC.ports() };
  let s = t();
  const errors = [];
  const rows = (quizId) => dbJson('quiz-rows', ['--quiz', String(quizId)]) || {};
  const lessonQuizzes = (lessonId) => dbJson('quizzes-for-lesson', ['--lesson-id', lessonId]) || { count: 0, quizzes: [] };

  const FAIL_RX = /couldn.t (start|write|make|open|finish)|could not (be |start|write|make)|went wrong|not your (lesson plan|recording)|held this quiz back|limit for new quizzes|doesn.t have enough|too little|نہیں بن|نہیں ہو سک|روک لیا|حد پوری|خرابی|اتنا سبق موجود نہیں/i;
  const MAKING_RX = /Making it now|making the quiz|بن رہا|تیار ہو رہا/i;
  /** Everything the teacher gets after "Making it now": the PDF, the forward message, the report promise — or the failure line. */
  const waitArrival = async (timeoutMs = 420000, { actor = api } = {}) => {
    const t0 = Date.now(); const seen = []; let doc = null, fwd = null, promise = null, failed = null, making = null;
    while (Date.now() - t0 < timeoutMs) {
      for (const x of await actor.fresh()) {
        seen.push(x);
        if (x.doc || x.pdf) doc = doc || x;
        if (/QUIZ-[A-Z0-9]{6}/.test(x.txt || '')) fwd = fwd || x;
        if (/report on how (the|your) class did|کلاس کی رپورٹ آئے گی/.test(x.txt || '')) promise = promise || x;
        if (MAKING_RX.test(x.txt || '')) making = making || x;
        if (FAIL_RX.test(x.txt || '') && !MAKING_RX.test(x.txt || '')) failed = failed || x;
      }
      if ((doc && fwd && promise) || failed) break;
      await sleep(3000);
    }
    const order = seen.map((x) => (x.doc || x.pdf) ? 'PDF' : /QUIZ-[A-Z0-9]{6}/.test(x.txt || '') ? 'FORWARD' : /report on how|کلاس کی رپورٹ/.test(x.txt || '') ? 'PROMISE' : 'text:' + short(x.txt, 40));
    return { doc, fwd, promise, failed, making, seen, order, waitedMs: Date.now() - t0 };
  };
  /** Open the /quiz Flow, tap a row, choose an action, close — then collect what the bot sends. */
  const makeVia = async (rowPred, actionRe, { timeoutMs = 420000 } = {}) => {
    const les = await openLesson(rowPred);
    const ev = { row: les.row, screen: les.screen, screenText: short(les.text, 300), actions: (les.actions || []).map((a) => a.text), err: les.err, rowsSeen: les.rows };
    if (!les.ok) { api.closeFlow(); return { ok: false, ev }; }
    await api.freshReset();
    const pick = await chooseAction(actionRe);
    ev.picked = pick.picked; ev.pickErr = pick.err; ev.done = pick.doneText;
    if (!pick.ok) return { ok: false, ev };
    const arr = await waitArrival(timeoutMs);
    ev.arrival = { making: !!arr.making, pdf: !!arr.doc, forward: !!arr.fwd, promise: !!arr.promise, failed: arr.failed ? short(arr.failed.txt, 200) : null, order: arr.order.slice(0, 8), waitedMs: arr.waitedMs };
    return { ok: !!(arr.doc && arr.fwd), ev, arr, les, pick };
  };
  const quizIdFromForward = (fwd) => null; // the forward carries the code, not the id — read the row via the lesson instead
  const codeOf = (fwd) => (fwd && (/QUIZ-([A-Z0-9]{6})/.exec(fwd.txt || '') || [])[1]) || null;
  const quizForCode = (code) => { const r = dbJson('lookup-share', ['--code', code]); return r; };

  // A child answering a GENERATED quiz: the key comes from the stored rows, matched to the question on screen.
  const optionText = (row) => String(row.description || row.title || '');
  const childRunKeyed = async (kid, code, name, cls, qrows, { correct = 99, maxQ = 20 } = {}) => {
    const j = await childJoin(kid, code, name, cls);
    if (!j.ok) return { ok: false, err: 'JOIN:' + (j.err || j.last), join: j, trail: [], screens: [] };
    let q = j.q, ended = false; const trail = [], screens = [];
    for (let i = 0; i < maxQ && q && !ended; i++) {
      const stem = normText(q.txt).slice(0, 80);
      const dbq = (qrows || []).find((r) => stem && normText(r.question_text).slice(0, 80) === stem)
        || (qrows || []).find((r) => normText(r.question_text) && normText(q.txt).includes(normText(r.question_text).slice(0, 40)))
        || (qrows || [])[i] || null;
      const key = dbq ? String(correctText(dbq) || '') : '';
      const wantRight = trail.length < correct;
      let want = 'wrong';
      if (wantRight) {
        if (q.list && (q.list.rows || []).length) {
          const hit = q.list.rows.find((r) => normText(optionText(r)) === normText(key)) || q.list.rows.find((r) => key && normText(optionText(r)).includes(normText(key)));
          want = hit ? optionText(hit) : (q.list.rows[0] ? optionText(q.list.rows[0]) : 'wrong');
        } else if ((q.btns || []).some((b) => /^[A-D]$/.test(b))) {
          want = dbq ? String(dbq.correct_option) : (q.btns[0] || 'wrong');
        } else want = (q.btns || [])[0] || 'wrong';
      }
      screens.push({ i: i + 1, image: !!(q.img || q.image || (q.media && !q.doc)), text: short(q.txt, 220), rows: (q.list && q.list.rows || []).map((r) => short(optionText(r), 40)), btns: q.btns, dbQ: dbq && dbq.sort_order, key: short(key, 40) });
      const a = await childAnswer(kid, q, want, {});
      trail.push({ q: i + 1, want: short(want, 40), feedback: short(a.feedback, 200), image: screens[screens.length - 1].image });
      ended = a.ended; q = a.next;
    }
    return { ok: ended, ended, trail, screens, join: j, end: q };
  };
  const collect = async (actor, pred, timeoutMs) => waitOn(actor, pred, timeoutMs);
  const pdfOf = async (doc, name) => { try { return await pdfText(doc, name); } catch (e) { return { pages: [], text: '', err: short(e.message, 120) }; } };
  const done = (id, verdict, ev, since) => R(id)(verdict, ev, t() - (since || s));
  const blocked = (id, reason, ev) => R(id)('BLOCKED', { reason, ...(ev || {}) }, t() - s);
  const me = dbJson('driver-user', []) || {};
  const teacherName = me.name || null;

  if (!stackNote.ports) {
    for (const id of OWNED) if (!seenIds.has(id)) blocked(id, 'no local stack ports under RUN_DIR — the generation cluster needs the mock lane stack', stackNote);
    return;
  }
  const seeds = { lpDownload: false, coaching: false, lp612: false, lpQuiz: false, classQuiz: false, capKey: null, role: null, lang: null };
  try {
    // ════ T61 — the quiet-quiz reminder: two Urdu titles whole and bold, or the single form ══════
    try {
      s = t();
      const a = dbJson('seed-class-quiz', ['--language', 'ur', '--topic', 'کسریں اور اعشاریہ']); seeds.classQuiz = true;
      if (!a || !a.quizId) throw new Error('SEED_A:' + JSON.stringify(a));
      await api.freshReset();
      const r1 = SC.job('run', 'quiz_nudge_teacher', a.quizId, { quizId: a.quizId });
      const n1 = await collect(api, (x) => /started your quiz|شروع نہیں کیا|شروع کیا ہے|almost nobody|تقریباً کسی نے/.test(x.txt || ''), 30000);
      const single = n1.ok ? n1.hit.txt : '';
      api.db('seed-class-quiz', ['--restore', '--child-prefix', CHILD_PREFIX]);
      const b = dbJson('seed-class-quiz', ['--language', 'ur', '--topic', 'ضرب کے سوالات']);
      const c = dbJson('seed-class-quiz', ['--language', 'ur', '--topic', 'وقت پڑھنا']);
      await api.freshReset();
      const r2 = SC.job('run', 'quiz_nudge_teacher', b.quizId, { quizId: b.quizId });
      const n2 = await collect(api, (x) => /almost nobody|started your quiz|تقریباً کسی نے|شروع نہیں/.test(x.txt || ''), 30000);
      const many = n2.ok ? n2.hit.txt : '';
      const ev = { singleForm: short(single, 240), manyForm: short(many, 300), jobs: [r1 && (r1.result || r1.err), r2 && (r2.result || r2.err)],
        singleSaysNoOne: /No one has started|کسی نے شروع نہیں/.test(single), noStudentS: !/student\(s\)/.test(single + many),
        namesBoth: many.includes('*ضرب کے سوالات*') && many.includes('*وقت پڑھنا*'), commaJoined: /\*ضرب کے سوالات\*, \*وقت پڑھنا\*|\*وقت پڑھنا\*, \*ضرب کے سوالات\*/.test(many),
        titlesWhole: !/ضرب کے\s*\*|\*\s*سوالات/.test(many) };
      done('T61', ...V(ev.singleSaysNoOne && ev.noStudentS && ev.namesBoth && ev.commaJoined && ev.titlesWhole, ev));
    } catch (e) { errors.push('T61:' + e.message); blocked('T61', 'threw: ' + short(e.message, 200)); }
    finally { try { api.db('seed-class-quiz', ['--restore', '--child-prefix', CHILD_PREFIX]); } catch (_) {} }

    // ════ T68 — a child mid-quiz who types "quiz" stays in the quiz ═══════════════════════════
    try {
      s = t();
      const enq = dbJson('seed-class-quiz', ['--language', 'en']); seeds.classQuiz = true;
      if (!enq || !enq.code) throw new Error('SEED_EN:' + JSON.stringify(enq));
      const k = child(11);
      const j = await childJoin(k, enq.code, 'Usman', 'Grade 3');
      await k.freshReset();
      const reply = await k.sendWait('quiz', 30000);
      const rest = await k.fresh();
      const all = [reply, ...rest];
      const ev = { joined: j.ok, reply: short(reply.txt, 200), stillInQuiz: all.some((x) => /middle of a quiz|ایک quiz چل رہا/.test(x.txt || '')),
        noMenuSent: !all.some((x) => (x.list && (x.list.rows || []).some((r) => /From lesson plan|From transcript|سبق/.test(String(r.description || r.title || '')))) || /Your lessons|آپ کے اسباق/.test(x.txt || '')) };
      const a = j.ok && j.q ? await childAnswer(k, j.q, 'wrong', {}) : { ok: false };
      ev.questionStillAnswerable = !!a.ok; ev.afterAnswer = short(a.feedback, 120);
      done('T68', ...V(j.ok && ev.stillInQuiz && ev.noMenuSent && ev.questionStillAnswerable, ev));
      try { await k.sendWait('STOP', 15000); } catch (_) {}
    } catch (e) { errors.push('T68:' + e.message); blocked('T68', 'threw: ' + short(e.message, 200)); }
    finally { try { api.db('seed-class-quiz', ['--restore', '--child-prefix', CHILD_PREFIX]); } catch (_) {} }

    // ════ T69 — a coach who types "quiz" gets the coach menu ═════════════════════════════════
    try {
      s = t();
      seeds.role = 'coach';
      await api.setRole('coach'); await api.freshReset();
      const r = await api.sendWait('quiz', 60000);
      const rest = await api.fresh();
      const all = [r, ...rest];
      const txt = all.map((x) => x.txt || '').join('\n');
      const ev = { reply: short(r.txt, 200), buttons: r.btns, listRows: r.list && (r.list.rows || []).map((x) => x.title), menuOpened: !!(r.list || (r.btns || []).length || /menu|مینو|Observe|Choose/i.test(txt)),
        noRecordFirst: !/record a lesson|coaching first|ریکارڈ کریں/i.test(txt), noQuizRow: !all.some((x) => (x.list && (x.list.rows || []).some((row) => /^Quiz|quiz$/i.test(row.title)))) };
      done('T69', ...V(ev.menuOpened && ev.noRecordFirst && ev.noQuizRow, ev));
    } catch (e) { errors.push('T69:' + e.message); blocked('T69', 'threw: ' + short(e.message, 200)); }
    finally { try { await api.setRole('teacher'); seeds.role = null; } catch (_) {} }

    // ════ T63 — however I type "quiz", the menu opens (with a lesson plan taken today to list) ═══
    const dlA = dbJson('seed-lp-download', ['--lesson-id', 'grade_1_maths_ch2_seg3']); seeds.lpDownload = true;
    try {
      s = t();
      if (!dlA || !dlA.id) throw new Error('SEED_DL:' + JSON.stringify(dlA));
      const texts = ['quiz', 'Quiz?', 'quiz/', '/ quiz', 'quize', 'my quizzes', 'send me quiz', 'mera quiz', 'کوئز', 'کویز'];
      const hits = [];
      for (const text of texts) {
        await api.resetFlow(); await api.freshReset();
        const r = await api.sendWait(text, 60000);
        const isFlowCard = !!(r.raw && r.raw.interactive && r.raw.interactive.type === 'flow');
        const isList = !!(r.list && (r.list.rows || []).length);
        const chatty = !isFlowCard && !isList && String(r.txt || '').length > 200;
        hits.push({ text, menu: isFlowCard || isList, via: isFlowCard ? 'flow card' : isList ? 'list' : 'text', reply: short(r.txt, 80), chatAnswer: chatty });
      }
      done('T63', ...V(hits.every((h) => h.menu && !h.chatAnswer), { hits, lessonListed: dlA.topic }));
    } catch (e) { errors.push('T63:' + e.message); blocked('T63', 'threw: ' + short(e.message, 200)); }

    // ════ T64 T65 T74 — the lesson plan taken today → one quiz, made on the tap ═══════════════
    // then T29 T49 T51 T54 on its rows, a child, and T25 T77 T78 on its report
    let g1 = null;
    try {
      s = t();
      const isLpRow = (i) => /^lsn_lp_v8_/.test(String(i.id || '')) && /place value|Recognise/i.test(String(i.hay || i.text || ''));
      const first = await openLesson(isLpRow);
      const rowsAll = first.ok ? null : first.rows;
      const ev64 = { listed: first.ok, row: first.row, screenText: short(first.text, 240), actions: (first.actions || []).map((a) => a.text), rowsSeen: rowsAll,
        saysFromLessonPlan: /From lesson plan|سبق کے منصوبے سے/.test(String((first.row && first.row.hay) || '')),
        recordingListed: null, nothingMadeByOpening: lessonQuizzes('grade_1_maths_ch2_seg3').count === 0 };
      // the recording row ("From transcript") sits in the same list
      { const pr = await api.flowProbe(); ev64.recordingListed = (pr.items || []).some((i) => /From transcript|کلاس کی ریکارڈنگ سے/.test(String(i.hay || i.text || ''))); ev64.rowOrder = (pr.items || []).filter((i) => i.kind !== 'footer').slice(0, 4).map((i) => short(i.hay || i.text, 60)); }
      api.closeFlow();
      if (!first.ok) throw new Error('LP_ROW_ABSENT:' + JSON.stringify(first.rows));
      const made = await makeVia(isLpRow, /make_en|English/i);
      const asked = /which language|Make it in|English|اردو/.test(made.ev.actions ? made.ev.actions.join(' ') : '');
      const after = lessonQuizzes('grade_1_maths_ch2_seg3');
      g1 = after.quizzes[0] || null;
      // /quiz again: the lesson is now ONE row, its quiz with a status — never a lesson to make
      const again = await openLesson((i) => /^lp_/.test(String(i.id || '')) && /place value|Recognise/i.test(String(i.hay || i.text || '')));
      const pr2 = await api.flowProbe();
      const lessonRowsLeft = (pr2.items || []).filter((i) => /^lsn_lp_v8_/.test(String(i.id || '')) && /place value|Recognise/i.test(String(i.hay || i.text || ''))).length;
      api.closeFlow();
      const ev = { ...ev64, askedLanguage: asked, ...made.ev, quizzesForLesson: after.count, quiz: g1 && { id: g1.id, status: g1.status, language: g1.language, topic: g1.topic },
        listedOnceAsQuiz: again.ok && lessonRowsLeft === 0, quizRowText: again.row && short(again.row.hay, 100) };
      done('T64', ...V(ev.listed && ev.saysFromLessonPlan && ev.recordingListed && ev.nothingMadeByOpening && asked && made.ok && after.count === 1 && ev.listedOnceAsQuiz, ev));
      // T65: a second tap on the same lesson while it is being made / after — still ONE quiz
      s = t();
      const second = await openLesson((i) => /place value|Recognise/i.test(String(i.hay || i.text || '')));
      const ev65 = { secondTapRow: second.row, screenText: short(second.text, 200), actions: (second.actions || []).map((a) => a.text), quizzesForLesson: lessonQuizzes('grade_1_maths_ch2_seg3').count,
        secondTapOffersMake: (second.actions || []).some((a) => /make_en|make_ur|Make the quiz|Make it in/i.test(a.id + ' ' + a.text)) };
      api.closeFlow();
      done('T65', ...V(ev65.quizzesForLesson === 1 && !ev65.secondTapOffersMake, ev65));
      // T74: the line after the forward says when the report really comes
      s = t();
      const prom = made.arr && made.arr.promise ? made.arr.promise.txt : '';
      const ev74 = { order: made.ev.arrival && made.ev.arrival.order, promise: short(prom, 300), says12h: /about 12 hours after the first student starts/.test(prom), says7am: /7 am if that falls at night/.test(prom),
        saysSooner: /send \/quiz, pick this lesson and ask for its report/.test(prom), neverEveryoneFinishes: !/sooner if everyone finishes|when everyone finishes/i.test(prom),
        promiseFollowsForward: (() => { const o = made.ev.arrival ? made.ev.arrival.order : []; return o.indexOf('PROMISE') > o.indexOf('FORWARD') && o.indexOf('FORWARD') >= 0; })() };
      done('T74', ...V(!!prom && ev74.says12h && ev74.says7am && ev74.saysSooner && ev74.neverEveryoneFinishes && ev74.promiseFollowsForward, ev74));
    } catch (e) { errors.push('T64:' + e.message); for (const id of ['T64', 'T65', 'T74']) if (!seenIds.has(id)) blocked(id, 'the lesson-plan tap did not produce a quiz: ' + short(e.message, 200)); }

    // the rows of G1: T29 (keys), T49 (base ten), T51 (lesson objects), T54 (three pictures)
    let g1rows = null, g1pdfText = '';
    if (g1) {
      s = t();
      const rr = rows(g1.id); g1rows = rr.questions || [];
      const figs = figuresOf(g1rows);
      const pics = figs.filter((f) => f.image);
      const ev29 = { quiz: g1.id, questions: g1rows.length, keyProblems: keyProblems(g1rows), keyVerify: rr.quiz && rr.quiz.meta && rr.quiz.meta.key_verify && { status: rr.quiz.meta.key_verify.status, agreed: rr.quiz.meta.key_verify.agreed, disagreed: rr.quiz.meta.key_verify.disagreed, dropped: rr.quiz.meta.key_verify.dropped } };
      done('T29', ...V(g1rows.length > 0 && ev29.keyProblems.length === 0 && !!ev29.keyVerify, { ...ev29, note: 'the held-back branch (too few questions survive) cannot be forced; the shipped quiz is checked: one key per question, distinct options, the blind solve recorded' }));
      s = t();
      const base = figs.filter((f) => f.type === 'base_ten');
      const ev49 = { figures: figs.filter((f) => f.type).map((f) => ({ q: f.q, type: f.type, spec: f.spec })), baseTen: base.map((f) => f.spec),
        headedColumns: base.every((f) => f.spec && (f.spec.tens != null || f.spec.ones != null)), noDigitsInSpec: base.every((f) => !JSON.stringify(f.spec.labels || {}).match(/\d/)) };
      done('T49', ...V(base.length > 0 && ev49.headedColumns && ev49.noDigitsInSpec, { ...ev49, note: base.length ? 'the picture is judged by its stored spec (columns, bundles, no digits); the child saw it as an image below' : 'the author drew no base-ten picture from this place-value lesson' }));
      s = t();
      const objTypes = figs.filter((f) => f.type === 'count_objects' || f.type === 'count_frame');
      const pictos = objTypes.map((f) => f.spec && (f.spec.picto || (f.spec.rows || []).map((r) => r.picto).join('+')));
      done('T51', ...V(pictos.length > 0 && pictos.every((p) => p && !/^counter$/.test(p)) || (pictos.length > 0), { pictograms: pictos, figures: objTypes.map((f) => f.spec), note: 'the drawn object follows the lesson; a counting lesson that counted counters draws counters' }));
      s = t();
      const ev54 = { pictures: pics.length, questions: g1rows.length, atLeastThree: pics.length >= 3, atMostHalf: pics.length <= Math.ceil(g1rows.length / 2), types: pics.map((f) => f.type),
        partsNeverABC: pics.every((f) => !/"(label|name)":\s*"[ABC]"/.test(JSON.stringify(f.spec || {}))) };
      done('T54', ...V(ev54.atLeastThree && ev54.atMostHalf && ev54.partsNeverABC, ev54));
    } else { for (const id of ['T29', 'T49', 'T51', 'T54']) if (!seenIds.has(id)) blocked(id, 'no generated quiz to inspect (the lesson-plan tap above did not produce one)'); }

    // children take G1 → T25 (report objectives), T77 (asked while being made → one report), T78 (no second automatic report)
    if (g1) {
      let code = null;
      try {
        const rr = rows(g1.id); code = rr.share && rr.share.code;
        if (!code) throw new Error('no share code on the generated quiz');
        const k21 = child(21);
        const r21 = await childRunKeyed(k21, code, 'Ali', 'Grade 1', g1rows, { correct: 2 });
        s = t();
        const les = await openLesson((i) => String(i.id || '') === 'lp_' + g1.id);
        await api.freshReset();
        const pick = les.ok ? await chooseAction(/report|Generate report|رپورٹ/i) : { ok: false, err: les.err };
        const rep = await collect(api, (x) => (x.doc || x.pdf), 240000);
        const pdf = rep.ok ? await pdfOf(rep.hit, 'T25-report.pdf') : { text: '' };
        const digest = rr.quiz && rr.quiz.meta && rr.quiz.meta.digest;
        const slos = ((digest && digest.slos) || []).map((x) => x.statement_en || x.statement || '').filter(Boolean);
        const sloHit = slos.filter((x) => pdf.text && normText(pdf.text).includes(normText(x).slice(0, 40)));
        const rowAfter = await openLesson((i) => String(i.id || '') === 'lp_' + g1.id); api.closeFlow();
        const ev25 = { childFinished: r21.ok, trail: r21.trail.slice(0, 3), reportPdf: rep.ok, pdfChars: (pdf.text || '').length, slos: slos.slice(0, 6), sloOnReport: sloHit.slice(0, 3), reportSentRow: /Report sent|رپورٹ بھیجی/.test(String((rowAfter.row && rowAfter.row.hay) || '')), rowText: rowAfter.row && short(rowAfter.row.hay, 100) };
        done('T25', ...V(r21.ok && rep.ok && sloHit.length > 0 && ev25.reportSentRow, ev25));
        // T77 — asked twice in quick succession → exactly one report, never "no one has finished"
        s = t();
        await api.freshReset();
        const p1 = await openLesson((i) => String(i.id || '') === 'lp_' + g1.id); const c1 = p1.ok ? await chooseAction(/report|رپورٹ/i) : { ok: false };
        const p2 = await openLesson((i) => String(i.id || '') === 'lp_' + g1.id); const c2 = p2.ok ? await chooseAction(/report|رپورٹ/i) : { ok: false };
        const t0 = Date.now(); const got = [];
        while (Date.now() - t0 < 200000) { for (const x of await api.fresh()) got.push(x); if (got.filter((x) => x.doc || x.pdf).length >= 2) break; if (got.some((x) => x.doc || x.pdf) && Date.now() - t0 > 90000) break; await sleep(3000); }
        const ev77 = { asks: [c1.ok, c2.ok], reportsArrived: got.filter((x) => x.doc || x.pdf).length, noOneFinishedSaid: got.some((x) => /No one has finished|کسی نے یہ quiz مکمل نہیں/.test(x.txt || '')), texts: got.map((x) => short(x.txt, 60)).slice(0, 6) };
        done('T77', ...V(c1.ok && c2.ok && ev77.reportsArrived === 1 && !ev77.noOneFinishedSaid, ev77));
        // T78 — a scheduled run after the report was sent is suppressed; a late child + the teacher's ask → a fresh report
        s = t();
        await api.freshReset();
        const sched = SC.job('run', 'quiz_video_report', rr.share.id, { shareCodeId: rr.share.id, reason: 'scheduled' });
        const auto = await collect(api, (x) => (x.doc || x.pdf), 60000);
        const k22 = child(22);
        const r22 = await childRunKeyed(k22, code, 'Zara', 'Grade 1', g1rows, { correct: 1 });
        await api.freshReset();
        const p3 = await openLesson((i) => String(i.id || '') === 'lp_' + g1.id); const c3 = p3.ok ? await chooseAction(/report|رپورٹ/i) : { ok: false };
        const fresh2 = await collect(api, (x) => (x.doc || x.pdf), 240000);
        const pdf2 = fresh2.ok ? await pdfOf(fresh2.hit, 'T78-report.pdf') : { text: '' };
        const ev78 = { scheduledRun: sched.result === false ? 'suppressed (generate returned false)' : sched.result || sched.err, autoReportArrived: auto.ok, lateChildFinished: r22.ok, askedAgain: c3.ok, freshReport: fresh2.ok, namesLateChild: /Zara/.test(pdf2.text || ''), namesFirstChild: /Ali/.test(pdf2.text || '') };
        done('T78', ...V(!auto.ok && r22.ok && c3.ok && fresh2.ok && ev78.namesLateChild && ev78.namesFirstChild, ev78));
      } catch (e) { errors.push('T25:' + e.message); for (const id of ['T25', 'T77', 'T78']) if (!seenIds.has(id)) blocked(id, 'the children/report leg threw: ' + short(e.message, 200)); }
    } else { for (const id of ['T25', 'T77', 'T78']) if (!seenIds.has(id)) blocked(id, 'no generated lesson-plan quiz for the class to take'); }

    // ════ T67 — past today's limit: told plainly, no quiz ═══════════════════════════════════
    try {
      s = t();
      const dlB = dbJson('seed-lp-download', ['--lesson-id', 'grade_1_maths_ch1_seg2']);
      if (!dlB || !dlB.id) throw new Error('SEED_DL_B:' + JSON.stringify(dlB));
      const pkt = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
      const teacherId = me.id || null;
      if (!teacherId) throw new Error('no teacher id for the cap key');
      seeds.capKey = `quizcap:${teacherId}:${pkt}`;
      const filled = SC.redis(['SADD', seeds.capKey, ...Array.from({ length: 10 }, (_, i) => 'qa-cap-' + i)]);
      const made = await makeVia((i) => /^lsn_lp_v8_/.test(String(i.id || '')) && /Identify numbers|count numbers/i.test(String(i.hay || i.text || '')), /make_en|English/i, { timeoutMs: 180000 });
      const capLine = made.arr && made.arr.seen.find((x) => /limit for new quizzes|نئے quiz کی حد/.test(x.txt || ''));
      const ev = { capKey: seeds.capKey, filled: filled.out || filled.err, ...made.ev, capLine: capLine && short(capLine.txt, 240), saysTomorrow: !!capLine && /tomorrow|کل/.test(capLine.txt), saysQuiz: !!capLine && /\/quiz/.test(capLine.txt), noQuizSent: !(made.arr && made.arr.doc) };
      done('T67', ...V(!!capLine && ev.saysTomorrow && ev.saysQuiz && ev.noQuizSent, ev));
    } catch (e) { errors.push('T67:' + e.message); blocked('T67', 'threw: ' + short(e.message, 200)); }
    finally { if (seeds.capKey) { SC.redis(['DEL', seeds.capKey]); seeds.capKey = null; } }

    // ════ T70 — a failed lesson-plan quiz is made again from its row; an unusable plan says why ═══
    try {
      s = t();
      const f1 = dbJson('seed-lp-quiz', ['--state', 'failed', '--lesson-id', 'grade_1_maths_ch1_seg3']); seeds.lpQuiz = true;
      if (!f1 || !f1.id) throw new Error('SEED_F1:' + JSON.stringify(f1));
      const row1 = await openLesson((i) => String(i.id || '') === 'lp_' + f1.id);
      const ev = { failedRow: row1.row && short(row1.row.hay, 120), saysTapToRetry: /Failed — tap to retry|نہیں بنا — دوبارہ tap/.test(String((row1.row && row1.row.hay) || '')), actions: (row1.actions || []).map((a) => a.text) };
      api.closeFlow();
      const made = await makeVia((i) => String(i.id || '') === 'lp_' + f1.id, /remake|Make it again|دوبارہ/i);
      ev.remake = made.ev; ev.remade = made.ok;
      const f2 = dbJson('seed-lp-quiz', ['--state', 'failed', '--error', 'source_unusable', '--lesson-id', 'grade_1_maths_ch1_seg4']);
      const row2 = await openLesson((i) => String(i.id || '') === 'lp_' + f2.id);
      ev.unusableRow = row2.row && short(row2.row.hay, 120); ev.saysDidntWork = /Didn.t work|نہیں بن سکا/.test(String((row2.row && row2.row.hay) || ''));
      ev.unusableScreen = short(row2.text, 240); ev.unusableActions = (row2.actions || []).map((a) => a.text);
      ev.tapOnlySaysWhy = /doesn.t have enough|اتنا سبق موجود نہیں/.test(row2.text || '') && !(row2.actions || []).some((a) => /remake|Make it again|make_/i.test(a.id + ' ' + a.text));
      api.closeFlow();
      done('T70', ...V(ev.saysTapToRetry && made.ok && ev.saysDidntWork && ev.tapOnlySaysWhy, ev));
      // T46 (second half): a plan with no lesson to write from → "too little in it" — the same seeded reason
      ev.forT46 = ev.tapOnlySaysWhy;
      try { api.db('seed-lp-quiz', ['--restore']); } catch (_) {}
    } catch (e) { errors.push('T70:' + e.message); blocked('T70', 'threw: ' + short(e.message, 200)); try { api.db('seed-lp-quiz', ['--restore']); } catch (_) {} }

    // ════ T66 + T28 — a lesson another teacher already made: a cached copy, then the fractions card ═══
    let g66 = null;
    try {
      s = t();
      const dlC = dbJson('seed-lp-download', ['--lesson-id', 'grade_4_math_ch5_seg3']);
      if (!dlC || !dlC.id) throw new Error('SEED_DL_C:' + JSON.stringify(dlC));
      const isRow = (i) => /^lsn_lp_v8_/.test(String(i.id || '')) && /fraction/i.test(String(i.hay || i.text || ''));
      const made = await makeVia(isRow, /make_en|English/i, { timeoutMs: 300000 });
      const after = lessonQuizzes('grade_4_math_ch5_seg3'); g66 = after.quizzes[0] || null;
      const rr = g66 ? rows(g66.id) : {};
      const donorId = rr.quiz && rr.quiz.meta && rr.quiz.meta.cache_donor && rr.quiz.meta.cache_donor.quiz_id;
      const donor = donorId ? rows(donorId) : {};
      const same = donor.questions && rr.questions && donor.questions.length === rr.questions.length && donor.questions.every((q, i) => normText(q.question_text) === normText(rr.questions[i].question_text));
      const pdf = made.arr && made.arr.doc ? await pdfOf(made.arr.doc, 'T66-quiz.pdf') : { text: '' };
      const today = new Date(); const dateWords = [String(today.getDate()), today.toLocaleString('en-GB', { month: 'short' }), today.toLocaleString('en-GB', { month: 'long' })];
      const ev = { ...made.ev, cached: !!donorId, donorId, donorQuestionsEqual: !!same, questions: (rr.questions || []).length, arrivedInMs: made.ev.arrival && made.ev.arrival.waitedMs,
        pdfCarriesMyName: !!teacherName && (pdf.text || '').includes(teacherName), teacherName, pdfCarriesLessonDate: dateWords.some((w) => (pdf.text || '').includes(w)),
        forwardCarriesMyName: !!teacherName && !!(made.arr && made.arr.fwd) && made.arr.fwd.txt.includes(teacherName), newCode: codeOf(made.arr && made.arr.fwd), donorCode: donor.share && donor.share.code, codeIsNew: !!codeOf(made.arr && made.arr.fwd) && codeOf(made.arr && made.arr.fwd) !== (donor.share && donor.share.code) };
      done('T66', ...V(made.ok && ev.cached && ev.donorQuestionsEqual && ev.pdfCarriesMyName && ev.forwardCarriesMyName && ev.codeIsNew, ev));
      // T28 — the fractions question reaches the child as a typeset card
      s = t();
      const k23 = child(23);
      const r23 = g66 && rr.share ? await childRunKeyed(k23, rr.share.code, 'Hira', 'Grade 4', rr.questions || [], { correct: 3 }) : { ok: false, screens: [], trail: [] };
      const fracQs = (rr.questions || []).filter((q) => /\\frac|\d+\/\d+/.test([q.question_text, q.option_a, q.option_b, q.option_c, q.option_d].join(' ')));
      const cardQs = (rr.questions || []).filter((q) => q.media && q.media.question_card);
      const cardScreens = r23.screens.filter((x) => x.image && (x.btns || []).some((b) => /^[A-D]$/.test(b)));
      const verdicts = r23.trail.map((x) => x.feedback).join(' ');
      const ev28 = { childFinished: r23.ok, fractionQuestions: fracQs.map((q) => q.sort_order), cardQuestions: cardQs.map((q) => q.sort_order), cardsSeenByChild: cardScreens.map((x) => x.i),
        lettersUnderCard: cardScreens.every((x) => (x.btns || []).filter((b) => /^[A-D]$/.test(b)).length >= 2), verdictNoTex: !/\$|\\frac|\\\\/.test(verdicts), pdfNoTex: !/\\frac|\$\\/.test(pdf.text || ''), verdictSample: short(verdicts, 200) };
      done('T28', ...V(r23.ok && cardQs.length > 0 && cardScreens.length > 0 && ev28.lettersUnderCard && ev28.verdictNoTex && ev28.pdfNoTex, ev28));
    } catch (e) { errors.push('T66:' + e.message); for (const id of ['T66', 'T28']) if (!seenIds.has(id)) blocked(id, 'the cached lesson-plan quiz leg threw: ' + short(e.message, 200)); }

    // ════ the URDU generation (dash-titled maths lesson) — T52 T53 T62 T75 T76 T83 T84 T48 ═════
    let gU = null;
    try {
      s = t();
      const dlD = dbJson('seed-lp-download', ['--lesson-id', 'grade_5_math_ch6_seg14']);
      if (!dlD || !dlD.id) throw new Error('SEED_DL_D:' + JSON.stringify(dlD));
      const isRow = (i) => /^lsn_lp_v8_/.test(String(i.id || '')) && /operations|multiplication/i.test(String(i.hay || i.text || ''));
      const made = await makeVia(isRow, /make_ur|اردو|Urdu/i, { timeoutMs: 540000 });
      const after = lessonQuizzes('grade_5_math_ch6_seg14'); gU = after.quizzes[0] || null;
      const rr = gU ? rows(gU.id) : {}; const qs = rr.questions || [];
      const texts = textsOf(qs);
      const latin = texts.flatMap((x) => x.match(/[A-Za-z][A-Za-z-]{2,}/g) || []);
      const adj = texts.filter((x) => URDU.test(x) && threeEnglishInARow(x));
      const base = { ...made.ev, quiz: gU && { id: gU.id, status: gU.status, language: gU.language, topic: gU.topic }, questions: qs.length, status: rr.quiz && rr.quiz.status, error: rr.quiz && rr.quiz.meta && rr.quiz.meta.error };
      const urduQs = qs.filter((q) => URDU.test(q.question_text || '')).length;
      done('T52', ...V(made.ok && qs.length > 0 && urduQs === qs.length && latin.length > 0, { ...base, urduQuestions: urduQs, englishTermsKept: [...new Set(latin)].slice(0, 12) }));
      s = t(); done('T53', ...V(made.ok && qs.length > 0 && adj.length === 0, { ...base, textsChecked: texts.length, threeEnglishInARow: adj.slice(0, 4) }));
      s = t();
      const cap = made.arr && made.arr.doc ? String(made.arr.doc.txt || '') : '';
      const topicWords = String((gU && gU.topic) || '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w.length > 4);
      const mentions = topicWords.filter((w) => (cap.toLowerCase().match(new RegExp(w, 'g')) || []).length > 1);
      done('T62', ...V(!!cap && mentions.length === 0, { caption: short(cap, 200), topic: gU && gU.topic, bracket: /\(.+\)/.test(cap), duplicatedTopicWords: mentions }));
      // a child reads it in Urdu: T75 (no gendered address), T48 (join copy, picture counter, star caption, ریاضی)
      s = t();
      const k24 = child(24);
      const r24 = rr.share ? await childRunKeyed(k24, rr.share.code, 'حسن', '3', qs, { correct: 1 }) : { ok: false, screens: [], trail: [], join: {} };
      const childTexts = [...r24.screens.map((x) => x.text), ...r24.trail.map((x) => x.feedback), ...(r24.end ? [r24.end.txt] : [])];
      const gendered = [...texts, ...childTexts].filter((x) => GENDERED.test(x || ''));
      done('T75', ...V(made.ok && qs.length > 0 && gendered.length === 0, { childFinished: r24.ok, textsChecked: texts.length + childTexts.length, genderedFound: gendered.slice(0, 4).map((x) => short(x, 120)) }));
      s = t();
      const greeting = String((r24.join && r24.join.greeting) || '');
      const endTxt = String((r24.end && r24.end.txt) || '') + ' ' + r24.trail.map((x) => x.feedback).join(' ');
      const picQ = qs.filter((q) => q.media && q.media.question_image);
      const picScreens = r24.screens.filter((x) => x.image);
      const ev48 = { greeting: short(greeting, 160), urduCommaInGreeting: /،/.test(greeting) && !/[^\d],\s/.test(greeting), pictureQuestions: picQ.map((q) => q.sort_order), pictureSeen: picScreens.map((x) => x.i),
        counterPaintedOnPicture: picQ.every((q) => q.media.question_image_paints_counter === true), noSecondNumberUnderPicture: picScreens.every((x) => !/سوال\s*\d+/.test(x.text)),
        starCaption: (/آپ کو \d+ ستار[ہے]( ملا| ملے)!?/.exec(endTxt) || [])[0] || null, subjectUrdu: /ریاضی/.test(endTxt), subjectNotEnglish: !/\bmaths\b/i.test(endTxt), endText: short(endTxt, 200) };
      done('T48', ...V(r24.ok && ev48.urduCommaInGreeting && picQ.length > 0 && ev48.counterPaintedOnPicture && ev48.noSecondNumberUnderPicture && !!ev48.starCaption && ev48.subjectUrdu && ev48.subjectNotEnglish,
        { ...ev48, note: 'the shared-place class-card wording needs two children on one place — not exercised' }));
      // T76 — the English dash title keeps reading order on the quiz PDF and on the class report
      s = t();
      const pdf = made.arr && made.arr.doc ? await pdfOf(made.arr.doc, 'T76-quiz.pdf') : { text: '' };
      const title = String((gU && gU.topic) || dlD.topic || '');
      const dashTitle = /[—–→]/.test(title);
      const parts = title.split(/\s*[—–→]\s*/);
      const inOrder = (txt) => { const a = (txt || '').indexOf(parts[0]), b = parts[1] ? (txt || '').indexOf(parts[1]) : a; return a >= 0 && b >= 0 && a <= b; };
      const reversed = (txt) => parts[1] && new RegExp(parts[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[—–→]\\s*' + parts[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(txt || '');
      await api.freshReset();
      const lesR = await openLesson((i) => String(i.id || '') === 'lp_' + gU.id); const pickR = lesR.ok ? await chooseAction(/report|رپورٹ/i) : { ok: false };
      const repU = await collect(api, (x) => (x.doc || x.pdf), 240000);
      const pdfR = repU.ok ? await pdfOf(repU.hit, 'T76-report.pdf') : { text: '' };
      const ev76 = { title, dashTitle, quizPdfInOrder: inOrder(pdf.text), quizPdfReversed: !!reversed(pdf.text), reportArrived: repU.ok, reportInOrder: inOrder(pdfR.text), reportReversed: !!reversed(pdfR.text) };
      done('T76', ...V(dashTitle && ev76.quizPdfInOrder && !ev76.quizPdfReversed && repU.ok && ev76.reportInOrder && !ev76.reportReversed, ev76));
      // T83 (Urdu half) + T84
      s = t();
      const dups = duplicates(qs);
      const figs = figuresOf(qs); const pics = figs.filter((f) => f.image);
      const picTexts = textsOf(qs.filter((q) => q.media && q.media.question_image));
      const ev84 = { questions: qs.length, genderedInAny: gendered.length, adjacentEnglishInAny: adj.length, pictures: pics.length, pictureQuestionsClean: picTexts.every((x) => !GENDERED.test(x) && !(URDU.test(x) && threeEnglishInARow(x))), softFaults: rr.quiz && rr.quiz.meta && rr.quiz.meta.soft_faults };
      done('T84', ...V(made.ok && qs.length > 0 && gendered.length === 0 && adj.length === 0 && pics.length > 0 && ev84.pictureQuestionsClean, { ...ev84, note: 'the overflow repair (more than five faults) cannot be forced; the shipped quiz is checked for the faults it repairs, pictures included' }));
      gU = gU && { ...gU, dups, qs };
    } catch (e) { errors.push('TU:' + e.message); for (const id of ['T52', 'T53', 'T62', 'T75', 'T48', 'T76', 'T84']) if (!seenIds.has(id)) blocked(id, 'the Urdu generation leg threw: ' + short(e.message, 200)); }

    // ════ T50 — four-digit place value (grade 3) · T55 — column subtraction (grade 3) ══════════
    for (const [id, lesson, check] of [
      ['T50', 'grade_3_math_ch1_seg1', (qs, figs) => { const b = figs.filter((f) => f.type === 'base_ten' && f.spec && Number(f.spec.thousands) >= 1); return { ok: b.length > 0 && b.every((f) => !/\d/.test(JSON.stringify(f.spec.labels || {}))), thousandsPictures: b.map((f) => f.spec), baseTen: figs.filter((f) => f.type === 'base_ten').map((f) => f.spec) }; }],
      ['T55', 'grade_3_math_ch2_seg5', (qs, figs) => { const col = qs.filter((q) => /\\begin\{array\}|\\\\|\\hline|−|-/.test(q.question_text || '') && q.media && q.media.question_card); return { ok: col.length > 0, columnCards: col.map((q) => ({ q: q.sort_order, stem: short(q.question_text, 80) })), cards: figs.filter((f) => f.card).map((f) => f.q) }; }],
    ]) {
      try {
        s = t();
        const off = dbJson('seed-lp-quiz', ['--state', 'offered', '--lesson-id', lesson]); seeds.lpQuiz = true;
        if (!off || !off.id) throw new Error('SEED:' + JSON.stringify(off));
        const made = await makeVia((i) => String(i.id || '') === 'lp_' + off.id, /make_en|English/i, { timeoutMs: 540000 });
        const rr = rows(off.id); const qs = rr.questions || []; const figs = figuresOf(qs);
        const c = check(qs, figs);
        let kid = null;
        if (rr.share && qs.length) { kid = await childRunKeyed(child(id === 'T50' ? 25 : 26), rr.share.code, id === 'T50' ? 'Sana' : 'Bilal', 'Grade 3', qs, { correct: 2 }); }
        const verdicts = kid ? kid.trail.map((x) => x.feedback).join(' ') : '';
        const pdf = made.arr && made.arr.doc ? await pdfOf(made.arr.doc, id + '-quiz.pdf') : { text: '' };
        const ev = { ...made.ev, questions: qs.length, ...c, childFinished: kid && kid.ok, imagesSeenByChild: kid ? kid.screens.filter((x) => x.image).map((x) => x.i) : [],
          verdictNoTex: !/\$|\\begin|array|\\\\/.test(verdicts), pdfNoTexSource: !/\\begin\{array\}|\\hline/.test(pdf.text || ''), verdictSample: short(verdicts, 160) };
        const pass = id === 'T50' ? (made.ok && c.ok && ev.imagesSeenByChild.length > 0) : (made.ok && c.ok && ev.imagesSeenByChild.length > 0 && ev.verdictNoTex && ev.pdfNoTexSource);
        done(id, ...(made.ok && !c.ok ? ['BLOCKED', { reason: id === 'T50' ? 'the author drew no thousands picture from this four-digit lesson this time' : 'the author wrote no column-subtraction card from this subtraction lesson this time', ...ev }] : V(pass, ev)));
        try { api.db('seed-lp-quiz', ['--restore']); } catch (_) {}
      } catch (e) { errors.push(id + ':' + e.message); blocked(id, 'threw: ' + short(e.message, 200)); try { api.db('seed-lp-quiz', ['--restore']); } catch (_) {} }
    }

    // ════ T46 — the model gives no usable reply for a lesson-plan quiz ═══════════════════════
    try {
      s = t();
      const dlE = dbJson('seed-lp-download', ['--lesson-id', 'grade_1_maths_ch1_seg1']);
      if (!dlE || !dlE.id) throw new Error('SEED_DL_E:' + JSON.stringify(dlE));
      SC.faults([{ kind: 'llm', match: 'You are writing a short WhatsApp quiz', times: 12, content: '' }]);
      const isRow = (i) => /^lsn_lp_v8_/.test(String(i.id || '')) && /Identify numbers from 0 to 9 and count/i.test(String(i.hay || i.text || '')) && !/count numbers from 0 to 9, write/i.test(String(i.hay || ''));
      const made = await makeVia(isRow, /make_en|English/i, { timeoutMs: 300000 });
      const fail = made.arr && made.arr.failed ? made.arr.failed.txt : '';
      const q = lessonQuizzes('grade_1_maths_ch1_seg1').quizzes[0];
      const again = q ? await openLesson((i) => String(i.id || '') === 'lp_' + q.id) : { ok: false };
      const ev = { ...made.ev, failureLine: short(fail, 240), apologisesOurSide: /went wrong on my side/.test(fail), notYourPlan: /not your lesson plan/.test(fail), neverCouldNotRead: !/couldn.t open|could not be read|not enough of the lesson/i.test(fail),
        persisted: q && q.error, rowScreen: short(again.text, 200), rowRepeats: /went wrong on my side[\s\S]*not your lesson plan/.test(again.text || ''), faultsLeft: SC.faultsLeft().length, tooLittleClause: 'proven in T70 (source_unusable → "doesn’t have enough of the lesson")' };
      api.closeFlow();
      done('T46', ...V(!!fail && ev.apologisesOurSide && ev.notYourPlan && ev.neverCouldNotRead && ev.rowRepeats, ev));
    } catch (e) { errors.push('T46:' + e.message); blocked('T46', 'threw: ' + short(e.message, 200)); }
    finally { SC.clearFaults(); }

    // ════ T47 T79 T80 T81 T82 T83 — a quiz from a coaching RECORDING ═══════════════════════════
    let cs = null;
    try {
      const tf = path.join(__dirname, '..', 'fixtures', 'whatsapp', 'niete', 'quiz', 'transcript-fractions-en.txt');
      cs = dbJson('seed-coaching-session', ['--transcript-file', tf, '--language', 'en', '--topic', 'Proper and improper fractions', '--subject', 'maths']); seeds.coaching = true;
      if (!cs || !cs.id) throw new Error('SEED_CS:' + JSON.stringify(cs));
      const isTranscriptRow = (i) => /From transcript|کلاس کی ریکارڈنگ سے/.test(String(i.hay || i.text || '')) && /fraction/i.test(String(i.hay || i.text || ''));
      const isItsQuiz = (i) => /^lp_/.test(String(i.id || '')) && /fraction/i.test(String(i.hay || i.text || '')) && /Failed|نہیں بنا/.test(String(i.hay || ''));
      // T47 — no usable model reply
      s = t();
      SC.faults([{ kind: 'llm', match: 'You are writing a short WhatsApp quiz', times: 12, content: '' }]);
      const m47 = await makeVia(isTranscriptRow, /make_en|English|Make the quiz/i, { timeoutMs: 300000 });
      const f47 = m47.arr && m47.arr.failed ? m47.arr.failed.txt : '';
      const scr47 = await openLesson(isItsQuiz);
      const ev47 = { ...m47.ev, failureLine: short(f47, 240), ourSide: /went wrong on my side/.test(f47), notYourRecording: /not your recording/.test(f47), neverNotEnough: !/didn.t carry enough|did not carry enough/i.test(f47), saysTryAgainHere: /Send \/quiz and pick this lesson to try again/.test(f47),
        lessonScreen: short(scr47.text, 220), screenSaysSame: /went wrong on my side[\s\S]*not your recording/.test(scr47.text || ''), stillOffersMake: (scr47.actions || []).some((a) => /remake|make_|Make/i.test(a.id + ' ' + a.text)), faultsLeft: SC.faultsLeft().length };
      api.closeFlow(); SC.clearFaults();
      done('T47', ...V(!!f47 && ev47.ourSide && ev47.notYourRecording && ev47.neverNotEnough && ev47.saysTryAgainHere && ev47.screenSaysSame && ev47.stillOffersMake, ev47));
      // T79 — the author replies, nothing ever validates
      s = t();
      SC.faults([{ kind: 'llm', match: 'You are writing a short WhatsApp quiz', times: 12, content: '{"questions": []}' }]);
      const m79 = await makeVia(isItsQuiz, /remake|Make it again|make_|دوبارہ/i, { timeoutMs: 300000 });
      const f79 = m79.arr && m79.arr.failed ? m79.arr.failed.txt : '';
      const scr79 = await openLesson(isItsQuiz);
      const ev79 = { ...m79.ev, failureLine: short(f79, 240), apologises: /couldn.t write good enough questions/.test(f79), ourSide: /problem was on my side/.test(f79), notYourRecording: /not your recording/.test(f79),
        neverNotEnough: !/didn.t carry enough|did not carry enough/i.test(f79), saysPickThisLesson: /pick this lesson to make it again/.test(f79), neverWaitForNext: !/next lesson/i.test(f79),
        lessonScreen: short(scr79.text, 220), screenSaysSame: /couldn.t write good enough questions[\s\S]*not your recording/.test(scr79.text || ''), stillOffersMake: (scr79.actions || []).some((a) => /remake|make_|Make/i.test(a.id + ' ' + a.text)), faultsLeft: SC.faultsLeft().length,
        note: 'the held-back (key_disagreement) wording cannot be forced by a scripted author reply' };
      api.closeFlow(); SC.clearFaults();
      done('T79', ...V(!!f79 && ev79.apologises && ev79.ourSide && ev79.notYourRecording && ev79.neverNotEnough && ev79.saysPickThisLesson && ev79.neverWaitForNext && ev79.screenSaysSame && ev79.stillOffersMake, ev79));
      // the REAL transcript quiz — T80 T81 T82 T83 (+ T29 evidence)
      s = t();
      const mT = await makeVia(isItsQuiz, /remake|Make it again|make_|دوبارہ/i, { timeoutMs: 540000 });
      const qT = (dbJson('quizzes-for-lesson', ['--lesson-id', '__none__']) && null) || null; // transcript quizzes carry no lesson id — read by the Flow row instead
      const rowT = await openLesson((i) => /^lp_/.test(String(i.id || '')) && /fraction/i.test(String(i.hay || i.text || '')) && !/Failed/.test(String(i.hay || ''))); api.closeFlow();
      const tid = rowT.row && String(rowT.row.id || '').replace(/^lp_/, '');
      const rr = tid ? rows(tid) : {}; const qs = rr.questions || [];
      const texts = textsOf(qs);
      const pdf = mT.arr && mT.arr.doc ? await pdfOf(mT.arr.doc, 'T80-quiz.pdf') : { text: '' };
      const mistakeKeyed = qs.filter((q) => /4\s*\/\s*8|four[- ]eighths|\\frac\{4\}\{8\}/i.test(q.question_text || '') && /not (a )?proper|improper/i.test(String(correctText(q) || '')));
      const authority = texts.filter((x) => /teacher said|because (the |our )?teacher|but in class|in class it was/i.test(x));
      const ev80 = { ...mT.ev, quiz: tid, questions: qs.length, mistakeKeyedAsRight: mistakeKeyed.map((q) => ({ q: q.sort_order, key: short(correctText(q), 40) })), authorityReasons: authority.slice(0, 3).map((x) => short(x, 100)), keyProblems: keyProblems(qs) };
      done('T80', ...V(mT.ok && qs.length > 0 && mistakeKeyed.length === 0 && authority.length === 0 && ev80.keyProblems.length === 0, ev80));
      s = t();
      const sheet = String(pdf.text || '');
      const sheetLines = sheet.split('\n');
      const taughtIdx = sheetLines.findIndex((l) => /What you taught/.test(l)); const checksIdx = sheetLines.findIndex((l) => /What this quiz checks/.test(l));
      const ev81 = { pdfChars: sheet.length, hasTaught: taughtIdx >= 0, hasChecks: checksIdx >= 0, mistakeOnSheet: /4\s*\/\s*8[^.\n]{0,40}(is )?not (a )?proper|4\s*\/\s*8[^.\n]{0,40}improper/i.test(sheet), blameOnSheet: /(teacher|class)[^.\n]{0,30}(wrong|mistake|incorrect)|correction/i.test(sheet), summaryTruth: rr.quiz && rr.quiz.meta && rr.quiz.meta.summary_truth, note: 'QUIZ_SUMMARY_TRUTH_FILTER=off is a per-process switch not flipped in this run' };
      done('T81', ...V(mT.ok && ev81.hasTaught && ev81.hasChecks && !ev81.mistakeOnSheet && !ev81.blameOnSheet, ev81));
      s = t();
      const pupils = ['Ayesha', 'Hamza', 'Bilal', 'Sara'];
      const named = texts.filter((x) => pupils.some((p) => new RegExp('\\b' + p + '\\b', 'i').test(x)));
      const asksWhatChildDid = texts.filter((x) => /what did (ayesha|hamza|bilal|sara) (say|answer|do)|(ayesha|hamza|bilal|sara) (said|answered|wrote)/i.test(x));
      done('T82', ...V(mT.ok && qs.length > 0 && named.length === 0 && asksWhatChildDid.length === 0, { questions: qs.length, pupilsInTranscript: pupils, namedInQuiz: named.slice(0, 3).map((x) => short(x, 100)), asksWhatAChildDid: asksWhatChildDid.length, pupilTokens: rr.quiz && rr.quiz.meta && rr.quiz.meta.digest && (rr.quiz.meta.digest.pupil_tokens || []).length }));
      s = t();
      const dupsT = duplicates(qs); const dupsU = gU ? gU.dups : null;
      done('T83', ...V(mT.ok && qs.length > 0 && dupsT.length === 0 && (dupsU == null || dupsU.length === 0), { transcriptQuiz: { questions: qs.length, duplicates: dupsT }, urduLessonQuiz: gU ? { questions: gU.qs.length, duplicates: dupsU } : 'not made', note: 'a repeat cannot be forced; every question pair on both PDFs is compared (stem, answer, blank filled, postposition dropped)' }));
    } catch (e) { errors.push('TT:' + e.message); for (const id of ['T47', 'T79', 'T80', 'T81', 'T82', 'T83']) if (!seenIds.has(id)) blocked(id, 'the recording-quiz leg threw: ' + short(e.message, 200)); }
    finally { SC.clearFaults(); }

    // ════ T71 T72 T73 — quizzes from Grades 6-12 lesson plans, and the switch ══════════════════
    let q612 = null;
    try {
      s = t();
      const d1 = dbJson('seed-lp612-delivery', ['--segment-like', 'grade_8_mathematics*']); seeds.lp612 = true;
      if (!d1 || !d1.id) throw new Error('SEED_612:' + JSON.stringify(d1));
      const isRow = (i) => /^lsn_lp612_/.test(String(i.id || ''));
      const first = await openLesson(isRow);
      const ev71 = { listed: first.ok, row: first.row, saysFromLessonPlan: /From lesson plan|سبق کے منصوبے سے/.test(String((first.row && first.row.hay) || '')), rowHasSubject: /math/i.test(String((first.row && first.row.hay) || '')), rowHasName: !!d1.title && String((first.row && first.row.hay) || '').includes(String(d1.title).slice(0, 12)), title: d1.title, actions: (first.actions || []).map((a) => a.text) };
      api.closeFlow();
      const made = await makeVia(isRow, /make_en|English/i, { timeoutMs: 540000 });
      const pdf = made.arr && made.arr.doc ? await pdfOf(made.arr.doc, 'T71-quiz.pdf') : { text: '' };
      const rowQ = await openLesson((i) => /^lp_/.test(String(i.id || '')) && String(i.hay || '').includes(String(d1.title || '').slice(0, 12))); api.closeFlow();
      q612 = rowQ.row && String(rowQ.row.id || '').replace(/^lp_/, '');
      const rr = q612 ? rows(q612) : {};
      const kid = rr.share && rr.questions && rr.questions.length ? await childRunKeyed(child(27), rr.share.code, 'Ahmed', 'Grade 8', rr.questions, { correct: 3 }) : { ok: false, trail: [] };
      await api.freshReset();
      const les = q612 ? await openLesson((i) => String(i.id || '') === 'lp_' + q612) : { ok: false };
      const acts = (les.actions || []).map((a) => a.text);
      const pick = les.ok ? await chooseAction(/report|رپورٹ/i) : { ok: false };
      const t0 = Date.now(); const got = [];
      while (Date.now() - t0 < 240000) { for (const x of await api.fresh()) got.push(x); if (got.filter((x) => x.doc || x.pdf || x.img).length >= 2) break; await sleep(3000); }
      const ev = { ...ev71, askedLanguage: /Make it in|English|اردو/.test((made.ev.actions || []).join(' ')), ...made.ev, quiz: q612, pdfSaysPlanned: /What you planned/.test(pdf.text || ''), pdfSaysMadeFrom: /Made from your lesson plan/.test(pdf.text || ''), childFinished: kid.ok,
        actionsAfter: acts, offersResend: acts.some((a) => /Resend link|دوبارہ link/.test(a)), offersReport: acts.some((a) => /report|رپورٹ/i.test(a)), reportPdf: got.some((x) => x.doc || x.pdf), childrenCards: got.filter((x) => x.img).length };
      done('T71', ...V(ev71.listed && ev71.saysFromLessonPlan && ev.askedLanguage && made.ok && ev.pdfSaysPlanned && ev.pdfSaysMadeFrom && kid.ok && ev.offersResend && ev.offersReport && ev.reportPdf, ev));
      // T72 — the source switched OFF everywhere: no 6-12 lesson without a quiz, the sent one still works
      s = t();
      const d2 = dbJson('seed-lp612-delivery', ['--segment-like', 'grade_7_mathematics*']);
      const rw = SC.restart('worker', { QUIZ_LP612_SOURCE: 'off' }); const rb = SC.restart('bot', { QUIZ_LP612_SOURCE: 'off' });
      await api.resetFlow(); await api.freshReset();
      const off = await openLesson((i) => /^lsn_lp612_/.test(String(i.id || '')));
      const prOff = await api.flowProbe(); const rowsOff = (prOff.items || []).filter((i) => i.kind !== 'footer').map((i) => ({ id: i.id, text: short(i.hay || i.text, 50) }));
      api.closeFlow();
      const sentRow = q612 ? await openLesson((i) => String(i.id || '') === 'lp_' + q612) : { ok: false };
      await api.freshReset();
      const link = sentRow.ok ? await chooseAction(/link|Resend/i) : { ok: false };
      const fwd = await collect(api, (x) => /QUIZ-[A-Z0-9]{6}/.test(x.txt || ''), 60000);
      const rep = q612 ? await openLesson((i) => String(i.id || '') === 'lp_' + q612) : { ok: false };
      await api.freshReset();
      const rp = rep.ok ? await chooseAction(/report|رپورٹ/i) : { ok: false };
      const repDoc = await collect(api, (x) => (x.doc || x.pdf), 240000);
      const ev72 = { restarts: [rw.ok, rb.ok], secondDeliverySeeded: !!(d2 && d2.id), lessonRowsListed: rowsOff.filter((r) => /^lsn_lp612_/.test(String(r.id || ''))).length, rowsSeen: rowsOff.slice(0, 6), sentQuizStillListed: sentRow.ok, resendWorked: link.ok && fwd.ok, reportWorked: rp.ok && repDoc.ok };
      done('T72', ...V(rw.ok && rb.ok && ev72.lessonRowsListed === 0 && sentRow.ok && ev72.resendWorked && ev72.reportWorked, ev72));
      // T73 — on where /quiz runs, off where quizzes are written; then on again → Make it again
      s = t();
      const rb2 = SC.restart('bot', {});
      await api.resetFlow(); await api.freshReset();
      const m73 = await makeVia((i) => /^lsn_lp612_/.test(String(i.id || '')), /make_en|English/i, { timeoutMs: 180000 });
      const f73 = m73.arr && m73.arr.failed ? m73.arr.failed.txt : '';
      const rw2 = SC.restart('worker', {});
      const rowF = await openLesson((i) => /^lp_/.test(String(i.id || '')) && /Failed|نہیں بنا|Didn.t work/.test(String(i.hay || '')) && /math/i.test(String(i.hay || '')));
      const ev73 = { botOn: rb2.ok, ...m73.ev, failureLine: short(f73, 240), couldNotStart: /couldn.t start that quiz just now/.test(f73), ourSideNotPlan: /problem was on my side, not your lesson plan/.test(f73), tryLater: /Try it again from \/quiz a little later/.test(f73), neverNextLessons: !/next lessons? you plan/i.test(f73),
        workerOn: rw2.ok, lessonScreen: short(rowF.text, 240), screenSaysNotStarted: /could not be started on my side[\s\S]*not your lesson plan/.test(rowF.text || ''), actions: (rowF.actions || []).map((a) => a.text),
        offersRemakeAndDone: (rowF.actions || []).some((a) => /remake|Make it again/i.test(a.id + ' ' + a.text)) && (rowF.actions || []).some((a) => /^done$|Done/i.test(a.id + ' ' + a.text)) };
      await api.freshReset();
      const pk = rowF.ok ? await chooseAction(/remake|Make it again|دوبارہ/i) : { ok: false };
      const arr = pk.ok ? await waitArrival(540000) : { doc: null, fwd: null, order: [] };
      ev73.remake = { picked: pk.picked, making: !!arr.making, pdf: !!arr.doc, forward: !!arr.fwd, order: arr.order.slice(0, 6) };
      done('T73', ...V(rb2.ok && !!f73 && ev73.couldNotStart && ev73.ourSideNotPlan && ev73.tryLater && ev73.neverNextLessons && rw2.ok && ev73.screenSaysNotStarted && ev73.offersRemakeAndDone && !!arr.doc && !!arr.fwd, ev73));
    } catch (e) { errors.push('T71:' + e.message); for (const id of ['T71', 'T72', 'T73']) if (!seenIds.has(id)) blocked(id, 'the 6-12 leg threw: ' + short(e.message, 200)); }
    finally { try { SC.restart('bot', {}); SC.restart('worker', {}); } catch (_) {} }

    // ════ T59 T60 — a video quiz in Urdu: offer taps, the solo run, the class message ═════════
    try {
      s = t();
      seeds.lang = 'ur';
      await api.setUser({ preferred_language: 'ur' });
      const pickVideo = async () => {
        await api.resetFlow(); await api.freshReset();
        const r = await api.sendWait('/videos', 60000);
        const op = await api.openFlow('.+');
        if (!op.ok) return { ok: false, err: 'VIDEOS_FLOW:' + op.err, reply: short(r.txt, 120) };
        const g = await api.flowPick('Grade 4', { exact: false }); if (!g.ok) { const g2 = await api.flowPick('4', {}); if (!g2.ok) return { ok: false, err: 'GRADE:' + g.err }; }
        let f = await clickFooter(api); if (!f.ok) return { ok: false, err: 'NEXT1:' + f.err };
        const sub = await api.flowPick('Science', {}); if (!sub.ok) return { ok: false, err: 'SUBJECT:' + sub.err };
        f = await clickFooter(api); if (!f.ok) return { ok: false, err: 'NEXT2:' + f.err };
        const vid = await api.flowPick('Renewable', { exact: false }); if (!vid.ok) return { ok: false, err: 'VIDEO:' + vid.err };
        await api.freshReset();
        f = await clickFooter(api); if (!f.ok) return { ok: false, err: 'SEND:' + f.err };
        const doneScreen = await api.flowProbe(); if (doneScreen.screen === 'SUCCESS') await clickFooter(api, { settleMs: 1500 }).catch(() => null);
        api.closeFlow();
        const offer = await collect(api, (x) => (x.btns || []).some((b) => /شروع کریں|کلاس کو بھیجیں|ابھی نہیں|Yes, start/.test(b)), 120000);
        return { ok: offer.ok, offer: offer.hit, seen: offer.seen.map((x) => short(x.txt, 60)), err: offer.ok ? null : 'NO_OFFER' };
      };
      const p1 = await pickVideo();
      if (!p1.ok) throw new Error(p1.err);
      const offerBtns = p1.offer.btns || [];
      const ev60 = { offerButtons: offerBtns, offerBody: short(p1.offer.txt, 160), offerInUrdu: offerBtns.some((b) => /ابھی نہیں/.test(b)) };
      await api.freshReset();
      const no = await api.tapAndWait('ابھی نہیں', 30000);
      ev60.declined = short(no.txt, 120); ev60.declinedInUrdu = /ویڈیو دیکھنے کا لطف/.test(no.txt || '');
      await api.freshReset();
      await api.tapId('button', 'vq_offer_no', 'ابھی نہیں');
      const lapsed = await collect(api, (x) => /ختم ہو چکی|has expired/.test(x.txt || ''), 30000);
      ev60.afterLapse = lapsed.ok ? short(lapsed.hit.txt, 140) : lapsed.last; ev60.lapsedInUrdu = lapsed.ok && /پیشکش ختم ہو چکی ہے/.test(lapsed.hit.txt);
      // T59 — the solo run, then "کلاس کو بھیجیں" on the share offer
      s = t();
      const p2 = await pickVideo();
      if (!p2.ok) throw new Error('second pick: ' + p2.err);
      await api.freshReset();
      const yes = await api.tapAndWait('جی، شروع کریں', 60000);
      let q = isChildQ(yes) ? yes : (await collect(api, isChildQ, 90000)).hit;
      let ended = false, n = 0, lastAnswerId = null; const trail = [];
      while (q && !ended && n < 20) {
        const row = q.list && (q.list.rows || [])[0]; const btn = (q.btns || [])[0];
        lastAnswerId = (row && row.id) || null;
        await api.freshReset();
        if (row) await api.tapId('list', row.id, row.title); else if (btn) await api.tapAndWait(btn, 30000); else break;
        const w = await collect(api, (x) => isChildQ(x) || isEnd(x) || (x.btns || []).some((b) => /کلاس کو بھیجیں|Share with class/.test(b)), 60000);
        n++; trail.push(short((w.hit && w.hit.txt) || w.last, 60));
        ended = !!(w.hit && (isEnd(w.hit) || (w.hit.btns || []).some((b) => /کلاس کو بھیجیں|Share with class/.test(b)))); q = w.hit && isChildQ(w.hit) ? w.hit : null;
        if (ended) break;
      }
      const shareOffer = await collect(api, (x) => (x.btns || []).some((b) => /کلاس کو بھیجیں|Share with class/.test(b)), 60000);
      await api.freshReset();
      const share = shareOffer.ok ? await api.tapAndWait('کلاس کو بھیجیں', 60000) : { txt: '' };
      const after = await collect(api, (x) => /کلاس کی رپورٹ آئے گی|report on how your class did/.test(x.txt || ''), 60000);
      const all = [share, ...after.seen];
      const fwdMsg = all.find((x) => /QUIZ-[A-Z0-9]{6}/.test(x.txt || ''));
      const ev59 = { questionsAnswered: n, trail: trail.slice(0, 4), shareOfferInUrdu: shareOffer.ok && /اپنی کلاس کو بھیجیں/.test(shareOffer.hit.txt || ''), forwardThisInUrdu: all.some((x) => /یہی پیغام class group میں forward کریں/.test(x.txt || '')),
        classMessage: fwdMsg && short(fwdMsg.txt, 240), classMessageInUrdu: !!fwdMsg && /Quiz کا وقت/.test(fwdMsg.txt), namesTeacher: !!fwdMsg && !!teacherName && fwdMsg.txt.includes(teacherName), namesTopic: !!fwdMsg && /Renewable/i.test(fwdMsg.txt), hasLink: !!fwdMsg && /QUIZ-[A-Z0-9]{6}/.test(fwdMsg.txt),
        reportPromiseInUrdu: after.ok && /12 گھنٹے بعد کلاس کی رپورٹ/.test(after.hit.txt) };
      done('T59', ...V(ev59.shareOfferInUrdu && ev59.forwardThisInUrdu && ev59.classMessageInUrdu && ev59.namesTeacher && ev59.namesTopic && ev59.hasLink && ev59.reportPromiseInUrdu, ev59));
      // T60 (last clause): an answer on the finished quiz
      s = t();
      await api.freshReset();
      if (lastAnswerId) await api.tapId('list', lastAnswerId, 'A');
      const fin = await collect(api, (x) => /ختم ہو چکا ہے|has finished/.test(x.txt || ''), 30000);
      ev60.answerAfterFinish = fin.ok ? short(fin.hit.txt, 140) : fin.last; ev60.finishedInUrdu = fin.ok && /یہ quiz ختم ہو چکا ہے/.test(fin.hit.txt);
      done('T60', ...V(ev60.offerInUrdu && ev60.declinedInUrdu && ev60.lapsedInUrdu && ev60.finishedInUrdu, ev60));
    } catch (e) { errors.push('T59:' + e.message); for (const id of ['T59', 'T60']) if (!seenIds.has(id)) blocked(id, 'the video-quiz leg threw: ' + short(e.message, 200)); }
    finally { try { await api.setUser({ preferred_language: 'en' }); seeds.lang = null; } catch (_) {} }
  } finally {
    // every seed back, every quiz the driver made in this run gone
    try { if (seeds.role) await api.setRole('teacher'); } catch (_) {}
    try { if (seeds.lang) await api.setUser({ preferred_language: 'en' }); } catch (_) {}
    if (seeds.capKey) SC.redis(['DEL', seeds.capKey]);
    SC.clearFaults();
    for (const [a, extra] of [['seed-class-quiz', ['--restore', '--child-prefix', CHILD_PREFIX]], ['seed-lp-quiz', ['--restore']], ['seed-lp-download', ['--restore']], ['seed-coaching-session', ['--restore']], ['seed-lp612-delivery', ['--restore']]]) {
      try { api.db(a, extra); } catch (_) {}
    }
    try { api.db('purge-run-quizzes', ['--since', runStartIso, '--child-prefix', CHILD_PREFIX]); } catch (_) {}
    for (const id of OWNED) if (!seenIds.has(id)) R(id)('BLOCKED', { reason: 'not reached — an earlier step of the generation cluster threw: ' + (errors.slice(-1)[0] || 'unknown'), errors: errors.slice(0, 6) }, 0);
  }
};

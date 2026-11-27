// @mock-lane — mock-capable driver (uses the mock API, not the browser DOM). Its presence enrols this feature in the mock lane; E2E_MOCK_FEATURES is derived from this marker, so there is no hardcoded list.
/* lesson-plan.feature — @e2e scenarios in one process. */
// Fixtures live in the tracked fixtures tree, NOT a results dir: results are untracked (this PR
// gitignores them) and 2026-08-26-all is EMPTY on a fresh checkout — every upload then fails with
// NO_SEND_BUTTON and aborts the feature (L05/L06/L07/L09 unrecorded, 2026-09-02, twice).
const FIX = require('path').resolve(__dirname, '..', '..', 'fixtures', 'whatsapp', 'niete', 'media');
const { withRedirect, isStoreNotice, REDIRECT_BLOCKED } = require('../app-redirect-case.cjs');
const V = (c, ev) => [c ? 'PASS' : 'FAIL', ev];
// If the Flow never opened we learned nothing about the product — BLOCKED, not FAIL.
// (2026-08-31: a 523s FLOW_READY_TIMEOUT was being reported as two product failures.)
const VF = (op, c, ev) => op.ok ? V(c, ev) : ['BLOCKED', { harness: op.err, clicked: op.clicked, waitedMs: op.waitedMs }];
// Staging renders the LP *chat card* in Urdu; only the Flow interior is English.
// Captured live 2026-08-31: header "سبق کے منصوبے", CTA "جماعت چنیں".
const CARD = /سبق کے منصوبے|Lesson Plans/;
const CTA  = 'جماعت چنیں|Pick Class|شروع کریں|Start';

exports.run = async ({ api, rec, sleep, want = () => true }) => {
  const t = () => Date.now();
  let s, r;
  // The first open after a burst of keyword cards times out, while the same open
  // succeeds in ~3s straight after a reset. Retry once through a reset rather than
  // blocking the scenario on an ordering artifact. (2026-08-31.)
  const openLP = async (trigger = '/lp') => {
    let op = await api.openFlow(CTA);
    if (!op.ok) {
      await api.resetFlow();
      await api.sendWait(trigger);
      op = await api.openFlow(CTA);
      op.retried = true;
    }
    return op;
  };
  await api.resetFlow();
  // Stop anything in flight first. menu.cjs M03 leaves coaching AWAITING_CLASSROOM_AUDIO (6h TTL)
  // and that state answers every free text with the "send your classroom audio" nudge — entering
  // Ask Anything does not clear it (L04 on the 2026-09-02 05:26 full run). The /status Flow's
  // "Stop" path is the product's own exit, so use it rather than a DB write.
  await require('./reset-state.cjs').run({ api, rec: () => {}, sleep });

  if (want('L02')) {
    // L02 — every recognised keyword opens the Flow card
    s = t();
    await api.sendWait('/menu');   // settle the transcript before the first measured keyword
    const kws = ['lp', 'lesson plan', 'lesson-plan', '/lp', 'لیسن پلان'];
    const hits = [];
    for (const k of kws) {
      // Five Flow sends inside ~40s tripped Meta #131056 "(Business Account, Consumer Account) pair rate
      // limit hit" on 2026-09-02 and the 5th card never arrived. Pace the burst — on the chrome lane only:
      // the mock Graph API has no pair limit and the bot's pacer is off there (bd-aqi0ay).
      if (hits.length && api.caps.method !== 'mock') await sleep(15000);
      const x = await api.sendWait(k);
      hits.push({ k, card: CARD.test(x.txt) && x.btns.length > 0, wait: x.waitedMs });
    }
    rec('L02', 'A recognised keyword opens the Lesson Plans Flow',
        ...V(hits.every(h => h.card), { hits }), t() - s);
  }

  if (want('L08')) {
    // L08 — "/lesson plan" (slash + space) IS a keyword, and opens the card.
    //
    // INVERTED 2026-09-14 (bd-mww73). This asserted the opposite — that the slash form was not
    // recognised — and had been failing for that reason, not because of a defect. The matcher was
    // right: `BARE` in bot/shared/utils/lp-intent.js opens with `^\/?\s*`, deliberately, and its
    // comment records that 111 of the 153 production bare commands were literally "/lesson plan".
    // Operator settled it the same day: slash plus space should open the card. The matcher was
    // unchanged; this scenario and the CI-gated case list in
    // tests/handlers/text-message-lp-keyword.test.js are what moved.
    //
    // Kept as its own scenario rather than folded into L02's keyword list: the slash form is the
    // one teachers actually type, and it earns a line of its own in the ledger. The pace sleep is
    // L02's — this is now a SIXTH Flow send in the same burst, and five inside ~40s already tripped
    // Meta #131056 once (2026-09-02).
    if (want('L02') && api.caps.method !== 'mock') await sleep(15000);
    s = t();
    r = await api.sendWait('/lesson plan');
    rec('L08', '"/lesson plan" opens the Lesson Plans Flow',
        ...V(CARD.test(r.txt) && r.btns.length > 0,
             { reply: (r.txt || '').slice(0, 100), btns: r.btns.length }), t() - s);
  }

  if (want('L04')) {
    // L04 — a natural-language request must NOT generate a freeform plan
    // Free text is swallowed by awaiting_menu_selection (left by the /menu above and by every
    // keyword card) and by coaching AWAITING_CLASSROOM_AUDIO: the reply is then the "(1-4)" or
    // "send your classroom audio" nudge, and "not a freeform plan" passes for the wrong reason
    // (2026-09-02, passes 1/4/5/7). Enter Ask Anything first so the request reaches the handler,
    // and refuse to score a nudge as a fallback.
    s = t();
    await api.sendWait('/menu');
    await api.openList('See what I do');
    await api.pickRowAndWait('Ask Anything');
    api.resetConversation();   // clean history → the open-chat prompt is deterministic → cassette replays
    r = await api.sendWait('make me a lesson plan for grade 4 science on the water cycle', 120000);
    const freeform = /objectives?:|5[- ]step|starter|plenary/i.test(r.txt || '') && (r.txt || '').length > 400;
    const nudge = /\(1-4\)|کلاس روم آڈیو|classroom recording audio/i.test(r.txt || '');
    rec('L04', 'A natural-language request returns the curriculum fallback, not a generated plan',
        ...V(r.ok && !freeform && !nudge,
             { generatedFreeform: freeform, stateNudge: nudge, len: (r.txt || '').length,
               reply: (r.txt || '').slice(0, 140) }), t() - s);
  }

  // Wait on the fresh-inbound reader both drivers expose (freshReset/fresh) — the page-eval loops this
  // replaces read the WhatsApp Web DOM, which the mock lane does not have (MOCK_NO_PAGE).
  const waitFresh = async (pred, timeoutMs, stepMs = 1500) => {
    const t0 = Date.now(); const seen = [];
    while (Date.now() - t0 < timeoutMs) {
      for (const r of await api.fresh()) seen.push(r);
      const hit = seen.find(pred);
      if (hit) return { ok: true, waitedMs: Date.now() - t0, hit, seen };
      await new Promise((r) => setTimeout(r, stepMs));
    }
    return { ok: false, waitedMs: Date.now() - t0, last: (seen[seen.length - 1] || {}).txt || '' };
  };

  if (want('L01', 'L10')) {
    // L01 + L10 — open the Pick-Class Flow and complete it for Grade 1 English Ch1 Day 1
    s = t();
    await api.freshReset();
    await api.sendWait('/lp');
    const op = await openLP();
    const first = op.ok ? await api.flowProbe() : { text: '' };
    // L10 — the Flow chrome is an English floor even on an Urdu account
    rec('L10', 'The Pick Class Flow renders in English for an Urdu-preference teacher',
        ...VF(op, /Lesson Plans/i.test(first.text) && /Grade 1/i.test(first.text) && !/[؀-ۿ]/.test(first.text),
              { screen: first.text.slice(0, 120) }), t() - s);

    s = t();
    let delivered = null;
    if (op.ok) {
      for (const pick of ['Grade 1', 'English', 'Ch 1', 'Day 1']) {
        const c1 = await api.flowClick(pick, { settleMs: 3000 });
        if (!c1.ok) { delivered = { err: 'pick failed at ' + pick, detail: c1 }; break; }
      }
      api.closeFlow();
      if (!delivered) {
        // the Flow hands back to chat; the PDF arrives as a document message
        const w = await waitFresh((x) => x.pdf || x.doc, 120000);
        delivered = w.ok
          ? { ok: true, waitedMs: w.waitedMs, pdf: (w.hit.txt || '').slice(0, 120),
              ack: w.seen.some((x) => /(سبق کا منصوبہ|Sending your lesson plan)/i.test(x.txt || '')) }
          : w;
      }
    }
    rec('L01', 'Completing the Pick Class Flow delivers the lesson-plan PDF',
        ...VF(op, !!(delivered && delivered.ok), delivered || {}), t() - s);
  }

  if (want('L03')) {
    // L03 — a secondary grade delivers a lesson plan from the Pakistan 6-12 corpus
    //
    // INVERTED 2026-09-14 (bd-mww73). This used to wait for the literal string "oxbridge" and
    // recorded a PASS when it found one — from when secondary grades had no Pakistan content and
    // fell through to the Oxbridge corpus. Grades 6-12 have been authored and shipped since, so the
    // old assertion now scores the CORRECT behaviour as a failure. What a secondary grade must
    // deliver is a lesson plan from the Pakistan corpus, and the delivered PDF's own filename is
    // the provenance: `grade_<n>_<subject>_c<NN>_p<NN>_<lang>.pdf`. Finding "oxbridge" in the
    // transcript is now the failure, and is captured separately so a regression says so plainly
    // rather than just timing out.
    //
    // The 150s wait stays: a cold secondary-grade render genuinely took 151s.
    s = t();
    await api.resetFlow();
    await api.freshReset();
    await api.sendWait('/lp');
    const op3 = await openLP();
    let pk = null;
    const trail = [];
    if (op3.ok) {
      // Grade and subject are fixed; the chapter and lesson are whatever the catalogue lists FIRST.
      // A hard-coded lesson title ('Fundamentals of ICT') matched nothing on SELECT_LESSON, the walk
      // stopped silently, and the 150s wait below timed out on a plan that was never requested
      // (the L03 known finding, 2026-09-16 → 2026-10-06). `trail` records every screen and pick.
      const CHROME = /^(Back|Close|Powered by|Tap to open|Lesson Plans|📘)/i;
      for (const fixed of ['Grade 6', 'Computer Science', null, null, null]) {
        const pr = await api.flowProbe();
        if (!pr.screen && !pr.text) break;                         // the Flow closed: the walk is done
        const pickable = (pr.items || []).filter((i) => i.text && !i.disabled && !CHROME.test(i.text.trim()));
        const label = fixed || (pickable[0] && pickable[0].text.split('\n')[0].trim());
        const c3 = label ? await api.flowClick(label, { settleMs: 3000 }) : { ok: false, err: 'NOTHING_TO_PICK' };
        trail.push({ screen: pr.screen, offered: pickable.slice(0, 4).map((i) => i.text.split('\n')[0]), picked: label, ok: !!c3.ok });
        if (!c3.ok) break;
      }
      api.closeFlow();
      // Inverted assertion (bd-mww73): a secondary grade must deliver a PAKISTAN plan; "oxbridge" is the
      // FAILURE. The provenance is the delivered DOCUMENT's own filename ("Grade 6 <subject> …pdf"), which
      // arrives in media.filename — NOT in the message text — so match the filename of a doc/pdf message,
      // the way L01 waits on x.pdf||x.doc. The old check tested x.txt and could never match a filename,
      // so a correctly-delivered Pakistan plan always timed out. An "oxbridge" filename or reply is the fail.
      const PKF = /grade[_\s-]*6.*\.pdf/i;
      const fnameOf = (x) => (x && x.media && x.media.filename) || '';
      const w3 = await waitFresh(
        (x) => ((x.pdf || x.doc) && PKF.test(fnameOf(x))) || /oxbridge/i.test(fnameOf(x)) || /oxbridge/i.test(x.txt || ''),
        150000, 2000);
      if (w3.ok) {
        const fn = fnameOf(w3.hit); const t3 = (w3.hit.txt || '');
        pk = (/oxbridge/i.test(fn) || /oxbridge/i.test(t3))
          ? { ok: false, oxbridge: true, waitedMs: w3.waitedMs, file: fn.slice(0, 130), txt: t3.slice(0, 130), trail }
          : { ok: true, oxbridge: false, waitedMs: w3.waitedMs, file: fn.slice(0, 130), trail };
      } else {
        pk = { ok: false, oxbridge: false, waitedMs: w3.waitedMs, last: w3.last, trail };
      }
    }
    rec('L03', 'A secondary grade delivers a Pakistan lesson plan, not an Oxbridge one',
        ...VF(op3, !!(pk && pk.ok), pk || {}), t() - s);
  }

  if (want('L09')) {
    // L09 — a photo must draw SOME reply
    s = t();
    const pic = await api.upload(FIX + '/textbook_page.png', 'Photos & videos', 90000);
    const FEEDBACK = /مفید رہے|helpful\?|👍|👎/;
    const picReal = !!pic.ok && !FEEDBACK.test(pic.txt || '');
    rec('L09', 'A photo gets a reply (known-fail was: silent dead-end)',
        ...V(picReal, { replied: !!pic.ok, kind: pic.kind, reply: (pic.txt || '').slice(0, 120), waitedMs: pic.waitedMs,
                         note: picReal ? 'known-fail FIXED — the bot replies'
                               : pic.ok ? 'only the stale post-plan feedback prompt arrived — not a reply to the photo'
                               : 'silent dead-end reproduces' }), t() - s);
  }

  if (want('L05')) {
    // L05 — a voice request is transcribed and answered
    s = t();
    const voice = await api.upload(FIX + '/lp_request_voice.ogg', 'Audio', 150000);
    // NOTE: a bare "replied" is too weak here — a timestamp-only row satisfied it on the
    // 2026-08-31 run. Require actual reply text before calling this transcribed-and-answered.
    rec('L05', 'A voice lesson-plan request is transcribed and answered',
        ...V(!!voice.ok && (voice.kind === 'audio' || voice.kind === 'document' ||
               (voice.txt || '').replace(/\d{1,2}:\d{2}\s*(AM|PM)?/gi, '').trim().length > 10),
             { replied: !!voice.ok, kind: voice.kind, reply: (voice.txt || '').slice(0, 120),
               waitedMs: voice.waitedMs }), t() - s);
  }

  // L06 / L07 — the pickers only offer what has content, so no tap can reach an empty grade or subject.
  // A stale client can: forge the data_exchange it would post (api.flowRaw) and read the endpoint's
  // answer. A Flow error carries the message the teacher sees in the Flow.
  if (want('L06', 'L07')) {
    s = t();
    await api.resetFlow();
    await api.sendWait('/lp');
    const op6 = await openLP();
    const errOf = (r) => (r && r.ok && r.res && r.res.data && r.res.data.error && r.res.data.error.message) || '';
    if (!op6.ok || !api.flowRaw) {
      const why = !op6.ok ? 'the Pick-Class Flow did not open: ' + op6.err : 'this lane cannot forge a Flow exchange';
      rec('L06', 'A grade with no lesson plans shows a friendly message', 'BLOCKED', { reason: why }, t() - s);
      rec('L07', 'A subject with no chapters is refused politely', 'BLOCKED', { reason: why }, 0);
    } else {
      const r6 = await api.flowRaw({ step: 'grade', grade: '0' });
      const m6 = errOf(r6);
      rec('L06', 'A grade with no lesson plans shows a friendly message',
          ...V(/No lesson plans available for .+ yet/i.test(m6) && !/error|undefined|null/i.test(m6), { forged: { step: 'grade', grade: '0' }, message: m6 || r6 }), t() - s);
      s = t();
      const r7 = await api.flowRaw({ step: 'subject', grade: '1', subject: 'Astronomy' });
      const m7 = errOf(r7);
      rec('L07', 'A subject with no chapters is refused politely',
          ...V(/No Astronomy lesson plans for .+ yet/i.test(m7), { forged: { step: 'subject', grade: '1', subject: 'Astronomy' }, message: m7 || r7 }), t() - s);
      api.closeFlow();
    }
    await api.resetFlow();
  }

  // bd-onxyu — app redirect. Recorded with the reason, not left absent.
  const L11 = 'With Lesson Plans moved to the app, asking for a lesson plan sends me to the Play Store instead';
  const r11 = await withRedirect(api, 'app_redirect_lesson_plan', async () => {
    const t0 = Date.now(), r = await api.sendWait('make me a lesson plan on fractions for grade 4', 90000), txt = r.txt || '';
    return { storeLink: isStoreNotice(txt), messages: r.freshIds, lpMenu: /Pick (your )?class|جماعت چنیں|Lesson Plans\n/i.test(txt) || r.kind === 'flow',
             reply: txt.slice(0, 160), ms: Date.now() - t0 };
  });
  if (r11.ran) rec('L11', L11, r11.value.storeLink && r11.value.messages === 1 && !r11.value.lpMenu ? 'PASS' : 'FAIL', r11.value, r11.value.ms);
  else rec('L11', L11, 'BLOCKED',
      { reason: REDIRECT_BLOCKED, setAppSetting: r11.reason }, 0);

  // bd-1r3k2h — a NEW lesson request while a 6-12 lesson sits on the shelf belongs to the lesson-plan feature
  // (intent detection → the app notice here), never to the edit router's out-of-scope sentence. The shelf is the
  // run's private Redis (lp_shelf:<user id>, lp-shelf.service), seeded with the entry lp612-serving pushes.
  const L12 = 'Asking for a new lesson plan after a 6-12 lesson is answered by the lesson-plan feature, not as an edit';
  const r12 = await withRedirect(api, 'app_redirect_lesson_plan', async () => {
    const SC = require(require('path').join(__dirname, '..', '..', 'engine', 'bin', 'stack-control.cjs'));
    const u = (() => { try { const o = api.db('driver-user'); const line = String(o.out || '').trim().split('\n').reverse().find((l) => l.trim().startsWith('{')); return line ? JSON.parse(line) : {}; } catch (_) { return {}; } })();
    const key = 'lp_shelf:' + u.id;
    const entry = { lane: 'lp612', segment_id: 'qa-lp612-g6-math-ch1-s1', grade: '6', subject: 'Mathematics', chapter_number: 1, chapter_title: 'QA chapter', topic: 'QA topic', pages_label: '', one_screen: null, lang: 'en', delivery_type: 'segment', delivered_at: new Date().toISOString() };
    const shelf = u.id ? await SC.redis(['SETEX', key, '3600', JSON.stringify([entry])]) : { ok: false, err: 'no driver user id' };
    const t0 = Date.now(), r = await api.sendWait('make me a lesson plan on fractions for grade 4', 90000), txt = r.txt || '';
    if (u.id) await SC.redis(['DEL', key]);
    return { shelfSeeded: !!(shelf && shelf.ok), shelfErr: shelf && shelf.err, storeLink: isStoreNotice(txt), messages: r.freshIds,
             editSentence: /I can change parts of a lesson|different thing, so your lesson/i.test(txt), reply: txt.slice(0, 160), ms: Date.now() - t0 };
  });
  if (r12.ran) rec('L12', L12, r12.value.shelfSeeded && r12.value.storeLink && !r12.value.editSentence ? 'PASS' : 'FAIL', r12.value, r12.value.ms);
  else rec('L12', L12, 'BLOCKED', { reason: REDIRECT_BLOCKED, setAppSetting: r12.reason }, 0);
  // bd-96f69c.8 — lp_whatsapp_pdf_off per programme (../niete_lp_whatsapp_off_case.cjs); L15 is @no-mock-driver.
  if (want('L13')) {
    const L13 = 'With lesson-plan PDFs off on WhatsApp for my programme, asking for a lesson plan sends me one app link';
    const x = await require('../niete_lp_whatsapp_off_case.cjs').sendLpWithPdfOff(api, ['ict'], CARD), e = x.value || {};
    if (x.ran) rec('L13', L13, ...V(e.appLink && e.messages === 1 && !e.card && !e.pdf, e), x.ms); else rec('L13', L13, 'BLOCKED', { reason: REDIRECT_BLOCKED, setAppSetting: x.reason }, 0);
  }
  if (want('L14')) {
    const L14 = "With lesson-plan PDFs off only for the GB programme, an ICT teacher's lesson-plan menu is unchanged";
    const x = await require('../niete_lp_whatsapp_off_case.cjs').sendLpWithPdfOff(api, ['gb'], CARD), e = x.value || {};
    if (x.ran) rec('L14', L14, ...V(e.card && !e.appLink, e), x.ms); else rec('L14', L14, 'BLOCKED', { reason: REDIRECT_BLOCKED, setAppSetting: x.reason }, 0);
  }

  await runNew({ api, rec, sleep, want, openLP, waitFresh });
};

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// bd-q8wt5e.6.3 — L67–L149: the scenarios given ids in that bead. Driven where the lane can reach them; otherwise
// recorded BLOCKED with what is missing (each call names its id literally: check-scenario-coverage reads `fn('L..'`).
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const PATH = require('path');
const { UX_STRINGS: UX } = require(PATH.resolve(__dirname, '..', '..', '..', '..', 'bot/shared/config/ux-strings.js'));
const LL = require('../leader-lessons-case.cjs');
const SEG612 = 'grade_6_computer_science.c01.p005-005';   // the one 6-12 lesson the lane serves (seed-files.txt: its lp.json)
// A K-5 survey is told from the 6-12 one by its button ids (lp_feedback_yes_<plan> vs lp612_fb_yes_…): the Urdu titles are the same.
const btnIds = (x) => ((((x || {}).raw || {}).interactive || {}).action || {}).buttons ? x.raw.interactive.action.buttons.map((b) => (b.reply || {}).id || '') : [];
const isK5Survey = (x) => btnIds(x).some((id) => /^lp_feedback_(yes|no)_/.test(id));

/** The run's stack: its private Redis and the mock Graph API's signal counter (reactions, read receipts, typing). */
function stack() {
  const SC = require(PATH.join(__dirname, '..', '..', 'engine', 'bin', 'stack-control.cjs'));
  let mockUrl = null;
  try { mockUrl = JSON.parse(require('fs').readFileSync(PATH.join(SC.runDir(), 'stack.json'), 'utf8')).mock_url; } catch (_) {}
  const signals = async () => { try { return (await (await fetch(mockUrl + '/health')).json()).signals; } catch (_) { return null; } };
  /** Cassette keys this run missed since `t0` (the replay-only lane cannot answer them). */
  const misses = (t0) => {
    try {
      return require('fs').readFileSync(PATH.join(SC.runDir(), 'cassette-trace.jsonl'), 'utf8').split('\n').filter(Boolean)
        .map((l) => JSON.parse(l)).filter((j) => j.ts >= t0 && j.outcome && j.outcome !== 'hit').map((j) => j.kind + ':' + String(j.key).slice(0, 24));
    } catch (_) { return []; }
  };
  return { redis: SC.redis, signals, misses };
}

/** PostgREST on the run's own database (null elsewhere — every write here is a scenario's own set-up). */
function localDb() {
  const { dbCreds } = require(PATH.join(__dirname, '..', '..', 'engine', 'bin', 'db-target.cjs'));
  const { url, key, kind } = dbCreds();
  if (!url || !key || kind !== 'local') return null;
  const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
  const call = async (method, q, body) => { const r = await fetch(`${url}/rest/v1/${q}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); return r.ok ? r.json().catch(() => []) : []; };
  return { get: (q) => call('GET', q), patch: (q, b) => call('PATCH', q, b), del: (q) => call('DELETE', q) };
}

async function runNew({ api, rec, sleep, want, openLP, waitFresh }) {
  const t = () => Date.now();
  const ST = stack();
  const db = localDb();
  const uid = LL.driverId(api);
  const verdict = (ok, ev, t0) => {
    // A step that went to a vendor the lane has no cassette for is not the product's answer: BLOCKED, with the key.
    const m = ST.misses(t0);
    if (!ok && m.length) return ['BLOCKED', { reason: 'cassette miss on the replay-only lane — recording it is a paid live call and needs an operator go', misses: m.slice(0, 5), ...ev }];
    return [ok ? 'PASS' : 'FAIL', ev];
  };
  const clearClaims = async () => {
    if (!uid) return;
    for (const pat of [`lpv8_deliver:${uid}:*`, `lp_feedback_asked:${uid}:*`]) {
      const k = await ST.redis(['KEYS', pat]);
      const keys = (k && (k.out || k.value || k.result)) || [];
      const list = Array.isArray(keys) ? keys : String(keys).split(/\s+/).filter(Boolean);
      for (const key of list) await ST.redis(['DEL', key]);
    }
  };
  /** Walk the Pick-Class Flow with fixed picks (null = the first pickable row); 'English' is preferred where offered. */
  const walk = async (picks) => {
    const CHROME = /^(Back|Close|Powered by|Tap to open|Lesson Plans|📘)/i;
    const trail = [];
    for (const fixed of picks) {
      const pr = await api.flowProbe();
      if (!pr.screen && !pr.text) break;
      const pickable = (pr.items || []).filter((i) => i.text && !i.disabled && !CHROME.test(i.text.trim()));
      const eng = pickable.find((i) => /^English$/i.test(i.text.trim()));
      const label = fixed || (eng && eng.text) || (pickable[0] && pickable[0].text.split('\n')[0].trim());
      const c = label ? await api.flowClick(label, { settleMs: 3000 }) : { ok: false, err: 'NOTHING_TO_PICK' };
      trail.push({ screen: pr.screen, picked: label, ok: !!c.ok, after: c.ok ? undefined : c.err });
      if (!c.ok) break;
    }
    return trail;
  };
  const isPdf = (x) => !!(x.pdf || x.doc);
  /** Ask for a lesson through the Flow and collect what the chat receives in `windowMs` after the Flow closes. */
  const deliver = async (picks, windowMs, { reset = true } = {}) => {
    await api.resetFlow();
    await api.sendWait('/lp');
    const op = await openLP();
    if (!op.ok) return { ok: false, err: 'Flow did not open: ' + op.err };
    if (reset) await api.freshReset();
    const trail = await walk(picks);
    const closing = await api.flowProbe();
    api.closeFlow();
    const seen = [];
    const t0 = t();
    while (t() - t0 < windowMs) { seen.push(...(await api.fresh())); if (seen.some(isPdf) && windowMs <= 0) break; await sleep(1500); }
    return { ok: true, trail, closing: (closing.text || '').slice(0, 120), seen };
  };
  const K5 = ['Grade 1', 'English', 'Ch 1', 'Day 1'];
  const G6 = ['Grade 6', 'Computer Science', null, null, null];
  const survey = (seen, rx) => seen.filter((x) => (rx === 'k5' ? isK5Survey(x) : (x.btns || []).some((b) => rx.test(b))));
  /** Wait (up to `ms`) for a survey message; returns it or null. */
  const waitSurvey = async (rx, ms = 60000, already = []) => {
    const hit = survey(already, rx)[0];
    if (hit) return hit;
    const w = await waitFresh((x) => (rx === 'k5' ? isK5Survey(x) : (x.btns || []).some((b) => rx.test(b))), ms);
    return w.ok ? w.hit : null;
  };
  /** Tap a reply button and read what follows for `ms`: messages with words, and the mock's signal count delta. */
  const tapQuiet = async (label, ms = 8000) => {
    const s0 = await ST.signals();
    await api.freshReset();
    await api.tapAndWait(label, 2000).catch(() => null);
    await sleep(ms);
    const after = (await api.fresh()).filter((x) => x.txt || (x.btns || []).length);
    const s1 = await ST.signals();
    return { messages: after.map((x) => (x.txt || '').slice(0, 100)), signals: s0 == null || s1 == null ? null : s1 - s0 };
  };
  /** Send a free-text answer and read what follows (a reason is receipted by a reaction, not a message). */
  const tapQuietText = async (text, ms = 5000) => {
    await api.freshReset();
    await api.sendWait(text, ms).catch(() => null);
    const after = (await api.fresh()).filter((x) => x.txt);
    if (uid) await ST.redis(['DEL', `lp612_feedback_pending:${uid}`]);
    return { messages: after.map((x) => (x.txt || '').slice(0, 100)) };
  };
  const NOT_SEEN = 'the mock Graph API counts reactions, read receipts and typing indicators as one number and keeps no emoji, so 🙏-vs-👍 and "no typing…" are not observable here';
  let s;

  // ── K-5 survey: L69 (double tap), L70 (surveyed once in ten minutes), L68 (receipt by reaction) ──
  if (want('L69', 'L70', 'L68')) {
    // Drain what earlier scenarios left in flight: L01's survey (same lesson) and L03's 6-12 survey land 30 s after
    // their deliveries, and L01's would claim this lesson's ten-minute survey window inside L69.
    if (want('L01', 'L03')) await waitFresh(() => false, 32000);
    await clearClaims();
    s = t();
    // L69 — the same lesson tapped twice inside a minute (the Flow reopened for the second tap).
    const a = await deliver(K5, 0);
    const b = await deliver(K5, 45000, { reset: false });   // ~45 s: past the 30 s survey delay; one read of both taps
    const all = [...(a.seen || []), ...(b.seen || [])];
    const pdfs = all.filter(isPdf).length;
    const voices = all.filter((x) => x.audio || x.voice).length;
    const preparing = all.filter((x) => /(سبق کا منصوبہ تیار|Preparing|Sending your lesson plan)/i.test(x.txt || '')).length;
    const surveys69 = survey(all, 'k5');
    if (want('L69')) rec('L69', 'Tapping the same lesson twice in the Pick Class Flow delivers it once',
      ...verdict(a.ok && b.ok && pdfs === 1 && voices <= 1 && preparing <= 1 && surveys69.length === 1,
        { pdfs, voiceNotes: voices, preparing, surveys: surveys69.length, closingScreens: [a.closing, b.closing], trails: [a.trail, b.trail] }, s), t() - s);

    // L70 — the same lesson again after the first survey: the 2-minute double-tap claim is let go (as if 3 minutes
    // had passed), the 10-minute survey claim is kept. The PDF comes again; no second survey.
    s = t();
    if (uid) for (const k of String(((await ST.redis(['KEYS', `lpv8_deliver:${uid}:*`])) || {}).out || '').split(/\s+/).filter(Boolean)) await ST.redis(['DEL', k]);
    const c = await deliver(K5, 45000);
    const again = (c.seen || []).filter(isPdf).length;
    const surveys70 = survey(c.seen || [], 'k5').length;
    if (want('L70')) rec('L70', 'The same lesson delivered twice within ten minutes is surveyed once',
      ...verdict(surveys69.length === 1 && again === 1 && surveys70 === 0,
        { firstSurveyed: surveys69.length, pdfAgain: again, secondSurveys: surveys70, note: 'the 2-minute double-tap claim was cleared to stand for the 3 minutes the spec waits' }, s), t() - s);

    // L68 — a fresh survey, 👍, and the answer that needs no follow-up is receipted without a message. The lane's one
    // Grades 1-5 lesson arrives WITH its voice note, so its 👍 rightly asks the usage question (after_voice_note); the
    // receipt rule is then read on the usage answer, which the spec puts under the same rule (NL1/FX7).
    s = t();
    await clearClaims();
    const d = await deliver(K5, 0);
    const sv = await waitSurvey('k5', 60000, d.seen || []);
    let ev68 = { surveyed: !!sv };
    let ok68 = false;
    if (sv) {
      const yes = sv.btns.find((x) => /👍/.test(x));
      const s0 = await ST.signals();
      await api.freshReset();
      const r = await api.tapAndWait(yes, 8000).catch(() => null);
      await sleep(4000);
      const afterYes = [r, ...(await api.fresh())].filter((x) => x && (x.txt || (x.btns || []).length));
      const usage = afterYes.find((x) => (x.btns || []).includes('Taught it today') || (x.btns || []).includes('آج پڑھا دیا'));
      const thanks = /Thanks — glad it helped|شکریہ — خوشی ہے یہ مفید تھی/;
      if (usage) {
        const q = await tapQuiet((usage.btns || []).find((x) => /Taught it today|آج پڑھا دیا/.test(x)));
        ok68 = q.messages.length === 0 && (q.signals == null || q.signals > 0);
        ev68 = { path: 'voice note delivered → usage question → "Taught it today"', afterTap: q, notChecked: NOT_SEEN };
      } else {
        const s1 = await ST.signals();
        ok68 = !afterYes.some((x) => thanks.test(x.txt || '')) && afterYes.length === 0;
        ev68 = { path: '👍 with no voice note', afterYes: afterYes.map((x) => (x.txt || '').slice(0, 100)), signals: s0 == null ? null : s1 - s0, notChecked: NOT_SEEN };
      }
    }
    if (want('L68')) rec('L68', 'A survey answer that needs no follow-up is receipted by a reaction, not a message', ...verdict(ok68, ev68, s), t() - s);
  }

  // ── 6-12 survey: L67 (👍 asks whether I taught it), L94 (👎 asks why), L73 (asked in my language) ──
  const fresh612 = async () => { if (db && uid) await db.del(`lp_feedback?user_id=eq.${uid}&lp612_segment_id=eq.${SEG612}`); };
  const s612 = async ({ beforeSurvey } = {}) => {
    await fresh612();
    const d = await deliver(G6, 0);
    const pdf = (d.seen || []).find(isPdf) || (await waitFresh(isPdf, 150000, 2000)).hit;
    if (beforeSurvey) await beforeSurvey();
    const sv = await waitSurvey(/👍 (Yes|ہاں)/, 60000, d.seen || []);
    return { d, pdf, sv };
  };
  const usedAsk = (r, lang) => (r && r.txt || '').includes(UX.lp612UsedAsk[lang]);
  const threeUsed = (r, lang) => JSON.stringify((r && r.btns) || []) === JSON.stringify([UX.lp612UsedTaught[lang], UX.lp612UsedPlanned[lang], UX.lp612UsedNotYet[lang]]);
  if (want('L67')) {
    s = t();
    const x = await s612();
    let ok = false, ev = { pdf: !!x.pdf, surveyed: !!x.sv, file: x.pdf && x.pdf.media && x.pdf.media.filename };
    if (x.sv) {
      const r = await api.tapAndWait(UX.lp612FeedbackYes.en, 60000);
      const q = usedAsk(r, 'en') && threeUsed(r, 'en') ? await tapQuiet(UX.lp612UsedTaught.en) : null;
      ok = usedAsk(r, 'en') && threeUsed(r, 'en') && !!q && q.messages.length === 0;
      ev = { ...ev, question: (r.txt || '').slice(0, 80), replies: r.btns, afterTaught: q, notChecked: NOT_SEEN };
    }
    rec('L67', 'Rating a 6-12 lesson plan useful asks whether I taught it', ...verdict(ok, ev, s), t() - s);
  }
  if (want('L94')) {
    s = t();
    const x = await s612();
    let ok = false, ev = { pdf: !!x.pdf, surveyed: !!x.sv };
    if (x.sv) {
      await api.freshReset();
      const r = await api.tapAndWait(UX.lp612FeedbackNo.en, 60000);
      await sleep(4000);
      const more = await api.fresh();
      const asksUse = [r, ...more].some((m) => usedAsk(m, 'en') || ((m && m.btns) || []).includes(UX.lp612UsedTaught.en));
      ok = (r.txt || '').includes(UX.lp612FeedbackAskReason.en) && !asksUse;
      // answer it in her own words, as asked: the reason window (10 min) otherwise takes the next free text
      const why = await tapQuietText('The timings were too long for my class');
      ev = { ...ev, reply: (r.txt || '').slice(0, 100), asksWhetherTaught: asksUse, reasonAnswered: why };
    }
    rec('L94', 'A thumbs-down asks why, and never asks whether I taught it', ...verdict(ok, ev, s), t() - s);
  }
  if (want('L73')) {
    s = t();
    const [orig] = db && uid ? await db.get(`users?select=preferred_language,language_locked&id=eq.${uid}`) : [];
    let ok = false, ev = {};
    try {
      // The English 6-12 lesson, ordered while English; she is Urdu by the time the survey asks (30 s later, in the
      // voice read at send time: lp612-feedback.shared.js _voiceOf). An Urdu account would be sent the Urdu document.
      const x = await s612({ beforeSurvey: () => api.setUser({ preferred_language: 'ur', language_locked: true }) });
      ev = { pdf: !!x.pdf, file: x.pdf && x.pdf.media && x.pdf.media.filename, surveyed: !!x.sv, surveyBtns: x.sv && x.sv.btns };
      if (x.sv) {
        const r = await api.tapAndWait(UX.lp612FeedbackYes.ur, 60000);
        ok = /_en\.pdf$/i.test((x.pdf && x.pdf.media && x.pdf.media.filename) || '') && usedAsk(r, 'ur') && threeUsed(r, 'ur');
        ev = { ...ev, question: (r.txt || '').slice(0, 80), replies: r.btns };
      }
    } finally {
      await api.setUser({ preferred_language: (orig && orig.preferred_language) || 'en', language_locked: !!(orig && orig.language_locked) });
    }
    rec('L73', "The use question is asked in my language, not the document's", ...verdict(ok, ev, s), t() - s);
  }
  await fresh612();

  // ── leaders and the Lesson Plans tab (leader_app_lesson_plan): L132 L133 L135 L136 L138 L139 L140 ──
  const READ_BODY = true;   // the leader body, either language (leader-lessons-case.cjs LEADER_BODY)
  const leader = async (id, name, value, role, act, judge) => {
    if (!want(id)) return;
    const s0 = t();
    const x = await LL.withLeaderSwitch(api, value, role, async () => LL.collect(api, act, 5000));
    if (!x.ran) return rec(id, name, 'BLOCKED', { reason: LL.LEADER_BLOCKED, setAppSetting: x.reason }, 0);
    const [ok, ev] = judge(x.value);
    rec(id, name, ...verdict(ok, ev, s0), t() - s0);
  };
  const tab = (body, extra) => (c) => { const [ok, ev] = LL.tabVerdict(c, uid, { body }); const e = extra ? extra(c) : { ok: true }; return [ok && e.ok, { ...ev, ...e }]; };
  const keepsMenu = (c) => [c.lpMenu && c.ctas.length === 0, { lpMenu: c.lpMenu, ctas: c.ctas.length, messages: c.messages }];
  await leader('L132', 'A coach asking for a lesson plan gets one button that opens the Lesson Plans tab in the app', true, 'coach',
    () => api.sendWait('lesson plan'), tab(READ_BODY, () => ({ ok: true, notChecked: 'opening a plan inside the tab is the portal\'s, which the mock lane does not run' })));
  // L133 — the lane's driver is on neither the coach app (portal_coach_v2) nor FLN share: read them to say so.
  await leader('L133', 'A coach off the coach app, or without FLN share, still lands on the Lesson Plans tab', true, 'coach',
    () => api.sendWait('lesson plan'), tab(false, () => ({ ok: true })));
  await leader('L135', 'A coach who types a lesson-plan topic gets the Lesson Plans tab button, not the catalogue', 'coaches', 'coach',
    () => api.sendWait('make me a lesson plan on fractions', 120000), tab(READ_BODY, (c) => ({ ok: !c.textbookLine })));
  await leader('L136', 'A coach who asks for a lesson-plan topic in a voice note gets the Lesson Plans tab button, and nothing else', 'coaches', 'coach',
    () => api.upload(FIX + '/lp_request_voice.ogg', 'Audio', 150000),
    (c) => { const [ok, ev] = LL.tabVerdict(c, uid); const spoken = c.all.some((m) => m.audio || m.voice);
      return [ok && !spoken, { ...ev, spokenAnswer: spoken, fixture: 'lp_request_voice.ogg ("I had to make a lesson plan" — no topic named; the same voice_intent door)' }]; });
  await leader('L138', 'With the leader switch on "coaches", a principal who names a topic keeps the WhatsApp lesson-plan menu', 'coaches', 'principal',
    () => api.sendWait('make me a lesson plan on fractions', 120000), keepsMenu);
  await leader('L139', 'With the leader switch on "coaches", a principal keeps the WhatsApp lesson-plan menu', 'coaches', 'principal',
    () => api.sendWait('lesson plan'), keepsMenu);
  await leader('L140', 'With the leader switch off, a coach keeps the WhatsApp lesson-plan menu', false, 'coach',
    () => api.sendWait('lesson plan'), keepsMenu);
  if (db && want('L133')) { /* evidence only */ }

  // ── inside the quiet hour (app_redirect_lesson_plan): L129, L130 ──
  const quiet = async (id, name, text, quietMs) => {
    if (!want(id)) return;
    s = t();
    const x = await withRedirect(api, 'app_redirect_lesson_plan', async () => {
      const first = await api.sendWait('lp', 90000);
      await api.freshReset();
      await api.sendWait(text, quietMs).catch(() => null);
      await sleep(1000);
      const later = (await api.fresh()).filter((m) => m.txt || (m.btns || []).length || m.doc || m.flow);
      return { firstNotice: isStoreNotice(first.txt || ''), later: later.map((m) => (m.txt || '').slice(0, 100)) };
    });
    if (!x.ran) rec(id, name, 'BLOCKED', { reason: REDIRECT_BLOCKED, setAppSetting: x.reason }, 0);
    else rec(id, name, ...verdict(x.value.firstNotice && x.value.later.length === 0, { ...x.value, watchedMs: quietMs, notChecked: NOT_SEEN }, s), t() - s);
  };
  await quiet('L129', 'Asking again inside the hour gets no reply and no "typing…"', 'lp', 10000);
  await quiet('L130', 'A typed lesson-plan request inside the hour gets no reply and no "typing…", however long the bot takes to read it', 'please make me a lesson plan for grade 4 maths fractions', 30000);

  // ── L89 route-all: LP_612_ROUTE_ALL is an environment variable read by the bot (lp612-flags.js) ──
  if (want('L89')) {
    const on = /^LP_612_ROUTE_ALL=(1|true)$/m.test((() => { try { return require('fs').readFileSync(PATH.join(require(PATH.join(__dirname, '..', '..', 'engine', 'bin', 'stack-control.cjs')).runDir(), 'src', '.env'), 'utf8'); } catch (_) { return ''; } })());
    if (!on) rec('L89', 'Under route-all, a typed lesson-plan request opens the Flow with the textbook line inside it', 'BLOCKED',
      { reason: 'LP_612_ROUTE_ALL is an environment variable the bot reads at start (config/lp612-flags.js), and the lane\'s bot runs without it (.claude/qa/config/local-lane.env); a driver cannot flip it mid-run' }, 0);
    else {
      s = t();
      const c = await LL.collect(api, () => api.sendWait('make me a lesson plan on photosynthesis', 120000), 4000);
      const card = c.all.filter((m) => /Lesson Plans|سبق کے منصوبے/.test(m.txt || '') && (m.btns || []).length);
      const body = (card[0] && card[0].txt) || '';
      rec('L89', 'Under route-all, a typed lesson-plan request opens the Flow with the textbook line inside it',
        ...verdict(c.all.length === 1 && card.length === 1 && /Lesson plans now come straight from your own textbook|اب سبق کے منصوبے آپ کی اپنی درسی کتاب سے بنتے ہیں/.test(body) && /Pick your class|جماعت/.test(body),
          { messages: c.messages }, s), t() - s);
    }
  }

  // ── Make my own on the 6-12 lesson screen (portal_lp_make_own + the teacher app): L145 L146 L147; L148 ──
  if (want('L145', 'L146', 'L147')) await makeOwn({ api, rec, sleep, want, openLP, walk, uid, verdict });
  if (want('L148')) rec('L148', 'A Make my own plan for a class of more than 70 fits one period with less to do', 'BLOCKED',
    { reason: 'the plan is written by the portal\'s Make my own generator (an LLM call behind the portal page), and the mock lane runs neither the portal nor that vendor; unit coverage is the portal\'s' }, 0);
  if (want('L144')) rec('L144', 'A plan a coach attached that is not a lesson plan, or is unreadable, never messages the teacher', 'BLOCKED',
    { reason: 'needs a coach observation (/observe, with a seeded school and observed teacher — observe.feature owns that set-up) whose attached file the extraction worker reads with an LLM; the stale coaching cassettes are being re-recorded under bd-q8wt5e.13' }, 0);

  // ── the 6-12 content gate (RELIGIOUS_MARKS, G5c review, overlay): each needs ONE segment authored through the LLM ──
  await contentGate({ rec, want, db });

  // ── @wip/@draft scenarios given ids (bd-q8wt5e.6.3) — not promoted; recorded so every run lists them ──
  const W = '@wip @draft: not promoted to the lane (promotion is the spec owner\'s call, bd-q8wt5e)';
  const QZ = W + '; the afternoon quiz offer is a scheduled nudge (send hour, school days, quiet hours) behind its config gate, with no trigger this lane calls';
  if (want('L99')) rec('L99', 'The first lesson plan of the day is followed by one coaching ask, and only the first', 'BLOCKED', { reason: W + '; the ask runs on a daily clock' }, 0);
  if (want('L100')) rec('L100', 'At the send hour a teacher who planned one lesson is offered a quiz', 'BLOCKED', { reason: QZ }, 0);
  if (want('L101')) rec('L101', 'A lesson plan read in the teacher app earns the same afternoon quiz offer as one received on WhatsApp', 'BLOCKED', { reason: QZ + '; and the teacher app' }, 0);
  if (want('L102')) rec('L102', 'A plan handed from the teacher app to another app earns the afternoon quiz offer too', 'BLOCKED', { reason: QZ + '; and the teacher app' }, 0);
  if (want('L103')) rec('L103', 'A lesson read in the teacher app shows the received tick on both lesson lists', 'BLOCKED', { reason: W + '; the lists are the portal\'s, not on this lane' }, 0);
  if (want('L104')) rec('L104', 'A lesson with no quiz source is not offered', 'BLOCKED', { reason: QZ }, 0);
  if (want('L105')) rec('L105', 'An Islamiyat lesson plan, or an Urdu Hamd or Naat chapter, is never made into a quiz until its religious content is reviewed', 'BLOCKED', { reason: QZ }, 0);
  if (want('L106')) rec('L106', "A teacher in the A/B trial's August group is quizzed on the August plan the app showed them", 'BLOCKED', { reason: QZ }, 0);
  if (want('L107')) rec('L107', 'A teacher who planned lessons for two classes gets a list to pick from', 'BLOCKED', { reason: QZ }, 0);
  if (want('L108')) rec('L108', "A teacher's first afternoon offer carries the intro film in their language", 'BLOCKED', { reason: QZ }, 0);
  if (want('L109')) rec('L109', 'A two-class offer with the intro film is ONE message — the film above three buttons', 'BLOCKED', { reason: QZ }, 0);
  if (want('L110')) rec('L110', 'An offer for three or more classes sends the intro film first, then the list', 'BLOCKED', { reason: QZ }, 0);
  if (want('L111')) rec('L111', 'The Urdu afternoon offer writes its numbers in Western digits', 'BLOCKED', { reason: QZ }, 0);
  if (want('L112')) rec('L112', 'A teacher coached today is not offered the afternoon quiz', 'BLOCKED', { reason: QZ }, 0);
  if (want('L113')) rec('L113', 'A lesson planned after 14:00 is offered on the next school day', 'BLOCKED', { reason: QZ }, 0);
  if (want('L114')) rec('L114', 'An assessment day is not offered a quiz', 'BLOCKED', { reason: QZ }, 0);
  if (want('L115')) rec('L115', 'Make the quiz produces an lp_v8 quiz with a share link', 'BLOCKED', { reason: QZ + '; @slow quiz generation' }, 0);
  if (want('L116')) rec('L116', 'The afternoon offer never makes a second quiz for a lesson already made into a quiz from /quiz', 'BLOCKED', { reason: QZ }, 0);
  if (want('L117')) rec('L117', 'Make the quiz on a maths lesson asks which language the quiz is written in', 'BLOCKED', { reason: QZ }, 0);
  if (want('L118')) rec('L118', "The quiz language question gives examples of English terms that fit the lesson's subject", 'BLOCKED', { reason: QZ }, 0);
  if (want('L119')) rec('L119', 'Urdu and Islamiyat lessons are not asked the quiz language', 'BLOCKED', { reason: QZ }, 0);
  if (want('L120')) rec('L120', 'The quiz offer names the lesson the way its PDF caption does', 'BLOCKED', { reason: QZ }, 0);
  if (want('L121')) rec('L121', "An Urdu LP-born quiz is called by the lesson's own name, never a clipped sentence", 'BLOCKED', { reason: QZ + '; @slow quiz generation' }, 0);
  if (want('L122')) rec('L122', 'The PDF of an LP-born quiz says planned, never taught', 'BLOCKED', { reason: QZ + '; @slow quiz generation' }, 0);
  if (want('L123')) rec('L123', "The afternoon offer's WhatsApp message id is kept on its nudge row", 'BLOCKED', { reason: QZ }, 0);
  if (want('L124')) rec('L124', 'No thanks is remembered', 'BLOCKED', { reason: QZ }, 0);
  if (want('L125')) rec('L125', "A quiz never keys the lesson's own misconception as correct", 'BLOCKED', { reason: QZ + '; @slow quiz generation' }, 0);
  if (want('L126')) rec('L126', 'The afternoon quiz offer is never sent at night', 'BLOCKED', { reason: QZ }, 0);
  if (want('L127')) rec('L127', 'The afternoon quiz offer waits while a lesson-plan survey question is open', 'BLOCKED', { reason: QZ }, 0);
  if (want('L128')) rec('L128', 'With NUDGE_OPEN_QUESTION_DEFER off the afternoon offer no longer waits for a survey question', 'BLOCKED', { reason: QZ + '; NUDGE_OPEN_QUESTION_DEFER is an environment variable' }, 0);
  if (want('L141')) rec('L141', "A Grades 6-12 quiz can draw the lesson's own diagram", 'BLOCKED', { reason: W + '; quiz picture generation behind its config gate' }, 0);
  if (want('L142')) rec('L142', 'Pictures a child cannot tell apart are never shipped', 'BLOCKED', { reason: W + '; quiz picture generation behind its config gate' }, 0);
  if (want('L143')) rec('L143', 'A place-value picture does not print the answer, and a mark lesson shows its mark', 'BLOCKED', { reason: W + '; quiz picture generation behind its config gate' }, 0);
  if (want('L149')) rec('L149', 'A Grades 1–5 lesson plan arrives with no voice note and no voice-note script lookup', 'BLOCKED', { reason: '@draft: not promoted; the lane\'s Grades 1-5 lesson still carries its voice note (lp-cache .ogg in the seed)' }, 0);
}

/** L145–L147: the lesson screen of a 6-12 chapter with Make my own on / off / for a GB teacher. The switch is held
 *  in-process for 30 s (lp612-own-offer.js TTL_MS), so each flip waits that out before the Flow is opened. */
async function makeOwn({ api, rec, sleep, want, openLP, walk, uid, verdict }) {
  const N = {
    L145: 'With Make my own on for me, a Grades 6-12 chapter opens with Make my own first, and one tap sends one link',
    L146: "With Make my own off or not for me, the chapter's lesson screen is exactly as before",
    L147: 'A GB teacher never sees Make my own, even with the switch on for teachers',
  };
  const R = (id, ...v) => { if (want(id)) rec(id, N[id], ...v); };
  const OWN = /^‏?(Make my own|اپنا پلان بنائیں)/;
  const lessonScreen = async () => {
    await api.resetFlow();
    await api.sendWait('/lp');
    const op = await openLP();
    if (!op.ok) return { ok: false, err: op.err };
    const trail = await walk(['Grade 6', 'Computer Science', null]);
    const p = await api.flowProbe();
    const rows = (p.items || []).filter((i) => i.kind === 'nav' || i.kind === 'option');
    return { ok: true, trail, screen: p.screen, rows: rows.map((i) => i.text.split('\n')[0]), first: rows[0] && rows[0].text };
  };
  const set = async (k, v) => { const r = await api.setAppSetting(k, v); return r && r.ok; };
  const s = Date.now();
  if (!(await set('portal_teacher_v2', true)) || !(await set('portal_lp_make_own', 'teachers'))) {
    for (const id of ['L145', 'L146', 'L147']) R(id, 'BLOCKED', { reason: 'portal_lp_make_own and portal_teacher_v2 are global app_settings: flipped only on the run\'s own local database (E2E_LOCAL_DB=1)' }, 0);
    await api.restoreAppSettings();
    return;
  }
  try {
    await sleep(31000);
    // L145 — on for her (teachers, an ICT teacher on the teacher app)
    const on = await lessonScreen();
    let ok145 = false, ev145 = on;
    if (on.ok && OWN.test(on.first || '')) {
      await api.freshReset();
      const c = await api.flowClick(on.first, { settleMs: 3000 });
      const closing = await api.flowProbe();
      api.closeFlow();
      await sleep(4000);
      const msgs = (await api.fresh()).filter((m) => m.txt || m.cta);
      const cta = msgs.find((m) => m.cta && m.cta.url);
      const land = cta ? LL.landingOfLink(cta.cta.url) : null;
      ok145 = c.ok && on.rows.length <= 20 && msgs.length === 1 && !!cta && /Make my own|اپنا پلان بنائیں/.test(cta.cta.text || '') && !!land && land.feature === 'lp_make_own' && land.user === uid;
      ev145 = { rows: on.rows.slice(0, 6), rowCount: on.rows.length, closing: (closing.text || '').slice(0, 100), messages: msgs.map((m) => (m.txt || '').slice(0, 80)),
        button: cta && cta.cta.text, landing: land, notChecked: 'the portal page opening at the first question is the portal\'s, not on this lane' };
    }
    R('L145', ...verdict(ok145, ev145, s), Date.now() - s);
    const s47 = Date.now();
    // L147 — the same switch, the driver as a GB teacher (users.source main_rumi_gb: region.service GB_SOURCES)
    await api.setUser({ source: 'main_rumi_gb' });
    const gb = await lessonScreen();
    api.closeFlow();
    await api.setUser({ source: null });
    R('L147', ...verdict(gb.ok && on.ok && !gb.rows.some((x) => OWN.test(x)) && OWN.test(on.first || ''),
      { gbRows: gb.rows && gb.rows.slice(0, 4), ictFirstRow: on.first, err: gb.err }, s47), Date.now() - s47);
    // L146 — switch off: no row, and a row tapped from scrollback (its data_exchange, forged) sends nothing
    const s46 = Date.now();
    await set('portal_lp_make_own', false);
    await sleep(31000);
    const off = await lessonScreen();
    let forged = null, sent = [];
    if (off.ok && api.flowRaw) {
      await api.freshReset();
      forged = await api.flowRaw({ step: 'lp612_own', grade: '6', subject: 'Computer Science', chapter_key: 'c01' });
      await sleep(4000);
      sent = (await api.fresh()).filter((m) => m.txt || m.cta).map((m) => (m.txt || '').slice(0, 80));
    }
    api.closeFlow();
    R('L146', ...verdict(off.ok && !off.rows.some((x) => OWN.test(x)) && off.rows.length > 0 && sent.length === 0,
      { rows: off.rows && off.rows.slice(0, 4), scrollbackTap: forged && (forged.res ? JSON.stringify(forged.res).slice(0, 160) : forged.err), sentAfterTap: sent }, s46), Date.now() - s46);
  } finally {
    await api.setUser({ source: null }).catch(() => null);
    await api.restoreAppSettings();
    await api.resetFlow();
  }
}

/** L74–L88, L95–L98: the content gate. Each needs one particular 6-12 segment AUTHORED (the LLM writes the plan the gate
 *  then reads). The lane seeds Grade 6 and six single segments (supabase/baseline/seed-keep.json) and serves exactly
 *  one authored lesson (grade_6_computer_science c01 p5, from seed-files.txt); a new authoring is a cassette the lane
 *  has never recorded. So each scenario looks its segment up in the run's database and records which part is missing. */
async function contentGate({ rec, want, db }) {
  const AUTHOR = 'authoring it is an LLM call the replay-only lane has no cassette for; recording one is a paid live call and needs an operator go';
  const CASES = [
    ['L74', 'An Urdu plan that uses ordinary religious vocabulary is delivered, not withheld', 'an Urdu 6-12 segment whose text uses «انبیاء»', null],
    ['L75', 'An Islamiat plan names and classifies its surahs correctly, even where the textbook page does not', 'the Grade 11 Islamiat ch 2 segment on pages 10-12', 'grade_11_islamiat%c02%p010-012'],
    ['L76', 'A plan naming an ordinary person called محمد is delivered, because a reviewer cleared it', 'grade_10_urdu.p2c05.p135-135', 'grade_10_urdu.p2c05.p135-135'],
    ['L77', 'An English-medium plan naming the Quaid is delivered, because the same review cleared the Latin spelling', 'an English 6-12 segment with religious content naming "Quaid-e-Azam Muhammad Ali Jinnah"', null],
    ['L78', 'A chained Latin name the book saluted at the end of the chain is delivered', 'an English 6-12 segment naming "Hazrat Muhammad Rasulullah" saluted at the end of the chain', null],
    ['L79', 'A Latin honorific the book printed reaches the teacher as the Arabic stamp', 'an English 6-12 segment naming "Hazrat Muhammad (PBUH)"', null],
    ['L80', 'An "Urdu" plan that is really English is refused, and the English lesson is delivered instead', 'an English-medium 6-12 segment whose Urdu overlay answers in English', null],
    ['L81', 'A سیرت lesson already held for review is delivered in Urdu when the overlay keeps the ﷺ', 'the Grade 9 Islamiyat سیرت segment of an English-medium book, held for G5c review', 'grade_9_islamiyat%'],
    ['L82', 'An Urdu 6-12 plan keeps the board in English and explains each board block in one Urdu line', 'a Grade 8 segment from an English-medium book, in Urdu', 'grade_8_%'],
    ['L83', 'An Urdu 6-12 plan numbers its sections and support pages in Urdu, not Latin letters', 'a 6-12 segment authored in Urdu (the lane\'s one served lesson is English)', null],
    ['L84', 'The common-mistakes box asks what pupils say or write, in both languages', 'a 6-12 segment whose plan lists common mistakes, in English and in Urdu', null],
    ['L85', 'Diagram labels on a 6-12 plan stay readable on a phone', 'a Grade 9 Chemistry segment whose plan carries a labelled diagram', 'grade_9_chemistry%'],
    ['L86', 'A worked scenario never guesses the gender of an unnamed character', 'a 6-12 segment whose worked example has an unnamed helper', null],
    ['L87', 'The last lesson of a chapter names no next lesson', 'the last 6-12 segment of a chapter, authored', null],
    ['L88', 'An Urdu overlay that drops the honorific is refused, and the English lesson is delivered instead', 'the Grade 9 Islamiyat سیرت segment, with an overlay that drops the ﷺ', 'grade_9_islamiyat%'],
    ['L95', 'A plan that names the Prophet without an honorific in teacher-facing text is still withheld', 'a segment whose teacher-facing body names the Prophet with no honorific', null],
    ['L96', 'A Latin name the G5c review did not clear still withholds the lesson', 'English 6-12 segments with religious content naming "Muhammad" / "Muhammad Zubair Farooqi"', null],
    ['L97', 'A Latin salutation the gate cannot reach still withholds the lesson', 'English 6-12 segments with the three uncleared salutations', null],
    ['L98', 'A cache repair that cannot clear its religious content leaves my lesson exactly as it was', 'a served Urdu 6-12 lesson and the overlay repair job, run on demand', null],
  ];
  const gate = async (id) => {
    const [, name, need, like] = CASES.find((c) => c[0] === id);
    if (!want(id)) return;
    let found = null;
    if (like && db) { const rows = await db.get(`niete_lp612_segments?select=segment_id&segment_id=like.${encodeURIComponent(like)}&limit=1`); found = rows[0] ? rows[0].segment_id : false; }
    const where = found ? `${found} is in the lane's seed, but ${AUTHOR}`
      : `${need} is not in the lane's seed (supabase/baseline/seed-keep.json: Grade 6 and six single segments), and ${AUTHOR}`;
    rec(id, name, 'BLOCKED', { reason: 'needs ' + need + ' authored on the lane: ' + where, segment: found }, 0);
  };
  // one call per id: check-scenario-coverage reads `fn('L..'` call sites, never an id inside an array
  await gate('L74');
  await gate('L75');
  await gate('L76');
  await gate('L77');
  await gate('L78');
  await gate('L79');
  await gate('L80');
  await gate('L81');
  await gate('L82');
  await gate('L83');
  await gate('L84');
  await gate('L85');
  await gate('L86');
  await gate('L87');
  await gate('L88');
  await gate('L95');
  await gate('L96');
  await gate('L97');
  await gate('L98');
}

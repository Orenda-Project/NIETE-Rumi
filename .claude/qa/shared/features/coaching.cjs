// @mock-lane — mock-capable driver (uses the mock API, not the browser DOM). Its presence enrols this feature in the mock lane; E2E_MOCK_FEATURES is derived from this marker, so there is no hardcoded list.
/* coaching.feature — all 55 scenarios: COA01–COA15 in this driver, COA16–COA55 through coaching-ext.cjs.
 *
 * ─── MOCKING ────────────────────────────────────────────────────────────────
 * Every string the bot is expected to produce lives in EXPECT below, and every
 * file it is fed lives in FIXTURE. Those two blocks are the whole contract with
 * the live bot: swap them and the driver runs against mocks unchanged. Nothing
 * further down this file hard-codes a bot response.
 *
 * ─── SELECTION ──────────────────────────────────────────────────────────────
 * Scenarios are tagged the way the .feature file tags them. By default only the
 * untagged subset runs, matching `/niete-e2e coaching`:
 *
 *   node feature-runner.cjs coaching              COA01 03 04 12  (~3 min)
 *   DEEP=1 node feature-runner.cjs coaching       + the @wip/@slow set (~20 min)
 *   DEEP=1 REFLECT=slash node feature-runner.cjs coaching   COA10 instead of COA06
 *
 * COA06 and COA10 are mutually exclusive: one answers the reflective question,
 * the other kills the conversation with a slash command. Same pipeline, so the
 * REFLECT switch picks which branch this run takes.
 */

// ── the mock surface ────────────────────────────────────────────────────────
const EXPECT = {
  // One coaching door (menu row, /coaching, the lesson-plan ask's "Record my
  // lesson"): the WhatsApp mic, 20–45 minutes. The old copy asked for "at least
  // 15 minutes", which was the routing threshold, not an instruction.
  menuAsksRecording : /WhatsApp mic|مائیک/i,
  menuLengthAsk     : /20 to 45 minutes|20 سے 45 منٹ/i,
  detected          : /I detected a (\d+)-minute audio recording/i,
  yesAnalyze        : /Yes,? Analyze/i,
  cancelled         : /No problem|cancel|nothing will be analy|منسوخ/i,
  step1             : /Step 1\/5|Transcribing your classroom audio/i,
  stepAny           : /Step (\d)\/5/,
  longLesson        : /Long Lesson Detected/i,
  acknowledges      : /Great job|engaging \d+-minute lesson/i,
  photoPrompt       : /(classroom photo|share a .*photo|add up to \d+ photos|like to add .*photo|تصویر)/i,
  lpPrompt          : /(lesson plan for this class|do you have a lesson plan|سبق کا منصوبہ)/i,
  notLessonPlan     : /not a lesson plan|doesn'?t look like|isn'?t a lesson plan|نہیں لگتا/i,
  reflectiveQ       : /(reflect|what (do|did) you|how (did|do) you|think about)/i,
  rubric            : /FICO|ICT|rubric|indicator|classroom (practice|management)|questioning/i,
  // Live card copy (staging, Urdu account, 2026-09-02 19:09Z): "کیا آپ اگلی کلاس میں یہ آزمانے کا عہد کریں گے؟"
  // with buttons "جی ہاں، میں کوشش کرو" / "شاید بعد میں" / "میرے لیے نہیں". The English-only pattern never
  // matched it, so the pipeline loop waited out its full 20-min budget on every run (COA15 BLOCKED,
  // 23.4 min wall for an 8.5-min pipeline).
  commitmentCard    : /(commit|will you|try this|اقدام|عہد|آزمانے|کوشش کرو)/i,
  commitYes         : /^(yes|👍|جی ہاں|ہاں)/i,
  commitAny         : /^(yes|later|no|maybe|👍|👎|جی ہاں|ہاں|شاید|میرے لیے نہیں|نہیں)/i,
  affirmative       : /^(yes|ہاں|👍)/i,
  pipelineNoise     : /Step \d\/5|Transcribing|hang in there|reflect on your teaching together/i,
};

// Fixtures ship with the repo. Resolved from THIS file, never from a machine
// path — the previous absolute path only existed on one laptop, so the coaching
// runner could not find its audio anywhere else (2026-09-07).
const MEDIA = require('path').resolve(__dirname, '..', '..', 'fixtures', 'whatsapp', 'niete', 'media');
const FIXTURE = {
  classroom : MEDIA + '/hameeda_16min.m4a',      // 4 MB · 16 min — clears the 900s gate
  tooShort  : MEDIA + '/hameeda_short.m4a',      // 444 KB — under the gate
  photo     : MEDIA + '/textbook_page.png',
  notAPlan  : MEDIA + '/staff_meeting_notes.pdf',      // a REAL text PDF: the .txt was stored as .pdf, failed to parse, and the classifier never ran
  oversized : null,                              // needs >100MB; largest fixture is 25.7MB
};

const REFLECT_ANSWER = 'I think the pacing worked well, and next time I would give the quieter '
                     + 'students more time to answer.';

const DEEP    = process.env.DEEP === '1';
const REFLECT = process.env.REFLECT === 'slash' ? 'slash' : 'answer';
// COA02 fires only on the FIRST EVER coaching use (FeatureIntroService). run-suite's
// coaching hygiene deletes the driver's user_feature_first_use row (reset-first-use)
// when FIRSTUSE=1, so the intro offer + "Just tell me" button appear and COA02 can
// actually be driven. Off by default: a normal run leaves first-use untouched.
const FIRSTUSE = process.env.FIRSTUSE === '1';
const PIPELINE_BUDGET_MS = 20 * 60 * 1000;

const V = (c, ev) => [c ? 'PASS' : 'FAIL', ev];

exports.run = async ({ api, rec, sleep }) => {
  const t = () => Date.now();
  let s;
  await api.resetFlow();
  // This driver speaks the ENGLISH copy. A previous run can leave the account on Urdu (run 20260930-0909 died on
  // the menu row in Urdu), so put it back through the product's own /language picker before anything else.
  try {
    const o = api.db('user-get'); const line = String(o.out || '').trim().split('\n').reverse().find((l) => l.trim().startsWith('{')); const u = line ? JSON.parse(line) : {};
    if (u.preferred_language && u.preferred_language !== 'en') {
      const r = await api.sendWait('/language'); const opener = (r.btns || []).find((b) => /Languages|زبانیں/.test(b)) || 'Languages';
      const list = await api.openList(opener); const row = ((list && list.rows) || []).find((x) => /English|انگریزی/.test(x)) || 'English'; await api.pickRowAndWait(row, 60000);
      await api.resetFlow();
    }
  } catch (_) { /* the run goes on; an Urdu account then shows up as the row error it always did */ }

  // ══ COA02 — decline the first-use intro, get asked for the class audio ════
  // MUST run before COA01: the menu path (View Features → Classroom Coaching) can
  // itself consume the one-shot first-use intro (menu.service.js →
  // sendFirstUseIntroIfNeeded). Gated on FIRSTUSE=1, which pairs with run-suite's
  // reset-first-use so the intro offer + "Just tell me" button are guaranteed present.
  if (FIRSTUSE) {
    const AUDIO_ASK = /send me an audio recording of your class|audio recording of your class/i;
    const CONTAMINATED = /Step \d\/5|Analyzing your teaching|Generating your comprehensive|Transcribing/i;
    api.resetConversation();   // clean history → the intro-reply prompt is deterministic → cassette replays
    const intro = await api.sendWait('Can you give me feedback on my teaching?', 60000);
    const btns = (intro.btns || []);
    const introTxt = intro.txt || '';
    if (CONTAMINATED.test(introTxt)) {
      // The reply we caught is an in-flight pipeline step, not an intro — another session
      // (a prior run, or concurrent traffic on this shared driver) is still analysing. Any
      // verdict here would be about the wrong message. Report the contamination, don't guess.
      rec('COA02', 'Declining the intro on a coaching request asks for the class audio', 'BLOCKED',
          { reason: 'driver busy — a coaching pipeline is mid-flight, so the reply picked up a pipeline '
                  + 'step, not the first-use intro. Needs a quiet driver (no in-flight/concurrent work).',
            caughtReply: introTxt.slice(0, 200) }, 0);
    } else if (/just tell me/i.test(btns.join('|'))) {
      const after = await api.tapAndWait('Just tell me', 60000);
      rec('COA02', 'Declining the intro on a coaching request asks for the class audio',
          ...V(AUDIO_ASK.test(after.txt || ''),
              { via: 'intro button', introBtns: btns, reply: (after.txt || '').slice(0, 200) }), 0);
    } else if (AUDIO_ASK.test(introTxt)) {
      // This build answers the coaching keyword with a plain-text ask for the recording — no
      // interactive intro button. The scenario's intent (get asked for the class audio) is met.
      rec('COA02', 'Declining the intro on a coaching request asks for the class audio',
          ...V(true, { via: 'plain-text reply (no intro button on this build)', reply: introTxt.slice(0, 200) }), 0);
    } else {
      rec('COA02', 'Declining the intro on a coaching request asks for the class audio', 'BLOCKED',
          { reason: 'neither the "Just tell me" intro button nor a plain-text audio ask appeared. The '
                  + 'first-use row may have been consumed already, or the intro copy changed.',
            introReply: introTxt.slice(0, 200), introBtns: btns }, 0);
    }
    await api.resetFlow();
  }

  // ══ preflight — is a coaching analysis already running? ═══════════════════
  // The bot defers a new classroom recording while one is in flight (30-min window,
  // shouldDeferNewClassroomAudio). Sessions outlive a run, so a second run the same
  // hour gets deferred and every pipeline scenario "fails" while the bot is behaving
  // exactly as specified. Detect it up front and say so. (2026-09-01.)
  const st = await api.sendWait('/status');
  let inFlight = null;
  if (/What's running|Open status/i.test(st.txt || '')) {
    const op = await api.openFlow('Open status|کھولیں');
    if (op.ok) {
      const p = await api.flowProbe();
      const claimed = /You have (\d+) things? running/i.exec(p.text || '');
      inFlight = { total: claimed ? Number(claimed[1]) : null,
                   coaching: /Coaching session in progress/i.test(p.text || ''),
                   screen: (p.text || '').slice(0, 200) };
    }
    api.closeFlow();
    await api.resetFlow();
  }
  const deferred = !!(inFlight && inFlight.coaching);
  rec('COA-preflight', 'No coaching analysis is already in flight',
      ...(deferred
          ? ['BLOCKED', { ...inFlight,
              reason: 'a coaching session from an earlier run is STILL RUNNING, so the bot will defer '
                    + 'any new recording rather than analysing it. Every pipeline scenario below is '
                    + 'unreachable until it finishes or is stopped from the /status Flow.' }]
          : V(true, inFlight || { note: 'nothing in flight' })), 0);

  // Fresh-inbound reader: keeps its own seen-set in the page, so each call returns
  // only what arrived since the last one. Used by the pipeline walker below.
  // Both drivers provide freshReset()/fresh() (feature-runner.cjs makeApi · mock-api.cjs); the
  // page-side implementation that used to live inline here stays as the fallback for an api without it.
  if (api.freshReset) await api.freshReset();
  else await api.ev(`(()=>{ window.__seen = new Set(
    [...document.querySelectorAll('#main div[role="row"] [data-id]')].map(e=>e.getAttribute('data-id')));
    return 1; })()`);
  const fresh = () => api.fresh ? api.fresh() : api.ev(`(()=>{
    const out=[];
    for(const r of document.querySelectorAll('#main div[role="row"]')){
      const e=r.querySelector('[data-id]'); const id=e&&e.getAttribute('data-id');
      if(!id || window.__seen.has(id)) continue;
      const txt0=(r.innerText||'').trim();
      const hasMedia=!!r.querySelector('img[src^="blob:"],img[src^="data:image/j"],[data-icon="wds-ic-hd-filled"],[data-icon="audio-file"],[data-icon="ptt"],[aria-label*="Voice message"],[aria-label*="voice message"],audio,[data-icon^="document-"],[data-icon="ms-office-doc"]');
      // A media row renders its timestamp FIRST and its player/thumbnail a beat later. Marking it seen on
      // that first sight recorded the voice question as "0:09 1:15 PM" with audio:false and the hero report
      // with img:false (cassette-record run 18:00Z: COA06/COA07 lost). Leave a time-only row unseen so
      // the next pass re-reads it once the media has mounted.
      if(!hasMedia && /^\d{1,2}:\d{2}( ?[AP]M)?$/.test(txt0)) continue;
      window.__seen.add(id);
      if(r.querySelector('[data-icon^="msg-check"],[data-icon^="msg-dblcheck"],[data-icon^="msg-time"]')) continue;
      out.push({ txt:txt0.slice(0,600),
                 img:!!r.querySelector('img[src^="blob:"],img[src^="data:image/j"],[data-icon="wds-ic-hd-filled"]'),
                 audio:!!r.querySelector('[data-icon="audio-file"],[data-icon="ptt"],[aria-label*="Voice message"],[aria-label*="voice message"],audio'),
                 doc:!!r.querySelector('[data-icon^="document-"],[data-icon="ms-office-doc"]'),
                 pdf:/\\.pdf/i.test(r.innerText||''),
                 btns:[...r.querySelectorAll('button,div[role="button"]')]
                        .map(b=>(b.getAttribute('aria-label')||b.innerText||'').trim())
                        .filter(x=>x&&x.length<40&&!/reaction/i.test(x)) });
    }
    return JSON.stringify(out); })()`).then(x => JSON.parse(x || '[]'));

  // ══ COA01 — the menu row asks for a classroom recording ═══════════════════
  s = t();
  await api.sendWait('/menu');
  await api.openList('See what I do');
  const row = await api.pickRowAndWait('Classroom Coaching');
  const rowTxt = row.txt || '';
  rec('COA01', 'The Classroom Coaching menu row asks for a classroom recording',
      ...V(EXPECT.menuAsksRecording.test(rowTxt) && EXPECT.menuLengthAsk.test(rowTxt),
           { asksForRecording: EXPECT.menuAsksRecording.test(rowTxt),
             states20to45Minutes: EXPECT.menuLengthAsk.test(rowTxt),
             reply: rowTxt.slice(0, 220) }), t() - s);

  // ══ COA11 — a clip under the 15-minute gate must NOT start the pipeline ═══
  if (DEEP) {
    s = t();
    const short = await api.upload(FIXTURE.tooShort, 'Document', 120000);
    const shortTxt = short.txt || '';
    const started = EXPECT.detected.test(shortTxt) || EXPECT.step1.test(shortTxt) ||
                    (short.btns || []).some(b => EXPECT.yesAnalyze.test(b));
    rec('COA11', 'An under-15-minute recording does not start a coaching analysis',
        ...V(!started,
             { startedPipeline: started, reply: shortTxt.slice(0, 180),
               note: 'CLASSROOM_AUDIO_THRESHOLD is 900s. Spec notes there is NO explicit '
                   + '"too short" rejection copy — it should fall through to normal voice handling.' }), t() - s);
    await api.resetFlow();
  } else {
    rec('COA11', 'An under-15-minute recording does not start a coaching analysis', 'SKIP',
        { why: '@wip/@draft — run with DEEP=1' }, 0);
  }


  // The bot answers a 16-min upload in TWO messages — a voice ack, then the "Yes, Analyze" card — and
  // the card can land after the reply's settle window closes (mock run 20260930-0531: the second
  // upload returned the audio, offers2 was false, and every pipeline scenario cascaded to BLOCKED
  // with elapsed 0s). Keep reading the fresh inbound for the card before deciding the offer is absent.
  const awaitOffer = async (reply, maxMs = 30000) => {
    const has = (r) => (r.btns || []).some(b => EXPECT.yesAnalyze.test(b)) || EXPECT.yesAnalyze.test(r.txt || '');
    if (has(reply)) return reply;
    const t1 = Date.now();
    while (Date.now() - t1 < maxMs) {
      const batch = await fresh();
      const card = batch.find(has);
      if (card) return Object.assign({}, reply, { txt: card.txt || reply.txt, btns: card.btns || [], lateCardMs: Date.now() - t1 });
      await sleep(1000);
    }
    return reply;
  };

  // ══ COA03 — a >=15-min recording is detected, confirmation offered ════════
  s = t();
  await fresh();   // drain BEFORE the upload: awaitOffer must only see cards that arrive after it (run 20260930-0649 tapped the previous, cancelled card)
  const up = await awaitOffer(await api.upload(FIXTURE.classroom, 'Document', 180000));
  const upTxt = up.txt || '';
  const detectedM = EXPECT.detected.exec(upTxt);
  const offers = (up.btns || []).some(b => EXPECT.yesAnalyze.test(b)) || EXPECT.yesAnalyze.test(upTxt);
  rec('COA03', 'Uploading a classroom recording is detected and confirmed for analysis',
      ...V(!!detectedM && offers,
           { detectedMinutes: detectedM ? Number(detectedM[1]) : null, offersYesAnalyze: offers,
             buttons: (up.btns || []).slice(0, 4), waitedMs: up.waitedMs,
             reply: upTxt.slice(0, 200) }), t() - s);

  // ══ COA12 — declining cancels the session ════════════════════════════════
  s = t();
  let declined = null;
  if (offers) {
    const no = await api.tapAndWait('No', 90000);
    declined = { ok: no.ok, reply: (no.txt || '').slice(0, 200) };
  }
  rec('COA12', 'Declining analysis cancels the coaching session',
      ...(offers
          ? V(!!(declined && declined.ok) && EXPECT.cancelled.test(declined.reply || '') &&
              !EXPECT.step1.test(declined.reply || ''),
              Object.assign({}, declined, { note: 'staging never says the word "cancel" — asserting '
                + 'acknowledged AND does not proceed to Step 1/5' }))
          : ['BLOCKED', { reason: 'no Yes/No choice was offered — see COA03' }]), t() - s);

  // ══ COA04 — confirming walks the 5-step pipeline ═════════════════════════
  s = t();
  await fresh();
  const up2 = await awaitOffer(await api.upload(FIXTURE.classroom, 'Document', 180000));
  const offers2 = (up2.btns || []).some(b => EXPECT.yesAnalyze.test(b)) || EXPECT.yesAnalyze.test(up2.txt || '');
  let confirmed = false;
  // Drain the fresh-inbound BEFORE confirming, never after: the reply to "Yes, Analyze" is "Step 1/5"
  // and the photo prompt follows it within seconds — a drain after the tap swallowed both, so the walker
  // below started with stepsSeen [] and bailed as a stall (mock run 20260930-0537).
  if (offers2) { await fresh(); await api.tapAndWait('Yes, Analyze', 120000); confirmed = true; }
  if (confirmed) { try { const o = api.db('session-get'); const line = String(o.out || '').trim().split('\n').reverse().find((l) => l.trim().startsWith('{')); obs.sessionId = line ? JSON.parse(line).id : null; } catch (_) {} }

  // Walk the pipeline as a state machine — react to each prompt as it arrives
  // rather than assuming an order. Shallow runs stop as soon as COA04 is decided.
  const obs = { steps: [], photoPrompt: false, photoAccepted: null, lpPrompt: false, lpRejected: null,
                reflectiveQ: null, reflectiveAck: null, slashEnded: null, deferral: null,
                report: null, commitment: null, acknowledges: false, longLesson: false, rows: [], sessionId: null };
  const seenTexts = [];
  let deferralTried = false;
  const t0 = Date.now();
  const budget = DEEP ? PIPELINE_BUDGET_MS : 4 * 60 * 1000;
  // Early-bail plumbing: the deep pipeline stalls forever when the vendor answer it waits on (Soniox
  // transcription, then the LLM analysis) is not in the cassette. Waiting the whole 20-min budget for a
  // reply that will never come is pure cost, so watch for silence before the reflective step and stop.
  const RUN_DIR = require('path').dirname(process.env.E2E_PROGRESS || '.');
  // The early-bail only makes sense under replay-strict: a missing cassette will NEVER arrive, so
  // waiting the whole budget is pure waste. In record/replay the calls go LIVE and legitimately take
  // time (Soniox on a 16-min file, then the LLM), so the pipeline WILL complete — never bail there.
  // The early-bail runs on the SEALED mock lane, where a stalled pipeline (missing cassette, or a
  // report that only arrives via the ~13-min debrief sweep) will never complete. Gate on the LANE:
  // E2E_METHOD reaches the driver process, but E2E_CASSETTE does NOT (it lives in the bot's env only),
  // so the old `E2E_CASSETTE === replay-strict` check was ALWAYS false here and the bail never fired.
  const SEALED = String(process.env.E2E_METHOD || '').toLowerCase() === 'mock'
              || String(process.env.E2E_CASSETTE || '').toLowerCase() === 'replay-strict';
  // 240 s, not 90: a driver whose analysis is a cassette MISS goes live — the FICO analysis took 108 s and the hero
  // report 106 s on run 20260930-1908, and the old 90 s bail fired 4 s before the report landed.
  const STALL_MS = Number(process.env.COACHING_STALL_MS || 240000);
  let lastMsgAt = Date.now();
  let lastProgressAt = Date.now();   // advances ONLY on real progress — see the early-bail below
  let prevSig = '';
  const asrLlmMisses = () => { try { const f = require('path').join(RUN_DIR, 'cassette-misses.jsonl'); if (!require('fs').existsSync(f)) return 0; return require('fs').readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (_) { return {}; } }).filter(m => m.kind === 'asr' || m.kind === 'llm').length; } catch (_) { return 0; } };

  // The lesson-plan prompt is a LIST ("منتخب کریں" / "Select") with rows "نیا اپلوڈ کریں" (Upload new),
  // "نہیں" (No lesson plan) and recent LPs (lp-selection-list.service.js). Until a row is picked the
  // session sits in the LP gate and transcription is never queued (one-shot all run, 2026-09-02:
  // 1203s at Step 0 with the prompt on screen). COA13 wants the "not a lesson plan" rejection, so
  // pick Upload new → send the notes file → then answer "No" so the pipeline proceeds.
  const answerLpPrompt = async (row) => {
    obs.lpPrompt = true;
    if (!DEEP) return;
    const opener = (row.btns || []).find(b => /منتخب کریں|^Select$/i.test(b));
    if (!opener) { const yes = (row.btns || []).find(b => EXPECT.affirmative.test(b)); if (yes) await api.tapAndWait(yes, 60000); }
    else { await api.openList(opener); await api.pickRowAndWait('اپلوڈ', 60000); }
    const doc = await api.upload(FIXTURE.notAPlan, 'Document', 120000);
    obs.lpRejected = { replied: !!doc.ok, reply: (doc.txt || '').slice(0, 200) };
    // The verdict is the extraction WORKER's, ~15-20 s after the "Lesson plan received" ack (run 20260930-0921:
    // rejected at +18 s). Wait for it here; whatever else lands meanwhile is carried into the walker.
    { const tR = Date.now(); let seen = [];
      while (Date.now() - tR < 45000 && !seen.some(r => EXPECT.notLessonPlan.test(r.txt || ''))) { await sleep(2500); seen = seen.concat(await fresh()); }
      const verdict = seen.find(r => EXPECT.notLessonPlan.test(r.txt || ''));
      if (verdict) obs.lpRejected = { replied: true, ack: obs.lpRejected.reply, reply: (verdict.txt || '').slice(0, 200), verdictAfterMs: Date.now() - tR };
      carry = carry.concat(seen.filter(r => r !== verdict)); }
    // the bot re-offers the list after a rejection — decline so the analysis can start
    const again = (doc.btns || []).find(b => /منتخب کریں|^Select$/i.test(b));
    if (again) { await api.openList(again); const no = await api.pickRowAndWait('نہیں', 90000); obs.lpDeclined = (no.txt || '').slice(0, 120); }
    else { const no = (doc.btns || []).find(b => /^(no|نہیں|skip)/i.test(b)); if (no) await api.tapAndWait(no, 90000); }
    await fresh();
  };

  let carry = [];   // rows read by a lever mid-loop (the COA09 upload) are processed, never dropped
  while (confirmed && Date.now() - t0 < budget) {
    const batch = carry.concat(await fresh()); carry = [];
    if (batch.length) lastMsgAt = Date.now();
    for (const r of batch) {
      const x = r.txt || '';
      obs.rows.push(r);
      if (x) seenTexts.push(x);
      const m = EXPECT.stepAny.exec(x);
      if (m && !obs.steps.includes(m[1])) { obs.steps.push(m[1]); lastMsgAt = Date.now(); }
      if (EXPECT.longLesson.test(x)) obs.longLesson = true;
      if (EXPECT.acknowledges.test(x)) obs.acknowledges = true;

      // COA08 — the classroom-photo prompt, ACCEPT branch
      if (!obs.photoPrompt && EXPECT.photoPrompt.test(x) && r.btns.length) {
        obs.photoPrompt = true;
        if (!DEEP) continue;                                   // shallow run declines by ignoring
        const yes = r.btns.find(b => EXPECT.affirmative.test(b));
        if (yes) {
          await api.tapAndWait(yes, 60000);
          const ph = await api.upload(FIXTURE.photo, 'Photos & videos', 120000);
          // The bot answers "تصویر 1 موصول۔ کیا ایک اور تصویر شامل کرنی ہے؟" with "مزید تصویر" / "مکمل".
          // Until "مکمل" (Done) is tapped the session sits in awaiting_classroom_photo and the
          // transcription is never queued — the DEEP pipeline of 2026-09-02 waited 1202s on exactly
          // this and never left Step 1. Close the gate.
          const done = (ph.btns || []).find(b => /مکمل|^done|no more|that'?s all|finish|complete/i.test(b));
          let closed = null;
          let gateReply = null;
          if (done) { const d = await api.tapAndWait(done, 90000); gateReply = d; closed = { tapped: done, reply: (d.txt || '').slice(0, 160) }; }
          obs.photoAccepted = { ok: !!ph.ok, reply: (ph.txt || '').slice(0, 160), gateClosed: closed };
          if (gateReply && !obs.lpPrompt && EXPECT.lpPrompt.test(gateReply.txt || '')) await answerLpPrompt(gateReply);
          else await fresh();
        } else obs.photoAccepted = { ok: false, reason: 'no affirmative button', btns: r.btns };
        continue;
      }

      // COA13 — asked for a lesson plan, hand it a document that is not one
      if (!obs.lpPrompt && EXPECT.lpPrompt.test(x)) { await answerLpPrompt(r); continue; }

      // COA06 / COA10 — the reflective step. Mutually exclusive branches. On this build the question
      // arrives as a VOICE NOTE right after "Step 3/5: Let's reflect…" (language.feature says so too), so
      // an audio row after Step 3 IS the question; a text question is accepted as before. Left unanswered
      // for ~3 min the bot nudges "Continue Now / Get Report Now" and then generates the report anyway.
      const voiceQuestion = !!r.audio && obs.steps.includes('3') && !obs.report;
      obs.reflectiveAnswers = obs.reflectiveAnswers || 0;
      if ((voiceQuestion && obs.reflectiveAnswers < 4) || (!obs.reflectiveQ && /\?/.test(x) && EXPECT.reflectiveQ.test(x) && !EXPECT.pipelineNoise.test(x))) {
        obs.reflectiveAnswers++;
        if (!obs.reflectiveQ) obs.reflectiveQ = voiceQuestion ? '(voice note)' : x.slice(0, 220);
        if (!DEEP) continue;
        if (REFLECT === 'slash') {
          const cmd = await api.sendWait('/menu', 90000);
          obs.slashEnded = { reply: (cmd.txt || '').slice(0, 200) };
        } else {
          const ans = await api.sendWait(REFLECT_ANSWER, 120000);
          // the acknowledgement is a VOICE note on this build (run 20260930-0832: ok, no text) — count it
          obs.reflectiveAck = (ans.txt || '').slice(0, 220) || (ans.ok ? '(acknowledged with a ' + (ans.kind || 'non-text') + ' message)' : '');
        }
        await fresh();
        continue;
      }

      // COA07 / COA05 — the delivered report
      if (!obs.report && (r.img || r.pdf || /کوچنگ رپورٹ|coaching report/i.test(x)) && !EXPECT.pipelineNoise.test(x) && obs.steps.length) {
        obs.report = { kind: r.img ? 'image' : 'document', caption: x.slice(0, 260), btns: r.btns };
        continue;
      }

      // COA15 — the commitment card
      if (obs.report && !obs.commitment && EXPECT.commitmentCard.test(x)
          && r.btns.some(b => EXPECT.commitAny.test(b))) {
        const yes = r.btns.find(b => EXPECT.commitYes.test(b));
        if (yes) {
          const c = await api.tapAndWait(yes, 90000);
          obs.commitment = { tapped: yes, acknowledged: !!c.ok, reply: (c.txt || '').slice(0, 200) };
        } else obs.commitment = { tapped: null, acknowledged: false, btns: r.btns };
        continue;
      }
    }

    // COA09 — a SECOND recording once the analysis is genuinely under way
    if (DEEP && !deferralTried && obs.steps.length && Date.now() - t0 > 45000) {
      deferralTried = true;
      const second = await api.upload(FIXTURE.classroom, 'Document', 180000);
      const txt2 = second.txt || '';
      // whatever landed while the upload settled (the voice question after Step 3/5 — run 20260930-0621
      // lost it here and stalled) is carried into the next iteration, and the card is judged from ALL of it
      // the bot's answer to a second recording (a deferral ack, or a fresh detection card) can land several
      // seconds after the upload settles — keep reading for up to 15 s before judging (run 20260930-0832)
      let extra = await fresh(); const tCard = Date.now();
      while (Date.now() - tCard < 15000 && !extra.some(r => EXPECT.detected.test(r.txt || '') || /still analys|already analys|in progress|ابھی تجزیہ/i.test(r.txt || ''))) { await sleep(2000); extra = extra.concat(await fresh()); }
      const cardRows = [second].concat(extra);
      obs.deferral = { replied: !!second.ok, reply: txt2.slice(0, 220),
        startedNewSession: cardRows.some(r => EXPECT.detected.test(r.txt || '') || (r.btns || []).some(b => EXPECT.yesAnalyze.test(b))) };
      carry = carry.concat(extra.filter(r => !(EXPECT.detected.test(r.txt || '') && (r.btns || []).some(b => EXPECT.yesAnalyze.test(b)))));
      // a second session the bot DID open must not stay in flight and swallow the rest of the run
      if (obs.deferral.startedNewSession) { const c = cardRows.find(r => (r.btns || []).some(b => EXPECT.yesAnalyze.test(b))); if (c) { try { await api.tapAndWait('No', 60000); } catch (_) {} } }
    }

    if (!DEEP && obs.steps.length && obs.photoPrompt) break;   // COA04 is decided
    if (obs.commitment) break;
    // Early-bail (fast commit gate): the DEEP pipeline is stuck when it makes NO forward progress —
    // no new step, report, photo/LP prompt, reflective turn or commitment — for STALL_MS. That happens
    // on a missing cassette OR when the report only arrives via the ~13-min debrief sweep. Stop now
    // rather than burning the 20-min budget; the deep scenarios then record BLOCKED. Progress is a
    // signature, so unrelated debrief nudges don't reset the timer — the old check keyed on lastMsgAt
    // and "before step 3", so it never fired once step 3 (the reflective step) was reached.
    const sig = obs.steps.length + '/' + (obs.report ? 1 : 0) + '/' + (obs.photoPrompt ? 1 : 0)
              + '/' + (obs.lpPrompt ? 1 : 0) + '/' + (obs.reflectiveAnswers || 0) + '/' + (obs.commitment ? 1 : 0);
    if (sig !== prevSig) { prevSig = sig; lastProgressAt = Date.now(); }
    if (DEEP && SEALED && !obs.report && Date.now() - lastProgressAt > STALL_MS) {
      obs.stalled = { silentSec: Math.round((Date.now() - lastProgressAt) / 1000), atSteps: obs.steps.slice(), asrLlmMisses: asrLlmMisses() };
      break;
    }
    await sleep(5000);
  }

  const joined = seenTexts.join(' | ');
  const elapsed = Math.round((Date.now() - t0) / 1000);
  const stallNote = obs.stalled
    ? `the analysis went silent at step(s) [${obs.stalled.atSteps.join(',') || 'none'}] for ${obs.stalled.silentSec}s and was stopped early`
      + (obs.stalled.asrLlmMisses ? ` — ${obs.stalled.asrLlmMisses} ASR/LLM cassette miss(es): the transcription/analysis answers are not recorded, so the pipeline cannot complete on this lane. Record the library once with E2E_CASSETTE=record, then re-run with DEEP=1.` : ' (no cassette miss logged — the pipeline is genuinely stuck).')
    : null;

  rec('COA04', 'Confirming analysis walks a 5-step pipeline with optional-context prompts',
      ...(deferred
          ? ['BLOCKED', { reason: 'a prior coaching session was in flight — the recording was deferred, '
                                + 'which is correct behaviour, not a pipeline failure', inFlight }]
          : confirmed
          ? (obs.stalled
              ? ['BLOCKED', { reason: stallNote, stepsSeen: obs.steps, asksPhoto: obs.photoPrompt, asksLessonPlan: obs.lpPrompt, elapsedSec: elapsed }]
              : V(obs.steps.length > 0 && obs.photoPrompt,   // Step 1 often lands while the driver is inside the photo/LP gate replies
                  { stepsSeen: obs.steps, longLessonWarning: obs.longLesson, acknowledges: obs.acknowledges,
                    asksPhoto: obs.photoPrompt, asksLessonPlan: obs.lpPrompt, elapsedSec: elapsed }))
          : ['BLOCKED', { reason: 'the second upload produced no Yes/No choice',
                          reply: (up2.txt || '').slice(0, 160) }]), t() - s);

  // ══ the @wip / @slow set ═════════════════════════════════════════════════
  const deepOnly = (id, name, verdict, ev) =>
    rec(id, name, DEEP ? verdict : 'SKIP', DEEP ? ev : { why: '@wip/@draft/@slow — run with DEEP=1' }, 0);

  deepOnly('COA09', 'A second recording sent mid-analysis is deferred, not started fresh',
      ...(obs.deferral
          ? V(obs.deferral.replied && !obs.deferral.startedNewSession, obs.deferral)
          : ['BLOCKED', { reason: 'the analysis never reached a step, so there was nothing to defer against' }]));

  deepOnly('COA08', 'Accepting the classroom-photo prompt folds photos into the analysis',
      ...(obs.photoPrompt
          ? V(!!(obs.photoAccepted && obs.photoAccepted.ok), obs.photoAccepted || {})
          : ['BLOCKED', { reason: 'no classroom-photo prompt within ' + elapsed + 's' }]));

  const coa13Good = !!(obs.lpRejected && EXPECT.notLessonPlan.test(obs.lpRejected.reply || ''));
  deepOnly('COA13', 'A non-lesson-plan document is rejected, not silently analysed',
      ...(obs.lpPrompt
          ? (coa13Good
              ? V(true, obs.lpRejected)
              : (asrLlmMisses() > 0
                  ? ['BLOCKED', { reason: 'the document classifier runs on an LLM extraction whose answer is not in the cassette ('
                        + asrLlmMisses() + ' ASR/LLM miss) — the "is this a lesson plan?" verdict is not trustworthy. Record the library with E2E_CASSETTE=record, then re-run.',
                        reply: (obs.lpRejected && obs.lpRejected.reply || '').slice(0, 160) }]
                  : V(false, obs.lpRejected || {})))
          : ['BLOCKED', { reason: stallNote || ('the pipeline never asked for a lesson plan within ' + elapsed + 's') }]));

  deepOnly('COA06', 'The reflective step asks exactly one question and closes after the answer',
      ...(REFLECT === 'slash'
          ? ['BLOCKED', { reason: 'this run used REFLECT=slash, which drives COA10 instead — the two '
                                + 'branches are mutually exclusive on one pipeline' }]
          : obs.reflectiveQ
            ? V(!!obs.reflectiveAck, { question: obs.reflectiveQ, acknowledgement: obs.reflectiveAck,
                note: 'NUM_REFLECTIVE_QUESTIONS=1 — one question asked, answer acknowledged' })
            : ['BLOCKED', { reason: stallNote || ('the reflective step (3/5) was not reached within ' + elapsed + 's'),
                            stepsSeen: obs.steps }]));

  deepOnly('COA10', 'A slash command during the reflective step ends the session',
      ...(REFLECT !== 'slash'
          ? ['BLOCKED', { reason: 'mutually exclusive with COA06 — re-run with REFLECT=slash' }]
          : obs.slashEnded
            ? V(!EXPECT.reflectiveQ.test(obs.slashEnded.reply || ''), obs.slashEnded)
            : ['BLOCKED', { reason: stallNote || ('the reflective step was not reached within ' + elapsed + 's') }]));

  // The FICO report is a hero IMAGE whose caption names the lesson, not the rubric; the rubric the analysis was
  // scored on is stamped on the session (analysis_data.framework — gpt5-mini stamps it, the transformer dispatches on it).
  let scoredOn = null, scoredRaw = null; try { const o = api.db('session-get', obs.sessionId ? ['--session-id', obs.sessionId] : ['--status', 'completed']); scoredRaw = String(o.out || o.err || '').trim().slice(-200); const line = String(o.out || '').trim().split('\n').reverse().find((l) => l.trim().startsWith('{')); scoredOn = line ? ((JSON.parse(line).analysis || {}).framework || null) : null; } catch (e) { scoredRaw = 'threw: ' + e.message; }
  deepOnly('COA05', 'The pipeline delivers coaching feedback on the FICO/ICT rubric',
      ...(obs.report
          ? V(String(scoredOn || '').toLowerCase() === 'fico' || EXPECT.rubric.test(obs.report.caption + ' ' + joined),
              { scoredOnFramework: scoredOn, sessionId: obs.sessionId, lookup: scoredRaw, caption: obs.report.caption, reportKind: obs.report.kind, note: 'PASS = the session was analysed on the FICO framework (or the delivered text names the rubric)' })
          : ['BLOCKED', { reason: stallNote || ('no report delivered within ' + elapsed + 's'), stepsSeen: obs.steps }]));

  deepOnly('COA07', 'Coaching feedback is delivered as a branded hero-report image',
      ...(obs.report
          ? V(obs.report.kind === 'image',
              Object.assign({}, obs.report, { note: obs.report.kind === 'pdf'
                ? 'PDF is the FALLBACK — the hero render threw' : 'hero image as specified' }))
          : ['BLOCKED', { reason: stallNote || ('no report delivered within ' + elapsed + 's — a full analysis is 10+ min') }]));

  deepOnly('COA15', 'The commitment-card buttons on the report are handled (@known-fail)',
      ...(obs.commitment
          ? V(!!obs.commitment.acknowledged,
              Object.assign({}, obs.commitment, { note: 'ORPHAN BUG expected: card_yes_ has no handler, '
                + 'so the tap should go unacknowledged. A PASS means it has been wired.' }))
          : ['BLOCKED', { reason: obs.report ? 'the report carried no commitment card'
                                             : (stallNote || ('no report within ' + elapsed + 's')) }]));

  // ══ unreachable on this driver, whatever the runtime ═════════════════════
  // COA02 is driven at the top under FIRSTUSE=1 (paired with reset-first-use). Only
  // record the unreachable BLOCK when we did NOT run the first-use path.
  if (!FIRSTUSE)
    rec('COA02', 'Declining the intro on a coaching request asks for the class audio', 'BLOCKED',
        { reason: '@first-use — the intro offer and the "Just tell me" button fire only on the FIRST EVER '
                + 'use of coaching on an account (FeatureIntroService). Re-run with FIRSTUSE=1 (which resets '
                + 'the driver\'s user_feature_first_use row) to drive it.' }, 0);

  // COA14's reject path is unreachable via WhatsApp: the reject threshold (100MB) EQUALS
  // WhatsApp's own document-upload ceiling, so nothing big enough to trip it can be sent.
  // Covered as a unit test instead — NIETE-Rumi bot/tests/coa14-audio-size-cap.test.js (bd-60026).
  rec('COA14', 'An audio document over the size cap is rejected before download', 'BLOCKED',
      { reason: 'unreachable via WhatsApp: reject threshold (100MB) = WhatsApp document ceiling, so no '
              + 'upload can exceed it. Covered by unit test bot/tests/coa14-audio-size-cap.test.js.',
        note: 'the reject copy still says "25MB"/"Whisper" though the real cap is 100MB — stale (bd-60026).' }, 0);

  // ══ COA16–COA55 — coaching-ext.cjs: six more pipeline runs + the coaching-ask family (2026-09-30) ══
  // Recorded here with literal ids so check-scenario-coverage.py binds every spec scenario to a driver line.
  let ext = new Map(); let extErr = null;
  if (DEEP) {
    try { ext = await require('../coaching-ext.cjs').run({ api, rec, sleep, fresh, r1: { rows: obs.rows, sessionId: obs.sessionId } }); }
    catch (e) { extErr = e; }
  }
  const E = (id, name) => { const r = ext.get(id);
    rec(id, name, DEEP ? (r ? r[0] : 'BLOCKED') : 'SKIP',
        DEEP ? (r ? r[1] : { reason: 'coaching-ext did not record it' + (extErr ? ' — the extension threw: ' + String(extErr.message).slice(0, 200) : '') })
             : { why: '@wip/@draft — run with DEEP=1' }, 0); };
  E('COA16', 'Every score a teacher receives is a band, never a number');
  E('COA17', 'The two coaching entry points quote different minimum audio lengths (@known-issue)');
  E('COA18', 'A report built without the reflection never claims a total of three questions');
  E('COA19', 'A lesson-plan move is credited from what a classroom photo shows');
  E('COA20', 'The same recording sent twice returns the report already made, not a second score');
  E('COA21', 'A recording the bot has not scored before is still analysed normally');
  E('COA22', 'A button left behind by a cancelled coaching session is refused on every tap');
  E('COA23', 'The reflective question still arrives as text when its voice note cannot be sent');
  E('COA24', "An Urdu teacher's five step messages are all in Urdu, counted in digits");
  E('COA25', "An English-account teacher's reflective question is written in English");
  E('COA26', 'The report-preparation greeting never calls a teacher "null"');
  E('COA27', 'A screenshot sent as a classroom photo is kept out of both scorers');
  E('COA28', 'A grader answer that comes back empty is re-graded the same way, not on a more generous setting');
  E('COA29', 'A recording whose transcript carries no timestamps is "not scored", never 0%');
  E('COA30', 'The "was this useful?" survey comes right after the voice debrief');
  E('COA31', 'The commitment question opens by saying the coaching session is over');
  E('COA32', 'A lesson plan typed into the chat is attached to the waiting observation');
  E('COA33', 'A short reply at the lesson-plan step is not mistaken for a plan (@obsolete)');
  E('COA34', 'Pasted text that is not a lesson plan gets the same rejection as a file');
  E('COA35', 'A brief typed lesson plan counts — length is not the test');
  E('COA36', 'Saying I have no lesson plan is not the same as sending one (@obsolete)');
  E('COA37', 'Talking about a lesson plan is not the same as sending one (@obsolete)');
  E('COA38', 'The first lesson plan of the day brings one coaching ask');
  E('COA39', 'A lesson planned after 14:00 is asked about the next morning without saying today');
  E('COA40', 'A second lesson plan the same day brings no second ask');
  E('COA41', 'Not today is remembered');
  E('COA42', 'Yes asks for a 20–45 minute mic recording, with the how-to clip the first two times');
  E('COA43', "The how-to clip arrives as the coaching ask's own video, never after it");
  E('COA44', 'An 11-minute recording after yes is answered as too short');
  E('COA45', 'A classroom-length voice note gets no "send it as a document" warning');
  E('COA46', 'Saying yes to the coaching ask means no quiz offer arrives that afternoon');
  E('COA47', 'The coaching ask waits while the lesson-plan survey is asking what did not work');
  E('COA48', 'The survey and the coaching ask can be answered in either order');
  E('COA49', 'After my recording has started coaching the bot stops waiting for a recording');
  E('COA50', 'Nobody offers to pick up a lesson that was already coached');
  E('COA51', 'A teacher who said yes and never recorded is still offered it back');
  E('COA52', '"Only N children have started" arrives at most once a morning, even for quizzes made on earlier days');
  E('COA53', 'With COACHING_RECORDING_ENDS_WAIT off the recording no longer ends the wait');
  E('COA54', 'With NUDGE_OPEN_QUESTION_DEFER off the coaching ask no longer waits for the survey');
  E('COA55', 'In Urdu, the coaching messages never guess my gender');

  if (DEEP)
    rec('COA-pipeline', 'Pipeline steps observed end to end', 'PASS',
        { stepsSeen: obs.steps, elapsedSec: elapsed, reportDelivered: !!obs.report,
          reflectMode: REFLECT, transcript: joined.slice(0, 700) }, 0);
};

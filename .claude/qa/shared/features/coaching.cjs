/* coaching.feature — all 15 @e2e scenarios in ONE driver.
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
  menuAsksRecording : /upload your classroom recording|کلاس روم .*ریکارڈنگ/i,
  menuFifteenMin    : /15 minutes|15 منٹ/i,
  detected          : /I detected a (\d+)-minute audio recording/i,
  yesAnalyze        : /Yes,? Analyze/i,
  cancelled         : /No problem|cancel|nothing will be analy|منسوخ/i,
  step1             : /Step 1\/5|Transcribing your classroom audio/i,
  stepAny           : /Step (\d)\/5/,
  longLesson        : /Long Lesson Detected/i,
  acknowledges      : /Great job|engaging \d+-minute lesson/i,
  photoPrompt       : /(classroom photo|share a .*photo|تصویر)/i,
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
  notAPlan  : MEDIA + '/staff_meeting_notes.txt',
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

  // ══ COA02 — decline the first-use intro, get asked for the class audio ════
  // MUST run before COA01: the menu path (View Features → Classroom Coaching) can
  // itself consume the one-shot first-use intro (menu.service.js →
  // sendFirstUseIntroIfNeeded). Gated on FIRSTUSE=1, which pairs with run-suite's
  // reset-first-use so the intro offer + "Just tell me" button are guaranteed present.
  if (FIRSTUSE) {
    const AUDIO_ASK = /send me an audio recording of your class|audio recording of your class/i;
    const CONTAMINATED = /Step \d\/5|Analyzing your teaching|Generating your comprehensive|Transcribing/i;
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
  await api.openList('View Features');
  const row = await api.pickRowAndWait('Classroom Coaching');
  const rowTxt = row.txt || '';
  rec('COA01', 'The Classroom Coaching menu row asks for a classroom recording',
      ...V(EXPECT.menuAsksRecording.test(rowTxt) && EXPECT.menuFifteenMin.test(rowTxt),
           { asksForRecording: EXPECT.menuAsksRecording.test(rowTxt),
             statesFifteenMinutes: EXPECT.menuFifteenMin.test(rowTxt),
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

  // ══ COA03 — a >=15-min recording is detected, confirmation offered ════════
  s = t();
  const up = await api.upload(FIXTURE.classroom, 'Document', 180000);
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
  const up2 = await api.upload(FIXTURE.classroom, 'Document', 180000);
  const offers2 = (up2.btns || []).some(b => EXPECT.yesAnalyze.test(b)) || EXPECT.yesAnalyze.test(up2.txt || '');
  let confirmed = false;
  if (offers2) { await api.tapAndWait('Yes, Analyze', 120000); confirmed = true; await fresh(); }

  // Walk the pipeline as a state machine — react to each prompt as it arrives
  // rather than assuming an order. Shallow runs stop as soon as COA04 is decided.
  const obs = { steps: [], photoPrompt: false, photoAccepted: null, lpPrompt: false, lpRejected: null,
                reflectiveQ: null, reflectiveAck: null, slashEnded: null, deferral: null,
                report: null, commitment: null, acknowledges: false, longLesson: false };
  const seenTexts = [];
  let deferralTried = false;
  const t0 = Date.now();
  const budget = DEEP ? PIPELINE_BUDGET_MS : 4 * 60 * 1000;

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
    // the bot re-offers the list after a rejection — decline so the analysis can start
    const again = (doc.btns || []).find(b => /منتخب کریں|^Select$/i.test(b));
    if (again) { await api.openList(again); const no = await api.pickRowAndWait('نہیں', 90000); obs.lpDeclined = (no.txt || '').slice(0, 120); }
    else { const no = (doc.btns || []).find(b => /^(no|نہیں|skip)/i.test(b)); if (no) await api.tapAndWait(no, 90000); }
    await fresh();
  };

  while (confirmed && Date.now() - t0 < budget) {
    for (const r of await fresh()) {
      const x = r.txt || '';
      if (x) seenTexts.push(x);
      const m = EXPECT.stepAny.exec(x);
      if (m && !obs.steps.includes(m[1])) obs.steps.push(m[1]);
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
          obs.reflectiveAck = (ans.txt || '').slice(0, 220);
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
      obs.deferral = { replied: !!second.ok, reply: txt2.slice(0, 220),
        startedNewSession: EXPECT.detected.test(txt2) ||
                           (second.btns || []).some(b => EXPECT.yesAnalyze.test(b)) };
      await fresh();
    }

    if (!DEEP && obs.steps.length && obs.photoPrompt) break;   // COA04 is decided
    if (obs.commitment) break;
    await sleep(5000);
  }

  const joined = seenTexts.join(' | ');
  const elapsed = Math.round((Date.now() - t0) / 1000);

  rec('COA04', 'Confirming analysis walks a 5-step pipeline with optional-context prompts',
      ...(deferred
          ? ['BLOCKED', { reason: 'a prior coaching session was in flight — the recording was deferred, '
                                + 'which is correct behaviour, not a pipeline failure', inFlight }]
          : confirmed
          ? V(obs.steps.length > 0 && obs.photoPrompt,   // Step 1 often lands while the driver is inside the photo/LP gate replies
              { stepsSeen: obs.steps, longLessonWarning: obs.longLesson, acknowledges: obs.acknowledges,
                asksPhoto: obs.photoPrompt, asksLessonPlan: obs.lpPrompt, elapsedSec: elapsed })
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

  deepOnly('COA13', 'A non-lesson-plan document is rejected, not silently analysed',
      ...(obs.lpPrompt
          ? V(!!(obs.lpRejected && EXPECT.notLessonPlan.test(obs.lpRejected.reply || '')), obs.lpRejected || {})
          : ['BLOCKED', { reason: 'the pipeline never asked for a lesson plan within ' + elapsed + 's' }]));

  deepOnly('COA06', 'The reflective step asks exactly one question and closes after the answer',
      ...(REFLECT === 'slash'
          ? ['BLOCKED', { reason: 'this run used REFLECT=slash, which drives COA10 instead — the two '
                                + 'branches are mutually exclusive on one pipeline' }]
          : obs.reflectiveQ
            ? V(!!obs.reflectiveAck, { question: obs.reflectiveQ, acknowledgement: obs.reflectiveAck,
                note: 'NUM_REFLECTIVE_QUESTIONS=1 — one question asked, answer acknowledged' })
            : ['BLOCKED', { reason: 'the reflective step (3/5) was not reached within ' + elapsed + 's',
                            stepsSeen: obs.steps }]));

  deepOnly('COA10', 'A slash command during the reflective step ends the session',
      ...(REFLECT !== 'slash'
          ? ['BLOCKED', { reason: 'mutually exclusive with COA06 — re-run with REFLECT=slash' }]
          : obs.slashEnded
            ? V(!EXPECT.reflectiveQ.test(obs.slashEnded.reply || ''), obs.slashEnded)
            : ['BLOCKED', { reason: 'the reflective step was not reached within ' + elapsed + 's' }]));

  deepOnly('COA05', 'The pipeline delivers coaching feedback on the FICO/ICT rubric',
      ...(obs.report
          ? V(EXPECT.rubric.test(obs.report.caption + ' ' + joined),
              { caption: obs.report.caption, note: 'asserting rubric vocabulary in the delivered feedback' })
          : ['BLOCKED', { reason: 'no report delivered within ' + elapsed + 's', stepsSeen: obs.steps }]));

  deepOnly('COA07', 'Coaching feedback is delivered as a branded hero-report image',
      ...(obs.report
          ? V(obs.report.kind === 'image',
              Object.assign({}, obs.report, { note: obs.report.kind === 'pdf'
                ? 'PDF is the FALLBACK — the hero render threw' : 'hero image as specified' }))
          : ['BLOCKED', { reason: 'no report delivered within ' + elapsed + 's — a full analysis is 10+ min' }]));

  deepOnly('COA15', 'The commitment-card buttons on the report are handled (@known-fail)',
      ...(obs.commitment
          ? V(!!obs.commitment.acknowledged,
              Object.assign({}, obs.commitment, { note: 'ORPHAN BUG expected: card_yes_ has no handler, '
                + 'so the tap should go unacknowledged. A PASS means it has been wired.' }))
          : ['BLOCKED', { reason: obs.report ? 'the report carried no commitment card'
                                             : 'no report within ' + elapsed + 's' }]));

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

  if (DEEP)
    rec('COA-pipeline', 'Pipeline steps observed end to end', 'PASS',
        { stepsSeen: obs.steps, elapsedSec: elapsed, reportDelivered: !!obs.report,
          reflectMode: REFLECT, transcript: joined.slice(0, 700) }, 0);
};

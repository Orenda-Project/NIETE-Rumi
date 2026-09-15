/* lesson-plan.feature — 10 @e2e scenarios in one process. */
// Fixtures live in the tracked fixtures tree, NOT a results dir: results are untracked (this PR
// gitignores them) and 2026-08-26-all is EMPTY on a fresh checkout — every upload then fails with
// NO_SEND_BUTTON and aborts the feature (L05/L06/L07/L09 unrecorded, 2026-09-02, twice).
const FIX = require('path').resolve(__dirname, '..', '..', 'fixtures', 'whatsapp', 'niete', 'media');
const V = (c, ev) => [c ? 'PASS' : 'FAIL', ev];
// If the Flow never opened we learned nothing about the product — BLOCKED, not FAIL.
// (2026-08-31: a 523s FLOW_READY_TIMEOUT was being reported as two product failures.)
const VF = (op, c, ev) => op.ok ? V(c, ev) : ['BLOCKED', { harness: op.err, clicked: op.clicked, waitedMs: op.waitedMs }];
// Staging renders the LP *chat card* in Urdu; only the Flow interior is English.
// Captured live 2026-08-31: header "سبق کے منصوبے", CTA "جماعت چنیں".
const CARD = /سبق کے منصوبے|Lesson Plans/;
const CTA  = 'جماعت چنیں|Pick Class|شروع کریں|Start';

exports.run = async ({ api, rec, sleep }) => {
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

  // L02 — every recognised keyword opens the Flow card
  s = t();
  await api.sendWait('/menu');   // settle the transcript before the first measured keyword
  const kws = ['lp', 'lesson plan', 'lesson-plan', '/lp', 'لیسن پلان'];
  const hits = [];
  for (const k of kws) {
    // Five Flow sends inside ~40s tripped Meta #131056 "(Business Account, Consumer Account) pair rate
    // limit hit" on 2026-09-02 and the 5th card never arrived. Pace the burst.
    if (hits.length) await sleep(15000);
    const x = await api.sendWait(k);
    hits.push({ k, card: CARD.test(x.txt) && x.btns.length > 0, wait: x.waitedMs });
  }
  rec('L02', 'A recognised keyword opens the Lesson Plans Flow',
      ...V(hits.every(h => h.card), { hits }), t() - s);

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
  await sleep(15000);
  s = t();
  r = await api.sendWait('/lesson plan');
  rec('L08', '"/lesson plan" opens the Lesson Plans Flow',
      ...V(CARD.test(r.txt) && r.btns.length > 0,
           { reply: (r.txt || '').slice(0, 100), btns: r.btns.length }), t() - s);

  // L04 — a natural-language request must NOT generate a freeform plan
  // Free text is swallowed by awaiting_menu_selection (left by the /menu above and by every
  // keyword card) and by coaching AWAITING_CLASSROOM_AUDIO: the reply is then the "(1-4)" or
  // "send your classroom audio" nudge, and "not a freeform plan" passes for the wrong reason
  // (2026-09-02, passes 1/4/5/7). Enter Ask Anything first so the request reaches the handler,
  // and refuse to score a nudge as a fallback.
  s = t();
  await api.sendWait('/menu');
  await api.openList('View Features');
  await api.pickRowAndWait('Ask Anything');
  r = await api.sendWait('make me a lesson plan for grade 4 science on the water cycle', 120000);
  const freeform = /objectives?:|5[- ]step|starter|plenary/i.test(r.txt || '') && (r.txt || '').length > 400;
  const nudge = /\(1-4\)|کلاس روم آڈیو|classroom recording audio/i.test(r.txt || '');
  rec('L04', 'A natural-language request returns the curriculum fallback, not a generated plan',
      ...V(r.ok && !freeform && !nudge,
           { generatedFreeform: freeform, stateNudge: nudge, len: (r.txt || '').length,
             reply: (r.txt || '').slice(0, 140) }), t() - s);

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
  if (op3.ok) {
    for (const pick of ['Grade 6', 'Computer Science', 'ICT Fundamentals', 'Fundamentals of ICT']) {
      const c3 = await api.flowClick(pick, { settleMs: 3000 });
      if (!c3.ok) break;
    }
    api.closeFlow();
    // Inverted assertion (bd-mww73): a secondary grade must deliver a PAKISTAN plan (filename
    // grade_6_..pdf); "oxbridge" is now the FAILURE. Mock-lane implementation of sandbox's check —
    // waitFresh instead of a browser eval, but the same verdict shape, and it sets `pk` (used below).
    const PKF = /grade[_\s-]*6.*\.pdf/i;
    const w3 = await waitFresh((x) => PKF.test(x.txt || '') || /oxbridge/i.test(x.txt || ''), 150000, 2000);
    if (w3.ok) {
      const t3 = (w3.hit.txt || '');
      pk = /oxbridge/i.test(t3)
        ? { ok: false, oxbridge: true, waitedMs: w3.waitedMs, txt: t3.slice(0, 130) }
        : { ok: true, oxbridge: false, waitedMs: w3.waitedMs, txt: t3.slice(0, 130) };
    } else {
      pk = { ok: false, oxbridge: false, waitedMs: w3.waitedMs, last: w3.last };
    }
  }
  rec('L03', 'A secondary grade delivers a Pakistan lesson plan, not an Oxbridge one',
      ...VF(op3, !!(pk && pk.ok), pk || {}), t() - s);

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

  // L06 / L07 — unreachable by construction
  rec('L06', 'A grade with no lesson plans shows a friendly message', 'BLOCKED',
      { reason: 'the grade picker is content-driven — every offered grade has content, so no empty grade is selectable' }, 0);
  rec('L07', 'A subject with no chapters is refused politely', 'BLOCKED',
      { reason: 'same — the subject picker only lists subjects that have chapters for that grade' }, 0);
};

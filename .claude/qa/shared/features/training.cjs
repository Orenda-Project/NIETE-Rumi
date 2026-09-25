// @mock-lane — mock-capable driver (uses the mock API, not the browser DOM). Its presence enrols this feature in the mock lane; E2E_MOCK_FEATURES is derived from this marker, so there is no hardcoded list.
/* training.feature — the runnable @e2e scenarios in one process.
 *
 * Excluded by tag (matching the /niete-e2e default subset):
 *   T04 T05 T06 T07 T21 T23      @wip/@draft
 *   T05 T16                      @destructive — T16 fails the level exam on purpose and
 *                                starts a real 24h cooldown; never run it unasked.
 *
 * Staging copy note (captured live 2026-08-31): the Teacher Training card keeps its
 * English heading but the body and CTA are Urdu — CTA is "کھولیں", not "Open".
 */
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const V  = (c, ev) => [c ? 'PASS' : 'FAIL', ev];
const VF = (op, c, ev) => op.ok ? V(c, ev) : ['BLOCKED', { harness: op.err, clicked: op.clicked, waitedMs: op.waitedMs }];
const CARD = /Teacher Training/i;
const CTA  = 'کھولیں|Open';

exports.run = async ({ api, rec: rec0, sleep }) => {
  const seenIds = new Set();
  const rec = (id, ...rest) => { seenIds.add(id); return rec0(id, ...rest); };
  const t = () => Date.now();
  let s;

  // Wait on the fresh-inbound reader both drivers expose — the page-eval loop this replaces read the
  // WhatsApp Web DOM, which the mock lane does not have.
  const waitFresh = async (pred, timeoutMs, stepMs = 1500) => {
    const t0 = Date.now(); const seen = [];
    while (Date.now() - t0 < timeoutMs) {
      for (const r of await api.fresh()) seen.push(r);
      const hit = seen.find(pred);
      if (hit) return { ok: true, waitedMs: Date.now() - t0, hit, seen };
      await new Promise((r) => setTimeout(r, stepMs));
    }
    return { ok: false, waitedMs: Date.now() - t0, seen, last: (seen[seen.length - 1] || {}).txt || '' };
  };

  const openTraining = async (trigger = '/training') => {
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

  // ── T02 — every entry point converges on the same card ──────────────────────
  s = t();
  await api.sendWait('/menu');                    // settle before the first measured send
  const entries = ['/training', '/trainings', 'show me training', 'open training', 'training'];
  const hits = [];
  for (const e of entries) {
    const x = await api.sendWait(e);
    hits.push({ entry: e, card: CARD.test(x.txt), cta: (x.btns || []).some(b => new RegExp(CTA).test(b)), wait: x.waitedMs });
  }
  rec('T02', 'Teacher Training opens from any of its entry points',
      ...V(hits.every(h => h.card && h.cta), { hits, note: 'the /menu row is covered by menu.cjs' }), t() - s);

  // ── T15 — "/teacher training" (two words) is NOT a trigger ──────────────────
  s = t();
  const two = await api.sendWait('/teacher training');
  rec('T15', '"/teacher training" (two words) is not a training command',
      ...V(!CARD.test(two.txt) || !(two.btns || []).some(b => new RegExp(CTA).test(b)),
           { reply: (two.txt || '').slice(0, 140) }), t() - s);

  // ── T18 — /training is stateless: it works mid-way through something else ───
  s = t();
  await api.sendWait('/lp');                      // start another feature, then interrupt it
  const mid = await api.sendWait('/training');
  rec('T18', '/training works even in the middle of something else',
      ...V(CARD.test(mid.txt) && (mid.btns || []).some(b => new RegExp(CTA).test(b)),
           { reply: (mid.txt || '').slice(0, 140), interruptedFeature: 'lesson plans' }), t() - s);

  // ── T03 / T13 / T14 — the certificates surface ──────────────────────────────
  s = t();
  const certs = await api.sendWait('/certificates');
  const noCerts = /don't have any|no .*certification|کوئی .*سرٹیفکیٹ/i.test(certs.txt || '');
  const hasList = /NIETE-\d{8}-[A-Z0-9]+/.test(certs.txt || '');
  rec('T03', 'A teacher with no certificates yet is pointed back to training',
      ...V(noCerts ? /\/training/.test(certs.txt || '') : hasList,
           { mode: noCerts ? 'no-certificates nudge' : hasList ? 'certificates list' : 'neither',
             pointsToTraining: /\/training/.test(certs.txt || ''), reply: (certs.txt || '').slice(0, 160) }), t() - s);

  s = t();
  const notMine = await api.sendWait('/certificate NIETE-L0-20260101-ZZZZ');
  rec('T13', "Asking for a certificate that isn't mine says it can't be found",
      ...V(/could not find|not find a certificate|نہیں مل/i.test(notMine.txt || ''),
           { reply: (notMine.txt || '').slice(0, 160) }), t() - s);

  s = t();
  const junk = await api.sendWait('/certificate not-a-code');
  rec('T14', 'A /certificate with a junk code just shows my certificates list',
      ...V(/don't have any|no .*certification|کوئی .*سرٹیفکیٹ/i.test(junk.txt || '') ||
           /NIETE-\d{8}-[A-Z0-9]+/.test(junk.txt || ''),
           { fellThroughToList: true, reply: (junk.txt || '').slice(0, 160) }), t() - s);

  // ── Flow ladder — one open, then discover what this account's state allows ──
  s = t();
  await api.resetFlow();
  await api.freshReset();
  await api.sendWait('/training');
  const op = await openTraining();
  let ladder = null, levelDetail = null, picker = null, pickerChangedScreen = false;

  if (op.ok) {
    await api.flowClick('NIETE', { settleMs: 2500 });
    await api.flowClick('Open program', { settleMs: 3500 });
    ladder = await api.flowProbe();
  }
  const lockedLevels = ladder ? (ladder.items || [])
    .map(i => (i.text || '').trim()).filter(x => /🔒 Locked|Unlocks after/.test(x)) : [];
  const readyLevel = ladder ? /Ready for exam|Take exam/.test(ladder.text || '') : false;

  rec('T09-ladder', 'The level ladder locks later levels in order',
      ...VF(op, lockedLevels.length > 0 && /Unlocks after Level/.test(ladder && ladder.text || ''),
            { lockedLevels: lockedLevels.slice(0, 4), levelZeroReadyForExam: readyLevel,
              screen: (ladder && ladder.text || '').slice(0, 200) }), t() - s);

  // T09 — a locked level is selectable client-side; the SERVER must refuse it.
  s = t();
  let refusal = null;
  if (op.ok && lockedLevels.length) {
    const target = lockedLevels.find(x => /Level 1/.test(x)) || lockedLevels[0];
    const pick = await api.flowClick(target.split('—')[0].trim(), { settleMs: 2500 });
    const open = await api.flowClick('Open level', { settleMs: 3500 });
    if (pick.ok && open.ok) {
      // the endpoint refuses on the SUCCESS screen; the refusal reaches the chat once the Flow closes
      await api.flowClick('Close', { settleMs: 2000 });
      api.closeFlow();
      const w = await waitFresh((x) => /grand quiz first|unlock this|پہلے|Unlocks after/i.test(x.txt || ''), 60000);
      refusal = w.ok ? { ok: true, waitedMs: w.waitedMs, txt: (w.hit.txt || '').slice(0, 180) } : w;
      refusal.clientSideEnabled = open.ok;
    } else refusal = { ok: false, err: 'could not drive the locked row', pick, open };
  }
  rec('T09', 'A locked level is selectable but the server refuses to open it',
      ...(op.ok && lockedLevels.length
          ? V(!!(refusal && refusal.ok), refusal || {})
          : ['BLOCKED', { reason: 'no locked level offered in this account state', op: op.err }]), t() - s);

  // ── Discover module state — decides T01/T10/T12/T19/T20/T22 ─────────────────
  s = t();
  await api.resetFlow();
  await api.sendWait('/training');
  const op2 = await openTraining();
  if (op2.ok) {
    await api.flowClick('NIETE', { settleMs: 2500 });
    await api.flowClick('Open program', { settleMs: 3500 });
    await api.flowClick('Level 0', { settleMs: 2500 });
    await api.flowClick('Open level', { settleMs: 3500 });
    levelDetail = await api.flowProbe();
    const pk = await api.flowClick('Pick a module to watch', { settleMs: 3500 });
    if (pk.ok) picker = await api.flowProbe();
    // Content regexes cannot tell "picker opened" from "level detail still showing" —
    // classifyScreen calls both 'level-list' (its 🔒 rule), and a stray 🔒 past the
    // truncation point made an earlier check report a picker that never opened.
    // The screen either changed or it did not; compare the text.
    pickerChangedScreen = !!(picker && levelDetail &&
      (picker.text || '').trim() !== (levelDetail.text || '').trim());
  }
  const pickerText = (picker && picker.text) || '';
  const nextUp = (picker ? (picker.items || []) : [])
    .map(i => (i.text || '').trim()).filter(x => /▶\s*Next up/.test(x));
  const passed = (pickerText.match(/✓\s*Passed/g) || []).length;

  // The picker only counts as OPEN if it actually lists module rows. Without this the
  // probe returns the level-detail screen again and an empty nextUp[] reads as a real
  // enumeration rather than a failed open. (2026-08-31.)
  // On a phone the dropdown opens a NEW screen; the emulator lists the rows inline, so the text does
  // not change. Either way the picker is open when structured ROWS carry the module states.
  const pickerRows = (picker ? (picker.items || []) : []).filter(i => /✓\s*Passed|▶\s*Next up|🔒\s*Locked/.test(i.text || ''));
  const pickerOpened = (pickerChangedScreen || pickerRows.length > 0) && /✓\s*Passed|▶\s*Next up/.test(pickerText);
  const modulesDone = (levelDetail && (levelDetail.text || '').match(/(\d+)\/(\d+)\s*modules done/) || null);
  rec('T-state', 'Module picker state for this account (drives the scenarios below)',
      ...(op2.ok
          ? (pickerOpened
              ? V(true, { pickerOpened: true, passedCount: passed, nextUp,
                          moduleRows: (picker.items || []).map(i => (i.text || '').trim())
                                        .filter(Boolean).filter((v, k, a) => a.indexOf(v) === k).slice(0, 12),
                          pickerSample: pickerText.slice(0, 1500) })
              : ['BLOCKED', { pickerOpened: false,
                  reason: 'the "Pick a module to watch" control did not open a module list — the probe '
                        + 'returned the level-detail screen again, so the modules were never enumerated',
                  modulesDoneFromLevelDetail: modulesDone ? modulesDone[0] : null,
                  levelDetail: (levelDetail && levelDetail.text || '').slice(0, 220) }])
          : ['BLOCKED', { harness: op2.err }]), t() - s);

  const noNextUp = { reason: 'the Level 0 detail reports every module finished, so no "▶ Next up" module '
                           + 'exists to drive a module check. Needs an account with an in-progress level, '
                           + 'or a DB reset of module progress.',
                     evidence: modulesDone ? modulesDone[0] : 'modules-done figure not captured',
                     note: 'this rests on the level-detail text, NOT on the module picker — see T-state '
                         + 'for whether the picker actually opened.' };

  const moduleScenarios = [
    ['T01', 'A teacher works through Teacher Training end to end — module check, pass, unlock next'],
    ['T10', "A module further down the list can't be opened before the earlier ones"],
    ['T12', 'Getting one question wrong fails the module check (NIETE needs 100%)'],
    ['T19', 'Pausing a module check saves my place'],
    ['T20', 'A module retake serves a fresh set of questions'],
    ['T22', "A module's button is named after what tapping it does"],
  ];
  const NAME = Object.fromEntries(moduleScenarios);
  const nextUpTitle = nextUp.length ? nextUp[0].split(' · ')[0].trim() : null;
  const lockedRow = (picker ? (picker.items || []) : []).map(i => (i.text || '').trim()).find(x => /🔒\s*Locked/.test(x)) || null;

  // ── The module-check driver ──────────────────────────────────────────────────
  // The answer key comes from the DB (module-answer-key: correct option TEXT per question). A question
  // is a WhatsApp list whose rows are letters with the option text as the description (or in the body
  // when an option is long); the driver maps the correct text to its letter and taps that row.
  const CTA_RE = /Take quiz|Next video|Next module/i;
  const PAUSE_RE = /⏸ Paused\. Send \/training when you want to pick up where you left off\./;
  const NOT_QUITE = /Module check — not quite/;
  const PASSED = /Module check — passed/;
  const norm = (x) => String(x || '').replace(/\s+/g, ' ').trim().toLowerCase();
  // api.db returns { ok, out, user }; the tool prints a banner before its JSON — parse the LAST line.
  const dbJson = (action, args) => {
    try {
      const r = api.db(action, args) || {};
      const last = String(r.out || '').split('\n').map(l => l.trim()).filter(Boolean).pop() || 'null';
      return JSON.parse(last);
    } catch (e) { return null; }
  };
  // The level screen's exam row is a NavigationList item — "📝 Grand Quiz — Ready. Start your level
  // exam." with "20 questions · 80% to pass" as its description — so a filter that drops rows containing
  // ' · ' (right for module rows) hid it from T05/T07/T16 (runs 1117/1127). Search every item, any kind.
  // The clickable is the EmbeddedLink bound to grand_quiz_cta — 'Start exam' when ready, '🔒 Locked',
  // '⏳ Cooldown (Nh)' — while 'Grand Quiz — Ready…' is the TextBody above it (teacher-training-endpoint:1725).
  const examRowOf = (probe) => (((probe && probe.items) || []).find(i => /^Start exam$|Take exam|Take the module exam|Start Grand Quiz|Cooldown|Locked after a recent|^\ud83d\udd12 Locked$/i.test(String(i.text || '').trim())) || null);
  const isFlowQTxt = (x) => !!(x && x.flow && /:training-msq:/.test(String(x.flow.token || '')));
  const allKeys = [];   // every module key fetched this run — T23 matches rendered questions against them
  const answerKey = (title) => {
    const r = api.db('module-answer-key', ['--title', title]);
    if (!r.ok) return { err: r.err };
    try { const k = JSON.parse(String(r.out).trim().split('\n').filter(l => l.startsWith('{')).pop()); if (k && k.questions) allKeys.push(k); return k; }
    catch (e) { return { err: 'unparseable key: ' + String(r.out).slice(0, 120) }; }
  };
  // Open the Flow down to the level detail and pick a module row; the endpoint answers on the SUCCESS
  // screen and the module card (or a refusal) lands in the chat once the Flow closes.
  const pickModule = async (rowText) => {
    await api.resetFlow(); await api.freshReset();
    await api.sendWait('/training');
    const o = await openTraining();
    if (!o.ok) return { ok: false, err: 'FLOW:' + o.err };
    await api.flowClick('NIETE', { settleMs: 2500 });
    await api.flowClick('Open program', { settleMs: 3500 });
    await api.flowClick('Level 0', { settleMs: 2500 });
    await api.flowClick('Open level', { settleMs: 3500 });
    await api.flowClick('Pick a module to watch', { settleMs: 2500 });
    const pk = await api.flowPick(rowText.split(' · ')[0].trim());
    if (!pk.ok) { api.closeFlow(); return { ok: false, err: 'PICK:' + pk.err }; }
    await api.flowClick('Close', { settleMs: 2000 });
    api.closeFlow();
    const w = await waitFresh((x) => (x.btns || []).some(b => CTA_RE.test(b)) || /Finish "|first — modules open one at a time|not part of your training|locked until/i.test(x.txt || ''), 60000);
    if (!w.ok) return { ok: false, err: 'NO_CARD', last: w.last };
    return { ok: true, card: w.hit, cta: (w.hit.btns || []).find(b => CTA_RE.test(b)) || null, txt: w.hit.txt || '' };
  };

  // ── Band-aware navigation (bd-2ug2s) ────────────────────────────────
  // pickModule above hardcodes the NIETE band, whose Level 0 ("Aspiring Teacher") is 46 video
  // modules and ZERO PDFs — the whole reason T04 could never find one. This account is scoped to
  // four vendors; Beacon House's English level is 43 PDFs to 12 videos. These helpers let a
  // scenario drive ANY band without disturbing the NIETE state the module-check cluster needs.
  const openBandLevel = async ({ vendor = 'NIETE', level = 'Level 0' } = {}) => {
    await api.resetFlow(); await api.freshReset();
    await api.sendWait('/training');
    const o = await openTraining();
    if (!o.ok) return { ok: false, err: 'FLOW:' + o.err };
    const v = await api.flowClick(vendor, { settleMs: 2500 });
    if (!v.ok) { const vp = await api.flowProbe(); return { ok: false, err: 'VENDOR:' + v.err, vendor, offered: ((vp && vp.items) || []).map(i => String(i.text || '').slice(0, 50)).slice(0, 10) }; }
    await api.flowClick('Open program', { settleMs: 3500 });
    // Resolve the level row by PROBE, never by a guessed "Level N" label: each vendor numbers its
    // own ladder, so Beacon House's English is not NIETE's Level 0 even though both come first.
    const lad = await api.flowProbe();
    const ladderRows = ((lad && lad.items) || []).map(i => (i.text || '').trim()).filter(Boolean);
    const row = ladderRows.find(x => new RegExp(level, 'i').test(x) && !/\ud83d\udd12\s*Locked/.test(x));
    if (!row) return { ok: false, err: 'NO_LEVEL_ROW', level, offered: ladderRows.slice(0, 8) };
    await api.flowClick(row.split('\u2014')[0].trim(), { settleMs: 2500 });
    await api.flowClick('Open level', { settleMs: 3500 });
    const detail = await api.flowProbe();
    return { ok: true, level: row, detail };
  };
  const openBandPicker = async (band) => {
    const lv = await openBandLevel(band);
    if (!lv.ok) return lv;
    const row = lv.level;
    const pk = await api.flowClick('Pick a module to watch', { settleMs: 3500 });
    if (!pk.ok) return { ok: false, err: 'PICKER:' + pk.err, level: row };
    const probe = await api.flowProbe();
    return { ok: true, level: row, probe,
             rows: ((probe && probe.items) || [])
                     .filter(i => /\u2713\s*Passed|\u25b6\s*Next up|\ud83d\udd12\s*Locked/.test(i.text || '')) };
  };
  // Pick a row from an ALREADY-OPEN picker and wait for what the endpoint delivers to the chat.
  // A PDF module arrives as a document card, which carries no "Next video" button, so a doc/pdf
  // item counts as a terminal state in its own right.
  const deliverPicked = async (rowText) => {
    const title = String(rowText).split(' \u00b7 ')[0].trim();
    const pk = await api.flowPick(title);
    if (!pk.ok) { api.closeFlow(); return { ok: false, err: 'PICK:' + pk.err }; }
    await api.flowClick('Close', { settleMs: 2000 });
    api.closeFlow();
    const CTA_ANY = /Take quiz|Next video|Next module|Continue|Resume|Start/i;   // a resumed check may not say "Take quiz"
    // A card with a button must be THIS module's: a late "Finished watching <previous module>?" card
    // from the scenario before leaked into T04's window and its Take-quiz button was taken for the PDF
    // module's card (run 20260924-1402). Documents and refusals are accepted as they are.
    const stem = title.replace(/\u2026$/, '').slice(0, 24);
    const w = await waitFresh((x) => x.doc || x.pdf
                                  || ((x.btns || []).some(b => CTA_ANY.test(b)) && String(x.txt || '').includes(stem))
                                  || /Finish "|first \u2014 modules open one at a time|not part of your training|locked until/i.test(x.txt || ''), 60000);
    if (!w.ok) return { ok: false, err: 'NO_CARD', last: w.last };
    return { ok: true, card: w.hit, cta: (w.hit.btns || []).find(b => CTA_ANY.test(b)) || null, txt: w.hit.txt || '' };
  };
  const letterFor = (list, optionText) => {
    const want = norm(optionText);
    const descs = list.descs || [];
    for (let i = 0; i < (list.rows || []).length; i++) {
      const d = norm(descs[i]);
      if (d && (d === want || want.startsWith(d.replace(/…$/, '')) || d.startsWith(want))) return list.rows[i];
    }
    // options printed in the body as "A. text" (long options), or the dialog text (chrome)
    const lines = String(list.all || '').split('\n').map(l => l.trim());
    for (let i = 0; i < lines.length; i++) {
      const m = /^([A-J])\.\s+(.*)$/.exec(lines[i]);
      if (m && norm(m[2]).startsWith(want.slice(0, 40))) return m[1];
      if (norm(lines[i]) === want && i > 0 && /^[A-J]$/.test(lines[i - 1])) return lines[i - 1];
    }
    return null;
  };
  // Answer the current module check end to end by polling fresh() — the start (intro → Q1) and the
  // between-question steps each have a multi-second gap that a single settled reply stops short of.
  // wrongAt = 1-based question to answer wrongly (null = all correct). Returns {first, trail, last}.
  const rowIdForText = (q, optText, idx1) => {
    const rows = (q.list && q.list.rows) || [];
    const want = norm(optText);
    // image options: the rows carry no text, only "Option N" — answer by 1-based index
    if (idx1 && rows.some(r => /^Option \d+$/.test(r.title || ''))) { const r = rows.find(x => x.title === 'Option ' + idx1); if (r) return r.id; }
    for (const r of rows) { const d = norm(r.description); if (d && (d === want || d.startsWith(want) || want.startsWith(d.replace(/…$/, '')))) return r.id; }
    // long options render in the body as "A. <text>" with the letter as the row title
    const m = String(q.txt || '').split('\n').map(l => l.trim()).find(l => /^[A-J]\.\s/.test(l) && norm(l.replace(/^[A-J]\.\s*/, '')).startsWith(want.slice(0, 40)));
    if (m) { const letter = m[0]; const r = rows.find(x => x.title === letter); if (r) return r.id; }
    return null;
  };
  // Questions as RENDERED, collected by the module-check runs below. Declared here because T23 is
  // recorded at the end of the driver, outside the block where run1/run2 are scoped.
  let renderedQuestions = [];
  // stopAfter: answer that many questions then return (T21 resumes a half-finished check).
  // wrongAll: answer every question wrongly (T16 fails the grand quiz on purpose).
  // preseen: items an earlier waitFresh already pulled off fresh() (fresh() is consume-once, so a
  // question it saw would otherwise be invisible here — runs 1117/1148 waited 90s on Q1 that way).
  const takeQuiz = async (key, { wrongAt = null, stopAfter = null, wrongAll = false, preseen = [] } = {}) => {
    const seen = [...(preseen || [])];
    const pull = async () => { for (const r of await api.fresh()) seen.push(r); };
    // Rows are letters — or "Option N" when the options are images (the bot sends the pictures first,
    // captioned "Option 1"…, then the list; I-SAPS m1-item-1-6, run 1236).
    const isQ = (x) => x.list && (x.list.rows || []).some(r => /^[A-J]$|^Option \d+$/.test(r.title || ''));
    // A "Select all that apply" question is NOT a list — the bot sends the training-msq FLOW, whose
    // single MSQ_QUESTION screen carries a CheckboxGroup and a "Submit answer" footer. Without this
    // the loop never recognised the question and timed out as NO_QUESTION_OR_VERDICT, which is what
    // stalled the Oxbridge drive on Q2/10 (bd-2ug2s).
    const isFlowQ = (x) => !!(x.flow && /:training-msq:/.test(String(x.flow.token || '')));
    // Module checks end in "Module check — passed/not quite"; the grand quiz ends in a
    // 🏆 Congratulations or ❌ Not this time card; a written exam opens with ✍️ Question 1.
    const GQ_TERM = /\ud83c\udfc6 \*Congratulations|\u274c \*Not this time|You have completed every|\u270d\ufe0f \*Question 1 of/;
    const isTerm = (x) => NOT_QUITE.test(x.txt || '') || PASSED.test(x.txt || '') || GQ_TERM.test(x.txt || '');
    const waitFor = async (pred, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { await pull(); const h = [...seen].reverse().find(pred); if (h) return h; await new Promise(r => setTimeout(r, 1200)); } return null; };
    const trail = []; let first = null; const answered = new Set();
    for (let n = 0; n < 40; n++) {
      // Dedupe a question on its Qn/N header, NOT on its row-id set: the options are shuffled per
      // question, and when two consecutive questions land in the same order (1 in 24 for four
      // options) the id set repeats and the second question is skipped as already answered — the
      // driver then waits 90s for a question that is already on screen. Run 20260924-1038 did
      // exactly this on Q3/3 and took T01/T12/T20 down with it (bd-2ug2s).
      const qKey = (x) => { const h = /Q\d+\/\d+/.exec(x.txt || ''); return h ? h[0] : ((x.list && x.list.rows) || []).map(r => r.id).join(','); };
      const hit = await waitFor((x) => isTerm(x)
                                    || (isQ(x) && !answered.has(qKey(x)))
                                    || (isFlowQ(x) && !answered.has(String(x.flow.token))), 90000);
      if (!hit) return { first, trail, seen, last: { err: 'NO_QUESTION_OR_VERDICT', tail: seen.slice(-4).map(x => (x.txt || '').slice(0, 80)) } };
      if (isTerm(hit)) {
        if (GQ_TERM.test(hit.txt || '')) {
          const v = /Congratulations|You have completed every/.test(hit.txt) ? 'passed' : /Not this time/.test(hit.txt) ? 'failed' : 'exam-started';
          return { first, trail, seen, last: { verdict: v, txt: (hit.txt || '').slice(0, 320), btns: hit.btns || [], doc: !!(hit.doc || hit.pdf) } };
        }
        const notQuite = NOT_QUITE.test(hit.txt);
        let btns = hit.btns || [];
        // A not-quite verdict is followed by a SEPARATE card carrying 🔄 Try again / ⏸ Pause — wait for it.
        // A PASS is followed by the NEXT module's card; do NOT poll here or we would consume it (T01).
        if (notQuite) { const t0 = Date.now(); while (Date.now() - t0 < 8000) { await pull(); const b = [...seen].reverse().find(x => (x.btns || []).some(bb => /Try again|Pause/i.test(bb))); if (b) { btns = b.btns; break; } await new Promise(r => setTimeout(r, 800)); } }
        return { first, trail, seen, last: { verdict: notQuite ? 'not-quite' : 'passed', txt: (hit.txt || '').slice(0, 220), btns } };
      }
      if (isFlowQ(hit)) {
        answered.add(String(hit.flow.token));
        const qTxt = String(hit.txt || '');
        const head = /Q(\d+)\/(\d+)/.exec(qTxt); const qNo = head ? Number(head[1]) : n + 1;
        if (n === 0) first = head ? head[0] : null;
        // The question line itself ends in "(Select all that apply)", so strip that suffix rather than
        // skip the line — skipping it left qLine empty and matched no key entry.
        const qLine = (qTxt.split('\n').map(l => l.trim())
          .find(l => l && !/^Q\d+\/\d+$/.test(l) && !/^Select all that apply$|^required$/i.test(l)) || '')
          .replace(/\s*\(Select all that apply\)\s*$/i, '').trim();
        const entry = (key.questions || []).find(q => norm(q.q) === norm(qLine)
          || norm(q.q).startsWith(norm(qLine).slice(0, 60)) || norm(qLine).startsWith(norm(q.q).slice(0, 60)));
        if (!entry) return { first, trail, seen, last: { err: 'NO_KEY_ENTRY_FLOW', qLine: qLine.slice(0, 120) } };
        const opF = await api.openFlow('Answer', { from: hit });   // the card came via fresh(), not a send
        if (!opF.ok) return { first, trail, seen, last: { err: 'MSQ_FLOW_OPEN:' + opF.err, qLine: qLine.slice(0, 80) } };
        const pr = await api.flowProbe();
        const opts = ((pr && pr.items) || []).filter(i => i.kind === 'option');
        // The checkbox rows carry ONLY a letter ("A.") — a row description is clamped to three lines
        // on the device, so quiz-delivery puts the option texts in the TextBody as "A. <text>" lines
        // (buildMsqFlowScreenData). Map the key's texts to letters through the screen body, then tick
        // the matching row, exactly as letterFor does for the long-option list case.
        const bodyLetters = String((pr && pr.text) || '').split('\n').map(l => l.trim())
          .map(l => /^([A-J])[.)]\s+(.*)$/.exec(l)).filter(Boolean).map(m => ({ letter: m[1], text: m[2] }));
        const letterFor2 = (want) => { const w = norm(want); const h = bodyLetters.find(b => norm(b.text) === w
          || norm(b.text).startsWith(w.slice(0, 40)) || w.startsWith(norm(b.text).slice(0, 40))); return h ? h.letter : null; };
        const rowFor = (letter) => opts.find(o => new RegExp('^' + letter + '\\b').test(String(o.text || '').trim()));
        const correctLetters = entry.correct.map(letterFor2).filter(Boolean);
        // wrongAt: tick one letter the key does NOT list, so a deliberate failure works here too.
        const wants = (wrongAt === qNo)
          ? bodyLetters.map(b => b.letter).filter(l => !correctLetters.includes(l)).slice(0, 1)
          : correctLetters;
        const picked = [];
        for (const letter of wants) {
          const o = rowFor(letter);
          if (o) { const r = await api.flowPick(o.text, { exact: true }); if (r && r.ok) picked.push(letter); }
        }
        if (!picked.length) return { first, trail, seen, last: { err: 'MSQ_NO_OPTION_MATCH', qLine: qLine.slice(0, 80),
                                                           wanted: entry.correct, bodyLetters: bodyLetters.slice(0, 6),
                                                           offered: opts.map(o => o.text).slice(0, 8) } };
        const sub = await api.flowClick('Submit answer', { settleMs: 3000 });
        api.closeFlow();
        trail.push({ q: qNo, via: 'training-msq flow', picked, submitted: !!(sub && sub.ok) });
        if (stopAfter && trail.length >= stopAfter) return { first, trail, seen, last: { stopped: true, after: qNo } };
        continue;
      }
      const rows = hit.list.rows; answered.add(qKey(hit));
      const head = /Q(\d+)\/(\d+)/.exec(hit.txt || ''); const qNo = head ? Number(head[1]) : n + 1; if (n === 0) first = head ? head[0] : null;
      const qLine = String(hit.txt || '').split('\n').map(l => l.trim()).find(l => l && !/^Q\d+\/\d+$/.test(l) && !/^[A-J]\.\s/.test(l) && !/required|Select all that apply|Selected:/.test(l)) || '';
      const cands = (key.questions || []).filter(q => norm(q.q) === norm(qLine) || norm(q.q).startsWith(norm(qLine).slice(0, 60)) || norm(qLine).startsWith(norm(q.q).slice(0, 60)));
      // Bank questions can share a stem (the rhyming-words sequence items differ only in their options):
      // of the candidates, take the one whose correct option is actually on this screen (run 1201, Q14).
      const entry = cands.find(q => (q.correct || []).length && q.correct.every((c, k) => rowIdForText(hit, c, (q.correct_index || [])[k]))) || cands.find(q => norm(q.q) === norm(qLine)) || cands[0];
      if (!entry) return { first, trail, seen, last: { err: 'NO_KEY_ENTRY', qLine: qLine.slice(0, 120), rows: rows.map(r => r.description || r.title) } };
      let ids;
      if (wrongAt === qNo || wrongAll) { const wrong = rows.find(r => /^[A-J]$|^Option \d+$/.test(r.title) && !entry.correct.some((c, k) => rowIdForText(hit, c, (entry.correct_index || [])[k]) === r.id)); ids = wrong ? [wrong.id] : []; }
      else ids = entry.correct.map((c, k) => rowIdForText(hit, c, (entry.correct_index || [])[k])).filter(Boolean);
      if (!ids.length) return { first, trail, seen, last: { err: 'NO_ROW_ID', qLine: qLine.slice(0, 80), rows: rows.map(r => ({ t: r.title, d: r.description })) } };
      for (const id of ids) { await api.tapId('list', id); await new Promise(r => setTimeout(r, 400)); }
      if (entry.multi && wrongAt !== qNo) { const done = rows.find(r => /_done$/.test(r.id) || /Done/i.test(r.title)); if (done) await api.tapId('list', done.id); }
      // T23 needs the RENDERING, not just which row was tapped: a long option is moved into the
      // message body as a lettered line instead of being truncated in the row description.
      renderedQuestions.push({ q: qNo,
                   body: String(hit.txt || ''),
                   rows: rows.map(r => ({ title: r.title, desc: String(r.description || '') })) });
      trail.push({ q: qNo, ids, wrong: wrongAt === qNo || wrongAll,
                   body: String(hit.txt || ''),
                   rows: rows.map(r => ({ title: r.title, desc: String(r.description || '') })) });
      if (stopAfter && trail.length >= stopAfter) return { first, trail, seen, last: { stopped: true, after: qNo } };
    }
    return { first, trail, seen, last: { err: 'TOO_MANY_QUESTIONS' } };
  };


  if (!nextUpTitle) {
    for (const [id, name] of moduleScenarios) rec(id, name, 'BLOCKED', noNextUp, 0);
  } else {
    const key = answerKey(nextUpTitle);
    // T22 — the card's button is named after what tapping it does
    s = t();
    const c1 = await pickModule(nextUp[0]);
    const hasQuiz = !!(key && key.questions && key.questions.length);
    const expectCta = hasQuiz ? /Take quiz/ : /Next video|Next module/;
    rec('T22', NAME.T22, ...(c1.ok ? V(!!c1.cta && expectCta.test(c1.cta), { cta: c1.cta, hasQuiz, questions: hasQuiz ? key.questions.length : 0, module: nextUpTitle, card: c1.txt.slice(0, 160) })
                                    : ['BLOCKED', { harness: c1.err, last: c1.last }]), t() - s);
    // T19 — ⏸ Pause on the card saves my place
    s = t();
    let paused = null;
    if (c1.ok && (c1.card.btns || []).includes('⏸ Pause')) paused = await api.tapAndWait('⏸ Pause', 30000);
    rec('T19', NAME.T19, ...(paused ? V(PAUSE_RE.test(paused.txt || ''), { reply: (paused.txt || '').slice(0, 140) }) : ['BLOCKED', { reason: 'no ⏸ Pause button on the module card', btns: c1.card && c1.card.btns }]), t() - s);

    if (!hasQuiz || !key) {
      for (const id of ['T12', 'T20', 'T01']) rec(id, NAME[id], 'BLOCKED', { reason: key && key.err ? 'answer key unavailable: ' + key.err : 'the next-up module has no quiz — nothing to check', module: nextUpTitle }, 0);
    } else {
      // re-open the module and start the check
      s = t();
      const c2 = await pickModule(nextUp[0]);
      await api.freshReset();                       // capture the quiz stream (intro → Q1 → …) from here
      if (c2.ok && c2.cta) await api.tapAndWait(c2.cta, 60000);   // tap "📝 Take quiz"; the check starts
      // T12 — one wrong answer fails the check (100%) and offers a retry
      const run1 = (c2.ok && c2.cta) ? await takeQuiz(key, { wrongAt: 1 }) : { last: { err: c2.err || 'NO_CTA' }, trail: [] };
      const l1 = run1.last || {};
      rec('T12', NAME.T12, ...(l1.verdict ? V(l1.verdict === 'not-quite' && /\d+\/\d+\*?\s*\(\d+%\)/.test(l1.txt) && /100%/.test(l1.txt) && (l1.btns || []).includes('🔄 Try again') && (l1.btns || []).includes('⏸ Pause'),
                                                { verdict: l1.verdict, reply: l1.txt, btns: l1.btns, answered: run1.trail.length })
                                            : ['BLOCKED', { harness: l1.err, detail: l1, cta: c2.cta, card: (c2.txt || '').slice(0, 120) }]), t() - s);
      // T20 — 🔄 Try again restarts the check at Q1; then re-answer ALL correct (drives T01 too)
      s = t();
      let run2 = { last: { err: 'NO_RETRY' }, trail: [], first: null };
      if (l1.verdict === 'not-quite') {
        await api.freshReset();
        await api.tapAndWait('🔄 Try again', 60000);   // restart — the intro reappears, then Q1
        run2 = await takeQuiz(key);                     // answer all correct this time
      }
      rec('T20', NAME.T20, ...(run2.first ? V(/Q1\/\d+/.test(run2.first),
                                                { firstQuestion: run2.first, answered: run2.trail.length,
                                                  note: 'restarts at Q1 with the same 100% bar; the served set may differ' })
                                          : ['BLOCKED', { reason: 'no failed check to retry', detail: l1 }]), t() - s);
      // T01 — the retake passes → the next module unlocks and its card arrives
      s = t();
      const l2 = run2.last || {};
      let nextCard = null;
      if (l2.verdict === 'passed') nextCard = await waitFresh((x) => (x.btns || []).some(b => CTA_RE.test(b)), 90000);
      rec('T01', NAME.T01, ...(l2.verdict ? V(l2.verdict === 'passed' && !!(nextCard && nextCard.ok),
                                                { verdict: l2.verdict, reply: l2.txt, answered: run2.trail.length, nextModuleCard: nextCard && nextCard.ok ? (nextCard.hit.txt || '').slice(0, 120) : null })
                                            : ['BLOCKED', { harness: l2.err, detail: l2 }]), t() - s);
    }
    // T10 — a locked module lower down is refused by the server. Re-probe the picker: passing a module
    // in T01 advances the state, so pick whatever is CURRENTLY 🔒 Locked rather than the T-state snapshot.
    s = t();
    let freshLocked = null;
    { await api.resetFlow(); await api.freshReset(); await api.sendWait('/training');
      const o10 = await openTraining();
      if (o10.ok) {
        await api.flowClick('NIETE', { settleMs: 2500 }); await api.flowClick('Open program', { settleMs: 3500 });
        await api.flowClick('Level 0', { settleMs: 2500 }); await api.flowClick('Open level', { settleMs: 3500 });
        await api.flowClick('Pick a module to watch', { settleMs: 2500 });
        const pk10 = await api.flowProbe();
        freshLocked = (pk10.items || []).map(i => (i.text || '').trim()).find(x => /🔒\s*Locked/.test(x)) || null;
        api.closeFlow();
      }
    }
    if (freshLocked) {
      const c3 = await pickModule(freshLocked);
      rec('T10', NAME.T10, ...(c3.ok ? V(/Finish ".+" first — modules open one at a time\./.test(c3.txt), { reply: c3.txt.slice(0, 160), tapped: freshLocked.slice(0, 60) })
                                       : ['BLOCKED', { harness: c3.err, last: c3.last }]), t() - s);
    } else rec('T10', NAME.T10, 'BLOCKED', { reason: 'no 🔒 Locked module row in the picker (all unlocked in this state)' }, 0);
  }

  // T11 — the locked-exam link explains what to finish first (only while modules remain)
  s = t();
  {
    await api.resetFlow(); await api.freshReset();
    await api.sendWait('/training');
    const o = await openTraining();
    let ex = null, examLabel = null;
    if (o.ok) {
      await api.flowClick('NIETE', { settleMs: 2500 }); await api.flowClick('Open program', { settleMs: 3500 });
      await api.flowClick('Level 0', { settleMs: 2500 }); await api.flowClick('Open level', { settleMs: 3500 });
      const ld = await api.flowProbe();
      // The exam is an EmbeddedLink (kind 'link'); its locked label is exactly '🔒 Locked'. Module rows
      // read "<title> · <course> · 🔒 Locked", so restrict to links (or, if a lane does not tag kind,
      // to rows without ' · ') and click EXACT so a module option can never be hit instead.
      const items = ld.items || [];
      const links = items.filter(i => i.kind === 'link');
      const pool = links.length ? links : items.filter(i => !/ · /.test(i.text || ''));
      const examItem = pool.find(i => /🔒 Locked|Take exam|Review/.test(i.text || '')) || null;
      examLabel = examItem ? (examItem.text || '').trim() : null;
      if (examLabel && /🔒 Locked/.test(examLabel)) {
        const k = await api.flowClick(examLabel, { settleMs: 3000, exact: true });
        if (k.ok) { await api.flowClick('Close', { settleMs: 2000 }); api.closeFlow(); ex = await waitFresh((x) => /Finish every module in this level first/i.test(x.txt || ''), 60000); }
        else ex = { ok: false, err: k.err };
      }
      api.closeFlow();
    }
    rec('T11', 'Tapping the locked exam link explains what to finish first',
        ...(ex ? V(!!ex.ok && /the exam unlocks once all \d+ courses are complete/.test(ex.hit && ex.hit.txt || ''), { reply: ex.hit ? ex.hit.txt.slice(0, 160) : null, err: ex.err, last: ex.last })
               : ['BLOCKED', { reason: examLabel ? 'the exam row is not 🔒 Locked in this account state (' + examLabel + ')' : 'level detail did not open', harness: o.ok ? null : o.err }]), t() - s);
  }

  // ══ T08 — Oxbridge: a level certified from MODULE SCORES, with no exam ═══
  // The old BLOCKED read "this environment has no Oxbridge programme row (training_programs)".
  // True, and beside the point: Oxbridge is a VENDOR scoped into niete_standard, and its level is a
  // single 7-module course — exactly the shape seed-module-pass was written for and never wired to.
  // Seed every module but the last, drive the last one LIVE so the real grading path runs, and the
  // level must certify with no exam anywhere in the journey. Reverted at the end (bd-2ug2s).
  {
    s = t();
    let crashed = null;
    const OX_LEVEL = 17;
    let seeded = [];            // hoisted: the finally below MUST be able to undo the seed
    try {
    const oxMods = dbJson('level-modules', ['--level', String(OX_LEVEL)]) || [];
    let band = null, card = null, run = null, cert = null, examOffered = null, title = null;
    if (oxMods.length >= 2) {
      for (const mm of oxMods.slice(0, -1)) {
        const r = api.db('seed-module-pass', ['--module', String(mm.id)]);
        seeded.push({ id: mm.id, ok: !!(r && r.ok) });
        await sleep(250);   // api.db is execFileSync — yield so the mock's keep-alive socket survives
      }
      band = await openBandPicker({ vendor: 'Oxbridge', level: 'Game-Based|Professional Training' });
      if (band.ok) {
        // The level screen must NOT be offering an exam — that IS the scenario.
        examOffered = /Take exam|Ready for exam/.test((band.probe && band.probe.text) || '');
        // With every earlier module seeded passed, the last one is the only \u25b6 Next up row.
        const nextRow = band.rows.find(x => /\u25b6\s*Next up/.test((x && x.text) || ''));
        if (nextRow) {
          title = ((nextRow.text || '').split(' \u00b7 ')[0] || '').trim();
          card = await deliverPicked(nextRow.text);
          const key = answerKey(title);
          if (card.ok && card.cta && key && key.questions && key.questions.length) {
            await api.freshReset();
            await api.tapAndWait(card.cta, 60000);
            run = await takeQuiz(key);
            if ((run.last || {}).verdict === 'passed') {
              cert = await waitFresh((x) => x.doc || x.pdf || /certificate|\u0633\u0631\u0679\u06cc\u0641\u06a9\u06cc\u0679/i.test(x.txt || ''), 120000);
              // T06 — while this certificate exists (the finally below deletes it): read its code off
              // /certificates, ask for it by code, expect the PDF document (bd-w3cb9.6).
              const s06 = t();
              const list = await api.sendWait('/certificates');
              const code = (/Cert:\s*`([^`]+)`/.exec(list.txt || '') || [])[1] || null;
              if (code) {
                await api.freshReset();
                await api.sendWait('/certificate ' + code);
                const doc = await waitFresh((x) => x.doc || x.pdf || /could not find/i.test(x.txt || ''), 90000);
                const isDoc = !!(doc.ok && (doc.hit.doc || doc.hit.pdf));
                rec('T06', 'Asking for a certificate by its code sends the PDF',
                    ...V(isDoc, { code, asDocument: isDoc, filename: doc.ok && doc.hit.media && doc.hit.media.filename,
                                  reply: doc.ok ? (doc.hit.txt || '').slice(0, 120) : doc.last }), t() - s06);
              } else {
                rec('T06', 'Asking for a certificate by its code sends the PDF', 'BLOCKED',
                    { reason: '/certificates listed no code to ask for', reply: (list.txt || '').slice(0, 200) }, t() - s06);
              }
            }
          }
        }
      }
    }
    const verdict = (run && run.last && run.last.verdict) || null;
    rec('T08', 'For an Oxbridge programme a level is certified from module scores, with no exam',
        ...(cert
            ? V(!!cert.ok && verdict === 'passed' && examOffered === false,
                { module: title, seededModules: seeded.length, drivenLive: 1, verdict,
                  examOfferedOnLevelScreen: examOffered,
                  certificate: (cert.hit && (cert.hit.txt || '')).slice(0, 160),
                  asDocument: !!(cert.hit && (cert.hit.doc || cert.hit.pdf)) })
            : ['BLOCKED', { reason: !oxMods.length ? 'level-modules returned nothing for the Oxbridge level'
                                   : !band || !band.ok ? 'could not reach the Oxbridge band: ' + ((band && band.err) || 'n/a')
                                   : !title ? 'no \u25b6 Next up row after seeding every earlier module'
                                   : !card || !card.ok ? 'the last module did not open: ' + ((card && card.err) || 'n/a')
                                   : !verdict ? 'the module check produced no verdict'
                                   : 'passed the last module but no certificate arrived within 120s',
                            module: title, seededModules: seeded.length, verdict,
                            examOfferedOnLevelScreen: examOffered,
                            cta: card && card.cta, lastSeen: run && run.last }]), t() - s);
    } catch (e) {
      crashed = { message: String(e && e.message || e), stack: String(e && e.stack || '').split('\n').slice(0, 6) };
      rec('T08', 'For an Oxbridge programme a level is certified from module scores, with no exam',
          'BLOCKED', { reason: 'the Oxbridge drive threw', error: crashed }, t() - s);
    } finally {
      // Undo the seed whatever happened: this level's progress, certificate and attempts all go, so a
      // re-run starts from the same place and a crash cannot leave a certified Oxbridge level behind.
      if (seeded.length) { try { api.db('revert-level', ['--level', String(OX_LEVEL)]); } catch (e) {} }
    }
  }

  // ══ T26 / T27 — I-SAPS: the LAST module exam certifies the level; the PDF is watermarked ═══
  // Level 1: Novice is nine modules, each with one exam of two scenario MCQs and ONE written CRQ
  // (isaps-crq-paper.rules), and the level certifies on a three-part composite (isaps-grading.rules).
  // seed-isaps-exams passes eight exams and every unit quiz WITHOUT finishing a unit; the driver
  // enters Module 1 (I-SAPS lists modules, and picking one re-enters the level screen scoped to it),
  // sits its exam live, answers the CRQ with a fixed text so the LLM marking replays from cassette,
  // and reads the certificate PDF's text off the mock's media store for the watermark (bd-w3cb9.3).
  {
    s = t();
    const ISAPS_LEVEL = 26, LIVE_COURSE = 58;
    const CRQ_ANSWER = 'My philosophy of teaching rests on the belief that every child can learn when the classroom is '
      + 'safe, inclusive and purposeful. I see the teacher as a facilitator rather than a lecturer: I plan lessons around '
      + 'clear learning objectives, connect new ideas to what pupils already know, and use questioning and group work so '
      + 'that pupils construct understanding for themselves. I treat assessment as information for the next lesson, not '
      + 'a verdict on the child, and I reflect after each lesson on what worked and what I would change. Ethically I model '
      + 'fairness, respect for every family and honesty, because pupils learn as much from how I act as from what I say. '
      + 'This links to the philosophical foundations of education: Dewey\'s learning by doing, constructivism, and the '
      + 'view that schooling should prepare children to think for themselves and to contribute to their community.';
    let seeded26 = null, crashed26 = null, doc = null; const ev = {}; const seen = [];
    const collect = async (ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { for (const r of await api.fresh()) seen.push(r); if (seen.some(x => x.doc || x.pdf)) return; await sleep(1500); } };
    try {
      // Only niete_standard is active on the driver at run time (the suite's seed), so the vendor picker
      // lists NIETE / Beacon House / Oxbridge and no I-SAPS (run 1201). Activate the pilot programme for
      // this scenario; deactivated again below.
      const act = api.db('activate-program', ['--program-key', 'niete_isaps_pilot']); ev.programActivated = !!(act && act.ok);
      seeded26 = dbJson('seed-isaps-exams', ['--skip-course', String(LIVE_COURSE)]);
      ev.seeded = seeded26 && { exams: seeded26.exams, units: seeded26.units, unitAnswers: seeded26.unitAnswers, live: seeded26.liveCourse && seeded26.liveCourse.title };
      if (!seeded26) throw new Error('SEED_FAILED (api.db returned nothing — see runner.log)');
      // api.db is execFileSync: a seed this size blocks the loop long enough for the mock's keep-alive
      // socket to drop ("fetch failed", run 1138). Breathe, then warm the connection with retries.
      await sleep(2000);
      for (let k = 0; k < 4; k++) { try { await api.fresh(); break; } catch (e) { if (k === 3) throw e; await sleep(1500); } }
      const lv = await openBandLevel({ vendor: 'I-SAPS', level: 'Novice' });
      if (!lv.ok) { ev.vendorPicker = lv.offered; throw new Error('LEVEL:' + lv.err); }
      ev.levelScreen = String((lv.detail && lv.detail.text) || '').slice(0, 200);
      await api.flowClick('Pick a module to watch', { settleMs: 3000 });
      let pr = await api.flowProbe();
      const courseRow = (((pr.items || []).find(i => i.kind === 'option' && /^Module 1\b/.test(i.text || '')) || {}).text) || null;
      if (!courseRow) throw new Error('NO_COURSE_ROW:' + JSON.stringify((pr.items || []).filter(i => i.kind === 'option').map(i => i.text).slice(0, 10)));
      await api.flowPick(courseRow, { exact: true });
      pr = await api.flowProbe(); ev.scopedScreen = String(pr.text || '').slice(0, 260);
      const links = (pr.items || []).filter(i => i.kind === 'link'); const pool = links.length ? links : (pr.items || []).filter(i => !/ · /.test(i.text || ''));
      const exam = pool.find(i => /Take the module exam|Module exam/i.test(i.text || ''));
      if (!exam) throw new Error('NO_EXAM_LINK:' + JSON.stringify(pool.map(i => i.text).slice(0, 8)));
      ev.examRow = String(exam.text).trim();
      await api.freshReset();
      await api.flowClick(ev.examRow, { settleMs: 3000, exact: true });
      await api.flowClick('Close', { settleMs: 2000 }); api.closeFlow();
      const rawK = seeded26 && seeded26.liveExam ? (dbJson('answer-key', ['--grand-quiz', String(seeded26.liveExam)]) || []) : [];
      const key26 = { questions: rawK.map(r => ({ q: r.q, correct: [r.correct].filter(Boolean), correct_index: [r.correct_index].filter(Boolean), multi: false })) };
      const mcq = await takeQuiz(key26, { stopAfter: 2 });
      ev.mcq = { answered: mcq.trail.length, first: mcq.first, refusedBeforeStart: !mcq.first ? (mcq.last || {}).err : null };
      const crq = await waitFresh((x) => /\*Q3\/3\*/.test(x.txt || '') && !x.list, 60000);
      ev.crqPrompt = crq.ok ? (crq.hit.txt || '').slice(0, 220) : crq.last;
      if (!crq.ok) throw new Error('NO_CRQ_PROMPT');
      await api.freshReset();
      await api.sendWait(CRQ_ANSWER);
      await collect(180000);
      const txt = seen.map(x => x.txt || '').join('\n');
      ev.afterAnswer = seen.map(x => (x.txt || '').slice(0, 120)).filter(Boolean).slice(0, 8);
      ev.crqScore = (/📝 \*(\d+)\/(\d+)\*/.exec(txt) || [])[0] || null;
      ev.passedModule = /Module exam — you passed|passed this module/i.test(txt);
      ev.completedEveryModule = /You have completed every module of Level 1: Novice\./.test(txt);
      ev.code = (/`([A-Z0-9][A-Z0-9-]{7,})`/.exec(txt) || /\b(CERT-\d{8}-[A-Z0-9]+)\b/.exec(txt) || [])[1] || null;
      doc = seen.find(x => x.doc || x.pdf) || null; ev.pdfDocument = !!doc; ev.filename = doc && doc.media && doc.media.filename;
    } catch (e) { crashed26 = String((e && e.message) || e); }
    rec('T26', 'For an I-SAPS programme passing the last module exam certifies the level, whatever units are left',
        ...(crashed26 ? ['BLOCKED', { reason: 'threw: ' + crashed26, ...ev }]
            : V(ev.completedEveryModule && !!ev.code && ev.pdfDocument && ev.mcq && ev.mcq.first === 'Q1/3', ev)), t() - s);

    // T27 — read the certificate's text off the mock's media store
    s = t();
    let wm = { reason: 'no certificate document arrived from T26' };
    if (doc && doc.media && doc.media.id) {
      try {
        const base = String(process.env.E2E_MOCK_URL || 'http://127.0.0.1:4010').replace(/\/+$/, '');
        const res = await fetch(base + '/media/' + doc.media.id + '/bytes');
        const buf = Buffer.from(await res.arrayBuffer());
        const out = path.join(process.env.RUN_DIR || '.', 'isaps-certificate.pdf'); fs.writeFileSync(out, buf);
        const text = execFileSync('python3', ['-c', 'import sys,pypdf;r=pypdf.PdfReader(sys.argv[1]);print("\\n".join((p.extract_text() or "") for p in r.pages))', out], { encoding: 'utf8', timeout: 60000 });
        wm = { bytes: buf.length, pages: (text.match(/\n/g) || []).length, watermark: /NOT A REAL CERTIFICATE/.test(text), sample: text.replace(/\s+/g, ' ').slice(0, 160), saved: out,
               productionHalf: 'not observable in the mock lane: NODE_ENV is not production, so shouldStampTestBanner stamps EVERY vendor here; the "other programmes are clean on production" rule is pinned by certificate-env.rules tests' };
      } catch (e) { wm = { reason: 'could not read the PDF text: ' + String((e && e.message) || e).slice(0, 160) }; }
    }
    rec('T27', 'An I-SAPS certificate is watermarked as not real, in every environment, while it is a pilot',
        ...(wm.watermark === undefined ? ['BLOCKED', wm] : V(wm.watermark === true, wm)), t() - s);
    if (seeded26) { try { api.db('revert-level', ['--level', String(ISAPS_LEVEL)]); } catch (e) {} }
    try { api.db('activate-program', ['--program-key', 'niete_isaps_pilot', '--deactivate']); } catch (e) {}
  }

  // \u2550\u2550 T24 \u2014 a quiz made from my lesson plan is listed in /quiz among my coaching lessons \u2550\u2550
  // No path in the mock lane makes an lp_v8 quiz (it takes the 15:00 nudge sweeper and worker
  // generation), so one sent row is seeded and deleted afterwards. /quiz is flag-gated
  // (TRANSCRIPT_QUIZ_ENABLED, now defaulted on in local-stack.sh) and, with TRANSCRIPT_QUIZ_FLOW_ID
  // set, answers with ONE Flow whose LESSONS list keys lesson-plan quizzes as lp_<quizId> and coaching
  // lessons by session id \u2014 that key is the one reliable way to tell them apart (bd-w3cb9.4).
  {
    s = t(); let seeded24 = null; const ev = {};
    try {
      seeded24 = dbJson('seed-lp-quiz', []);
      if (seeded24 && !seeded24.id) { const back = dbJson('seed-lp-quiz', ['--lookup']); if (back && back.id) seeded24.id = back.id; }
      ev.quizId = seeded24 && seeded24.id; ev.topic = seeded24 && seeded24.topic;
      await api.resetFlow(); await api.freshReset();
      const q = await api.sendWait('/quiz');
      ev.reply = (q.txt || '').slice(0, 160); ev.btns = q.btns;
      const op = await api.openFlow('.+');
      if (op.ok) {
        const pr = await api.flowProbe();
        const items = (pr.items || []).filter(i => i.kind !== 'footer');
        // The scenario is about the LISTING: our quiz appears in the one list with the coaching lessons,
        // keyed lp_<quizId> (the only reliable tell), showing its topic. Opening the row is not asked for
        // — and the emulator refuses that route (ROUTING_REFUSED:LESSONS→DONE, run 1236), so it is not tried.
        const mine = items.find(i => String(i.id || '') === 'lp_' + ev.quizId) || null;
        const coaching = items.filter(i => i.id && !/^lp_/.test(String(i.id)));
        Object.assign(ev, { screen: pr.screen,
          row: mine ? { id: mine.id, text: String(mine.text || '').slice(0, 60), hay: String(mine.hay || '').replace(/\n/g, ' | ').slice(0, 140) } : null,
          listed: !!mine, keyedAsLessonPlan: !!(mine && /^lp_/.test(String(mine.id || ''))),
          showsTopic: !!(mine && ev.topic && String(mine.hay || '').includes(String(ev.topic))),
          coachingLessonsAlongside: coaching.map(i => ({ id: String(i.id).slice(0, 24), text: String(i.text || '').slice(0, 40) })).slice(0, 4),
          allRows: items.map(i => String(i.text || '').slice(0, 40)).slice(0, 8) });
        rec('T24', 'A quiz made from my lesson plan is listed in /quiz among my coaching lessons', ...V(ev.listed && ev.keyedAsLessonPlan && ev.showsTopic, ev), t() - s);
      } else if (q.list && q.list.rows) {
        const rows = q.list.rows; const mine = rows.find(r => String(r.id || '') === 'tq_pick_lp_' + ev.quizId);
        Object.assign(ev, { via: 'list', listed: !!mine, rows: rows.slice(0, 6).map(r => ({ id: r.id, title: r.title, desc: r.description })) });
        rec('T24', 'A quiz made from my lesson plan is listed in /quiz among my coaching lessons', ...V(!!mine, ev), t() - s);
      } else rec('T24', 'A quiz made from my lesson plan is listed in /quiz among my coaching lessons', 'BLOCKED',
                 { reason: '/quiz produced neither a Flow card nor a list: ' + op.err, ...ev }, t() - s);
    } finally { api.closeFlow(); if (seeded24) { try { api.db('seed-lp-quiz', ['--restore']); } catch (e) {} } }   // restore keys on meta.qa_seed, not the id
  }

  // ══ T35–T62 — the class-quiz scenarios sandbox added (bd-5d294) ══════════════════════════════
  // Two seeds and a second phone make most of these drivable with no LLM: seed-class-quiz writes a
  // SENT quiz with four hand-written questions and a QUIZ-<code>; api.as(phone) is a child (or a
  // friend) on the same mock stack. Lesson-plan states (offered / failed) are seeded with the
  // lesson references of a REAL lesson-plan quiz, so "Make it" can genuinely generate (worker +
  // LLM via cassette replay-on-miss). What still cannot be reached is said so, per scenario.
  {
    const N = (tid, title) => (verdict, ev, ms) => rec(tid, title, ...(Array.isArray(verdict) ? verdict : [verdict, ev]), ms);
    const T = {
      T35: 'A lesson-plan quiz still waiting for its language is asked again from /quiz, never "still being made"',
      T36: 'A lesson-plan quiz that could not be made opens in /quiz, says why, and can be made again',
      T37: '/quiz never promises a report when no student has finished',
      T38: 'A letter typed during a class quiz answers the question, and an unfinished quiz never takes over the chat',
      T39: 'A child can type STOP to end a class quiz, and the teacher sees it stopped',
      T40: '/quiz counts each child once, however many times they opened the quiz',
      T41: 'A lesson-plan quiz that could not be started says so, and can be made again',
      T42: 'A question that cannot be sent is skipped, and the child is scored on the questions actually asked',
      T43: 'The class report names the class once, the same way, however the children typed it',
      T44: 'The class report never calls me "your teacher"',
      T45: 'The class report and the quiz PDF do not leave pages nearly empty',
      T46: 'A quiz the model could not write from my lesson plan says the problem was on our side',
      T47: 'A quiz the model could not write from my coaching recording says the problem was on our side',
      T48: 'An Urdu class quiz speaks to the child in grammatical Urdu, and a picture question looks like the rest of the quiz',
      T49: 'A place-value question shows the bundles the class built, and never the number',
      T50: 'A four-digit place-value question shows the thousands the class built',
      T51: 'A counting question draws the lesson’s own objects — sweets, dates, cookies, lilies, samosas, bangles',
      T52: 'An Urdu quiz for a maths lesson full of English terms is made, with the terms in English letters',
      T53: 'In an Urdu quiz, two English terms are never written side by side',
      T54: 'A grade 1-5 maths quiz draws what the lesson drew, on at least three questions',
      T55: 'A column subtraction reaches the child set out the way the textbook prints it',
      T56: 'A child opening an Urdu quiz link is asked for name and class in Urdu',
      T57: 'After an Urdu quiz, the message a child forwards to a friend is in Urdu',
      T58: 'A child who passed an Urdu quiz to a friend hears how the friend did, in Urdu',
      T59: 'A video quiz sent to the class from an Urdu run forwards an Urdu message',
      T60: 'A video quiz offered in Urdu answers every tap in Urdu, even after the offer or the quiz has ended',
      T61: 'The reminder about a quiet quiz reads naturally and keeps each quiz title whole',
      T62: 'The quiz caption names the lesson once, with a bracket only when the bracket says something new',
    };
    const R = (tid) => N(tid, T[tid]);
    const CHILD_PREFIX = '9230099';
    const child = (n) => api.as(CHILD_PREFIX + String(n).padStart(5, '0'));
    const URDU = /[؀-ۿ]/;
    // flowClick matches LITERAL text (findItem: includes), unlike openFlow's regex: an alternation like
    // 'Start the quiz|quiz شروع کریں' matches nothing (run 20260925-0958: every child join and every
    // lesson-screen Continue silently did not click). Click a footer by the label the probe shows.
    const clickFooter = async (actor, o2) => {
      const pr = await actor.flowProbe(); const f = (pr.items || []).find(i => i.kind === 'footer');
      if (!f) return { ok: false, err: 'NO_FOOTER', items: (pr.items || []).map(i => i.kind + ':' + String(i.text || '').slice(0, 30)) };
      return actor.flowClick(String(f.text), { settleMs: 3000, exact: true, ...(o2 || {}) });
    };
    const waitOn = async (actor, pred, timeoutMs, stepMs = 1500) => {
      const t0 = Date.now(); const seen = [];
      while (Date.now() - t0 < timeoutMs) {
        for (const r of await actor.fresh()) seen.push(r);
        const hit = seen.find(pred); if (hit) return { ok: true, hit, seen, waitedMs: Date.now() - t0 };
        await sleep(stepMs);
      }
      return { ok: false, seen, last: (seen[seen.length - 1] || {}).txt || '', waitedMs: Date.now() - t0 };
    };
    const isChildQ = (x) => !!((x.list && (x.list.rows || []).length) || (x.btns || []).some(b => /^[A-D]$/.test(b)));
    const isEnd = (x) => /All done|مکمل|out of|میں سے|QUIZ COMPLETE|کوئز مکمل/.test(x.txt || '') || (x.btns || []).some(b => /Invite a friend|دوست کو بھیجیں/.test(b));
    // Join a class quiz from its link: greeting → "Start" opens the WHO Flow (name + class) → question 1.
    const childJoin = async (kid, code, name, cls) => {
      await kid.resetFlow(); await kid.freshReset();
      const g = await kid.sendWait('QUIZ-' + code);
      const ev = { greeting: (g.txt || '').slice(0, 220), buttons: g.btns };
      if ((g.btns || []).some(b => /^Start$|شروع کریں/.test(b))) {
        const op = await kid.openFlow('^Start$|شروع کریں');
        if (!op.ok) return { ok: false, err: 'JOIN_FLOW:' + op.err, ...ev };
        const pr = await kid.flowProbe(); ev.joinScreen = { screen: pr.screen, text: String(pr.text || '').slice(0, 160) };
        await kid.flowType(name, { field: 'student_name' }); await kid.flowType(cls, { field: 'student_class' });
        await kid.freshReset();
        const s = await clickFooter(kid); kid.closeFlow();
        ev.joinVia = 'flow'; ev.submit = s.ok;
      } else if (/name|نام/i.test(g.txt || '')) {
        const cp = await kid.sendWait(name); ev.classPrompt = (cp.txt || '').slice(0, 160); await kid.freshReset(); await kid.sendWait(cls); ev.joinVia = 'chat';
      } else if ((g.btns || []).length) {
        await kid.tapAndWait(g.btns[0], 30000); ev.joinVia = 'button:' + g.btns[0];
      }
      const q1 = await waitOn(kid, isChildQ, 60000);
      return { ok: q1.ok, ...ev, q: q1.hit || null, seen: q1.seen, last: q1.last };
    };
    // Answer the question on screen. want: option TEXT (any shuffle) | 'wrong' | a letter to TYPE.
    const optionText = (row) => String(row.description || row.title || '');
    const childAnswer = async (kid, q, want, { type = false } = {}) => {
      await kid.freshReset();
      if (type) { await kid.sendWait(String(want)); }
      else if (q.list && (q.list.rows || []).length) {
        const rows = q.list.rows;
        const row = want === 'wrong' ? rows[rows.length - 1] : (rows.find(r => optionText(r) === String(want)) || rows.find(r => /^[A-D]$/.test(r.title) && optionText(r).includes(String(want))) || rows[0]);
        await kid.tapId('list', row.id, row.title);
      } else {
        const btns = q.btns || []; const b = want === 'wrong' ? btns[btns.length - 1] : (btns.find(x => x === String(want)) || btns[0]);
        await kid.tapAndWait(b, 30000);
      }
      const w = await waitOn(kid, (x) => isChildQ(x) || isEnd(x), 60000);
      const fb = w.seen.map(x => x.txt || '').join(' | ');
      return { ok: w.ok, next: w.hit || null, feedback: fb.slice(0, 200), ended: !!(w.hit && isEnd(w.hit)), seen: w.seen };
    };
    // The correct option's TEXT for question i of the seeded en/ur quiz (same numbers both languages).
    const KEY_TEXT = ['37', '51', '2', '92'];
    const childRun = async (kid, code, name, cls, { correct = 4, stopAfter = null, typed = false } = {}) => {
      const j = await childJoin(kid, code, name, cls); if (!j.ok) return { ok: false, err: 'JOIN:' + (j.err || j.last), join: j };
      let q = j.q, answered = 0, ended = false, trail = [];
      for (let i = 0; i < 8 && q && !ended; i++) {
        const idx = trail.length; const want = idx < correct ? KEY_TEXT[idx] || 'wrong' : 'wrong';
        const a = await childAnswer(kid, q, typed ? ['A', 'B', 'C', 'D'][idx % 4] : want, { type: typed });
        answered++; trail.push({ q: idx + 1, want, feedback: a.feedback.slice(0, 90) });
        ended = a.ended; q = a.next;
        if (stopAfter && answered >= stopAfter) return { ok: true, answered, trail, ended: false, q, join: j };
      }
      return { ok: ended, answered, trail, ended, join: j, end: q };
    };
    // Teacher side: /quiz → the Flow → open a row → LESSON screen
    const openLesson = async (rowPred) => {
      await api.resetFlow(); await api.freshReset();
      const q = await api.sendWait('/quiz');
      const op = await api.openFlow('.+'); if (!op.ok) return { ok: false, err: 'QUIZ_FLOW:' + op.err, reply: (q.txt || '').slice(0, 120) };
      const pr = await api.flowProbe(); const rows = (pr.items || []).filter(i => i.kind !== 'footer');
      const row = rows.find(rowPred) || null;
      if (!row) return { ok: false, err: 'ROW_ABSENT', rows: rows.map(i => ({ id: i.id, text: String(i.text || '').slice(0, 50) })).slice(0, 6) };
      const k = await api.flowClick(String(row.text), { settleMs: 3000, exact: true });
      const lp = await api.flowProbe();
      return { ok: !!k.ok, err: k.err, row: { id: row.id, text: row.text, hay: String(row.hay || '').slice(0, 120) }, screen: lp.screen, text: String(lp.text || '').slice(0, 600),
               actions: (lp.items || []).filter(i => i.kind === 'option').map(i => ({ id: i.id, text: String(i.text || '').slice(0, 60) })) };
    };
    const chooseAction = async (re) => {
      const pr = await api.flowProbe(); const a = (pr.items || []).find(i => i.kind === 'option' && re.test(String(i.text || '') + ' ' + String(i.id || '')));
      if (!a) return { ok: false, err: 'NO_ACTION', offered: (pr.items || []).filter(i => i.kind === 'option').map(i => i.text) };
      const p = await api.flowPick(a.text, { exact: true }); if (!p.ok) return { ok: false, err: 'PICK:' + p.err };
      await api.freshReset();
      const c = await clickFooter(api);
      if (!c.ok) { api.closeFlow(); return { ok: false, err: 'CONTINUE:' + c.err, picked: a.text }; }
      const done = await api.flowProbe();   // a SUCCESS completion has already closed the Flow (screen undefined)
      if (done.screen === 'DONE') { await clickFooter(api, { settleMs: 1500 }).catch(() => null); }
      api.closeFlow();
      return { ok: true, picked: a.text, doneScreen: done.screen || 'SUCCESS', doneText: String(done.text || '').slice(0, 200) };
    };
    const pdfText = async (doc, name) => {
      const base = String(process.env.E2E_MOCK_URL || 'http://127.0.0.1:4010').replace(/\/+$/, '');
      const res = await fetch(base + '/media/' + doc.media.id + '/bytes'); const buf = Buffer.from(await res.arrayBuffer());
      const out = path.join(process.env.RUN_DIR || '.', name); fs.writeFileSync(out, buf);
      const pages = JSON.parse(execFileSync('python3', ['-c', 'import sys,json,pypdf;r=pypdf.PdfReader(sys.argv[1]);print(json.dumps([(p.extract_text() or "") for p in r.pages]))', out], { encoding: 'utf8', timeout: 60000 }));
      return { pages, text: pages.join('\n'), bytes: buf.length, saved: out };
    };

    // ── the EN class quiz: T37 (before) → T38 T39 T40 → T37 (after) → T43 T44 ───────────────
    let enq = null, urq = null, brk = null;
    try {
      enq = dbJson('seed-class-quiz', ['--language', 'en']);
      if (!enq || !enq.code) throw new Error('SEED_EN:' + JSON.stringify(enq));
      // T37 (first half): nobody finished → Resend link + Done, no Generate report
      s = t();
      const before = await openLesson(i => String(i.id || '') === 'lp_' + enq.quizId);
      const ev37 = { before: { ok: before.ok, err: before.err, actions: before.actions && before.actions.map(a => a.text), text: (before.text || '').slice(0, 200) } };
      api.closeFlow();
      // T38 — typed letters; the teacher's own unfinished run never takes over /menu
      s = t();
      const k1 = child(1);
      const j = await childJoin(k1, enq.code, 'Ali', 'Grade 3');
      const ev38 = { join: { via: j.joinVia, ok: j.ok, greeting: j.greeting, submit: j.submit, err: j.err || j.last, seen: (j.seen || []).map(x => (x.txt || '').slice(0, 80)).slice(0, 4) } };
      if (j.ok) {
        const a1 = await childAnswer(k1, j.q, 'B', { type: true });
        ev38.typedB = { recorded: !!(a1.next || a1.ended), feedback: a1.feedback };
        const a2 = a1.next ? await childAnswer(k1, a1.next, 'Z', { type: true }) : { ok: false };
        ev38.typedZ = { taken: a2.ok && a2.next && a2.next !== a1.next, feedback: (a2.feedback || '').slice(0, 120) };
        // the teacher opens her own link, answers one, then /menu must still be the menu
        await api.freshReset(); const tj = await childJoin(api, enq.code, 'E2E Driver', 'Grade 3');
        if (tj.ok) await childAnswer(api, tj.q, 'A', { type: true });
        const menu = await api.sendWait('/menu');
        ev38.teacherMenuAfterOwnRun = { reply: (menu.txt || '').slice(0, 120), isMenu: /menu|مینو|choose|Lesson plan|Training/i.test(menu.txt || '') || (menu.btns || []).length > 0 || !!menu.list };
        R('T38')(V(ev38.typedB.recorded && !ev38.typedZ.taken && ev38.teacherMenuAfterOwnRun.isMenu, ev38), t() - s);
        // finish k1 correctly so she counts as finished
        let q = a2.next || a1.next; for (let i = 0; q && i < 6; i++) { const a = await childAnswer(k1, q, KEY_TEXT[Math.min(i + 2, 3)]); if (a.ended) break; q = a.next; }
      } else R('T38')('BLOCKED', { reason: 'child could not join the quiz: ' + (j.err || j.last), ...ev38 }, t() - s);
      // T39 — STOP
      s = t();
      const k2 = child(2);
      const j2 = await childJoin(k2, enq.code, 'Sara', 'Grade 3');
      const ev39 = { join: j2.ok, err: j2.err || j2.last };
      if (j2.ok) {
        await k2.freshReset(); const st = await k2.sendWait('stop');
        ev39.stopped = { reply: (st.txt || '').slice(0, 160), saysStopped: /stopped|روک|رک گیا/i.test(st.txt || '') };
        await k2.freshReset();
        if (j2.q.list) { const r = j2.q.list.rows[0]; await k2.tapId('list', r.id, r.title); } else if ((j2.q.btns || [])[0]) { try { await k2.tapAndWait(j2.q.btns[0], 8000); } catch (e) {} }
        const after = await waitOn(k2, (x) => /Correct|Not quite|درست|غلط|Question \d+ of|سوال \d+/.test(x.txt || ''), 8000);
        ev39.oldTapRecorded = after.ok; ev39.afterTap = after.ok ? (after.hit.txt || '').slice(0, 100) : 'nothing';
        const les = await openLesson(i => String(i.id || '') === 'lp_' + enq.quizId); api.closeFlow();
        ev39.lesson = { text: (les.text || '').slice(0, 400) };
        ev39.listedAsStopped = /Stopped before the end[^\n]*Sara|روک[^\n]*Sara/.test(les.text || '');
        R('T39')(V(ev39.stopped.saysStopped && !ev39.oldTapRecorded && ev39.listedAsStopped, ev39), t() - s);
      } else R('T39')('BLOCKED', { reason: 'child could not join: ' + (j2.err || j2.last) }, t() - s);
      // T40 — each child counted once, latest finished attempt
      s = t();
      const k3 = child(3), k4 = child(4);
      const r3a = await childRun(k3, enq.code, 'Bilal', 'Grade 3', { stopAfter: 1 }); if (r3a.ok) { await k3.freshReset(); await k3.sendWait('stop'); }
      const r3b = await childRun(k3, enq.code, 'Bilal', 'Grade 3', { correct: 4 });
      const r4a = await childRun(k4, enq.code, 'Hina', 'Grade 3', { correct: 2 });
      const r4b = await childRun(k4, enq.code, 'Hina', 'Grade 3', { correct: 4 });
      const les40 = await openLesson(i => String(i.id || '') === 'lp_' + enq.quizId); api.closeFlow();
      const head = (/(\d+) started · (\d+) finished · average (\d+)%/.exec(les40.text || '') || []);
      const names = ((les40.text || '').match(/Bilal|Hina/g) || []);
      const ev40 = { runs: { bilalStoppedThenFinished: r3a.ok && r3b.ok, hinaTwice: r4a.ok && r4b.ok }, head: head[0] || null, started: head[1], finished: head[2], avg: head[3],
                     bilalLines: names.filter(n => n === 'Bilal').length, hinaLines: names.filter(n => n === 'Hina').length, lesson: (les40.text || '').slice(0, 400) };
      // Ali finished (T38), Sara stopped (T39), Bilal + Hina finished: 4 started, 3 finished. Latest attempts: Ali (typed, unknown), Bilal 100, Hina 100.
      R('T40')(V(!!head[0] && ev40.bilalLines === 1 && ev40.hinaLines === 1 && Number(head[1]) === 4 && Number(head[2]) === 3, ev40), t() - s);
      // T37 (second half): a child has finished → Generate report first, and choosing it brings the report
      s = t();
      const afterL = await openLesson(i => String(i.id || '') === 'lp_' + enq.quizId);
      ev37.after = { actions: afterL.actions && afterL.actions.map(a => a.text) };
      await api.freshReset();
      const pick = afterL.ok ? await chooseAction(/Generate report|رپورٹ/) : { ok: false, err: afterL.err };
      const rep = pick.ok ? await waitFresh((x) => x.doc || x.pdf, 240000) : { ok: false };
      ev37.report = { picked: pick.picked, arrived: !!rep.ok, filename: rep.ok && rep.hit.media && rep.hit.media.filename, err: pick.err };
      const bActs = (ev37.before.actions || []).join(' '), aActs = (ev37.after.actions || []).join(' ');
      R('T37')(V(before.ok && /Resend link/.test(bActs) && /Done/.test(bActs) && !/Generate report/.test(bActs) && /^Generate report/.test((ev37.after.actions || [])[0] || '') && ev37.report.arrived, ev37), t() - s);
      // T43 / T44 — the report's text
      s = t();
      let ev43 = {}, ev44 = {};
      if (rep.ok) {
        const pdf = await pdfText(rep.hit, 'class-report-en.pdf');
        const header = pdf.pages[0] || '';
        ev43 = { classMentionsOnPage1: (header.match(/Class 3|Grade 3/g) || []).length, hasDoubledClass: /3، ?۳|Grade 3[^\n]*Grade 3[^\n]*Grade 3/.test(header),
                 repeatsClassPerChild: (pdf.text.match(/Grade 3/g) || []).length > 2, sample: header.replace(/\s+/g, ' ').slice(0, 220), saved: pdf.saved };
        R('T43')(V(ev43.classMentionsOnPage1 >= 1 && !ev43.hasDoubledClass && !ev43.repeatsClassPerChild, ev43), t() - s);
        ev44 = { yourTeacher: /Your teacher|آپ کے استاد/.test(pdf.text), note: 'the driver account HAS a first name (E2E Driver); the Given asks for none — checked that the phrase never appears anyway' };
        R('T44')(V(!ev44.yourTeacher, ev44), t() - s);
      } else { R('T43')('BLOCKED', { reason: 'no class report arrived to read', report: ev37.report }, t() - s); R('T44')('BLOCKED', { reason: 'no class report arrived to read' }, t() - s); }
    } catch (e) { for (const id of ['T37', 'T38', 'T39', 'T40', 'T43', 'T44']) if (!seenIds.has(id)) R(id)('BLOCKED', { reason: 'the EN class-quiz drive threw: ' + String((e && e.message) || e).slice(0, 200) }, 0); }

    // ── the UR class quiz: T56 T57 T58 T45 ───────────────────────────────────────────────
    try {
      urq = dbJson('seed-class-quiz', ['--language', 'ur']);
      if (!urq || !urq.code) throw new Error('SEED_UR:' + JSON.stringify(urq));
      s = t();
      const k5 = child(5);
      const j5 = await childJoin(k5, urq.code, 'علی', '3');
      const ev56 = { greeting: j5.greeting, buttons: j5.buttons, joinScreen: j5.joinScreen, joinVia: j5.joinVia, classPrompt: j5.classPrompt, q1: j5.ok };
      ev56.urduGreeting = URDU.test(j5.greeting || ''); ev56.startButtonUrdu = (j5.buttons || []).some(b => /شروع کریں/.test(b));
      // STUDENT_JOIN_LOCALIZED_FLOW_ID is unset in the mock stack env, so an Urdu link joins through chat
      // prompts (name, then class) rather than the localized Flow with its "شروع کریں" button. Judge the
      // Urdu of whichever surface asked: greeting, name ask and class ask must all be Urdu.
      ev56.askedInUrdu = j5.joinVia === 'flow' ? !!(j5.joinScreen && URDU.test(j5.joinScreen.text || ''))
                        : (/نام/.test(j5.greeting || '') && URDU.test(j5.classPrompt || ''));
      ev56.surface = j5.joinVia === 'flow' ? 'localized join Flow' : 'chat prompts (STUDENT_JOIN_LOCALIZED_FLOW_ID unset in the mock stack env)';
      R('T56')(V(ev56.urduGreeting && ev56.askedInUrdu && j5.ok && (j5.joinVia !== 'flow' || ev56.startButtonUrdu), ev56), t() - s);
      // finish the Urdu quiz with two wrong answers (T45 wants questions worth reteaching)
      let q = j5.q, endSeen = []; for (let i = 0; q && i < 6; i++) { const a = await childAnswer(k5, q, i < 2 ? 'wrong' : KEY_TEXT[i]); if (a.ended) { endSeen = a.seen; break; } q = a.next; }
      // T57 — invite a friend, in Urdu. The button card lands 0.2s after the scorecard, inside the batch
      // the last answer already pulled (run 1545) — look there first, then wait.
      s = t();
      const isInvite = (x) => (x.btns || []).some(b => /دوست کو بھیجیں|Invite a friend/.test(b));
      const pre = endSeen.find(isInvite);
      const inviteBtn = pre ? { ok: true, hit: pre } : await waitOn(k5, isInvite, 30000);
      const ev57 = { inviteOffered: inviteBtn.ok, offer: inviteBtn.ok ? (inviteBtn.hit.txt || '').slice(0, 120) : inviteBtn.last };
      let friendCode = null;
      if (inviteBtn.ok) {
        await k5.freshReset(); await k5.tapAndWait((inviteBtn.hit.btns || []).find(b => /دوست|Invite/.test(b)), 30000);
        const msgs = await waitOn(k5, (x) => /QUIZ-[A-Z0-9]{6}/.test(x.txt || ''), 30000);
        const all = msgs.seen.map(x => x.txt || '');
        ev57.instruction = (all[0] || '').slice(0, 140); ev57.forward = (all.find(x => /QUIZ-/.test(x)) || '').slice(0, 200);
        friendCode = (/QUIZ-([A-Z0-9]{6})/.exec(ev57.forward) || [])[1] || null;
        ev57.instructionUrdu = URDU.test(ev57.instruction); ev57.forwardUrdu = URDU.test(ev57.forward); ev57.namesChildFirstNameOnly = /علی/.test(ev57.forward);
        R('T57')(V(ev57.instructionUrdu && ev57.forwardUrdu && !!friendCode && ev57.namesChildFirstNameOnly, ev57), t() - s);
      } else R('T57')('BLOCKED', { reason: 'no invite-a-friend button after finishing the Urdu quiz', ...ev57 }, t() - s);
      // T58 — the friend finishes; the first child hears in Urdu with both scores
      s = t();
      if (friendCode) {
        const k6 = child(6); await k5.freshReset();
        const r6 = await childRun(k6, friendCode, 'احمد', '3', { correct: 4 });
        const told = await waitOn(k5, (x) => /احمد/.test(x.txt || ''), 60000);
        const ev58 = { friendFinished: r6.ok, told: told.ok ? (told.hit.txt || '').slice(0, 220) : told.last,
                       urdu: told.ok && URDU.test(told.hit.txt || ''), scoresShape: told.ok && /\d+ میں سے \d+/.test(told.hit.txt || ''),
                       framedAsLoss: told.ok && /ہار|lost|behind/i.test(told.hit.txt || '') };
        R('T58')(V(ev58.friendFinished && ev58.urdu && ev58.scoresShape && !ev58.framedAsLoss, ev58), t() - s);
      } else R('T58')('BLOCKED', { reason: 'no friend link came out of T57' }, t() - s);
      // T45 — the Urdu report's pages
      s = t();
      const lesU = await openLesson(i => String(i.id || '') === 'lp_' + urq.quizId);
      await api.freshReset();
      const pickU = lesU.ok ? await chooseAction(/Generate report|رپورٹ/) : { ok: false, err: lesU.err };
      const repU = pickU.ok ? await waitFresh((x) => x.doc || x.pdf, 240000) : { ok: false };
      if (repU.ok) {
        const pdf = await pdfText(repU.hit, 'class-report-ur.pdf');
        const lens = pdf.pages.map(p => p.replace(/\s+/g, '').length);
        const ev45 = { pages: pdf.pages.length, pageTextLengths: lens, firstPageHasQuestion: /\?|؟/.test(pdf.pages[0] || ''),
                       nearlyEmptyBeforeLast: lens.slice(0, -1).some((n, i) => n < 0.25 * Math.max(...lens)), saved: pdf.saved };
        R('T45')(V(ev45.firstPageHasQuestion && !ev45.nearlyEmptyBeforeLast, ev45), t() - s);
      } else R('T45')('BLOCKED', { reason: 'no Urdu class report arrived: ' + (pickU.err || 'timeout'), lesson: lesU.err || (lesU.actions || []).map(a => a.text) }, t() - s);
    } catch (e) { for (const id of ['T56', 'T57', 'T58', 'T45']) if (!seenIds.has(id)) R(id)('BLOCKED', { reason: 'the UR class-quiz drive threw: ' + String((e && e.message) || e).slice(0, 200) }, 0); }

    // ── T42: a question whose card cannot be fetched is skipped ─────────────────────────
    try {
      s = t();
      brk = dbJson('seed-class-quiz', ['--language', 'en', '--broken-q']);
      if (!brk || !brk.code) throw new Error('SEED_BRK:' + JSON.stringify(brk));
      const k7 = child(7);
      const r7 = await childRun(k7, brk.code, 'Zain', 'Grade 3', { correct: 4 });
      const all = (r7.trail || []).map(x => x.feedback).join(' | ') + ' ' + ((r7.end && r7.end.txt) || '');
      const ev42 = { answered: r7.answered, ended: r7.ended, skippedNotice: /could not send|couldn.t send|skipped|بھیج نہیں/i.test(all), scoreLine: (/out of \d+|\d+ میں سے/.exec(all) || [])[0] || null, trail: r7.trail, end: ((r7.end && r7.end.txt) || '').slice(0, 160) };
      R('T42')(V(ev42.ended && ev42.skippedNotice && /out of 3/.test(all), ev42), t() - s);
    } catch (e) { if (!seenIds.has('T42')) R('T42')('BLOCKED', { reason: 'threw: ' + String((e && e.message) || e).slice(0, 200) }, 0); }

    // ── lesson-plan quiz states: T35 (offered) T36 (failed) T41 (queue_failed) — with REAL lesson refs
    const lpState = async (tid, state, actionRe, expectText) => {
      s = t();
      let row = null;
      try {
        row = dbJson('seed-lp-quiz', ['--state', state, '--lessons-from', 'auto', '--subject', 'maths']);
        if (!row || !row.id) throw new Error('SEED:' + JSON.stringify(row));
        const les = await openLesson(i => String(i.id || '') === 'lp_' + row.id);
        const ev = { lessonsBorrowed: row.lessons, rowText: les.row && les.row.hay, screen: les.screen, text: (les.text || '').slice(0, 300), actions: (les.actions || []).map(a => a.text) };
        ev.saysStillBeingMade = /still being made|Being made|تیار ہو رہا/.test(les.text || '');
        ev.textMatches = expectText.test(les.text || '');
        await api.freshReset();
        const pick = les.ok ? await chooseAction(actionRe) : { ok: false, err: les.err };
        ev.picked = pick.picked; ev.done = pick.doneText;
        const ack = await waitFresh((x) => /Making it now|making the quiz|بن رہا|couldn.t start that quiz|could not start/i.test(x.txt || ''), 60000);
        ev.acknowledged = ack.ok ? (ack.hit.txt || '').slice(0, 160) : ack.last;
        // The lesson-plan path enqueues quiz_generate on SQS directly (transcript-quiz-offer →
        // sqs-queue.service) while the local stack runs BullMQ, whose driver would route it (bd-2aetj).
        // The bot therefore answers "I couldn't start that quiz just now" — the mock lane's gap.
        ev.queueUnavailable = ack.ok && /couldn.t start that quiz|could not start/i.test(ack.hit.txt || '');
        const arrived = ack.ok && !ev.queueUnavailable ? await waitFresh((x) => (x.doc || x.pdf) || /QUIZ-[A-Z0-9]{6}/.test(x.txt || ''), 300000) : { ok: false };
        const after = dbJson('quiz-rows', ['--quiz', String(row.id)]) || {};
        ev.arrival = { arrived: !!arrived.ok, what: arrived.ok ? (arrived.hit.media && arrived.hit.media.filename) || (arrived.hit.txt || '').slice(0, 120) : 'not within 5 min',
                       status: after.quiz && after.quiz.status, error: after.quiz && after.quiz.meta && after.quiz.meta.error, questions: (after.questions || []).length };
        const ok = les.ok && ev.textMatches && !!pick.ok && ack.ok && !ev.queueUnavailable && !!arrived.ok;
        R(tid)(ok ? V(true, ev) : (les.ok && ev.textMatches && pick.ok && ev.queueUnavailable
                 ? ['BLOCKED', { reason: 'screen, copy and action are right; the quiz cannot be MADE here — quiz_generate is enqueued on SQS directly (transcript-quiz-offer → sqs-queue.service, bd-2aetj) and the mock stack has no SQS, so the bot replies that it could not start the quiz', ...ev }]
                 : (les.ok && ev.textMatches && pick.ok && ack.ok
                 ? ['BLOCKED', { reason: 'the screen, the action and the acknowledgement are right; the quiz itself did not arrive — generation ' + (ev.arrival.status || '?') + (ev.arrival.error ? ' (' + ev.arrival.error + ')' : ''), ...ev }]
                 : V(false, ev))), t() - s);
      } catch (e) { R(tid)('BLOCKED', { reason: 'threw: ' + String((e && e.message) || e).slice(0, 200) }, t() - s); }
      finally { try { api.db('seed-lp-quiz', ['--restore']); } catch (e) {} }
    };
    await lpState('T35', 'offered', /make_en|English|انگریزی|Make/i, /./);
    await lpState('T36', 'failed', /Make it again|remake|دوبارہ/i, /went wrong on my side[^\n]*not your lesson plan|The problem was not your lesson plan/i);
    await lpState('T41', 'queue_failed', /Make it again|remake|دوبارہ/i, /could not be started on my side[^\n]*not your lesson plan/i);

    // ── T52 / T53 / T62: an Urdu quiz GENERATED from the fractions lesson (one generation, three checks)
    {
      s = t(); let row = null;
      try {
        row = dbJson('seed-lp-quiz', ['--state', 'offered', '--lessons-from', 'auto', '--subject', 'maths']);
        if (!row || !row.id || !row.lessons) throw new Error('no real maths lesson-plan quiz to borrow lesson refs from');
        const les = await openLesson(i => String(i.id || '') === 'lp_' + row.id);
        await api.freshReset();
        const pick = les.ok ? await chooseAction(/make_ur|اردو|Urdu/i) : { ok: false, err: les.err };
        const ack = await waitFresh((x) => /Making it now|making the quiz|بن رہا|couldn.t start that quiz|could not start/i.test(x.txt || ''), 60000);
        const queueUnavailable = ack.ok && /couldn.t start that quiz|could not start/i.test(ack.hit.txt || '');
        const seenAll = [];
        const t0 = Date.now(); let doc = null, fwd = null;
        while (!queueUnavailable && Date.now() - t0 < 360000 && !(doc && fwd)) { for (const x of await api.fresh()) { seenAll.push(x); if (x.doc || x.pdf) doc = x; if (/QUIZ-[A-Z0-9]{6}/.test(x.txt || '')) fwd = x; } if (/couldn.t make|could not make|went wrong/i.test(seenAll.map(x => x.txt).join(' '))) break; await sleep(3000); }
        const after = dbJson('quiz-rows', ['--quiz', String(row.id)]) || {};
        const qs = after.questions || [];
        const texts = qs.flatMap(q => [q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, ...(Object.values(q.option_feedback || {}))].filter(Boolean).map(String));
        const latinTerms = texts.flatMap(x => x.match(/[A-Za-z][A-Za-z-]{2,}/g) || []);
        const adjacentEnglish = texts.filter(x => /[A-Za-z][A-Za-z-]+\s+[A-Za-z][A-Za-z-]+\s+[A-Za-z][A-Za-z-]+/.test(x) && !/(improper|proper|common|cross|unlike|like|mixed) (fraction|denominator|multiplication|numbers?)/i.test(x));
        const base = { topic: row.topic, lessonsBorrowed: row.lessons, picked: pick.picked, acknowledged: ack.ok ? (ack.hit.txt || '').slice(0, 120) : false,
                       queueUnavailable: queueUnavailable ? 'quiz_generate is enqueued on SQS directly (transcript-quiz-offer → sqs-queue.service, bd-2aetj); the mock stack has no SQS' : false,
                       arrived: { pdf: !!doc, forward: !!fwd, caption: doc && (doc.txt || '').slice(0, 160) },
                       status: after.quiz && after.quiz.status, error: after.quiz && after.quiz.meta && after.quiz.meta.error, questions: qs.length, language: after.quiz && after.quiz.language };
        const madeInUrdu = !!doc && qs.length > 0 && qs.every(q => URDU.test(q.question_text || ''));
        const ev52 = { ...base, urduQuestions: qs.filter(q => URDU.test(q.question_text || '')).length, englishTermsKept: [...new Set(latinTerms)].slice(0, 12) };
        R('T52')(doc ? V(madeInUrdu && latinTerms.length > 0, ev52) : ['BLOCKED', { reason: 'no Urdu quiz arrived from the borrowed fractions lesson: ' + (base.status || '?') + (base.error ? ' (' + base.error + ')' : ''), ...ev52 }], t() - s);
        const ev53 = { ...base, textsChecked: texts.length, threeEnglishInARow: adjacentEnglish.slice(0, 4) };
        R('T53')(doc ? V(qs.length > 0 && adjacentEnglish.length === 0, ev53) : ['BLOCKED', { reason: 'no generated Urdu quiz to inspect', ...ev53 }], t() - s);
        const cap = doc ? String(doc.txt || '') : '';
        const topicWords = String(row.topic || '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(w => w.length > 4);
        const mentions = topicWords.length ? topicWords.filter(w => (cap.toLowerCase().match(new RegExp(w, 'g')) || []).length > 1) : [];
        const ev62 = { caption: cap.slice(0, 200), topic: row.topic, bracket: /\(.+\)/.test(cap), duplicatedTopicWords: mentions };
        R('T62')(doc ? V(!!cap && mentions.length === 0, ev62) : ['BLOCKED', { reason: 'no quiz PDF caption arrived to judge', ...ev62 }], t() - s);
      } catch (e) { for (const id of ['T52', 'T53', 'T62']) if (!seenIds.has(id)) R(id)('BLOCKED', { reason: 'threw: ' + String((e && e.message) || e).slice(0, 200) }, t() - s); }
      finally { try { api.db('seed-lp-quiz', ['--restore']); } catch (e) {} }
    }

    // ── not reachable in the mock lane — the precondition each one needs, named ─────────────
    const NOT_HERE = {
      T46: 'forcing "no usable reply" from the model mid-generation: the worker calls the LLM through the cassette; a recorded miss replays, it cannot be made to fail on demand. Pinned by transcript-quiz-generate tests (key_disagreement / model_failed paths).',
      T47: 'a coaching RECORDING quiz: needs a coaching session with a long transcript on the driver plus a forced model failure — neither is seedable here.',
      T48: 'an Urdu quiz with a PICTURE question from a maths lesson: generation must choose a figure question; no seeded lesson guarantees one. Picture rendering is pinned by bot/tests/quiz/*figure* tests.',
      T49: 'a base-ten bundles picture: needs generation to author a place-value picture question from a tens-and-ones lesson; picture composition is pinned by quiz figure unit tests.',
      T50: 'a thousands-column picture: same as T49 for four-digit numbers.',
      T51: 'lesson-object counters (sweets, samosas…): same generation dependency; drawn-object choice is pinned by figure unit tests.',
      T54: 'at least three picture questions from a counting lesson: depends on what generation authors from a specific grade 1-3 lesson; not seedable.',
      T55: 'a column-subtraction card: needs a grade 3 subtraction lesson to generate from and the KaTeX card render; pinned by quiz-typeset-maths tests.',
      T59: 'a VIDEO quiz taken in Urdu: needs the video library (student_videos + a delivered video) and its quiz on the driver; no video-quiz seed exists.',
      T60: 'Urdu video-quiz offer taps after the offer lapsed: same video-quiz dependency plus a time-lapse.',
      T61: 'the quiet-quiz reminder is a scheduled sweeper (teacher-nudges) with an "almost nobody started" rule; not triggerable from a driver.',
    };
    if (!seenIds.has('T46')) R('T46')('BLOCKED', { reason: NOT_HERE.T46 }, 0);
    if (!seenIds.has('T47')) R('T47')('BLOCKED', { reason: NOT_HERE.T47 }, 0);
    if (!seenIds.has('T48')) R('T48')('BLOCKED', { reason: NOT_HERE.T48 }, 0);
    if (!seenIds.has('T49')) R('T49')('BLOCKED', { reason: NOT_HERE.T49 }, 0);
    if (!seenIds.has('T50')) R('T50')('BLOCKED', { reason: NOT_HERE.T50 }, 0);
    if (!seenIds.has('T51')) R('T51')('BLOCKED', { reason: NOT_HERE.T51 }, 0);
    if (!seenIds.has('T54')) R('T54')('BLOCKED', { reason: NOT_HERE.T54 }, 0);
    if (!seenIds.has('T55')) R('T55')('BLOCKED', { reason: NOT_HERE.T55 }, 0);
    if (!seenIds.has('T59')) R('T59')('BLOCKED', { reason: NOT_HERE.T59 }, 0);
    if (!seenIds.has('T60')) R('T60')('BLOCKED', { reason: NOT_HERE.T60 }, 0);
    if (!seenIds.has('T61')) R('T61')('BLOCKED', { reason: NOT_HERE.T61 }, 0);

    // clean every class quiz and its children's sessions/students
    try { api.db('seed-class-quiz', ['--restore', '--child-prefix', CHILD_PREFIX]); } catch (e) {}
  }

  // ══ T30–T34 — the assessment generator's Seen / Unseen count screens ════════
  // The stored fixture was the 2026-09-08 WABA capture (v7.0, one total box). The repo's publish
  // source is v7.3 with SEEN_COUNT and COUNTS; the fixture is now that file (bd-w3cb9.7). A refusal
  // comes back as an endpoint error on Continue — the emulator surfaces it as ENDPOINT_ERROR:<reason>
  // and the screen does not advance, which is exactly "I stay on that screen and see the reason".
  {
    const SOURCE = { seen: 'Seen (from the book)', unseen: 'Unseen (outside the book)', both: 'Both Seen and Unseen' };
    const errOf = (r) => (r && !r.ok && /^ENDPOINT_ERROR:/.test(String(r.err || ''))) ? String(r.err).replace(/^ENDPOINT_ERROR:/, '') : null;
    const inputsOf = (pr) => ((pr && pr.items) || []).filter(i => i.kind === 'input' && i.visible !== false && String(i.text || '').trim());
    const optionsOf = (pr) => ((pr && pr.items) || []).filter(i => i.kind === 'option');
    // Open the generator and get to QUESTIONS with a class, a subject and a chapter chosen.
    const assessTo = async (source) => {
      await api.resetFlow(); await api.freshReset();
      await api.sendWait('/assessment');
      const op = await api.openFlow('Start|شروع');
      if (!op.ok) return { ok: false, err: 'OPEN:' + op.err };
      let pr = await api.flowProbe();
      // the probe lists both dropdowns' options as plain option items — pick by text (run 1148 showed
      // "Grade 1".."Grade 5" then "English"… with no field name on the item)
      const grade = optionsOf(pr).find(o => /^Grade \d/.test(String(o.text || '').trim()));
      if (!grade) return { ok: false, err: 'NO_GRADE_OPTIONS', screen: pr.screen, text: String(pr.text || '').slice(0, 200) };
      let r = await api.flowPick(grade.text, { exact: true }); if (!r.ok) return { ok: false, err: 'GRADE:' + r.err };
      pr = await api.flowProbe();
      const subj = optionsOf(pr).find(o => /^(English|Maths|Mathematics|Urdu|Islamiat|General Knowledge|Science|Social Studies)$/i.test(String(o.text || '').trim()));
      if (!subj) return { ok: false, err: 'NO_SUBJECT_OPTIONS', screen: pr.screen, options: optionsOf(pr).map(o => o.text).slice(0, 10) };
      r = await api.flowPick(subj.text, { exact: true }); if (!r.ok) return { ok: false, err: 'SUBJECT:' + r.err };
      r = await api.flowClick('Continue', { settleMs: 3000 }); if (!r.ok) return { ok: false, err: 'CLASS>:' + r.err };
      pr = await api.flowProbe();
      if (pr.screen !== 'COVERAGE') return { ok: false, err: 'NOT_AT_COVERAGE:' + pr.screen };
      const chapter = optionsOf(pr)[0] || null;                       // the chapter checkboxes are this screen's only options
      if (chapter) { r = await api.flowPick(chapter.text, { exact: true }); if (!r.ok) return { ok: false, err: 'CHAPTER:' + r.err }; }
      else {
        r = await api.flowClick('Type page numbers instead', { settleMs: 500 }); if (!r.ok) return { ok: false, err: 'PAGES_OPTIN:' + r.err };
        r = await api.flowClick('Continue', { settleMs: 3000 }); if (!r.ok) return { ok: false, err: 'COVERAGE>PAGES:' + r.err };
        r = await api.flowType('4-14', { field: 'page_ranges' }); if (!r.ok) return { ok: false, err: 'PAGES_TYPE:' + r.err };
      }
      r = await api.flowClick('Continue', { settleMs: 3000 }); if (!r.ok) return { ok: false, err: 'COVERAGE>:' + r.err };
      pr = await api.flowProbe();
      if (pr.screen !== 'QUESTIONS') return { ok: false, err: 'NOT_AT_QUESTIONS:' + pr.screen };
      r = await api.flowPick(SOURCE[source], { exact: true }); if (!r.ok) return { ok: false, err: 'SOURCE:' + r.err };
      r = await api.flowClick('Continue', { settleMs: 3000 }); if (!r.ok) return { ok: false, err: 'QUESTIONS>:' + r.err, refused: errOf(r) };
      pr = await api.flowProbe();
      return { ok: true, probe: pr, classPicked: grade.text + ' / ' + subj.text, chapter: chapter ? chapter.text : 'pages 4-14' };
    };
    const tickTypes = async (names) => { for (const n of names) { const r = await api.flowPick(n); if (!r.ok) return { ok: false, err: 'TYPE:' + r.err }; } return { ok: true }; };
    const heading = (pr) => String((pr && pr.text) || '').split('\n').map(l => l.trim()).filter(Boolean).slice(0, 3).join(' | ');

    // T30 — Unseen: one box per ticked type, counts kept as typed
    s = t();
    {
      const a = await assessTo('unseen'); const ev = { setup: a.ok ? a.classPicked + ' · ' + a.chapter : a.err };
      let ok = false;
      if (a.ok) {
        ev.afterUnseen = { screen: a.probe.screen, heading: heading(a.probe) };
        const tk = await tickTypes(['MCQs', 'Brief Answers']);
        let r = tk.ok ? await api.flowClick('Continue', { settleMs: 3000 }) : tk;
        const pr = await api.flowProbe();
        const boxes = inputsOf(pr).map(i => i.text);
        ev.countsScreen = { screen: pr.screen, heading: heading(pr), boxes };
        await api.flowType('10', { field: 'MCQs' }); await api.flowType('2', { field: 'Brief Answers' });
        r = await api.flowClick('Continue', { settleMs: 3000 });
        const cf = await api.flowProbe(); ev.recap = String(cf.text || '').slice(0, 300); ev.refused = errOf(r);
        ok = /Unseen questions/i.test(ev.afterUnseen.heading) && a.probe.screen === 'TYPES'
          && pr.screen === 'COUNTS' && boxes.length === 2 && /MCQ/i.test(boxes[0]) && /Brief/i.test(boxes[1])
          && cf.screen === 'CONFIRM' && /10 MCQs, 2 Brief Answers/.test(ev.recap) && /12 in total/.test(ev.recap);
      }
      api.closeFlow();
      rec('T30', 'For Unseen questions she sets how many of EACH type, not one total we split for her', ...(a.ok ? V(ok, ev) : ['BLOCKED', ev]), t() - s);
    }
    // T31 — a count she cannot have is refused, naming the type (Examples: nothing, 0, abc, 60)
    s = t();
    {
      const a = await assessTo('unseen'); const ev = { setup: a.ok ? a.classPicked : a, examples: [] };
      let ok = false;
      if (a.ok) {
        const tk = await tickTypes(['MCQs']); let r = tk.ok ? await api.flowClick('Continue', { settleMs: 3000 }) : tk;
        let pr = await api.flowProbe(); ev.screen = pr.screen;
        for (const value of ['', '0', 'abc', '60']) {
          await api.flowType(value, { field: 'MCQs' });
          r = await api.flowClick('Continue', { settleMs: 2500 });
          pr = await api.flowProbe();
          ev.examples.push({ value: value === '' ? 'nothing' : value, stayed: pr.screen === 'COUNTS', reason: errOf(r) });
        }
        ok = ev.screen === 'COUNTS' && ev.examples.length === 4 && ev.examples.every(x => x.stayed && x.reason && /MCQ/i.test(x.reason));
      }
      api.closeFlow();
      rec('T31', 'A count she cannot have is refused on the screen, naming the type', ...(a.ok ? V(ok, ev) : ['BLOCKED', ev]), t() - s);
    }
    // T32 — Seen: one box, no type picking, recap says Seen and 12
    s = t();
    {
      const a = await assessTo('seen'); const ev = { setup: a.ok ? a.classPicked : a };
      let ok = false;
      if (a.ok) {
        const pr = a.probe; const boxes = inputsOf(pr).map(i => i.text);
        ev.screen = { screen: pr.screen, heading: heading(pr), boxes, typeOptions: optionsOf(pr).length };
        await api.flowType('12', { field: 'How many Seen?' });
        const r = await api.flowClick('Continue', { settleMs: 3000 });
        const cf = await api.flowProbe(); ev.recap = String(cf.text || '').slice(0, 300); ev.refused = errOf(r);
        ok = pr.screen === 'SEEN_COUNT' && /Seen questions/i.test(ev.screen.heading) && boxes.length === 1 && optionsOf(pr).length === 0
          && cf.screen === 'CONFIRM' && /Seen \(from the book\)/.test(ev.recap) && /12 questions/.test(ev.recap);
      }
      api.closeFlow();
      rec('T32', 'Seen questions ask one thing — how many Seen', ...(a.ok ? V(ok, ev) : ['BLOCKED', ev]), t() - s);
    }
    // T33 — Both: Seen first on its own screen, then Unseen types and counts
    s = t();
    {
      const a = await assessTo('both'); const ev = { setup: a.ok ? a.classPicked : a };
      let ok = false;
      if (a.ok) {
        ev.first = { screen: a.probe.screen, heading: heading(a.probe), boxes: inputsOf(a.probe).map(i => i.text) };
        await api.flowType('5', { field: 'How many Seen?' });
        let r = await api.flowClick('Continue', { settleMs: 3000 });
        let pr = await api.flowProbe(); ev.second = { screen: pr.screen, heading: heading(pr), refused: errOf(r) };
        const tk = await tickTypes(['MCQs', 'Brief Answers']); r = tk.ok ? await api.flowClick('Continue', { settleMs: 3000 }) : tk;
        pr = await api.flowProbe(); ev.third = { screen: pr.screen, boxes: inputsOf(pr).map(i => i.text) };
        await api.flowType('10', { field: 'MCQs' }); await api.flowType('2', { field: 'Brief Answers' });
        r = await api.flowClick('Continue', { settleMs: 3000 });
        const cf = await api.flowProbe(); ev.recap = String(cf.text || '').slice(0, 300); ev.refused = errOf(r);
        ok = ev.first.screen === 'SEEN_COUNT' && ev.second.screen === 'TYPES' && ev.third.screen === 'COUNTS'
          && cf.screen === 'CONFIRM' && /Seen: 5 · Unseen: 10 MCQs, 2 Brief Answers · 17 in total/.test(ev.recap);
      }
      api.closeFlow();
      rec('T33', 'Both asks the Seen number first, on its own screen, then the Unseen types and counts', ...(a.ok ? V(ok, ev) : ['BLOCKED', ev]), t() - s);
    }
    // T34 — over 50 in total: refused on the Unseen screen, saying 55 (30 Seen + 25 Unseen) and the most is 50
    s = t();
    {
      const a = await assessTo('both'); const ev = { setup: a.ok ? a.classPicked : a };
      let ok = false;
      if (a.ok) {
        await api.flowType('30', { field: 'How many Seen?' });
        let r = await api.flowClick('Continue', { settleMs: 3000 }); ev.seenAccepted = !errOf(r);
        const tk = await tickTypes(['MCQs', 'Brief Answers']); r = tk.ok ? await api.flowClick('Continue', { settleMs: 3000 }) : tk;
        await api.flowType('15', { field: 'MCQs' }); await api.flowType('10', { field: 'Brief Answers' });
        r = await api.flowClick('Continue', { settleMs: 3000 });
        const pr = await api.flowProbe(); ev.stayedOn = pr.screen; ev.reason = errOf(r);
        ok = pr.screen === 'COUNTS' && !!ev.reason && /55 questions in total/.test(ev.reason) && /30 Seen/.test(ev.reason) && /25 Unseen/.test(ev.reason) && /up to 50/.test(ev.reason);
      }
      api.closeFlow();
      rec('T34', 'Going over 50 in total tells her why, where she can see it', ...(a.ok ? V(ok, ev) : ['BLOCKED', ev]), t() - s);
    }
  }

  // ══ T16 / T05 — the NIETE grand quiz: fail → cooldown, pass → certificate ═══════
  // Level 0 (id 1) is 46 modules; seed-level-complete marks them done in one upsert and the level
  // screen offers "Take exam". The exam serves 20 of the bank's 62 MCQs (TALEEMABAD exam_question_cap)
  // with the same list rows as a module check, so takeQuiz drives it off answer-key --level 1.
  // T16 first (answer everything wrong → ❌ Not this time + 24h cooldown → a second start is refused),
  // then revert-level clears the failed attempt and T05 passes for the certificate. Reverted in the
  // finally so the module-check cluster starts from a fresh level next run (bd-w3cb9.2).
  {
    const L1 = 1;
    const raw = dbJson('answer-key', ['--level', String(L1)]) || [];
    const gqKey = { questions: raw.map(r => ({ q: r.q, correct: [r.correct].filter(Boolean), correct_index: [r.correct_index].filter(Boolean), multi: false })) };
    const startExam = async () => {
      const lv = await openBandLevel({ vendor: 'NIETE', level: 'Level 0' });
      if (!lv.ok) return { ok: false, err: lv.err };
      const ex = examRowOf(lv.detail);
      if (!ex) return { ok: false, err: 'NO_EXAM_LINK', screen: String((lv.detail && lv.detail.text) || '').slice(0, 260), kinds: ((lv.detail && lv.detail.items) || []).map(i => i.kind + ':' + String(i.text || '').slice(0, 30)).slice(0, 8) };
      await api.freshReset();
      await api.flowClick(String(ex.text).trim(), { settleMs: 3000, exact: true });
      await api.flowClick('Close', { settleMs: 2000 }); api.closeFlow();
      const w = await waitFresh((x) => /Grand Quiz|try again in about|already passed|not available|Please open the level/i.test(x.txt || '') || (x.list && /Q\d+\//.test(x.txt || '')), 60000);
      return { ok: w.ok, hit: w.hit, examRow: String(ex.text).trim(), last: w.last, seen: w.seen || [] };
    };
    let seededL1 = false;
    try {
      s = t();
      api.db('seed-level-complete', ['--level', String(L1)]); seededL1 = true;
      const st1 = await startExam();
      let fail = null, retry = null;
      if (st1.ok) { fail = await takeQuiz(gqKey, { wrongAll: true, preseen: st1.seen }); retry = await startExam(); }
      const retryTxt = ((retry && retry.hit && retry.hit.txt) || '') + ' ' + ((retry && retry.examRow) || '');
      rec('T16', 'Failing the level exam starts a wait before I can retry',
          ...(st1.ok && fail
              ? V((fail.last || {}).verdict === 'failed' && /try again in about \*?\d+ hours?|Try again in \*?\d+ hours|Locked after a recent|Cooldown/i.test(retryTxt),
                  { answered: fail.trail.length, verdict: (fail.last || {}).verdict, failText: ((fail.last || {}).txt || '').slice(0, 200), last: (fail.last || {}).verdict ? undefined : fail.last, retry: retryTxt.slice(0, 200) })
              : ['BLOCKED', { reason: 'exam did not start: ' + (st1.err || st1.last), screen: st1.screen, kinds: st1.kinds, key: gqKey.questions.length }]), t() - s);
      api.db('revert-level', ['--level', String(L1)]);
      api.db('seed-level-complete', ['--level', String(L1)]);
      s = t();
      const st2 = await startExam();
      let pass = null, pdf = null, code = null;
      if (st2.ok) {
        pass = await takeQuiz(gqKey, { preseen: st2.seen });
        if ((pass.last || {}).verdict === 'passed') {
          // The certificate PDF lands half a second after the congratulations, in the same fresh() batch
          // the quiz loop pulled (run 1225) — look in what takeQuiz saw before waiting for more.
          const inSeen = (pass.seen || []).find(x => x.doc || x.pdf);
          pdf = inSeen ? { ok: true, hit: inSeen } : await waitFresh((x) => x.doc || x.pdf, 120000);
          const list = await api.sendWait('/certificates');
          code = (/Cert:\s*`([^`]+)`/.exec(list.txt || '') || [])[1] || (/`([A-Z0-9][A-Z0-9-]{7,})`/.exec((pass.last || {}).txt || '') || [])[1] || null;
        }
      }
      rec('T05', 'Finishing every module unlocks the level exam, and passing it certifies the level',
          ...(st2.ok && pass
              ? V((pass.last || {}).verdict === 'passed' && !!code && !!(pdf && pdf.ok),
                  { answered: pass.trail.length, verdict: (pass.last || {}).verdict, last: (pass.last || {}).verdict ? undefined : pass.last, congratulations: ((pass.last || {}).txt || '').slice(0, 220),
                    certificateCode: code, pdfDocument: !!(pdf && pdf.ok), filename: pdf && pdf.ok && pdf.hit.media && pdf.hit.media.filename })
              : ['BLOCKED', { reason: 'exam did not start: ' + (st2.err || st2.last), screen: st2.screen, kinds: st2.kinds }]), t() - s);
    } finally { if (seededL1) { try { api.db('revert-level', ['--level', String(L1)]); } catch (e) {} } }
  }

  api.closeFlow();

  // ── appended by scaffold-driver.py --sync: these scenarios exist in the .feature
  //    but had no driver. Implement each one, then turn BLOCKED into V(...).
  // ══ T04 — a PDF module arrives as a DOCUMENT, not a video link ═════════
  // Why this needs its own navigation: the cluster above drives the NIETE band, whose Level 0 is 46
  // video modules and 0 PDFs — so T04 read a picker that COULD NOT contain a PDF and reported
  // "every offered row is a video" as if that were a fact about the account. It is a fact about that
  // one band. The account is scoped to Beacon House too, whose English level is 43 PDFs to 12
  // videos, so the PDF delivery path is reachable with NO seeding at all (bd-2ug2s).
  // NOTE: the old code called openModule(), which is defined nowhere in this file — a latent
  // ReferenceError the permanent BLOCKED had been hiding, since that branch never ran.
  // ══ T21 — a half-finished module check picks up where I left off ══════════
  // Answer ONE question of the next-up NIETE module, re-open the module from the Flow, tap its
  // button again, and the first question served must be Q2, not Q1. The check is then finished so
  // the account is left in a clean state (bd-w3cb9.2).
  {
    s = t();
    const ev = {};
    const pk = await openBandPicker();
    const row = pk.ok ? pk.rows.find(x => /\u25b6\s*Next up/.test((x && x.text) || '')) : null;
    const title21 = row ? ((row.text || '').split(' \u00b7 ')[0] || '').trim() : null;
    const key21 = title21 ? answerKey(title21) : null;
    ev.module = title21; ev.questions = key21 && key21.questions ? key21.questions.length : 0;
    if (row && key21 && key21.questions && key21.questions.length >= 2) {
      const c1 = await deliverPicked(row.text);
      if (c1.ok && c1.cta) {
        await api.freshReset(); await api.tapAndWait(c1.cta, 60000);
        const part = await takeQuiz(key21, { stopAfter: 1 });
        ev.answeredBeforePause = part.trail.length; ev.firstServed = part.first;
        const pk2 = await openBandPicker();
        const row2 = pk2.ok ? pk2.rows.find(x => String((x && x.text) || '').startsWith(title21)) : null;
        const c2 = row2 ? await deliverPicked(row2.text) : { ok: false, err: 'ROW_GONE' };
        if (c2.ok && c2.cta) {
          ev.buttonOnReopen = c2.cta;
          await api.freshReset(); await api.tapAndWait(c2.cta, 60000);
          // Let takeQuiz consume the resumed stream itself: a separate waitFresh here ate Q2 off
          // fresh() and the finishing run then waited 90s for a question already on screen (run 1117).
          const rest = await takeQuiz(key21);
          ev.resumedAt = rest.first || null;
          ev.finished = (rest.last || {}).verdict || rest.last;
          rec('T21', 'A half-finished module quiz picks up where I left off',
              ...V(!!ev.resumedAt && /^Q2\//.test(ev.resumedAt), ev), t() - s);
        } else rec('T21', 'A half-finished module quiz picks up where I left off', 'BLOCKED', { reason: 're-open did not yield a card: ' + c2.err, ...ev }, t() - s);
      } else rec('T21', 'A half-finished module quiz picks up where I left off', 'BLOCKED', { reason: 'module card did not open: ' + (c1.err || 'no button'), ...ev }, t() - s);
    } else rec('T21', 'A half-finished module quiz picks up where I left off', 'BLOCKED',
               { reason: row ? 'next-up module has fewer than 2 questions' : 'no \u25b6 Next up module in the picker', ...ev }, t() - s);
  }

  let t23run = null;
  {
    s = t();
    // Beacon House / COMPUTER SCIENCE is the one band on this account whose FIRST module
    // ("What is AI") is PDF media — every other band opens on a video. That matters because the
    // ladder is chained: the server refuses any module but the next-up one ("Finish \"X\" first —
    // modules open one at a time"), which is exactly how the first attempt failed (bd-2ug2s).
    const band = await openBandPicker({ vendor: 'Beacon House', level: 'Computer Science' });
    // Keep title and ROW together: indices into a separately-filtered title array drift apart from
    // band.rows the moment one row yields an empty title.
    // Only UNLOCKED rows are candidates. A locked row is refused by the server however good a
    // PDF it is, so treating every row as pickable turned a chain refusal into a bare NO_CARD.
    const cand = band.ok
      ? band.rows.filter(x => !/\ud83d\udd12\s*Locked/.test((x && x.text) || ''))
          .slice(0, 10)
          .map(x => ({ row: x, title: (((x && x.text) || '').split(' \u00b7 ')[0] || '').trim() }))
          .filter(c => c.title)
      : [];
    let media = [], idx = -1;
    if (cand.length) {
      try {
        // api.db returns { ok, out, user }; the tool prints a '[niete_training_db] env=...' banner
        // before its JSON, so parse the LAST non-empty line of .out, never String(res).
        const res = api.db('module-media', cand.flatMap(c => ['--title', c.title])) || {};
        const last = String(res.out || '').split('\n').map(l => l.trim()).filter(Boolean).pop() || '[]';
        media = JSON.parse(last);
      } catch (e) { media = []; }
      idx = media.findIndex(m => m && m.kind === 'pdf');
    }
    if (!band.ok) {
      rec('T04', 'A PDF module arrives as a document', 'BLOCKED',
          { reason: 'could not reach the Beacon House Computer Science picker: ' + band.err,
            level: band.level, offered: band.offered }, t() - s);
    } else if (idx < 0) {
      rec('T04', 'A PDF module arrives as a document', 'BLOCKED',
          { reason: 'no UNLOCKED module in this band resolves to PDF media',
            band: band.level, offered: cand.map(c => c.title).slice(0, 6),
            resolved: media.map(m => m && m.kind) }, t() - s);
    } else {
      const title = cand[idx].title;
      const om = await deliverPicked(cand[idx].row.text || title);
      // The assertion is the DELIVERY FORMAT. A document card carries no "Next video" button, so
      // requiring one (as the old code did) would have failed a correct delivery.
      rec('T04', 'A PDF module arrives as a document',
          ...(om.ok
              ? V(!!(om.card && (om.card.pdf || om.card.doc)),
                  { title, band: band.level,
                    deliveredAs: om.card && (om.card.pdf ? 'pdf' : om.card.doc ? 'document'
                                          : om.card.img ? 'image' : 'text-only'),
                    nextButton: om.cta, media: (media[idx] || {}).media,
                    reply: (om.txt || '').slice(0, 150) })
              : ['BLOCKED', { reason: 'could not open the PDF module: ' + om.err, title,
                              band: band.level, lastSeen: om.last }]), t() - s);
      // T23 rides on this module: "What is AI" is the one next-up module on the account whose
      // options include one longer than OPTION_DESC_MAX (72), so sitting its check is what puts a
      // truncated-then-written-out row into renderedQuestions for T23 to judge (bd-w3cb9.8).
      // The document card has no button; "📝 Take quiz" rides the follow-up ("Finished reading …?").
      if (om.ok) {
        const follow = (om.cta && /Take quiz/i.test(om.cta)) ? { ok: true, hit: om.card }
          : await waitFresh((x) => (x.btns || []).some(b => /Take quiz/i.test(b)), 30000);
        const cta23 = follow.ok ? (follow.hit.btns || []).find(b => /Take quiz/i.test(b)) : null;
        const k23 = cta23 ? answerKey(title) : null;
        if (cta23 && k23 && k23.questions && k23.questions.length) {
          await api.freshReset(); await api.tapAndWait(cta23, 60000);
          t23run = await takeQuiz(k23);
        }
      }
    }
  }

  // ══ T07 — Beacon House: the level exam is WRITTEN answers, not multiple choice ═══
  // all_modules vendors sit a capstone: once every module is done the level screen offers the exam,
  // and the bot asks "✍️ Question i of N … Reply with your answer in a few sentences". Seed every
  // Computer Science module (the band T04 just used), open the level, tap the exam, read Q1, cancel.
  // The seed — and T04/T23's progress on this band — is reverted in the finally (bd-w3cb9.1).
  {
    s = t();
    const CS_LEVEL = 21;
    let seeded7 = [], lv = null, examRow = null, offer = null, q1 = null, crashed7 = null;
    try {
      const mods = dbJson('level-modules', ['--level', String(CS_LEVEL)]) || [];
      for (const mm of mods) { const r = api.db('seed-module-pass', ['--module', String(mm.id)]); seeded7.push({ id: mm.id, ok: !!(r && r.ok) }); await sleep(200); }
      lv = await openBandLevel({ vendor: 'Beacon House', level: 'Computer Science' });
      if (lv.ok) {
        examRow = ((examRowOf(lv.detail) || {}).text || '').trim() || null;
        if (examRow) {
          await api.freshReset();
          await api.flowClick(examRow, { settleMs: 3000, exact: true });
          await api.flowClick('Close', { settleMs: 2000 }); api.closeFlow();
          offer = await waitFresh((x) => /written questions|\u270d\ufe0f \*Question 1 of|Grand Quiz|already passed|no written exam|not available/i.test(x.txt || ''), 60000);
          if (offer.ok && /\u270d\ufe0f \*Question 1 of/.test(offer.hit.txt || '')) q1 = offer.hit;
          else if (offer.ok && (offer.hit.btns || []).some(b => /Start Grand Quiz/i.test(b))) {
            await api.freshReset(); await api.tapAndWait('Start Grand Quiz', 60000);
            const w = await waitFresh((x) => /\u270d\ufe0f \*Question 1 of/.test(x.txt || ''), 60000);
            if (w.ok) q1 = w.hit;
          }
          if (q1) await api.sendWait('cancel');
        }
      }
    } catch (e) { crashed7 = String((e && e.message) || e); }
    finally { if (seeded7.length) { try { api.db('revert-level', ['--level', String(CS_LEVEL)]); } catch (e) {} } }
    const qtxt = (q1 && q1.txt) || '';
    const total = (/Question 1 of (\d+)/.exec(qtxt) || [])[1] || null;
    rec('T07', 'For a Beacon House programme the level exam is written answers, not multiple choice',
        ...(q1
            ? V(/Reply with your answer in a few sentences/i.test(qtxt) && !(q1.list && q1.list.rows && q1.list.rows.length) && !(q1.btns || []).length,
                { questions: total, prompt: qtxt.slice(0, 220), noOptionRows: !(q1.list && q1.list.rows && q1.list.rows.length), noButtons: !(q1.btns || []).length,
                  pointsPerAnswer: 5, note: 'the 0\u20135 per-answer scale is the vendor default (capstone-points.rules); it shows only after LLM marking, which needs a recorded cassette' })
            : ['BLOCKED', { reason: crashed7 ? 'threw: ' + crashed7 : !lv || !lv.ok ? 'could not open the Beacon House Computer Science level: ' + ((lv && lv.err) || 'n/a')
                                   : !examRow ? 'no exam link on the level screen after seeding every module' : 'tapping the exam produced no written question',
                            seededModules: seeded7.length, examRow, levelScreen: ((lv && lv.detail && lv.detail.text) || '').slice(0, 260),
                            items: ((lv && lv.detail && lv.detail.items) || []).map(i => i.kind + ':' + String(i.text || '').slice(0, 40)).slice(0, 10),
                            offer: offer && offer.ok ? (offer.hit.txt || '').slice(0, 200) : (offer && offer.last) }]), t() - s);
  }







  // ══ T23 — a long option is written out in full, not truncated ════════════
  // OPTION_DESC_MAX=72: past that the option cannot live in a WhatsApp row description, so
  // sendQuestion moves it into the message BODY as a lettered line and the row keeps just its
  // letter. The failure this guards is the option being silently cut off with an ellipsis and the
  // teacher choosing blind. Asserted on what the bot actually rendered, so it needs no DB lookup.
  {
    s = t();
    // A long option is not truncated in its row: quiz-delivery moves it into the message body as a
    // lettered line and leaves the row carrying the letter. So the check is: for every rendered
    // question whose key has an option longer than OPTION_DESC_MAX (72), that option's full text is
    // in the body, and no row description ends in an ellipsis (bd-w3cb9.8).
    const OPTION_DESC_MAX = 72;
    const seenQs = renderedQuestions;
    const firstLine = (b) => String(b || '').split('\n').map(l => l.trim()).find(l => l && !/^Q\d+\/\d+$/.test(l)) || '';
    const findEntry = (q) => { const w = norm(firstLine(q.body)); for (const k of allKeys) { const e = (k.questions || []).find(x => norm(x.q) === w || norm(x.q).startsWith(w.slice(0, 60)) || w.startsWith(norm(x.q).slice(0, 60))); if (e) return e; } return null; };
    const judged = [];
    for (const q of seenQs) {
      const e = findEntry(q); const longs = ((e && e.options) || []).filter(o => [...String(o)].length > OPTION_DESC_MAX);
      for (const o of longs) {
        judged.push({ q: q.q, optionLen: [...String(o)].length, writtenOutInBody: String(q.body || '').includes(String(o).trim()),
                      anyRowTruncated: (q.rows || []).some(r => /[\u2026]$|\.\.\.$/.test(r.desc || '')), option: String(o).slice(0, 70) });
      }
    }
    const longestRow = seenQs.reduce((mx, q) => Math.max(mx, ...(q.rows || []).map(r => [...(r.desc || '')].length), 0), 0);
    rec('T23', 'A very long answer option is shown in full, not cut off',
        ...(judged.length
            ? V(judged.every(x => x.writtenOutInBody && !x.anyRowTruncated), { questionsSeen: seenQs.length, longOptions: judged })
            : ['BLOCKED', { reason: 'none of the questions served this run has an option longer than ' + OPTION_DESC_MAX + ' code points, so the long-option path was never exercised',
                            questionsSeen: seenQs.length, keysLoaded: allKeys.length, longestRowDescription: longestRow }]), t() - s);
  }


  // Not drivable in the mock lane — the reason below is what would have to exist first.
  rec('T25', 'The class report of a quiz made from my lesson plan carries the objectives to reteach', 'BLOCKED',
      { reason: "needs a SENT lesson-plan quiz with a share code and children who finished, then the class report: a PDF rendered by local headless Chrome whose 'For tomorrow' box calls OpenAI through a raw client outside the cassette. The objectives live inside that PDF (video-quiz-report.template's slo pill). None of that is seeded or reachable in the mock lane today (research 2026-09-24)." }, 0);

  // T26/T27 — I-SAPS (operator 2026-09-23). Declared unrunnable here, with the reason, not left absent.


  // ── appended by scaffold-driver.py --sync: these scenarios exist in the .feature
  //    but had no driver. Implement each one, then turn BLOCKED into V(...).
  // Not drivable in the mock lane — the reason below is what would have to exist first.
  rec('T28', 'A maths question with fractions reaches the child as a typeset card', 'BLOCKED',
      { reason: 'needs an lp_v8 quiz GENERATED by the worker (4–5 LLM calls: digest, author, key check, blind solve), a fraction stem so quiz-notation routes it to a KaTeX card rendered by local Chrome and uploaded to R2, then a CHILD phone answering QUIZ-<code>. The mock lane seeds none of that pipeline; a seeded quiz row cannot exercise the card path.' }, 0);

  // Not drivable in the mock lane — the reason below is what would have to exist first.
  rec('T29', 'A quiz never ships an answer key a blind solver disagrees with', 'BLOCKED',
      { reason: "the blind solver runs inside worker generation and a wrong key cannot be forced live (the feature file says so); pinned by tests/quiz/transcript-quiz-key-verify.test.js and transcript-quiz-generate's key_disagreement path. Not a mock-lane scenario." }, 0);







  // ── appended by scaffold-driver.py --sync: these scenarios exist in the .feature
  //    but had no driver. Implement each one, then turn BLOCKED into V(...).




























};

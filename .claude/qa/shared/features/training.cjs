/* training.feature — the runnable @e2e scenarios in one process.
 *
 * Excluded by tag (matching the /niete-e2e default subset):
 *   T04 T05 T06 T07 T17 T21 T23  @wip/@draft
 *   T05 T16                      @destructive — T16 fails the level exam on purpose and
 *                                starts a real 24h cooldown; never run it unasked.
 *
 * Staging copy note (captured live 2026-08-31): the Teacher Training card keeps its
 * English heading but the body and CTA are Urdu — CTA is "کھولیں", not "Open".
 */
const V  = (c, ev) => [c ? 'PASS' : 'FAIL', ev];
const VF = (op, c, ev) => op.ok ? V(c, ev) : ['BLOCKED', { harness: op.err, clicked: op.clicked, waitedMs: op.waitedMs }];
const CARD = /Teacher Training/i;
const CTA  = 'کھولیں|Open';

exports.run = async ({ api, rec, sleep }) => {
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
  const answerKey = (title) => {
    const r = api.db('module-answer-key', ['--title', title]);
    if (!r.ok) return { err: r.err };
    try { return JSON.parse(String(r.out).trim().split('\n').filter(l => l.startsWith('{')).pop()); } catch (e) { return { err: 'unparseable key: ' + String(r.out).slice(0, 120) }; }
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
  const rowIdForText = (q, optText) => {
    const rows = (q.list && q.list.rows) || [];
    const want = norm(optText);
    for (const r of rows) { const d = norm(r.description); if (d && (d === want || d.startsWith(want) || want.startsWith(d.replace(/…$/, '')))) return r.id; }
    // long options render in the body as "A. <text>" with the letter as the row title
    const m = String(q.txt || '').split('\n').map(l => l.trim()).find(l => /^[A-J]\.\s/.test(l) && norm(l.replace(/^[A-J]\.\s*/, '')).startsWith(want.slice(0, 40)));
    if (m) { const letter = m[0]; const r = rows.find(x => x.title === letter); if (r) return r.id; }
    return null;
  };
  const takeQuiz = async (key, { wrongAt = null } = {}) => {
    const seen = [];
    const pull = async () => { for (const r of await api.fresh()) seen.push(r); };
    const isQ = (x) => x.list && (x.list.rows || []).some(r => /^[A-J]$/.test(r.title || ''));
    const isTerm = (x) => NOT_QUITE.test(x.txt || '') || PASSED.test(x.txt || '');
    const waitFor = async (pred, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { await pull(); const h = [...seen].reverse().find(pred); if (h) return h; await new Promise(r => setTimeout(r, 1200)); } return null; };
    const trail = []; let first = null; const answered = new Set();
    for (let n = 0; n < 40; n++) {
      const hit = await waitFor((x) => isTerm(x) || (isQ(x) && !answered.has(x.list.rows.map(r => r.id).join(','))), 90000);
      if (!hit) return { first, trail, last: { err: 'NO_QUESTION_OR_VERDICT', tail: seen.slice(-4).map(x => (x.txt || '').slice(0, 80)) } };
      if (isTerm(hit)) {
        const notQuite = NOT_QUITE.test(hit.txt);
        let btns = hit.btns || [];
        // A not-quite verdict is followed by a SEPARATE card carrying 🔄 Try again / ⏸ Pause — wait for it.
        // A PASS is followed by the NEXT module's card; do NOT poll here or we would consume it (T01).
        if (notQuite) { const t0 = Date.now(); while (Date.now() - t0 < 8000) { await pull(); const b = [...seen].reverse().find(x => (x.btns || []).some(bb => /Try again|Pause/i.test(bb))); if (b) { btns = b.btns; break; } await new Promise(r => setTimeout(r, 800)); } }
        return { first, trail, last: { verdict: notQuite ? 'not-quite' : 'passed', txt: (hit.txt || '').slice(0, 220), btns } };
      }
      const rows = hit.list.rows; answered.add(rows.map(r => r.id).join(','));
      const head = /Q(\d+)\/(\d+)/.exec(hit.txt || ''); const qNo = head ? Number(head[1]) : n + 1; if (n === 0) first = head ? head[0] : null;
      const qLine = String(hit.txt || '').split('\n').map(l => l.trim()).find(l => l && !/^Q\d+\/\d+$/.test(l) && !/^[A-J]\.\s/.test(l) && !/required|Select all that apply|Selected:/.test(l)) || '';
      const entry = (key.questions || []).find(q => norm(q.q) === norm(qLine) || norm(q.q).startsWith(norm(qLine).slice(0, 60)) || norm(qLine).startsWith(norm(q.q).slice(0, 60)));
      if (!entry) return { first, trail, last: { err: 'NO_KEY_ENTRY', qLine: qLine.slice(0, 120), rows: rows.map(r => r.description || r.title) } };
      let ids;
      if (wrongAt === qNo) { const wrong = rows.find(r => /^[A-J]$/.test(r.title) && !entry.correct.some(c => rowIdForText(hit, c) === r.id)); ids = wrong ? [wrong.id] : []; }
      else ids = entry.correct.map(c => rowIdForText(hit, c)).filter(Boolean);
      if (!ids.length) return { first, trail, last: { err: 'NO_ROW_ID', qLine: qLine.slice(0, 80), rows: rows.map(r => ({ t: r.title, d: r.description })) } };
      for (const id of ids) { await api.tapId('list', id); await new Promise(r => setTimeout(r, 400)); }
      if (entry.multi && wrongAt !== qNo) { const done = rows.find(r => /_done$/.test(r.id) || /Done/i.test(r.title)); if (done) await api.tapId('list', done.id); }
      trail.push({ q: qNo, ids, wrong: wrongAt === qNo });
    }
    return { first, trail, last: { err: 'TOO_MANY_QUESTIONS' } };
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

  // T08 — different vendor entirely.
  rec('T08', 'For an Oxbridge programme a level is certified from module scores, with no exam', 'BLOCKED',
      { reason: 'needs a driver enrolled in an Oxbridge programme; this environment has no Oxbridge programme row '
              + '(training_programs) to enrol into, so the certified-from-module-scores path is unreachable here.' }, 0);

  api.closeFlow();
};

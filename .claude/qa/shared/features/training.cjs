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
      api.closeFlow();
      const w = await api.ev(`(async()=>{
        const wa=window.__wa; wa.restore(); const t0=Date.now();
        while(Date.now()-t0 < 60000){
          const hit = wa.readLast(4).find(x=>!x.mine && /grand quiz first|unlock this|پہلے/i.test(x.txt||''));
          if(hit) return JSON.stringify({ok:true,waitedMs:Date.now()-t0,txt:hit.txt.slice(0,180)});
          await new Promise(r=>setTimeout(r,1500));
        }
        return JSON.stringify({ok:false,waitedMs:Date.now()-t0,last:(wa.readLast(1)[0]||{}).txt||''});
      })()`);
      refusal = JSON.parse(w);
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
  const pickerOpened = pickerChangedScreen && /✓\s*Passed|▶\s*Next up/.test(pickerText);
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
  for (const [id, name] of moduleScenarios)
    rec(id, name, 'BLOCKED', nextUp.length ? { reason: 'next-up module exists but the module-check driver is not built yet', nextUp } : noNextUp, 0);

  // T11 — the locked-exam explainer only exists while the level still has modules left.
  rec('T11', 'Tapping the locked exam link explains what to finish first', 'BLOCKED',
      { reason: 'Level 0 is 9/9 courses complete, so the grand quiz is READY, not 🔒 Locked — '
              + 'the locked-exam explainer is unreachable in this account state.',
        observedExamRow: (levelDetail && (levelDetail.text || '').match(/Grand Quiz[^·]*·[^·]*·[^\n]*/) || [''])[0].slice(0, 120) }, 0);

  // T08 — different vendor entirely.
  rec('T08', 'For an Oxbridge programme a level is certified from module scores, with no exam', 'BLOCKED',
      { reason: 'this driver is enrolled only in the NIETE programme (4 levels, 9/36 courses); '
              + 'an Oxbridge enrolment is required.' }, 0);

  api.closeFlow();
};

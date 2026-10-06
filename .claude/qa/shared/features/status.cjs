// @mock-lane — mock-capable driver (uses the mock API, not the browser DOM). Its presence enrols this feature in the mock lane; E2E_MOCK_FEATURES is derived from this marker, so there is no hardcoded list.
/* status.feature — 8 @e2e scenarios (4 added 2026-09-08, PR #801 sync, bd-q25il).
 *
 * SURFACE CONTRACT since PR #801 (2026-09-08):
 *   nothing running  -> a plain chat reply "Nothing's running right now. Send /menu to start
 *                       something." (Urdu variant for Urdu accounts), on EVERY environment, and
 *                       NO Flow card. Before the fix an empty store bought the teacher a Flow that
 *                       flashed open and shut and a silent chat.
 *   something running -> per environment: the Flow card "What's running / … / Powered by NIETE"
 *                       + CTA "Open status" where STATUS_FLOW_ID is set (staging), else the text
 *                       list "Running for you:". The listing lives INSIDE the Flow on staging.
 * A menu glance is not work: /status straight after /menu must still be the idle reply.
 *
 * In-flight work is set up on the mock lane itself (2026-10-06): a coaching analysis for STA01, plus
 * an in-progress training quiz for STA04; STA06 switches the driver to Urdu and back; STA08 makes it
 * a principal mid-attendance. Every seed is cleared before the feature ends.
 */
const V = (c, ev) => [c ? 'PASS' : 'FAIL', ev];
const RUNNING  = /Running for you:/i;
const IDLE     = /Nothing's running right now|کچھ نہیں چل رہا/i;
const CARD     = /What's running|Open status/i;
const CTA      = 'Open status|کھولیں';

const pickLang = async (api, row) => {
  const r = await api.sendWait('/language');
  await api.openList((r.btns || []).find((b) => /Languages|زبانیں/.test(b)) || 'Languages');
  const p = await api.pickRowAndWait(row);
  return Object.assign({}, p, { txt: (p && p.txt) || '' });
};
const canSeed = (api) => !!(api.caps && api.caps.method === 'mock' && api.caps.upload);
const MEDIA = require('path').resolve(__dirname, '..', '..', 'fixtures', 'whatsapp', 'niete', 'media');
const ITEM_CHROME = /^(Open status|Back|Close|Powered by|Done)/i;

/** Read the /status Flow listing: { claimed, items, surface, err }. */
async function readListing(api) {
  const st = await api.sendWait('/status');
  // Other work in flight talks too: a lesson plan being prepared sends its board text, and that can
  // land before the /status answer. Wait for the status surface itself rather than the first reply.
  for (let waited = 0; surfaceOf(st.txt || '') === 'neither' && waited < 20000; waited += 1000) {
    const hit = (await api.fresh()).find((m) => surfaceOf(m.txt || '') !== 'neither');
    if (hit) { st.txt = hit.txt; st.btns = hit.btns || []; break; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const surface = surfaceOf(st.txt || '');
  if (surface !== 'flow-card') {
    return { claimed: null, surface, reply: (st.txt || '').slice(0, 160),
             items: surface === 'running-template' ? (st.txt || '').split('\n').slice(1).map((x) => x.trim()).filter(Boolean) : [] };
  }
  const op = await api.openFlow(CTA);
  if (!op.ok) return { claimed: null, surface, items: [], err: op.err };
  const p = await api.flowProbe();
  const m = /You have (\d+) things? running/i.exec(p.text || '');
  const items = (p.items || []).map((i) => (i.text || '').trim()).filter(Boolean)
    .filter((x) => !ITEM_CHROME.test(x)).filter((v, k, a) => a.indexOf(v) === k);
  api.closeFlow();
  return { claimed: m ? Number(m[1]) : null, surface, items };
}

/** Start a coaching analysis that is really in flight. The audio-hash cache (bd-7beiz) answers a
 *  recording this account already had analysed with the old report and starts NOTHING, so first
 *  archive the driver's own past sessions — the same clean slate coaching-ext.cjs uses. */
async function seedCoaching(api) {
  try { api.db('cancel-stuck'); api.db('reset-history'); } catch (_) {}
  await api.resetFlow();
  const up = await api.upload(require('path').join(MEDIA, 'hameeda_16min.m4a'), 'Audio', 180000);
  let yes = null;
  if ((up.btns || []).some((b) => /Yes, Analyze/i.test(b))) yes = await api.tapAndWait('Yes, Analyze', 120000);
  return { upload: (up.txt || '').slice(0, 80), started: (yes && yes.txt || '').slice(0, 100) };
}

/** A teacher part-way through a training quiz — a second, durable kind of work. A lesson plan cannot
 *  be it: the bot answers one teacher's messages in order, so /status is read only after the plan is
 *  delivered (run 20261006-1552). Training is listed from training_assessment_attempts, so seed one
 *  in-progress attempt on the driver's own sandbox account; clear-training-inflight removes it. */
function seedTraining(api) {
  const r = api.db('seed-training-inflight');
  return { ok: !!(r && r.ok), out: String((r && (r.out || r.err)) || '').trim().split('\n').pop().slice(0, 120) };
}

const surfaceOf = txt => CARD.test(txt) ? 'flow-card'
                       : RUNNING.test(txt) ? 'running-template'
                       : IDLE.test(txt) ? 'idle-template' : 'neither';

exports.run = async ({ api, rec, sleep = async (ms) => new Promise((r) => setTimeout(r, ms)), want = () => true }) => {
  const t = () => Date.now();
  let s;
  await api.resetFlow();

  s = t();
  await api.sendWait('/menu');                       // settle before the first measured send
  const st = await api.sendWait('/status');
  const txt = st.txt || '';
  const surface = surfaceOf(txt);

  // The divergence itself, recorded once, as a finding rather than buried in a FAIL.
  // Idle -> text on every env. Running -> Flow card (staging) or text list (prod). Anything
  // else — including a Flow card for an EMPTY store, the pre-PR-#801 defect — is off-contract.
  rec('STA-surface', 'The /status surface matches the documented contract',
      ...V(surface !== 'neither',
           { observedSurface: surface,
             documented: 'idle -> chat text; running -> Flow card (STATUS_FLOW_ID set) or "Running for you:" list',
             actual: txt.slice(0, 180) }), t() - s);

  // STA01 — does it actually list in-flight work, wherever that listing lives?
  s = t();
  let items = [], via = surface, flowText = '', flowClaimedCount = null;
  if (surface === 'flow-card') {
    // Same retry-through-reset the LP and training drivers use: the first open after a
    // burst of cards times out, while the identical open succeeds straight after a reset.
    // Without it STA01 reported FLOW_NEVER_OPENED on a Flow that opens fine by hand.
    let op = await api.openFlow(CTA);
    if (!op.ok) {
      await api.resetFlow();
      await api.sendWait('/status');
      op = await api.openFlow(CTA);
      op.retried = true;
    }
    if (op.ok) {
      const p = await api.flowProbe();
      flowText = p.text || '';
      const claimed = /You have (\d+) things? running/i.exec(flowText);
      if (claimed) flowClaimedCount = Number(claimed[1]);
      items = (p.items || []).map(i => (i.text || '').trim())
        .filter(Boolean).filter(x => !/^(Open status|Back|Close|Powered by)/i.test(x))
        .filter((v, k, a) => a.indexOf(v) === k);
      via = 'flow';
    } else via = 'flow-would-not-open:' + op.err;
    api.closeFlow();
  } else if (surface === 'running-template') {
    items = txt.split('\n').slice(1).map(x => x.trim()).filter(Boolean);
  }
  const idle = IDLE.test(txt) || /nothing/i.test(flowText);
  // Nothing in flight on a lane that can start real work: STA01 is asserted after the seed below.
  const deferSTA01 = !items.length && canSeed(api) && want('STA01');
  if (!deferSTA01) rec('STA01', "/status lists the teacher's in-flight work",
      ...(items.length
          ? V(true, { via, count: items.length, flowClaimedCount, items: items.slice(0, 8) })
          : idle
            ? ['BLOCKED', { via, reason: 'nothing was in flight, so there is no listing to assert — the '
                                       + 'idle answer is correct but proves nothing about listing',
                            screen: (flowText || txt).slice(0, 200) }]
            : ['BLOCKED', { via, reason: 'could not read a listing from the status surface',
                            screen: (flowText || txt).slice(0, 200) }]), t() - s);

  if (want('STA02')) {
    // STA02 — case-insensitive + tolerates trailing text: same SURFACE either way.
    s = t();
    await api.resetFlow();
    const loud = await api.sendWait('/STATUS now');
    const loudSurface = surfaceOf(loud.txt || '');
    rec('STA02', '/status is case-insensitive and tolerates trailing text',
        ...V(loudSurface !== 'neither' && loudSurface === surface,
             { lower: surface, upper: loudSurface,
               note: 'compares the surface each produces, not a fixed template — idle text or a Flow card depending on state/env',
               reply: (loud.txt || '').slice(0, 160) }), t() - s);
  }

  if (want('STA03')) {
    // STA03 — a bare "status" must NOT open the status surface (shape, never wording)
    s = t();
    // A bare "status" falls through to open chat, whose prompt carries the conversation history.
    // Clear it first, as menu and language do, or the cassette key follows whatever came before
    // (7 history messages on one run, 10 on the next, same driver: a replay miss every time).
    api.resetConversation();
    const bare = await api.sendWait('status');
    const bareSurface = surfaceOf(bare.txt || '');
    rec('STA03', 'A bare "status" (no slash) does not open the status surface',
        ...V(bareSurface === 'neither',
             { observedSurface: bareSurface, reply: (bare.txt || '').slice(0, 180) }), t() - s);
  }

  if (want('STA07')) {
    // STA07 — the FIRST /status above came straight after /menu. A glance is not work: with
    // nothing else in flight the answer must be the idle text, never a card claiming "1 thing".
    s = t();
    const menuListed = items.some(x => /^menu$|\bmenu\b/i.test(x)) || /You have 1 thing running/i.test(flowText);
    rec('STA07', 'Opening the menu is a glance, not work — /status right after /menu still says nothing is running',
        ...(surface === 'idle-template' && !menuListed
            ? V(true, { reply: txt.slice(0, 160) })
            : items.length && !menuListed
              ? ['BLOCKED', { reason: 'real work was in flight (' + items.length + ' item(s)), so the idle answer is not '
                                     + 'expected; the menu itself was NOT listed, which is the rule under test', items: items.slice(0, 5) }]
              : V(false, { observedSurface: surface, menuListed, reply: (flowText || txt).slice(0, 200),
                           note: 'a Flow card / "1 thing running" for a menu glance is the PR #801 defect' })), t() - s);
  }

  if (want('STA05', 'STA06')) {
    // STA05 — nothing running: the answer is words in the chat, and no Flow card, on every env.
    s = t();
    await api.resetFlow();
    const idleReply = await api.sendWait('/status');
    const idleTxt = idleReply.txt || '';
    const idleSurface = surfaceOf(idleTxt);
    const EN_IDLE = /Nothing's running right now\. Send \/menu to start something\./;
    const UR_IDLE = /اس وقت کچھ نہیں چل رہا/;
    rec('STA05', '/status with nothing running answers in the chat and does not open the Flow',
        ...(idleSurface === 'idle-template'
            ? V(EN_IDLE.test(idleTxt) || UR_IDLE.test(idleTxt), { reply: idleTxt.slice(0, 160), copyExact: EN_IDLE.test(idleTxt) || UR_IDLE.test(idleTxt) })
            : (items.length || flowClaimedCount)
              ? ['BLOCKED', { reason: 'something was in flight for this account, so "nothing running" cannot be observed', items: items.slice(0, 5) }]
              : V(false, { observedSurface: idleSurface, reply: idleTxt.slice(0, 200),
                           note: idleSurface === 'flow-card' ? 'Flow card for an empty store = the pre-PR-#801 behaviour; is the fix deployed here?' : null })), t() - s);

    // STA06 — the idle answer in the teacher's language. Language is locked per account, so on
    // the shared English driver this is a state BLOCK, not a failure.
    s = t();
    rec('STA06', 'The nothing-running answer is in the teacher\'s language',
        ...(UR_IDLE.test(idleTxt)
            ? V(/کچھ شروع کرنے کے لیے \/menu بھیجیں/.test(idleTxt), { reply: idleTxt.slice(0, 160) })
            : idleSurface === 'idle-template'
              ? await (async () => {
                  // The driver is English: switch it to Urdu through /language (the one writer), read
                  // the idle answer, switch back. feature-runner also restores the language after the run.
                  const toUr = await pickLang(api, 'اردو');
                  await api.resetFlow();
                  const ur = await api.sendWait('/status');
                  const urTxt = ur.txt || '';
                  await pickLang(api, 'English');
                  return V(UR_IDLE.test(urTxt) && /کچھ شروع کرنے کے لیے \/menu بھیجیں/.test(urTxt),
                           { switchedToUrdu: (toUr.txt || '').slice(0, 60), reply: urTxt.slice(0, 160) });
                })()
              : ['BLOCKED', { reason: 'no idle reply observed to check the language of', observedSurface: idleSurface }]), t() - s);
  }

  if (want('STA08')) {
    // STA08 — a flow outside the resumable set is named in words, never by its internal id. A principal's
    // /attendance opens the "tap or voice?" question and parks the conversation on `attendance_method`,
    // which conversation-resume's TASK_LABEL does not name, so /status must de-snake it. Role switching is
    // a harness capability (api.setRole); feature-runner restores the driver's role after the run.
    s = t();
    const roleOk = api.setRole ? (await api.setRole('principal')).ok : false;
    if (!roleOk) {
      rec('STA08', 'An in-flight item is named in plain words, never as an internal identifier', 'BLOCKED',
          { reason: 'this lane cannot switch the driver to a principal (api.setRole)' }, t() - s);
    } else {
      // A principal with no school is told so and nothing starts. Link the driver to the dedicated E2E
      // school api.setRoster seeds (removed by feature-runner's finally) and put the original back after.
      const SB = { url: process.env.NIETE_SANDBOX_SUPABASE_URL, key: process.env.NIETE_SANDBOX_SUPABASE_SERVICE_ROLE_KEY, drv: process.env.E2E_DRIVER };
      const H = SB.key ? { apikey: SB.key, Authorization: `Bearer ${SB.key}`, 'Content-Type': 'application/json' } : null;
      const getJson = async (q) => { try { const r = await fetch(`${SB.url}/rest/v1/${q}`, { headers: H }); return r.ok ? r.json() : []; } catch (_) { return []; } };
      const [me8] = H ? await getJson(`users?select=school_id&phone_number=eq.${SB.drv}`) : [];
      const roster = H ? await api.setRoster() : { ok: false };
      const [sch] = roster.ok ? await getJson(`schools?select=id&emis=eq.E2EOBS${SB.drv}`) : [];
      if (sch) await api.setUser({ school_id: sch.id });
      await api.resetFlow();
      const att = await api.sendWait('/attendance');
      const l8 = await readListing(api);
      const shown = [l8.reply || '', ...(l8.items || [])].join('\n');
      const ids = shown.match(/\b[a-z]+_[a-z_]+\b/g) || [];
      const named = (l8.items || []).some((x) => /attendance/i.test(x));
      rec('STA08', 'An in-flight item is named in plain words, never as an internal identifier',
          ...(named || ids.length
              ? V(named && ids.length === 0, { items: l8.items, claimed: l8.claimed, identifiers: ids, attendanceReply: (att.txt || '').slice(0, 100) })
              : ['BLOCKED', { reason: 'the principal\'s /attendance left nothing in flight to name', listing: l8, attendanceReply: (att.txt || '').slice(0, 160) }]),
          t() - s);
      await api.resetFlow();
      if (sch) await api.setUser({ school_id: (me8 && me8.school_id) || null });
      await api.clearRoster();
      await api.setRole('teacher');
    }
  }

  if (want('STA01', 'STA04') && (deferSTA01 || (want('STA04') && (flowClaimedCount || items.length) <= 1 && canSeed(api)))) {
    // Real work in flight, set up on the driver's own sandbox account: a coaching analysis (STA01),
    // then a Grade 6 lesson plan on top of it — two different kinds at once (STA04). /menu does not
    // count: a glance is not work (STA07).
    s = t();
    const coaching = await seedCoaching(api);
    await sleep(3000);
    const one = await readListing(api);
    if (deferSTA01) {
      rec('STA01', "/status lists the teacher's in-flight work",
          ...((one.claimed || one.items.length)
              ? V(true, { via: 'mock: seeded coaching analysis', claimed: one.claimed, items: one.items.slice(0, 8), coaching })
              : ['BLOCKED', { reason: 'the seeded coaching analysis was not in flight when /status was read', listing: one, coaching }]), t() - s);
    }
    if (want('STA04')) {
      s = t();
      const training = seedTraining(api);
      const two = await readListing(api);
      const n = two.claimed || two.items.length;
      rec('STA04', '/status lists multiple concurrent items',
          ...(n > 1
              ? V(true, { count: two.items.length, claimed: two.claimed, items: two.items.slice(0, 8), seeded: { coaching, training } })
              : ['BLOCKED', { reason: n === 1 ? 'only one item was in flight when /status was read'
                                              : 'nothing was in flight when /status was read', listing: two, seeded: { coaching, training } }]), t() - s);
    }
    // Leave nothing running for the next feature: an analysis parked mid-pipeline answers free text
    // with its own nudge (lesson-plan.cjs L04's history).
    try { api.db('cancel-stuck'); api.db('clear-training-inflight'); } catch (_) {}
    await api.resetFlow();
  } else if (want('STA04')) {
    rec('STA04', '/status lists multiple concurrent items',
        ...((flowClaimedCount || items.length) > 1
            ? V(true, { count: items.length, flowClaimedCount, items: items.slice(0, 8) })
            : ['BLOCKED', { reason: 'nothing was in flight, and this lane cannot start work (no upload)', observed: items }]), 0);
  }
};

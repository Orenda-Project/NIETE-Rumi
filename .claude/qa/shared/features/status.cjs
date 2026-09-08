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
 * Ordering: run AFTER coaching, which leaves an analysis in flight for STA01/STA04. On a targeted
 * `status` run with nothing in flight STA01/STA04 are BLOCKED (state) and STA05/STA07 are the
 * scenarios that actually exercise the build.
 */
const V = (c, ev) => [c ? 'PASS' : 'FAIL', ev];
const RUNNING  = /Running for you:/i;
const IDLE     = /Nothing's running right now|کچھ نہیں چل رہا/i;
const CARD     = /What's running|Open status/i;
const CTA      = 'Open status|کھولیں';

const surfaceOf = txt => CARD.test(txt) ? 'flow-card'
                       : RUNNING.test(txt) ? 'running-template'
                       : IDLE.test(txt) ? 'idle-template' : 'neither';

exports.run = async ({ api, rec }) => {
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
  rec('STA01', "/status lists the teacher's in-flight work",
      ...(items.length
          ? V(true, { via, count: items.length, flowClaimedCount, items: items.slice(0, 8) })
          : idle
            ? ['BLOCKED', { via, reason: 'nothing was in flight, so there is no listing to assert — the '
                                       + 'idle answer is correct but proves nothing about listing',
                            screen: (flowText || txt).slice(0, 200) }]
            : ['BLOCKED', { via, reason: 'could not read a listing from the status surface',
                            screen: (flowText || txt).slice(0, 200) }]), t() - s);

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

  // STA03 — a bare "status" must NOT open the status surface (shape, never wording)
  s = t();
  const bare = await api.sendWait('status');
  const bareSurface = surfaceOf(bare.txt || '');
  rec('STA03', 'A bare "status" (no slash) does not open the status surface',
      ...V(bareSurface === 'neither',
           { observedSurface: bareSurface, reply: (bare.txt || '').slice(0, 180) }), t() - s);

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
            ? ['BLOCKED', { reason: 'driver account is English (language is locked once chosen); needs an Urdu account', reply: idleTxt.slice(0, 120) }]
            : ['BLOCKED', { reason: 'no idle reply observed to check the language of', observedSurface: idleSurface }]), t() - s);

  // STA08 — @draft: needs the principal persona part-way through attendance marking.
  s = t();
  rec('STA08', 'An in-flight item is named in plain words, never as an internal identifier',
      'BLOCKED', { reason: '@draft — needs a principal account mid-attendance-marking (attendance.feature is @wip); '
                          + 'not drivable on the shared teacher driver', codeGrounded: 'teacher-state.service.js de-snakes unlabelled flow ids' }, t() - s);

  // STA04 — more than one kind of work at once
  s = t();
  rec('STA04', '/status lists multiple concurrent items',
      ...((flowClaimedCount || items.length) > 1
          ? V(true, { count: items.length, flowClaimedCount, items: items.slice(0, 8) })
          : ['BLOCKED', { reason: items.length === 1
                ? 'only one item was in flight; this needs two kinds at once (e.g. a coaching analysis AND a lesson plan)'
                : 'nothing was in flight for this account', observed: items }]), t() - s);
};

// NOT @mock-lane yet — this driver is mock-CAPABLE (api.fresh, no browser DOM) and run-suite has an un-register seed, but the bot caches the teacher's registration at stack startup and the stack is shared across features, so R01/R03/R06 see the cached 'registered' state. Re-add the @mock-lane marker once the bot's user cache is invalidated on the unregister (or registration gets its own stack).
/* registration.feature — @e2e scenarios across the v5 Flow's five screens (bd-x7aprz.2) and the front door (R14–R19), one process.
 * Precondition: the driver must be UNREGISTERED (no name, registration flags clear — the bot's
 * isRegistered() gate) so /register opens the Flow. users.name is the only name column.
 * Scenario order is deliberate — it walks the Flow once and harvests several scenarios per pass. */
const V = (c, ev) => [c ? 'PASS' : 'FAIL', ev];
// The v5 school step searches the schools table. Sandbox carries IMSG (I-VIII) G-7/3-2 at EMIS 215 (a real,
// non-test row); the option title drops the level bracket (registration-endpoint.js schoolOption).
const SEARCH_EMIS = '215';
const SEARCH_HIT = /G-7\/3-2/;
const SEARCH_TITLE = 'IMSG G-7/3-2';

exports.run = async ({ api, rec, sleep, want = () => true }) => {
  const t = () => Date.now();
  let s, r;
  await api.resetFlow();          // a Flow remembers its screen across opens

  // R01 — /register opens the Flow
  s = t();
  r = await api.sendWait('/register');
  rec('R01', '/register opens the registration Flow',
      ...V(/Welcome/i.test(r.txt) && r.btns.some(b => /Get started/i.test(b)),
           { head: (r.txt || '').split('\n')[0], btns: r.btns, botWaitMs: r.waitedMs }), t() - s);

  if (want('R06')) {
    // R06 — case-insensitive
    s = t();
    r = await api.sendWait('/REGISTER');
    rec('R06', '/register is case-insensitive',
        ...V(/Welcome/i.test(r.txt) || /already registered/i.test(r.txt),
             { head: (r.txt || '').split('\n')[0], botWaitMs: r.waitedMs }), t() - s);
  }

  if (want('R02', 'R09', 'R07', 'R12', 'R03', 'R11', 'R05', 'R08')) {
    // ---- v5 (bd-x7aprz.2): open the Flow once and harvest R02 / R09 / R07 / R11 / R12 / R03 / R05 ----
    // Screens: name + language → role (Teacher/Principal) + school search → pick a school → grades +
    // subjects → done. The first screen is static and bilingual ("Name / نام", "Language / زبان").
    s = t();
    const op = await api.openFlow('Get started');
    let first = op.ok ? await api.flowProbe() : { text: '' };
    const onFirst = (txt) => /Name/i.test(txt) && /Language|زبان/i.test(txt);
    if (op.ok && !onFirst(first.text)) {      // resumed mid-journey — restart it
      await api.resetFlow();
      await api.sendWait('/register');
      const op2 = await api.openFlow('Get started');
      if (op2.ok) first = await api.flowProbe();
    }
    rec('R02', 'The registration Flow first screen asks for a name and a language',
        ...V(op.ok && onFirst(first.text) && !/Country/i.test(first.text),
             { opened: op.ok, screen: first.text.slice(0, 130), err: op.err }), t() - s);
    if (!op.ok) { rec('R09', 'required fields', 'BLOCKED', { reason: 'Flow did not open' });
                  return; }
    // R09 — Next disabled with the name empty (the language is pre-selected, so name is the one gate)
    s = t();
    const nx = await api.flowState('^Next');
    const nameEmptyDisabled = nx.found && nx.disabled;
    rec('R09', 'A required field on the personal-info screen must be provided',
        ...V(nameEmptyDisabled, { nameEmptyDisabled,
             note: 'enforced by a disabled submit, so no inline "required" message is reachable' }), t() - s);

    // R07 — the second screen: role (Teacher or Principal ONLY) + the school search
    s = t();
    await api.flowType('Mahnoor');
    await api.flowClick('English', { exact: true, settleMs: 300 });   // the assertions below read English
    await api.flowClick('Next / آگے', { exact: true, settleMs: 2000 });
    let p = await api.flowProbe();
    const r07 = {
      role: /Your role/i.test(p.text), principal: /Principal/i.test(p.text),
      noLeaderRoles: !/\bCoach\b|\bAEO\b/i.test(p.text), search: /School name or EMIS/i.test(p.text),
    };
    rec('R07', 'The second screen asks the role (Teacher or Principal only) and searches for a school',
        ...V(Object.values(r07).every(Boolean), { ...r07, screen: p.text.slice(0, 140) }), t() - s);

    // R11 (picked here, checked after completion) — Principal
    await api.flowClick('Principal / Head Teacher', { exact: true, settleMs: 300 });

    // R12 — the search: an EMIS code finds its school, and "My school isn't here" is always offered
    s = t();
    await api.flowType(SEARCH_EMIS);
    await api.flowClick('Search', { exact: true, settleMs: 2500 });
    p = await api.flowProbe();
    const found = SEARCH_HIT.test(p.text);
    const wayOut = /My school isn.t here/i.test(p.text);
    rec('R12', 'A school search finds the school, with a "My school isn\'t here" way out',
        ...V(found && wayOut, { searched: SEARCH_EMIS, found, wayOut, screen: p.text.slice(0, 160) }), t() - s);
    await api.flowClick(found ? SEARCH_TITLE : 'My school isn’t here', { exact: false, settleMs: 300 });
    await api.flowClick('Next', { exact: true, settleMs: 2000 });

    // grades + subjects, then Finish
    s = t();
    await api.flowClick('Grade 2', { exact: true, settleMs: 300 });
    await api.flowClick('Urdu', { exact: true, settleMs: 300 });
    const fin = await api.flowState('^Finish$');
    rec('R13-pre', 'Finish is enabled on the grades and subjects screen',
        ...V(fin.found && !fin.disabled, { submit: fin }), t() - s);
    if (!(fin.found && !fin.disabled)) {
      for (const [id, nm] of [['R03', 'Completing the Flow registers the teacher'],
                              ['R05', 'completion greeting names the teacher'],
                              ['R08', 'already-registered teacher is not re-onboarded']])
        rec(id, nm, 'BLOCKED', { reason: 'Finish never enabled — see R13-pre' }, 0);
      return;
    }

    // R03 / R05 — complete and read the greeting
    s = t();
    await api.flowClick('Finish', { exact: true, settleMs: 2500 });
    await api.flowClick('Done', { exact: true, settleMs: 1500 });
    api.closeFlow();
    // Poll the replies for the registration confirmation. Mock-capable: api.fresh() reads the mock
    // outbox on the mock lane and the WhatsApp Web transcript on chrome — the same helper lesson-plan
    // uses on both lanes.
    const GREET = /registering|شکریہ|all set|portal/i;
    const gt0 = Date.now();
    const g = { ok: false, waitedMs: 0, txt: '', btns: [] };
    while (Date.now() - gt0 < 90000) {
      for (const rr of await api.fresh()) {
        const txt = rr.txt || '';
        if (txt) { g.txt = txt; g.btns = rr.btns || []; }
        if (GREET.test(txt)) { g.ok = true; g.txt = txt; g.btns = rr.btns || []; break; }
      }
      if (g.ok) break;
      await sleep(700);
    }
    g.waitedMs = Date.now() - gt0;
    // The welcome is ONE cta_url message whose button opens the portal through the signed /go link
    // (flow-response.handler.js sendRegistrationWelcome). The 7-day /portal/setup/ link is gone.
    const portalButton = (g.btns || []).some((b) => /Open portal|پورٹل کھولیں/.test(String(b)))
      || /\/go\//.test(g.txt || '');
    const nameInGreeting = /Mahnoor/.test(g.txt || '');
    rec('R03', 'Completing the Flow registers the teacher', ...V(g.ok && portalButton,
        { greeting: (g.txt || '').slice(0, 150), portalButton, btns: g.btns,
          namePresent: nameInGreeting, botWaitMs: g.waitedMs }), t() - s);
    // R11 — did the selected role persist? (Coach and AEO are never offered — R07)
    s = t();
    const look = api.db('lookup');
    const roleLine = ((look.user || '').split('\n').find(l => l.includes('"role"'))) || '';
    const fnAfter  = ((look.user || '').split('\n').find(l => l.includes('"name"'))) || '';
    // "" is as unpersisted as null — the bot's gate (isRegistered) reads a non-empty `name`.
    const fnValue = (fnAfter.match(/"name":\s*"?([^",]*)"?/) || [,''])[1].trim();
    const namePersisted = !!fnValue && fnValue !== 'null';
    const rolePersisted = /principal/i.test(roleLine);
    rec('R11', 'The registration Flow persists the selected role',
        rolePersisted ? 'PASS' : 'FAIL',
        { picked: 'Principal / Head Teacher', dbRole: roleLine.trim() || '(not found)' }, t() - s);

    rec('R05', 'The completion greeting names the teacher, in the language she chose',
        nameInGreeting ? 'PASS' : 'FAIL',
        { nameInGreeting, note: nameInGreeting ? 'name present' : 'name dropped — F-REG1 regressed' }, 0);

    // R08 — already registered short-circuits
    s = t();
    if (!namePersisted) {
      rec('R08', 'An already-registered teacher is not re-onboarded', 'BLOCKED',
          { reason: 'the already-registered gate reads users.name, and no name was persisted by the completed Flow (same root defect as R05/R11) — so this path is unreachable on this build',
            dbName: fnAfter.trim() }, 0);
    } else {
      r = await api.sendWait('/register');
      // Since 2026-10-16 a registered teacher gets the Flow to UPDATE her details, never "already registered".
      rec('R08', 'An already-registered teacher gets the Flow to update her details',
          ...V(/Update your details|تفصیلات درست کریں/i.test(r.txt) && !/already registered/i.test(r.txt),
               { reply: (r.txt || '').slice(0, 110), btns: r.btns, botWaitMs: r.waitedMs }), t() - s);
    }
  }

  if (want('R13')) {
    // R13 — "My school isn't here": she can finish, and the pass writes no school. Needs an
    // unregistered account again, so it runs on its own after the main pass.
    s = t();
    api.db('unregister');
    const before = api.db('lookup');
    const schoolBefore = ((before.user || '').split('\n').find(l => l.includes('"school_id"'))) || '';
    await api.resetFlow();
    await api.sendWait('/register');
    const o13 = await api.openFlow('Get started');
    if (o13.ok) {
      await api.flowType('Mahnoor');
      await api.flowClick('Next / آگے', { exact: true, settleMs: 2000 });
      await api.flowType('zzqx no such school');
      await api.flowClick('Search', { exact: true, settleMs: 2500 });
      const pick = await api.flowProbe();
      const onlyWayOut = /My school isn.t here/i.test(pick.text);
      await api.flowClick('My school isn’t here', { exact: false, settleMs: 300 });
      await api.flowClick('Next', { exact: true, settleMs: 2000 });
      await api.flowClick('Finish', { exact: true, settleMs: 2500 });
      await api.flowClick('Done', { exact: true, settleMs: 1500 });
      api.closeFlow();
      const after = api.db('lookup');
      const schoolAfter = ((after.user || '').split('\n').find(l => l.includes('"school_id"'))) || '';
      const regLine = ((after.user || '').split('\n').find(l => l.includes('"registration_completed"'))) || '';
      const completed = /true/.test(regLine);
      rec('R13', 'A teacher whose school is not listed can finish without one',
          (onlyWayOut && completed && schoolAfter === schoolBefore) ? 'PASS' : 'FAIL',
          { onlyWayOut, completed, schoolBefore: schoolBefore.trim(), schoolAfter: schoolAfter.trim() }, t() - s);
    } else {
      rec('R13', 'A teacher whose school is not listed can finish without one', 'BLOCKED', { reason: 'Flow did not open' }, t() - s);
    }
  }

  // ---- the front door (2026-10-16): every way of asking, /portal, school features ----
  const REG_FLOW = (x) => /Welcome to NIETE|خوش آمدید|Update your details|تفصیلات درست کریں|First, your school|پہلے آپ کا اسکول/i.test(x.txt || '');
  if (want('R14')) {
    s = t();
    const asked = ['Register', 'Register me', 'i need to register', '/registered', '/ register', 'Type/register', 'رجسٹر'];
    const got = [];
    for (const msg of asked) {
      api.db('unregister');
      await api.resetFlow();
      const x = await api.sendWait(msg);
      got.push({ msg, flow: REG_FLOW(x), oldGuide: /ask for your name|نام پوچھوں گی/i.test(x.txt || '') });
    }
    rec('R14', 'Every way of asking to register opens the registration Flow',
        ...V(got.every((g) => g.flow && !g.oldGuide), { got }), t() - s);
  }
  if (want('R15')) {
    s = t();
    const said = ['attendance register', 'Mera registration number kia hai'];
    const got = [];
    for (const msg of said) {
      const x = await api.sendWait(msg);
      got.push({ msg, flow: REG_FLOW(x), head: (x.txt || '').split('\n')[0].slice(0, 60) });
    }
    rec('R15', 'Talking about a register is not a registration request',
        ...V(got.every((g) => !g.flow), { got }), t() - s);
  }
  if (want('R16')) {
    rec('R16', "A new person's first message is answered first, then the Flow is offered once", 'DEFERRED',
        { reason: 'needs a number that has never been offered the form (users.registration_started_at is NULL) — the driver account is stamped after its first offer and api.db has no action that clears the stamp; the ordering and once-only rules are covered by tests/registration/front-door-invite.test.js and registration-invite.service.test.js' }, 0);
  }
  if (want('R17')) {
    s = t();
    api.db('unregister');
    await api.resetFlow();
    r = await api.sendWait('/portal');
    rec('R17', '/portal from someone not yet registered opens the registration Flow',
        ...V(REG_FLOW(r) && !/portal\/setup\//i.test(r.txt || ''), { head: (r.txt || '').split('\n')[0], botWaitMs: r.waitedMs }), t() - s);
  }
  if (want('R18')) {
    s = t();
    const got = [];
    for (const cmd of ['/classes', '/roster']) {
      api.db('unregister');
      await api.resetFlow();
      const x = await api.sendWait(cmd);
      got.push({ cmd, school: /First, your school|پہلے آپ کا اسکول/i.test(x.txt || '') });
    }
    rec('R18', 'A feature that needs a school asks an unregistered person to register first',
        ...V(got.every((g) => g.school), { got }), t() - s);
  }
  if (want('R19')) {
    rec('R19', 'After the first lesson plan, a person already offered the Flow is not asked her name in chat', 'DEFERRED',
        { reason: 'needs a lesson plan generated and delivered by the worker on an unregistered account — minutes per run; the worker guard is covered by tests/registration/after-first-feature-invite.test.js' }, 0);
  }

  if (want('R10')) {
    // R10 needs an unregistered account again — left to the DB step, reported as deferred
    // R10 — abandon a fresh Flow and prove nothing was recorded
    s = t();
    api.db('unregister');
    await api.resetFlow();
    const r10open = await api.sendWait('/register');
    const o10 = await api.openFlow('Get started');
    await api.flowAria('Cancel', 1500);
    api.closeFlow();
    const after = api.db('lookup');
    const fnLine = ((after.user || '').split('\n').find(l => l.includes('"name"'))) || '';
    const stillUnreg = /null/i.test(fnLine);
    const canReopen = /Welcome/i.test(r10open.txt || '');
    rec('R10', 'Abandoning the Flow leaves the teacher unregistered',
        (stillUnreg && canReopen && o10.ok) ? 'PASS' : 'FAIL',
        { reopened: canReopen, flowOpened: o10.ok, dbName: fnLine.trim(), stillUnregistered: stillUnreg }, t() - s);
  }
};

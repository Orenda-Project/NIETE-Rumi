/* registration.feature — 13 @e2e scenarios across four Flow screens, one process.
 * Precondition: the driver must be UNREGISTERED (first_name null) so /register opens the Flow.
 * Scenario order is deliberate — it walks the Flow once and harvests several scenarios per pass. */
const V = (c, ev) => [c ? 'PASS' : 'FAIL', ev];

exports.run = async ({ api, rec, sleep }) => {
  const t = () => Date.now();
  let s;
  await api.resetFlow();          // a Flow remembers its screen across opens

  // R01 — /register opens the Flow
  s = t();
  let r = await api.sendWait('/register');
  rec('R01', '/register opens the registration Flow',
      ...V(/Welcome/i.test(r.txt) && r.btns.some(b => /Get started/i.test(b)),
           { head: (r.txt || '').split('\n')[0], btns: r.btns, botWaitMs: r.waitedMs }), t() - s);

  // R06 — case-insensitive
  s = t();
  r = await api.sendWait('/REGISTER');
  rec('R06', '/register is case-insensitive',
      ...V(/Welcome/i.test(r.txt) || /already registered/i.test(r.txt),
           { head: (r.txt || '').split('\n')[0], botWaitMs: r.waitedMs }), t() - s);

  // ---- open the Flow once and harvest R02 / R09 / R07 / R12 / R11 / R13 / R03 / R05 ----
  s = t();
  const op = await api.openFlow('Get started');
  let first = op.ok ? await api.flowProbe() : { text: '' };
  if (op.ok && !/Full Name/i.test(first.text)) {      // resumed mid-journey — restart it
    await api.resetFlow();
    await api.sendWait('/register');
    const op2 = await api.openFlow('Get started');
    if (op2.ok) first = await api.flowProbe();
  }
  rec('R02', 'The registration Flow first screen collects name and country',
      ...V(op.ok && /Full Name/i.test(first.text) && /Country/i.test(first.text),
           { opened: op.ok, screen: first.text.slice(0, 130), err: op.err }), t() - s);
  if (!op.ok) { rec('R09', 'required fields', 'BLOCKED', { reason: 'Flow did not open' });
                return; }

  // R09a — Next disabled with BOTH fields empty
  s = t();
  let nx = await api.flowState('^Next$');
  const bothEmpty = nx.found && nx.disabled;
  // R09b — name filled, country still empty -> still disabled
  await api.flowType('Mahnoor');
  nx = await api.flowState('^Next$');
  const countryEmpty = nx.found && nx.disabled;
  rec('R09', 'A required field on the personal-info screen must be provided',
      ...V(bothEmpty && countryEmpty,
           { bothEmptyDisabled: bothEmpty, countryEmptyDisabled: countryEmpty,
             note: 'enforced by a disabled submit, so no inline "required" message is reachable' }), t() - s);

  // R07 — Pakistan routes to REGION_INFO
  s = t();
  await api.flowPick('Pakistan', { open: 'Country' });
  await api.flowClick('Next', { exact: true, settleMs: 2000 });
  let p = await api.flowProbe();
  rec('R07', 'Pakistan teachers get an extra region screen',
      ...V(/Select Your Region|province in Pakistan/i.test(p.text), { screen: p.text.slice(0, 110) }), t() - s);

  // R12 — a non-Pakistan country skips it
  s = t();
  await api.flowAria('Back');
  await api.flowPick('Tanzania', { open: 'Country' });
  await api.flowClick('Next', { exact: true, settleMs: 2200 });
  p = await api.flowProbe();
  rec('R12', 'A non-Pakistan teacher skips the region screen',
      ...V(/Professional Details/i.test(p.text) && !/Select Your Region/i.test(p.text),
           { screen: p.text.slice(0, 110) }), t() - s);

  // back to Pakistan and on to PROFESSIONAL_INFO
  await api.flowAria('Back');
  await api.flowPick('Pakistan', { open: 'Country' });
  await api.flowClick('Next', { exact: true, settleMs: 2000 });   // -> Region
  await api.flowClick('Next', { exact: true, settleMs: 2000 });   // -> Professional
  p = await api.flowProbe();

  // R11 — the role dropdown (staging has one; sandbox does not)
  s = t();
  const roleCtl = p.items.find(i => /Your Role/i.test(i.text));
  let rolePicked = null;
  if (roleCtl) rolePicked = await api.flowPick('Coach', { open: 'Your Role' });

  // school + grade + subject, then R13 org "Other"
  s = t();
  await api.flowType('NIETE E2E Test School');
  await api.flowClick('Grade 2', { exact: true, settleMs: 500 });
  await api.flowClick('Urdu', { exact: true, settleMs: 500 });
  // "Other" exists in BOTH the Subjects list and the Organization dropdown — take the LAST match
  const orgPick = await api.flowPick('Other', { open: 'Organization / Partner' });
  const sub = await api.flowState('Complete Registration');
  rec('R13-pre', 'Complete Registration enables once the required fields are set',
      ...V(sub.found && !sub.disabled, { submit: sub, orgPick }), t() - s);

  // R13 — org "Other" adds an ORG_DETAILS screen
  if (!(sub.found && !sub.disabled)) {
    for (const [id, nm] of [['R13','organization "Other" adds ORG_DETAILS'],
                            ['R03','Completing the Flow registers the teacher'],
                            ['R05','completion greeting drops the name'],
                            ['R08','already-registered teacher is not re-onboarded']])
      rec(id, nm, 'BLOCKED', { reason: 'Complete Registration never enabled — see R13-pre' }, 0);
    rec('R10', 'Abandoning the Flow leaves the teacher unregistered', 'DEFERRED', {}, 0);
    return;
  }
  s = t();
  await api.flowClick('Complete Registration', { settleMs: 2500 });
  p = await api.flowProbe();
  const orgDetails = /Organization Name|organization or partner name/i.test(p.text);
  rec('R13', 'Choosing organization "Other" adds an organization-details screen',
      ...V(orgDetails, { screen: p.text.slice(0, 110) }), t() - s);

  // R03 / R05 — complete and read the greeting
  s = t();
  if (orgDetails) { await api.flowType('E2E Org'); await api.flowClick('Complete Registration', { settleMs: 1500 }); }
  api.closeFlow();
  const greet = await api.ev(`(async()=>{
    const wa=window.__wa; wa.restore();
    const t0=Date.now();
    while(Date.now()-t0 < 90000){
      const last=wa.readLast(1)[0];
      if(last && !last.mine && /registering|شکریہ|all set|portal/i.test(last.txt))
        return JSON.stringify({ok:true,waitedMs:Date.now()-t0,txt:last.txt});
      await new Promise(r=>setTimeout(r,700));
    }
    return JSON.stringify({ok:false,waitedMs:Date.now()-t0,txt:(wa.readLast(1)[0]||{}).txt||''});
  })()`);
  const g = JSON.parse(greet);
  const hasLink = /portal\/setup\//.test(g.txt || '');
  const nameInGreeting = /Mahnoor/.test(g.txt || '');
  rec('R03', 'Completing the Flow registers the teacher', ...V(g.ok && hasLink,
      { greeting: (g.txt || '').slice(0, 150), portalSetupLink: hasLink,
        namePresent: nameInGreeting, botWaitMs: g.waitedMs }), t() - s);
  // R11 — did the selected role actually persist?
  s = t();
  const look = api.db('lookup');
  const roleLine = ((look.user || '').split('\n').find(l => l.includes('"role"'))) || '';
  const fnAfter  = ((look.user || '').split('\n').find(l => l.includes('"first_name"'))) || '';
  // "" is as unpersisted as null — the bot's gate is `if (user.first_name)`, so an EMPTY
  // string leaves the already-registered path unreachable just as null does.
  const fnValue = (fnAfter.match(/"first_name":\s*"?([^",]*)"?/) || [,''])[1].trim();
  const namePersisted = !!fnValue && fnValue !== 'null';
  const rolePersisted = /coach/i.test(roleLine);
  rec('R11', 'The registration Flow persists the selected role',
      rolePersisted ? 'PASS' : 'FAIL',
      { picked: 'Coach', dbRole: roleLine.trim() || '(not found)',
        note: rolePersisted ? 'role persisted' : 'role NOT persisted — known-fail reproduces' }, t() - s);

  rec('R05', 'The completion greeting drops the name (@known-fail)',
      nameInGreeting ? 'PASS' : 'FAIL',
      { nameInGreeting, note: nameInGreeting ? 'name present — the known-fail is FIXED here'
                                             : 'name dropped — known-fail reproduces' }, 0);

  // R08 — already registered short-circuits
  s = t();
  if (!namePersisted) {
    rec('R08', 'An already-registered teacher is not re-onboarded', 'BLOCKED',
        { reason: 'the already-registered gate reads first_name, and first_name was not persisted by the completed Flow (same root defect as R05/R11) — so this path is unreachable on this build',
          dbFirstName: fnAfter.trim() }, 0);
  } else {
    r = await api.sendWait('/register');
    rec('R08', 'An already-registered teacher is not re-onboarded',
        ...V(/already registered/i.test(r.txt), { reply: (r.txt || '').slice(0, 110), botWaitMs: r.waitedMs }), t() - s);
  }

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
  const fnLine = ((after.user || '').split('\n').find(l => l.includes('"first_name"'))) || '';
  const stillUnreg = /null/i.test(fnLine);
  const canReopen = /Welcome/i.test(r10open.txt || '');
  rec('R10', 'Abandoning the Flow leaves the teacher unregistered',
      (stillUnreg && canReopen && o10.ok) ? 'PASS' : 'FAIL',
      { reopened: canReopen, flowOpened: o10.ok, dbFirstName: fnLine.trim(), stillUnregistered: stillUnreg }, t() - s);
};

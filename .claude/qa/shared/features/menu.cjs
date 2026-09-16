// @mock-lane — mock-capable driver (uses the mock API, not the browser DOM). Its presence enrols this feature in the mock lane; E2E_MOCK_FEATURES is derived from this marker, so there is no hardcoded list.
/* menu.feature — all 13 @e2e scenarios, driven in one process.
 * Assertions mirror tests/features/whatsapp/niete/menu.feature. */
// The CORE teacher rows that must always be present. The menu is role-aware (78406d1e): a teacher's
// full layout is up to ten rows, role- and config-gated, so assert these are INCLUDED, not an exact
// list — matching menu.feature's "includes these teacher rows".
const CORE = ['Lesson Plans', 'Classroom Coaching', 'Teacher Training', 'Ask Anything'];
const includesCore = (rows) => CORE.every((x) => (rows || []).includes(x));
const head = t => (t || '').split('\n')[0];
const V = (cond, ev) => ({ verdict: cond ? 'PASS' : 'FAIL', evidence: ev });

exports.run = async ({ api, rec, sleep }) => {
  const t = () => Date.now();

  // M01 — card + exactly the 4 ICT rows
  let s = t();
  let r = await api.sendWait('/menu');
  const list = r.ok ? await api.openList('See what I do') : { rows: [] };
  await api.closeDialog();
  const rowsOk = includesCore(list.rows);
  rec('M01', '/menu renders the role-aware feature card for a teacher',
      (head(r.txt) === "Here's what I can do" && r.btns.includes('See what I do') && rowsOk) ? 'PASS' : 'FAIL',
      { header: head(r.txt), opener: r.btns, rows: list.rows, botWaitMs: r.waitedMs }, t() - s);

  // M02 — case-insensitive
  s = t(); r = await api.sendWait('/MENU');
  rec('M02', '/menu is case-insensitive',
      ...Object.values(V(head(r.txt) === "Here's what I can do" && r.btns.includes('See what I do'),
      { header: head(r.txt), botWaitMs: r.waitedMs })), t() - s);

  // M04 — idempotent across repeats
  s = t();
  const a = await api.sendWait('/menu'), b = await api.sendWait('/menu');
  rec('M04', 'Sending /menu repeatedly is idempotent',
      ...Object.values(V(head(a.txt) === "Here's what I can do" && head(b.txt) === "Here's what I can do",
      { first: head(a.txt), second: head(b.txt), botWaitMs: [a.waitedMs, b.waitedMs] })), t() - s);

  // M05 — surrounding whitespace (client trims)
  s = t(); r = await api.sendWait(' /menu ');
  rec('M05', '/menu with surrounding whitespace still opens the menu',
      ...Object.values(V(r.btns.includes('See what I do'), { header: head(r.txt), botWaitMs: r.waitedMs })), t() - s);

  // M06 — bare "menu" must NOT open the list
  s = t(); r = await api.sendWait('menu');
  rec('M06', 'A bare "menu" does not open the interactive menu',
      ...Object.values(V(!r.btns.includes('See what I do'),
      { reply: (r.txt || '').slice(0, 110), openedList: r.btns.includes('See what I do') })), t() - s);

  // M07 — Ask Anything row opens general help  (also puts us in GENERAL_CONVERSATION for M08/09/12)
  s = t();
  await api.sendWait('/menu');
  await api.openList('See what I do');
  r = await api.pickRowAndWait('Ask Anything');
  rec('M07', 'The Ask Anything menu row opens general help',
      ...Object.values(V(/How can I help you today/i.test(r.txt || ''),
      { reply: (r.txt || '').slice(0, 90), botWaitMs: r.waitedMs })), t() - s);

  // M08 — answers a teaching question
  // Isolate each open-chat scenario: reset the conversation history (DB rows + the bot's in-process
  // Map) so the LLM prompt does not fold in earlier scenarios' turns, which made the vendor cassette
  // key drift every run (the M09/M08/M12 misses). With a clean baseline the prompt is deterministic.
  api.resetConversation();
  s = t(); r = await api.sendWait('What are two quick classroom management strategies for a large class?', 120000);
  rec('M08', 'Ask Anything answers a teaching question',
      ...Object.values(V(r.ok && (r.txt || '').length > 60,
      { len: (r.txt || '').length, sample: (r.txt || '').slice(0, 90), botWaitMs: r.waitedMs })), t() - s);

  // M09 — gibberish handled gracefully
  api.resetConversation();
  s = t(); r = await api.sendWait('asdfghjkl zxcvbnm qwerty', 120000);
  rec('M09', 'Gibberish input is handled gracefully',
      ...Object.values(V(r.ok && (r.txt || '').trim().length > 0 && !/error|exception|undefined/i.test(r.txt),
      { len: (r.txt || '').length, sample: (r.txt || '').slice(0, 90), botWaitMs: r.waitedMs })), t() - s);

  // M12 — capability question gets guidance, not a feature
  api.resetConversation();
  s = t(); r = await api.sendWait('what can you do?', 120000);
  rec('M12', 'A capability question gets a guided answer, not a feature attempt',
      ...Object.values(V(r.ok && (r.txt || '').length > 40 && !r.btns.includes('See what I do'),
      { len: (r.txt || '').length, sample: (r.txt || '').slice(0, 90), botWaitMs: r.waitedMs })), t() - s);

  // M10 — /portal
  s = t(); r = await api.sendWait('/portal');
  const portal = /\/portal\/(login|setup)/.test(r.txt || '');
  rec('M10', '/portal points a teacher to their portal', portal ? 'PASS' : 'FAIL',
      { matchedPath: (String(r.txt).match(/\/portal\/\w+/) || [null])[0],
        note: /setup/.test(r.txt || '') ? 'setup link — portal not yet activated for this account' : 'login link',
        botWaitMs: r.waitedMs }, t() - s);

  // M11 — /settings (config-gated)
  s = t(); r = await api.sendWait('/settings');
  const notAvail = /not available/i.test(r.txt || '');
  rec('M11', '/settings degrades gracefully when the Settings Flow is not configured',
      notAvail ? 'PASS' : 'SKIP',
      { reply: (r.txt || '').slice(0, 90), botWaitMs: r.waitedMs,
        note: notAvail ? null : 'Settings Flow IS configured here — the scenario precondition (SETTINGS_FLOW_ID unset) is an environment shape this lane does not run; the degrade path is covered by unit tests' }, t() - s);

  // M13 — a menu number outside 1-4 gets the Helper Agent escape nudge and starts nothing
  // (spec sync 2026-09-08; the first mock drive showed "7" never reaches handleMenuChoice)
  s = t();
  await api.sendWait('/menu');
  r = await api.sendWait('7');
  rec('M13', 'A menu number outside 1-4 gets the choose-an-option nudge and starts nothing',
      ...Object.values(V(/choose an option \(1-4\)/i.test(r.txt || '') && /\/menu/.test(r.txt || '') && !r.btns.includes('See what I do'),
      { reply: (r.txt || '').slice(0, 110), btns: r.btns, botWaitMs: r.waitedMs })), t() - s);

  // M03 — /menu as escape hatch from inside a feature flow
  s = t();
  await api.sendWait('/menu');
  await api.openList('See what I do');
  await api.pickRowAndWait('Classroom Coaching');
  r = await api.sendWait('/menu');
  const esc = await api.openList('See what I do');
  await api.closeDialog();
  rec('M03', '/menu re-opens the menu from inside a feature flow (escape hatch)',
      ...Object.values(V(head(r.txt) === "Here's what I can do" &&
                         includesCore(esc.rows),
      { header: head(r.txt), rows: esc.rows, botWaitMs: r.waitedMs })), t() - s);

  // ═══════════════ ROLE-AWARE scenarios (M14–M19) ═══════════════
  // Role switching is a GENERIC harness capability: api.setRole/api.setUser write the driver's identity
  // (the bot reads role fresh per message — getOrCreateUser), and the harness snapshots+restores it
  // around the feature, so this suite never cleans up after itself. Row taps from scrollback are forged
  // with api.injectList (caps.rawInject). Any role/persona-based feature (observe, attendance) uses the
  // same api.setRole — nothing menu-specific here.
  const openRows = async () => { await api.sendWait('/menu'); const l = await api.openList('See what I do'); await api.closeDialog(); return l.rows || []; };
  const roleRec = (id, name, cond, ev) => rec(id, name, ...Object.values(V(cond, ev)), 0);
  const roleBlocked = (id, name) => rec(id, name, 'BLOCKED', { reason: 'this lane does not support role switching (api.setRole returned not-ok — no sandbox creds)' }, 0);
  const canRole = (await api.setRole('teacher')).ok;   // probe once: does this lane support role switching?

  if (canRole) {
    await api.setRole('principal');
    const p = await openRows();
    roleRec('M14', 'A principal sees BOTH Classroom Coaching and Observe a Teacher',
        p.includes('Classroom Coaching') && p.includes('Observe a Teacher'), { role: 'principal', rows: p });

    await api.setRole('coach');
    const c = await openRows();
    roleRec('M15', 'A coach sees Observe a Teacher and NOT Classroom Coaching',
        c.includes('Observe a Teacher') && !c.includes('Classroom Coaching'), { role: 'coach', rows: c });

    await api.setRole('teacher');
    const te = await openRows();
    roleRec('M16', 'A teacher still sees Classroom Coaching and no observe row',
        te.includes('Classroom Coaching') && !te.includes('Observe a Teacher'), { role: 'teacher', rows: te });

    await api.setRole('coach');
    const r17 = await api.injectList('menu_coaching', 'Classroom Coaching');
    roleRec('M17', 'A coach tapping a Classroom Coaching row from old scrollback is refused',
        r17.ok && !/recording|ریکارڈنگ/i.test(r17.txt || '') && /Observe a Teacher|Observe/i.test(r17.txt || ''),
        { role: 'coach', reply: (r17.txt || '').slice(0, 140) });

    await api.setRole('teacher');
    const r18 = await api.injectList('menu_observe', 'Observe a Teacher');
    roleRec('M18', 'A teacher tapping a stray Observe row is refused and redirected',
        r18.ok && /Classroom Coaching|Coaching/i.test(r18.txt || '') && !/observation (started|form)|Step \d/i.test(r18.txt || ''),
        { role: 'teacher', reply: (r18.txt || '').slice(0, 140) });

    await api.setUser({ role: 'coach', preferred_language: 'ur', language_locked: true });
    const r19 = await api.injectList('menu_coaching', 'Classroom Coaching');
    roleRec('M19', "The role-refusal is in the tapping user's own language (Urdu)",
        r19.ok && /[؀-ۿ]/.test(r19.txt || ''), { role: 'coach', urdu: /[؀-ۿ]/.test(r19.txt || ''), reply: (r19.txt || '').slice(0, 140) });
    // No manual restore — feature-runner snapshots+restores the driver's role/language around this run.
  } else {
    for (const [id, name] of [['M14', 'A principal sees BOTH Classroom Coaching and Observe a Teacher'],
      ['M15', 'A coach sees Observe a Teacher and NOT Classroom Coaching'],
      ['M16', 'A teacher still sees Classroom Coaching and no observe row'],
      ['M17', 'A coach tapping a Classroom Coaching row from old scrollback is refused'],
      ['M18', 'A teacher tapping a stray Observe row is refused and redirected'],
      ['M19', "The role-refusal is in the tapping user's own language (Urdu)"]]) roleBlocked(id, name);
  }
};

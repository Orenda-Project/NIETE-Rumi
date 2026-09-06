/* menu.feature — all 12 @e2e scenarios, driven in one process.
 * Assertions mirror tests/features/whatsapp/niete/menu.feature. */
const ROWS = ['Teacher Training', 'Lesson Plans', 'Classroom Coaching', 'Ask Anything'];
const head = t => (t || '').split('\n')[0];
const V = (cond, ev) => ({ verdict: cond ? 'PASS' : 'FAIL', evidence: ev });

exports.run = async ({ api, rec, sleep }) => {
  const t = () => Date.now();

  // M01 — card + exactly the 4 ICT rows
  let s = t();
  let r = await api.sendWait('/menu');
  const list = r.ok ? await api.openList('View Features') : { rows: [] };
  await api.closeDialog();
  const rowsOk = JSON.stringify(list.rows) === JSON.stringify(ROWS);
  rec('M01', '/menu renders the card and exactly the 4 ICT feature rows',
      (head(r.txt) === "Here's what I can do!" && r.btns.includes('View Features') && rowsOk) ? 'PASS' : 'FAIL',
      { header: head(r.txt), opener: r.btns, rows: list.rows, botWaitMs: r.waitedMs }, t() - s);

  // M02 — case-insensitive
  s = t(); r = await api.sendWait('/MENU');
  rec('M02', '/menu is case-insensitive',
      ...Object.values(V(head(r.txt) === "Here's what I can do!" && r.btns.includes('View Features'),
      { header: head(r.txt), botWaitMs: r.waitedMs })), t() - s);

  // M04 — idempotent across repeats
  s = t();
  const a = await api.sendWait('/menu'), b = await api.sendWait('/menu');
  rec('M04', 'Sending /menu repeatedly is idempotent',
      ...Object.values(V(head(a.txt) === "Here's what I can do!" && head(b.txt) === "Here's what I can do!",
      { first: head(a.txt), second: head(b.txt), botWaitMs: [a.waitedMs, b.waitedMs] })), t() - s);

  // M05 — surrounding whitespace (client trims)
  s = t(); r = await api.sendWait(' /menu ');
  rec('M05', '/menu with surrounding whitespace still opens the menu',
      ...Object.values(V(r.btns.includes('View Features'), { header: head(r.txt), botWaitMs: r.waitedMs })), t() - s);

  // M06 — bare "menu" must NOT open the list
  s = t(); r = await api.sendWait('menu');
  rec('M06', 'A bare "menu" does not open the interactive menu',
      ...Object.values(V(!r.btns.includes('View Features'),
      { reply: (r.txt || '').slice(0, 110), openedList: r.btns.includes('View Features') })), t() - s);

  // M07 — Ask Anything row opens general help  (also puts us in GENERAL_CONVERSATION for M08/09/12)
  s = t();
  await api.sendWait('/menu');
  await api.openList('View Features');
  r = await api.pickRowAndWait('Ask Anything');
  rec('M07', 'The Ask Anything menu row opens general help',
      ...Object.values(V(/How can I help you today/i.test(r.txt || ''),
      { reply: (r.txt || '').slice(0, 90), botWaitMs: r.waitedMs })), t() - s);

  // M08 — answers a teaching question
  s = t(); r = await api.sendWait('What are two quick classroom management strategies for a large class?', 120000);
  rec('M08', 'Ask Anything answers a teaching question',
      ...Object.values(V(r.ok && (r.txt || '').length > 60,
      { len: (r.txt || '').length, sample: (r.txt || '').slice(0, 90), botWaitMs: r.waitedMs })), t() - s);

  // M09 — gibberish handled gracefully
  s = t(); r = await api.sendWait('asdfghjkl zxcvbnm qwerty', 120000);
  rec('M09', 'Gibberish input is handled gracefully',
      ...Object.values(V(r.ok && (r.txt || '').trim().length > 0 && !/error|exception|undefined/i.test(r.txt),
      { len: (r.txt || '').length, sample: (r.txt || '').slice(0, 90), botWaitMs: r.waitedMs })), t() - s);

  // M12 — capability question gets guidance, not a feature
  s = t(); r = await api.sendWait('what can you do?', 120000);
  rec('M12', 'A capability question gets a guided answer, not a feature attempt',
      ...Object.values(V(r.ok && (r.txt || '').length > 40 && !r.btns.includes('View Features'),
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
        note: notAvail ? null : 'Settings Flow IS configured here — the scenario precondition does not hold' }, t() - s);

  // M03 — /menu as escape hatch from inside a feature flow
  s = t();
  await api.sendWait('/menu');
  await api.openList('View Features');
  await api.pickRowAndWait('Classroom Coaching');
  r = await api.sendWait('/menu');
  const esc = await api.openList('View Features');
  await api.closeDialog();
  rec('M03', '/menu re-opens the menu from inside a feature flow (escape hatch)',
      ...Object.values(V(head(r.txt) === "Here's what I can do!" &&
                         JSON.stringify(esc.rows) === JSON.stringify(ROWS),
      { header: head(r.txt), rows: esc.rows, botWaitMs: r.waitedMs })), t() - s);
};

// @mock-lane — mock-capable driver (uses the mock API, not the browser DOM). Its presence enrols this feature in the mock lane; E2E_MOCK_FEATURES is derived from this marker, so there is no hardcoded list.
/* menu.feature — all @e2e scenarios, driven in one process.
 * Assertions mirror tests/features/whatsapp/niete/menu.feature. */
const { withRedirect, isStoreNotice, REDIRECT_BLOCKED } = require('../app-redirect-case.cjs');
// The CORE teacher rows that must always be present. The menu is role-aware (78406d1e): a teacher's
// full layout is up to ten rows, role- and config-gated, so assert these are INCLUDED, not an exact
// list — matching menu.feature's "includes these teacher rows".
const CORE = ['Lesson Plans', 'Classroom Coaching', 'Teacher Training', 'Ask Anything'];
const includesCore = (rows) => CORE.every((x) => (rows || []).includes(x));
const head = t => (t || '').split('\n')[0];
const V = (cond, ev) => ({ verdict: cond ? 'PASS' : 'FAIL', evidence: ev });

exports.run = async ({ api, rec, sleep, want = () => true }) => {
  const t = () => Date.now();
  let s, r;

  if (want('M01')) {
    // M01 — card + exactly the 4 ICT rows
    s = t();
    r = await api.sendWait('/menu');
    const list = r.ok ? await api.openList('See what I do') : { rows: [] };
    await api.closeDialog();
    const rowsOk = includesCore(list.rows);
    rec('M01', '/menu renders the role-aware feature card for a teacher',
        (head(r.txt) === "Here's what I can do" && r.btns.includes('See what I do') && rowsOk) ? 'PASS' : 'FAIL',
        { header: head(r.txt), opener: r.btns, rows: list.rows, botWaitMs: r.waitedMs }, t() - s);
  }

  if (want('M02')) {
    // M02 — case-insensitive
    s = t(); r = await api.sendWait('/MENU');
    rec('M02', '/menu is case-insensitive',
        ...Object.values(V(head(r.txt) === "Here's what I can do" && r.btns.includes('See what I do'),
        { header: head(r.txt), botWaitMs: r.waitedMs })), t() - s);
  }

  if (want('M21')) {
    // M21 — "/menu" typed back reversed, as an Urdu line displayed it (bd-5ls6qy.7)
    s = t(); r = await api.sendWait('Menu/');
    rec('M21', '/menu typed back the way Urdu text showed it ("Menu/") still opens the menu',
        ...Object.values(V(head(r.txt) === "Here's what I can do" && r.btns.includes('See what I do'),
        { header: head(r.txt), botWaitMs: r.waitedMs })), t() - s);
  }

  if (want('M22')) {
    // M22 — a space after the slash (bd-5ls6qy.7)
    s = t(); r = await api.sendWait('/ menu');
    rec('M22', '"/ menu" (a space after the slash) opens the menu',
        ...Object.values(V(head(r.txt) === "Here's what I can do" && r.btns.includes('See what I do'),
        { header: head(r.txt), botWaitMs: r.waitedMs })), t() - s);
  }

  if (want('M04')) {
    // M04 — idempotent across repeats
    s = t();
    const a = await api.sendWait('/menu'), b = await api.sendWait('/menu');
    rec('M04', 'Sending /menu repeatedly is idempotent',
        ...Object.values(V(head(a.txt) === "Here's what I can do" && head(b.txt) === "Here's what I can do",
        { first: head(a.txt), second: head(b.txt), botWaitMs: [a.waitedMs, b.waitedMs] })), t() - s);
  }

  if (want('M05')) {
    // M05 — surrounding whitespace (client trims)
    s = t(); r = await api.sendWait(' /menu ');
    rec('M05', '/menu with surrounding whitespace still opens the menu',
        ...Object.values(V(r.btns.includes('See what I do'), { header: head(r.txt), botWaitMs: r.waitedMs })), t() - s);
  }

  if (want('M06')) {
    // M06 — bare "menu" must NOT open the list
    s = t(); r = await api.sendWait('menu');
    rec('M06', 'A bare "menu" does not open the interactive menu',
        ...Object.values(V(!r.btns.includes('See what I do'),
        { reply: (r.txt || '').slice(0, 110), openedList: r.btns.includes('See what I do') })), t() - s);
  }

  if (want('M07', 'M08', 'M09', 'M12')) {
    // M07 — Ask Anything row opens general help  (also puts us in GENERAL_CONVERSATION for M08/09/12)
    s = t();
    await api.sendWait('/menu');
    await api.openList('See what I do');
    r = await api.pickRowAndWait('Ask Anything');
    rec('M07', 'The Ask Anything menu row opens general help',
        ...Object.values(V(/How can I help you today/i.test(r.txt || ''),
        { reply: (r.txt || '').slice(0, 90), botWaitMs: r.waitedMs })), t() - s);
  }

  if (want('M08')) {
    // M08 — answers a teaching question
    // Isolate each open-chat scenario: reset the conversation history (DB rows + the bot's in-process
    // Map) so the LLM prompt does not fold in earlier scenarios' turns, which made the vendor cassette
    // key drift every run (the M09/M08/M12 misses). With a clean baseline the prompt is deterministic.
    api.resetConversation();
    s = t(); r = await api.sendWait('What are two quick classroom management strategies for a large class?', 120000);
    rec('M08', 'Ask Anything answers a teaching question',
        ...Object.values(V(r.ok && (r.txt || '').length > 60,
        { len: (r.txt || '').length, sample: (r.txt || '').slice(0, 90), botWaitMs: r.waitedMs })), t() - s);
  }

  if (want('M09')) {
    // M09 — gibberish handled gracefully
    api.resetConversation();
    s = t(); r = await api.sendWait('asdfghjkl zxcvbnm qwerty', 120000);
    rec('M09', 'Gibberish input is handled gracefully',
        ...Object.values(V(r.ok && (r.txt || '').trim().length > 0 && !/error|exception|undefined/i.test(r.txt),
        { len: (r.txt || '').length, sample: (r.txt || '').slice(0, 90), botWaitMs: r.waitedMs })), t() - s);
  }

  if (want('M12')) {
    // M12 — capability question gets guidance, not a feature
    api.resetConversation();
    s = t(); r = await api.sendWait('what can you do?', 120000);
    rec('M12', 'A capability question gets a guided answer, not a feature attempt',
        ...Object.values(V(r.ok && (r.txt || '').length > 40 && !r.btns.includes('See what I do'),
        { len: (r.txt || '').length, sample: (r.txt || '').slice(0, 90), botWaitMs: r.waitedMs })), t() - s);
  }

  if (want('M10')) {
    // M10 — /portal: ONE "Open portal" cta_url button whose link is the signed /go/<token> (bd-x7aprz.3).
    // The link rides the button (cta.url), not the text; a lane that cannot see it (the CDP phone) reports BLOCKED.
    s = t();
    if (api.freshReset) await api.freshReset();
    r = await api.sendWait('/portal');
    const items10 = api.fresh ? await api.fresh() : [];
    const cta10 = items10.map((i) => i.cta).find((c) => c && c.url) || null;
    const ok10 = !!(cta10 && /\/go\/[A-Za-z0-9_-]{40,}$/.test(cta10.url) && !/\/portal\/(setup|login)/.test(cta10.url));
    rec('M10', '/portal opens the portal already signed in — one "Open portal" button with her own sign-in link',
        cta10 ? (ok10 ? 'PASS' : 'FAIL') : (api.fresh ? 'FAIL' : 'BLOCKED'),
        { button: cta10 ? cta10.text : (r.btns || [])[0] || null, link: cta10 ? cta10.url.replace(/\/go\/.*/, '/go/<token>') : null,
          reply: String(r.txt || '').slice(0, 160), botWaitMs: r.waitedMs }, t() - s);
  }

  if (want('M21')) {
    // M21 — bd-kkpg4t → bd-x7aprz.3: activated with NO password gets the same signed /go button — no password asked.
    // Seeds the driver's own row, then puts both portal columns back exactly as they were.
    const NAME21 = '/portal gives an activated teacher with no password the same sign-in link — no password asked';
    const o = api.db('user-get');
    const line = String(o.out || '').trim().split('\n').reverse().find((l) => l.trim().startsWith('{'));
    const before = line ? JSON.parse(line) : null;
    if (!before || !('portal_activated' in before)) {
      rec('M21', NAME21, 'BLOCKED', { reason: 'user-get lever unavailable on this lane — cannot seed or restore portal columns' }, 0);
    } else {
      s = t();
      try {
        await api.setUser({ portal_activated: true, portal_password_hash: null });
        if (api.freshReset) await api.freshReset();
        r = await api.sendWait('/portal');
        const txt = String(r.txt || '');
        const items21 = api.fresh ? await api.fresh() : [];
        const cta21 = items21.map((i) => i.cta).find((c) => c && c.url) || null;
        const ok21 = !!(cta21 && /\/go\/[A-Za-z0-9_-]{40,}$/.test(cta21.url) && !/\/portal\/(setup|login)/.test(cta21.url + ' ' + txt));
        rec('M21', NAME21, ok21 ? 'PASS' : 'FAIL',
            { link: cta21 ? cta21.url.replace(/\/go\/.*/, '/go/<token>') : null, reply: txt.slice(0, 160), botWaitMs: r.waitedMs }, t() - s);
      } finally {
        await api.setUser({ portal_activated: before.portal_activated, portal_password_hash: before.portal_password_hash,
                            portal_invite_token: before.portal_invite_token, portal_invite_expires_at: before.portal_invite_expires_at });
      }
    }
  }

  // M11 removed from the mock lane (operator, 2026-09-16): its precondition (Settings Flow UNSET)
  // cannot be met on any reachable env here, so it only ever SKIPped. The degrade path stays covered
  // by unit tests; the .feature scenario is tagged @obsolete for the E2E lane.

  if (want('M13')) {
    // M13 — free text after /menu is answered, not met with the "choose an option (1-4)" nudge
    // (spec sync 2026-10-01, Meta bill cut NO3: the list menu has no 1-4; free text now ends the
    // menu wait and is routed like any other message)
    s = t();
    await api.sendWait('/menu');
    r = await api.sendWait('7');
    rec('M13', 'Free text after /menu is answered as an ordinary message, not with a choose-1-4 nudge',
        ...Object.values(V(Boolean(r.txt) && !/choose an option \(1-4\)/i.test(r.txt || '') && !r.btns.includes('See what I do'),
        { reply: (r.txt || '').slice(0, 110), btns: r.btns, botWaitMs: r.waitedMs })), t() - s);
  }

  if (want('M03')) {
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
  }

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
    if (want('M14')) {
      await api.setRole('principal');
      const p = await openRows();
      roleRec('M14', 'A principal sees BOTH Classroom Coaching and Observe a Teacher',
          p.includes('Classroom Coaching') && p.includes('Observe a Teacher'), { role: 'principal', rows: p });
    }

    if (want('M15')) {
      await api.setRole('coach');
      const c = await openRows();
      roleRec('M15', 'A coach sees Observe a Teacher and NOT Classroom Coaching',
          c.includes('Observe a Teacher') && !c.includes('Classroom Coaching'), { role: 'coach', rows: c });
    }

    if (want('M16')) {
      await api.setRole('teacher');
      const te = await openRows();
      roleRec('M16', 'A teacher still sees Classroom Coaching and no observe row',
          te.includes('Classroom Coaching') && !te.includes('Observe a Teacher'), { role: 'teacher', rows: te });
    }

    if (want('M17')) {
      await api.setRole('coach');
      const r17 = await api.injectList('menu_coaching', 'Classroom Coaching');
      roleRec('M17', 'A coach tapping a Classroom Coaching row from old scrollback is refused',
          r17.ok && !/recording|ریکارڈنگ/i.test(r17.txt || '') && /Observe a Teacher|Observe/i.test(r17.txt || ''),
          { role: 'coach', reply: (r17.txt || '').slice(0, 140) });
    }

    if (want('M18')) {
      await api.setRole('teacher');
      const r18 = await api.injectList('menu_observe', 'Observe a Teacher');
      roleRec('M18', 'A teacher tapping a stray Observe row is refused and redirected',
          r18.ok && /Classroom Coaching|Coaching/i.test(r18.txt || '') && !/observation (started|form)|Step \d/i.test(r18.txt || ''),
          { role: 'teacher', reply: (r18.txt || '').slice(0, 140) });
    }

    if (want('M19')) {
      await api.setUser({ role: 'coach', preferred_language: 'ur', language_locked: true });
      const r19 = await api.injectList('menu_coaching', 'Classroom Coaching');
      roleRec('M19', "The role-refusal is in the tapping user's own language (Urdu)",
          r19.ok && /[؀-ۿ]/.test(r19.txt || ''), { role: 'coach', urdu: /[؀-ۿ]/.test(r19.txt || ''), reply: (r19.txt || '').slice(0, 140) });
    }
    // No manual restore — feature-runner snapshots+restores the driver's role/language around this run.
  } else {
    for (const [id, name] of [['M14', 'A principal sees BOTH Classroom Coaching and Observe a Teacher'],
      ['M15', 'A coach sees Observe a Teacher and NOT Classroom Coaching'],
      ['M16', 'A teacher still sees Classroom Coaching and no observe row'],
      ['M17', 'A coach tapping a Classroom Coaching row from old scrollback is refused'],
      ['M18', 'A teacher tapping a stray Observe row is refused and redirected'],
      ['M19', "The role-refusal is in the tapping user's own language (Urdu)"]]) roleBlocked(id, name);
  }

  // bd-onxyu — app redirect. The switch is GLOBAL (one app_settings row every teacher reads), so it is only
  // flipped where it reaches nobody else: the run's own local database (E2E_LOCAL_DB=1, bd-z3ze4). There
  // api.setAppSetting turns it on, waits out the bot's 30 s switch cache, and the harness puts it back.
  const M20 = 'A menu row whose feature moved to the app sends me to the Play Store instead';
  const r20 = await withRedirect(api, 'app_redirect_lesson_plan', async () => {
    const t0 = Date.now(), r = await api.injectList('menu_lesson_plan', 'Lesson Plans'), txt = r.txt || '';
    return { storeLink: isStoreNotice(txt), messages: r.newIds, flowStarted: /Pick (your )?class|جماعت چنیں/i.test(txt) || (r.btns || []).length > 0,
             reply: txt.slice(0, 160), ms: Date.now() - t0 };
  });
  if (!r20.ran) rec('M20', M20, 'BLOCKED', { reason: REDIRECT_BLOCKED, setAppSetting: r20.reason }, 0);
  else rec('M20', M20, r20.value.storeLink && !r20.value.flowStarted ? 'PASS' : 'FAIL', r20.value, r20.value.ms);
};

// @mock-lane — mock-capable driver (uses the mock API, not the browser DOM). Its presence enrols this feature in the mock lane; E2E_MOCK_FEATURES is derived from this marker, so there is no hardcoded list.
/* language.feature — the runnable @e2e subset in one process (added for the 2026-09-02 pre-merge run).
 * WRITES users.preferred_language on the driver via the bot itself (one-writer rule) and ends on the
 * driver's pre-run language, read from the DB at the start. Excluded here: @wip/@draft, @config-gated
 * (/observe), @slow (coaching), @defensive (stale row — not client-reproducible), @coverage (source check),
 * and the two sign-up-screen scenarios (recorded from the registration Flow drive, not re-driven). */
const V = (c, ev) => [c ? 'PASS' : 'FAIL', ev];
const UR = /[؀-ۿ]/;                       // Perso-Arabic script present
const latinOnly = s => !UR.test(s || '');
const field = (user, k) => { const m = (user || '').match(new RegExp('"' + k + '":\\s*("?[^",\\n]*"?)')); return m ? m[1].replace(/"/g, '') : '(not found)'; };
// The build renders the bilingual header/footer with the ACCOUNT-language half first ("زبان منتخب کریں / Select Language" on an
// Urdu account), so assert both halves, not the answer-key order. The ✅ is an emoji glyph WhatsApp Web does not expose in
// innerText — assert the words.
const hasHeader = t => /Select Language/.test(t) && /زبان منتخب کریں/.test(t);
const hasFooter = t => /change anytime/.test(t) && /کسی بھی وقت تبدیل کریں/.test(t);
const CONFIRM_EN = 'Language set to English. I will now respond in English.';
// Labels come from the bot's own catalog, in BOTH languages: the suite switches the driver to Urdu at LANG03 and the bot
// then renders the menu and the picker button in Urdu. Hardcoded English labels made the mock lane throw at "Ask Anything"
// on every run (bd-lu2p4) and made the live picker unopenable on an Urdu account (bd-7fsb6).
const { UX_STRINGS: UX } = require(require('path').resolve(__dirname, '..', '..', '..', '..', 'bot/shared/config/ux-strings.js'));
const both = k => [UX[k].en, UX[k].ur];
const openerIn = (r, k) => (r.btns || []).find(b => both(k).includes(b)) || UX[k].en;
// Free text is swallowed by awaiting_menu_selection (left by any /menu) and by coaching AWAITING_CLASSROOM_AUDIO. Enter Ask
// Anything first so a free-text reply is an AI answer, not the "choose an option (1-4)" nudge (contaminated LANG10/12 on pass 4).
const enterAskAnything = async (api) => {
  const m = await api.sendWait('/menu');
  const list = await api.openList(openerIn(m, 'menuButton'));
  await api.pickRowAndWait(both('menuRowOtherTitle').find(x => (list.rows || []).includes(x)) || UX.menuRowOtherTitle.en);
};
// Open /language and pick a row, whatever language the account is in. Always returns a txt string.
const pickLanguage = async (api, row) => {
  const r = await api.sendWait('/language');
  await api.openList(openerIn(r, 'languagePickerButton'));
  const p = await api.pickRowAndWait(row);
  return Object.assign({}, p, { txt: (p && p.txt) || '' });
};

exports.run = async ({ api, rec, sleep, want = () => true }) => {
  const t = () => Date.now();
  let s, r;
  await api.resetFlow();
  const before = api.db('lookup');
  const langBefore = field(before.user, 'preferred_language');
  rec('LANG-baseline', 'driver language before the run', 'INFO', { preferred_language: langBefore, locked: field(before.user, 'language_locked') }, 0);

  if (want('LANG01')) {
    // LANG01 — /language picker chrome + exactly Urdu/English
    s = t();
    r = await api.sendWait('/language');
    const list = r.btns.some(b => /Languages/.test(b)) ? await api.openList('Languages') : { ok: false, err: 'NO_OPENER', rows: [] };
    const rows = (list.rows || []).map(x => x.trim());
    const banned = ['Auto-detect', 'پنجابی', 'سنڌي', 'پښتو', 'بلوچی', 'தமிழ்', 'العربية', 'Español'].filter(b => (list.all || '').includes(b));
    rec('LANG01', '/language opens a bilingual picker offering EXACTLY Urdu and English',
        ...V(r.ok && hasHeader(r.txt) && hasFooter(r.txt) && r.btns.includes('Languages')
             && rows.length === 2 && rows[0] === 'اردو' && rows[1] === 'English' && banned.length === 0,
             { header: hasHeader(r.txt), footer: hasFooter(r.txt), headerText: r.txt.split('\n')[0], opener: r.btns, rows, banned, botWaitMs: r.waitedMs }), t() - s);
    await api.closeDialog(); await sleep(800);
  }

  if (want('LANG04')) {
    // LANG04 — case-insensitive
    s = t();
    r = await api.sendWait('/LANGUAGE');
    rec('LANG04', '/language is case-insensitive', ...V(r.ok && r.btns.includes('Languages'), { btns: r.btns, head: r.txt.slice(0, 60) }), t() - s);
  }

  if (want('LANG22')) {
    // LANG22 — bare "language" does not open the picker
    s = t();
    api.resetConversation();   // clean history -> deterministic open-chat cassette
    r = await api.sendWait('language', 120000);
    rec('LANG22', 'A bare "language" (no slash) does not open the picker',
        ...V(r.ok && !r.btns.includes('Languages') && !hasHeader(r.txt), { btns: r.btns, reply: r.txt.slice(0, 100) }), t() - s);
  }

  if (want('LANG02')) {
    // LANG02 — select English → exact confirm, DB en/locked, "hello" → English
    s = t();
    r = await pickLanguage(api, 'English');
    const dbEn = api.db('lookup');
    await enterAskAnything(api);
    api.resetConversation();   // clean history -> deterministic open-chat cassette
    const hiEn = await api.sendWait('hello', 120000);
    rec('LANG02', 'Selecting English confirms in English and persists the choice, locked',
        ...V(r.txt.includes(CONFIRM_EN) && field(dbEn.user, 'preferred_language') === 'en' && field(dbEn.user, 'language_locked') === 'true' && hiEn.ok && latinOnly(hiEn.txt),
             { confirm: r.txt.slice(0, 80), db: { preferred_language: field(dbEn.user, 'preferred_language'), locked: field(dbEn.user, 'language_locked') }, helloReply: hiEn.txt.slice(0, 80), helloLatinOnly: latinOnly(hiEn.txt) }), t() - s);
  }

  if (want('LANG03', 'LANG10', 'LANG14', 'LANG15', 'LANG09', 'LANG16', 'LANG17', 'LANG06', 'LANG18', 'LANG12', 'LANG13')) {
    // LANG14/15 on ENGLISH first is pointless — the known-issues are about an URDU account. Switch to Urdu.
    // LANG03 — select Urdu → confirm in Urdu, DB ur/locked, "hello" → Urdu
    s = t();
    r = await pickLanguage(api, 'اردو');
    const dbUr = api.db('lookup');
    await enterAskAnything(api);
    api.resetConversation();   // clean history -> deterministic open-chat cassette
    const hiUr = await api.sendWait('hello', 120000);
    rec('LANG03', 'Selecting Urdu confirms IN Urdu and persists the choice, locked',
        ...V(UR.test(r.txt) && field(dbUr.user, 'preferred_language') === 'ur' && field(dbUr.user, 'language_locked') === 'true' && hiUr.ok && UR.test(hiUr.txt),
             { confirm: r.txt.slice(0, 80), db: { preferred_language: field(dbUr.user, 'preferred_language'), locked: field(dbUr.user, 'language_locked') }, helloReply: hiUr.txt.slice(0, 80), helloUrdu: UR.test(hiUr.txt) }), t() - s);
  }

  if (want('LANG10')) {
    // LANG10 — Ask Anything in Urdu answers in Urdu
    s = t();
    await enterAskAnything(api);
    api.resetConversation();   // clean history → the open-chat prompt is deterministic → cassette replays
    r = await api.sendWait('بڑی کلاس کو سنبھالنے کے دو آسان طریقے بتائیں', 120000);
    rec('LANG10', 'Ask Anything answers an Urdu account in Urdu', ...V(r.ok && UR.test(r.txt) && r.txt.length > 40 && !/\(1-4\)/.test(r.txt), { reply: r.txt.slice(0, 100), len: r.txt.length }), t() - s);
  }

  if (want('LANG14')) {
    // LANG14 — /menu on an Urdu account renders Urdu. Inverted 2026-10-06: this was a @known-issue
    // that asserted the English leak, and failed once 6dc2cad6 ("menu: the front door speaks her
    // language") fixed it. Card text, opener and every row must now be Urdu.
    s = t();
    r = await api.sendWait('/menu');
    const menuList = r.btns.length ? await api.openList(r.btns.find(b => /See what I do|فہرست دیکھیں/.test(b)) || r.btns[0]) : { rows: [], all: '' };
    const rows14 = (menuList.rows || []).map((x) => x.trim()).filter(Boolean);
    const englishRows = rows14.filter((x) => !UR.test(x));
    const menuUrdu = r.ok && UR.test(r.txt) && r.btns.length > 0 && r.btns.every((b) => UR.test(b))
      && rows14.length > 0 && englishRows.length === 0;
    rec('LANG14', '/menu renders in Urdu on an Urdu account',
        ...V(menuUrdu, { card: r.txt.slice(0, 80), opener: r.btns, rows: rows14, englishRows }), t() - s);
    await api.closeDialog(); await sleep(800);
  }

  if (want('LANG15')) {
    // LANG15 — /status on an Urdu account answers in Urdu (the English leak was fixed 2026-09-08)
    s = t();
    r = await api.sendWait('/status');
    rec('LANG15', '/status answers in Urdu on an Urdu account',
        ...V(r.ok && UR.test(r.txt), { reply: r.txt.slice(0, 120), btns: r.btns, urdu: UR.test(r.txt) }), t() - s);
    await api.resetFlow();
  }

  if (want('LANG09')) {
    // LANG09 — /register on an Urdu account answers in Urdu. Inverted 2026-11-18 (bd-kbo9h0.7): it asserted the
    // old English bubble (a @known-issue), which the localised registration invite fixed.
    s = t();
    r = await api.sendWait('/register');
    rec('LANG09', '/register on an Urdu account answers in Urdu',
        ...V(r.ok && UR.test(r.txt) && !latinOnly(r.txt), { reply: r.txt.slice(0, 120), urdu: UR.test(r.txt) }), t() - s);
    await api.resetFlow();
  }

  if (want('LANG16')) {
    // LANG16 — Lesson Plans card + Pick-Class Flow on an Urdu account. Inverted 2026-11-18 (bd-kbo9h0.7): it now
    // asserts Urdu and FAILS while the Flow interior is English (known-findings.json lists it until the fix).
    s = t();
    r = await api.sendWait('/lp');
    const op = await api.openFlow('جماعت چنیں|Pick Class|شروع کریں|Browse');
    const fp = op.ok ? await api.flowProbe() : { text: '' };
    rec('LANG16', 'Lesson Plans via the Pick-Class Flow speaks Urdu on an Urdu account',
        op.ok ? V(UR.test(r.txt) && UR.test(fp.text) && !latinOnly(fp.text), { card: r.txt.slice(0, 80), cardUrdu: UR.test(r.txt), flowScreen: fp.text.slice(0, 120), flowEnglish: latinOnly(fp.text) })[0] : 'BLOCKED',
        op.ok ? { card: r.txt.slice(0, 80), cardUrdu: UR.test(r.txt), flowScreen: fp.text.slice(0, 120), flowEnglish: latinOnly(fp.text) } : { harness: op.err, card: r.txt.slice(0, 80), cardUrdu: UR.test(r.txt) }, t() - s);
    await api.resetFlow();
  }

  // LANG17/06/18 read the replies a step sends (fresh) and upload media: a lane without those records
  // them BLOCKED with the reason rather than throwing mid-suite (test_language_feature's fake bot).
  const canRead = typeof api.fresh === 'function' && typeof api.freshReset === 'function';
  const canUpload = canRead && typeof api.upload === 'function' && !!(api.caps && api.caps.upload);
  if (want('LANG17') && !canRead) {
    rec('LANG17', 'A Grade 1-5 lesson plan is the lesson\'s own PDF, in its book\'s language', 'BLOCKED',
        { reason: 'this lane cannot read the replies a Flow completion sends (no api.fresh)' }, 0);
  } else if (want('LANG17')) {
    // LANG17 — Grade 1-5 content language: the delivered PDF is the Urdu one when that row HAS an Urdu
    // file, else the English one. Judged against the row itself, so it stays right when Urdu PDFs land.
    s = t();
    await api.resetFlow(); await api.freshReset();
    await api.sendWait('/lp');
    const op17 = await api.openFlow('جماعت چنیں|Pick Class|شروع کریں|Browse');
    let doc17 = null;
    if (op17.ok) {
      for (const pick of ['Grade 1', 'English', 'Ch 1', 'Day 1']) {
        const c = await api.flowClick(pick, { settleMs: 2000 });
        if (!c.ok) break;
      }
      api.closeFlow();
      const t0 = Date.now();
      while (!doc17 && Date.now() - t0 < 120000) {
        doc17 = (await api.fresh()).find((m) => (m.pdf || m.doc) && m.media && m.media.filename) || null;
        if (!doc17) await sleep(1500);
      }
    }
    const file17 = (doc17 && doc17.media.filename) || '';
    // Grades 1-5 are served from the v8 corpus: one PDF per lesson, in its BOOK's language, whatever
    // the teacher's preference (lp-v8-delivery.service.js — preferred_language only labels the survey).
    // The old "Urdu PDF if pdf_r2_key_ur, else English" rule now applies only on the legacy fallback,
    // reached when a grade has no v8 assets. So an Urdu teacher picking Grade 1 English gets that
    // lesson's English plan, named after it.
    rec('LANG17', 'A Grade 1-5 lesson plan is the lesson\'s own PDF, in its book\'s language',
        ...(!op17.ok ? ['BLOCKED', { reason: 'the Pick-Class Flow did not open: ' + op17.err }]
            : V(/^Grade 1 English — Ch1 Day 1\b/.test(file17), { file: file17 || null })), t() - s);
    await api.resetFlow();
  }

  if (want('LANG06', 'LANG18') && !canUpload) {
    for (const [id, name] of [['LANG06', 'coaching transcription cannot re-language a locked account'],
                              ['LANG18', 'The coaching journey renders in Urdu on an Urdu account']])
      rec(id, name, 'BLOCKED', { reason: 'this lane cannot upload a classroom recording (no api.upload / caps.upload)' }, 0);
  } else if (want('LANG06', 'LANG18')) {
    // LANG06 + LANG18 — one real coaching upload on the Urdu-locked account. The audio-hash cache would
    // answer a recording this account already had analysed with the old report and transcribe nothing,
    // so archive the driver's own sessions first (cancel-stuck + reset-history, as coaching-ext does).
    s = t();
    try { api.db('cancel-stuck'); api.db('reset-history'); } catch (_) {}
    await api.resetFlow(); await api.freshReset();
    const MEDIA = require('path').resolve(__dirname, '..', '..', 'fixtures', 'whatsapp', 'niete', 'media');
    const up = await api.upload(require('path').join(MEDIA, 'hameeda_16min.m4a'), 'Audio', 180000);
    // The bot may speak first (a voice note) — wait for the detection card itself, the one with buttons.
    const seen = [{ txt: up.txt || '', btns: up.btns || [] }];
    let detect = (up.btns || []).length ? seen[0] : null;
    for (let w = 0; !detect && w < 60000; w += 1500) {
      for (const m of await api.fresh()) { seen.push({ txt: m.txt || '', btns: m.btns || [], audio: !!(m.audio || m.voice) }); }
      detect = seen.find((m) => (m.btns || []).length) || null;
      if (!detect) await sleep(1500);
    }
    const confirm = detect && detect.btns.find((b) => /Yes|ہاں|جی|تجزیہ/i.test(b));
    if (confirm) {
      const y = await api.tapAndWait(confirm, 120000);
      seen.push({ txt: y.txt || '', btns: y.btns || [] });
    }
    // Collect everything the pipeline sends until the photo prompt (transcription is done by then),
    // answer it "No", then keep reading until the reflective voice note or 6 minutes.
    const PHOTO = /📸/;
    const t0 = Date.now(); let declined = false, lpAnswered = false, voice = null;
    while (Date.now() - t0 < 480000 && !voice && !seen.some((m) => m.doc || m.img)) {
      for (const m of await api.fresh()) {
        seen.push({ txt: m.txt || '', btns: m.btns || [], audio: !!(m.audio || m.voice), doc: !!(m.doc || m.pdf), img: !!m.img });
        if ((m.audio || m.voice) && declined) voice = m;
      }
      const ph = seen.find((m) => PHOTO.test(m.txt));
      if (ph && !declined) {
        const no = (ph.btns || []).find((b) => /^(No|نہیں)/i.test(b));
        if (no) { const r2 = await api.tapAndWait(no, 120000); seen.push({ txt: r2.txt || '', btns: r2.btns || [] }); }
        declined = true;
      }
      // Then "do you have a lesson plan for this class?" — answer No so the analysis runs on the recording alone.
      const lpAsk = declined && !lpAnswered && seen.find((m) => /سبق کا منصوبہ|lesson plan/i.test(m.txt) && (m.btns || []).some((x) => /^(No|نہیں)$/.test(x)));
      if (lpAsk) {
        lpAnswered = true;
        const r3 = await api.tapAndWait(lpAsk.btns.find((x) => /^(No|نہیں)$/.test(x)), 120000);
        seen.push({ txt: r3.txt || '', btns: r3.btns || [] });
      }
      if (!voice) await sleep(2000);
    }
    const after = api.db('lookup');
    const transcribed = seen.some((m) => PHOTO.test(m.txt) || /Step [2-5]\/5/.test(m.txt));
    rec('LANG06', 'coaching transcription cannot re-language a locked account',
        ...(transcribed
            ? V(field(after.user, 'preferred_language') === 'ur' && field(after.user, 'language_locked') === 'true',
                { preferred_language: field(after.user, 'preferred_language'), locked: field(after.user, 'language_locked') })
            : ['BLOCKED', { reason: 'the coaching upload never reached transcription (no photo prompt or Step 2+)', seen: seen.slice(0, 6).map((m) => m.txt.slice(0, 80)) }]),
        t() - s);
    // LANG18 inverted 2026-10-06: it was a @known-issue asserting the detection card and the Step N/5
    // progress lines leak English on an Urdu account. They are Urdu now (مرحلہ 3/5), so the scenario
    // asserts the whole journey: every text the pipeline sends an Urdu teacher is Urdu, a progress step
    // is among them, and the reflective step arrives as a voice note.
    const texts = seen.filter((m) => (m.txt || '').trim());
    const englishTexts = texts.filter((m) => !UR.test(m.txt)).map((m) => m.txt.slice(0, 70));
    const step = texts.find((m) => /مرحلہ|Step \d/.test(m.txt));
    const photo = seen.find((m) => PHOTO.test(m.txt));
    rec('LANG18', 'The coaching journey renders in Urdu on an Urdu account',
        ...(photo
            ? V(englishTexts.length === 0 && !!step && UR.test(step.txt) && !!voice,
                { englishTexts, step: step && step.txt.slice(0, 60), reflectiveVoiceNote: !!voice,
                  journey: seen.map((m) => (m.audio ? '[voice] ' : m.doc ? '[doc] ' : m.img ? '[image] ' : '') + m.txt.slice(0, 60)) })
            : ['BLOCKED', { reason: 'the pipeline never reached the photo prompt', seen: seen.slice(0, 6).map((m) => m.txt.slice(0, 80)) }]),
        t() - s);
    try { api.db('cancel-stuck'); } catch (_) {}
    await api.resetFlow();
  }

  if (want('LANG12')) {
    // LANG12 — NL lesson-plan request answered in Urdu
    s = t();
    await enterAskAnything(api);
    api.resetConversation();   // clean history → the open-chat prompt is deterministic → cassette replays
    r = await api.sendWait('گریڈ 4 سائنس پانی کے چکر پر سبق کا منصوبہ بنا دیں', 120000);
    rec('LANG12', 'Lesson Plans via the natural-language path answers in the chosen language',
        ...V(r.ok && UR.test(r.txt) && !/\(1-4\)/.test(r.txt), { reply: r.txt.slice(0, 120), urdu: UR.test(r.txt), nudge: /\(1-4\)/.test(r.txt) }), t() - s);
  }

  if (want('LANG13')) {
    // LANG13 — the account is Urdu here: the training launcher (entry only) renders Urdu body + CTA
    s = t();
    r = await api.sendWait('/training');
    rec('LANG13', 'training entry launcher localized',
        ...V(r.ok && UR.test(r.txt) && (r.btns || []).includes('کھولیں'), { body: (r.txt || '').slice(0, 120), btns: r.btns, bodyUrdu: UR.test(r.txt) }), t() - s);
    await api.resetFlow();
  }

  if (want('LANG05')) {
    // LANG05 — a stale client replaying an off-offer row: the WRITER refuses it. Only a raw list reply can
    // reproduce this (no picker offers the row), so it runs where the driver can forge one — the mock lane.
    s = t();
    if (api.caps && api.caps.rawInject && typeof api.injectList === 'function') {
      const pre = api.db('lookup');
      const stale = await api.injectList('lang_pa-PK', 'پنجابی', 60000);
      const post = api.db('lookup');
      rec('LANG05', 'stale off-offer row rejected by the writer',
          ...V(/error updating your language preference/i.test(stale.txt || '') && field(post.user, 'preferred_language') === field(pre.user, 'preferred_language') && field(post.user, 'preferred_language') !== 'pa-PK',
               { reply: (stale.txt || '').slice(0, 120), before: field(pre.user, 'preferred_language'), after: field(post.user, 'preferred_language') }), t() - s);
    } else rec('LANG05', 'stale off-offer row rejected by the writer', 'BLOCKED', { reason: '@defensive — needs a raw list-reply replay; only the mock driver can forge one (caps.rawInject)' }, 0);
  }

  if (want('LANG07')) {
    // LANG07 — code-hygiene guard: no dead language-lock reader export (a source check, same on both lanes)
    s = t();
    {
      const fs = require('fs'), path = require('path');
      const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
      const lc = fs.readFileSync(path.join(ROOT, 'bot/shared/utils/language-cache.js'), 'utf8');
      const exported = /module\.exports\s*=\s*\{[\s\S]*?\bisUserLanguageLocked\b[\s\S]*?\}/.test(lc);
      const callers = [];
      const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        if (f.name === 'node_modules' || f.name === '__mocks__' || f.name.startsWith('.')) continue;
        const fp = path.join(d, f.name);
        if (f.isDirectory()) walk(fp);
        else if (/\.js$/.test(f.name) && !/\.test\.js$/.test(f.name) && !fp.endsWith('utils/language-cache.js')) { const src = fs.readFileSync(fp, 'utf8'); if (/\bisUserLanguageLocked\s*\(/.test(src)) callers.push(path.relative(ROOT, fp)); } } };
      walk(path.join(ROOT, 'bot'));
      rec('LANG07', 'no dead language-lock reader export',
          ...V(!exported || callers.length >= 1, { exported, callers, note: exported && !callers.length ? 'isUserLanguageLocked is exported again with zero callers in bot/ — the dead reader the spec removed (bd-2485) is back' : null }), t() - s);
    }
  }

  // restore the pre-run language via the surface under test
  s = t();
  // An unreadable baseline (lookup failed → '(not found)') is NOT a language: guessing one left the shared driver in Urdu
  // for the next run, and '(not found)' === '(not found)' reported that as a PASS (bd-7fsb6). Refuse, and say why.
  if (langBefore === 'en' || langBefore === 'ur') {
    await pickLanguage(api, langBefore === 'en' ? 'English' : 'اردو');
    const after = api.db('lookup');
    rec('LANG-restore', 'driver language restored to its pre-run value', field(after.user, 'preferred_language') === langBefore ? 'PASS' : 'FAIL',
        { before: langBefore, after: field(after.user, 'preferred_language') }, t() - s);
  } else {
    rec('LANG-restore', 'driver language restored to its pre-run value', 'FAIL',
        { before: langBefore, reason: 'baseline unknown — the DB lookup was unreadable (' + ((before && before.err) || 'no USER block') + '), so the pre-run language could not be read or restored; the driver is left as the run ended' }, t() - s);
  }

  // One call per id, not a loop over an array: check-scenario-coverage reads `fn('ID'` call sites,
  // and an id hidden inside an array literal looks unrecorded to it.
  const blocked = (id, name, why) => rec(id, name, 'BLOCKED', { reason: why }, 0);
  blocked('LANG11', '/observe renders content in Urdu', '@config-gated @seeded @persona:coach — needs a leader-role driver with a seeded school + roster; the lane\'s driver is a teacher');
  blocked('LANG20', 'LP keeps enqueue language across a mid-generation switch', '@wip @draft — needs a generation job long enough to switch language mid-flight; not deterministic on any lane');
  blocked('LANG21', 'off-market language clamped and logged', '@defensive — the off-market code arrives from transcription language detection, which has no client-side path to forge');

  await runNewTeacher({ api, rec, sleep, want });

  // ── bd-q8wt5e.6.3: the spoken scenarios, and the @wip/@draft ones given ids (one call per id, see above) ──
  const NOVOICE = 'needs a fixture voice note of a teacher %s plus its ASR, LLM and TTS cassettes; the lane\'s only spoken '
    + 'request (fixtures/whatsapp/niete/media/lp_request_voice.ogg) asks for a lesson plan. Recording one is a paid live '
    + 'call and needs an operator go (cassettes are replay-only on this lane)';
  if (want('LANG25')) blocked('LANG25', "A spoken question is answered with a voice message the teacher can speed up, in the teacher's language", NOVOICE.replace('%s', 'asking a teaching question'));
  if (want('LANG26')) blocked('LANG26', 'Saying "switch to Urdu" in a voice note switches the language, and the confirmation is itself an Urdu voice message', NOVOICE.replace('%s', 'saying "switch to Urdu"'));
  const WIP = '@wip @draft: not promoted to the lane (promotion is the spec owner\'s call, bd-q8wt5e)';
  if (want('LANG27')) blocked('LANG27', 'An Urdu line that opens with a name in English letters still reads right to left', WIP + '; an RTL mark is a rendering property the mock outbox carries as text only');
  if (want('LANG28')) blocked('LANG28', 'The "try it yourself" line in my quiz caption is in my language', WIP + '; @config-gated quiz caption');
  if (want('LANG29')) blocked('LANG29', "A coach reads the observation flow in the COACH's language, not the observed teacher's", WIP + '; needs a coach driver with a seeded school and an observed teacher (observe.feature owns that set-up)');
  if (want('LANG30')) blocked('LANG30', 'A refusal for a cancelled session is worded in my language', WIP);
  if (want('LANG32')) blocked('LANG32', 'The coaching ask after a lesson plan, and its recording instructions, arrive in my language', WIP + '; the ask follows a delivered plan on a daily clock');
  if (want('LANG33')) blocked('LANG33', 'A lesson-plan-born quiz that cannot be written says so in the teacher\'s language', WIP + '; needs a quiz generation that fails, scripted');
  if (want('LANG34')) blocked('LANG34', 'The afternoon quiz offer, and the list of classes it may show, arrive in my language', WIP + '; the offer is a scheduled nudge at the send hour');
  if (want('LANG35')) blocked('LANG35', 'A child whose quiz was in English and who writes English is answered in English', WIP + '; @persona:student @seeded — a child phone with a seeded quiz');
  if (want('LANG37')) blocked('LANG37', 'A child whose quiz was in English and who writes Roman Urdu is answered in Urdu script', WIP + '; @persona:student @seeded');
  if (want('LANG38')) blocked('LANG38', 'A one-letter answer keeps the chat\'s language', WIP + '; @persona:student @seeded');
  if (want('LANG39')) blocked('LANG39', 'A child whose quiz was in Urdu and who writes English is answered in English', WIP + '; @persona:student @seeded');
  if (want('LANG40')) blocked('LANG40', 'The "not sure" line before the menu is in my language', WIP);
  if (want('LANG41')) blocked('LANG41', 'A brand-new person whose first message is plainly English is answered in English, with the switch on', WIP + '; behind a first-message language switch');
  if (want('LANG42')) blocked('LANG42', "A brand-new person's first message without clear English evidence is answered in Urdu, as today", WIP + '; behind a first-message language switch');
  if (want('LANG43')) blocked('LANG43', 'A person who has messaged before keeps their stored Urdu for an English sentence', WIP + '; behind a first-message language switch');
  if (want('LANG44')) blocked('LANG44', 'A child answering an Urdu quiz wrong is told so in Urdu', '@draft: not promoted to the lane; @persona:student — a child phone with a seeded Urdu quiz');
};

// ── LANG23 / LANG24 / LANG31 (bd-q8wt5e.6.3): a brand-new number, as a new teacher really arrives. The shared driver
//    cannot be used: the bot caches its registration at stack start (registration.cjs line 1). The new number's
//    first message makes her account and brings the registration card; registration-itu.cjs seeds the QA school
//    (EMIS 215) the search must find and puts everything back. The stored v5.1 form, picked through by option id,
//    because every label after the first screen is in the language she chose.
const LATIN_COPY = /\b(Teacher|Principal|Search|Next|Finish|Grades?|Subjects?|Pick|school|Done|Role)\b/i;
async function runNewTeacher({ api, rec, sleep, want }) {
  const N23 = 'The registration Flow speaks the language she picks on its first screen';
  const N24 = 'The registration welcome and its portal button are in the language she chose';
  const N31 = 'A new teacher is offered Urdu first; English is only the emergency floor (D4)';
  if (!want('LANG23', 'LANG24', 'LANG31')) return;
  const itu = require('../registration-itu.cjs');
  const it = itu.makeItu({ api, sleep });
  const why = it.blocked();
  const R = (id, name, ...v) => { if (want(id)) rec(id, name, ...v); };
  if (why) { R('LANG23', N23, 'BLOCKED', { reason: why }, 0); R('LANG24', N24, 'BLOCKED', { reason: why }, 0); R('LANG31', N31, 'BLOCKED', { reason: why }, 0); return; }
  const s = Date.now();
  try {
    await it.setUp();
    const ph = itu.phonesFor(process.env.E2E_DRIVER || '0', 9);
    const u = api.as(ph.me);
    await u.freshReset();
    await u.sendWait('/register');
    const card = (await u.fresh()).reverse().find((i) => i.raw && i.raw.interactive && i.raw.interactive.type === 'flow');
    // LANG31 — the offer as she sees it: the first screen's language options in order, and the one pre-selected
    // (the endpoint's INIT fills both: languages + init_language). Read from the emulator's own probe, which keeps
    // `selected`. The other floor (DEFAULT_LANGUAGE 'en' when no language resolves at all) has no client path.
    const op = card ? await u.openFlow('Get started|شروع کریں', { from: card }) : { ok: false, err: 'no card' };
    const fl = op.ok && u.flow && u.flow();
    const opts = fl ? fl.probe().items.filter((i) => i.kind === 'option' && i.name === 'language') : [];
    const langs = opts.map((i) => i.id);
    const pre = (opts.find((i) => i.selected) || {}).id || null;
    R('LANG31', N31, ...V(op.ok && langs[0] === 'ur' && pre === 'ur',
      { card: !!card, opened: op.ok, err: op.err, languages: langs, preselected: pre,
        notChecked: 'the English emergency floor (language-cache DEFAULT_LANGUAGE) is only reached when no language resolves; unit: tests on languages.js offerDefaultLanguage' }), Date.now() - s);
    if (!want('LANG23', 'LANG24')) return;
    if (!card) { R('LANG23', N23, 'FAIL', { err: 'no registration card after her first message' }, Date.now() - s); R('LANG24', N24, 'BLOCKED', { reason: 'LANG23 had no card' }, 0); return; }
    if (!op.ok) { R('LANG23', N23, 'BLOCKED', { reason: 'Flow did not open: ' + op.err }, Date.now() - s); R('LANG24', N24, 'BLOCKED', { reason: 'Flow did not open' }, 0); return; }
    const footer = async () => { const p = await u.flowProbe(); const f = (p.items || []).find((i) => i.kind === 'footer'); return f ? u.flowClick(f.text, { exact: true, settleMs: 2500 }) : { ok: false, err: 'NO_FOOTER' }; };
    const optionOf = (p, name, pred) => (p.items || []).find((i) => i.kind === 'option' && i.name === name && (!pred || pred(i)));
    const screens = {};
    const name = 'Saima Bibi';
    await u.flowType(name, { field: 'full_name' });
    await u.flowClick('', { id: 'ur', settleMs: 300 });
    await footer();
    let p = await u.flowProbe(); screens.ROLE_SCHOOL = { screen: p.screen, text: p.text };
    const role = optionOf(p, 'role', (i) => String(i.id) === 'teacher') || optionOf(p, 'role');
    if (role) await u.flowClick('', { id: role.id, settleMs: 300 });
    await u.flowType('215', { field: 'school_query' });
    await footer();
    p = await u.flowProbe(); screens.SCHOOL_PICK = { screen: p.screen, text: p.text };
    const sch = optionOf(p, 'school_id', (i) => /G-7\/3-2/.test(i.text));
    if (sch) await u.flowClick('', { id: sch.id, settleMs: 300 });
    await footer();
    p = await u.flowProbe(); screens.TEACHING = { screen: p.screen, text: p.text };
    const gr = optionOf(p, 'grade'); const sub = optionOf(p, 'subjects');
    if (gr) await u.flowClick('', { id: gr.id, settleMs: 300 });
    if (sub) await u.flowClick('', { id: sub.id, settleMs: 300 });
    const me1 = await it.user(`phone_number=eq.${ph.me}`);   // the first screen's submit has written the language
    it.adopt(me1 && me1.id);
    const urdu = (x) => !!x && UR.test(x.text || '') && !LATIN_COPY.test((x.text || '').replace(/IMSG|EMIS|G-7\/3-2/g, ''));
    const allUrdu = ['ROLE_SCHOOL', 'SCHOOL_PICK', 'TEACHING'].every((k) => screens[k] && screens[k].screen === k && urdu(screens[k]));
    R('LANG23', N23, ...V(allUrdu && me1 && me1.preferred_language === 'ur' && me1.language_locked === true,
      { screens: Object.fromEntries(Object.entries(screens).map(([k, v]) => [k, { screen: v.screen, text: (v.text || '').slice(0, 160), urdu: urdu(v) }])),
        preferred_language: me1 && me1.preferred_language, language_locked: me1 && me1.language_locked }), Date.now() - s);
    if (!want('LANG24')) { u.closeFlow(); return; }
    const s24 = Date.now();
    await footer();                  // Finish
    await footer();                  // Done on SUCCESS (completes the Flow)
    u.closeFlow();
    const seen = [];
    for (let w = 0; w < 60000 && !seen.some((m) => /رجسٹریشن کا شکریہ/.test(m.txt || '')); w += 1000) { seen.push(...(await u.fresh())); await sleep(1000); }
    await sleep(1500); seen.push(...(await u.fresh()));
    const welcome = seen.find((m) => /رجسٹریشن کا شکریہ/.test(m.txt || ''));
    const btn = welcome ? ((welcome.cta && welcome.cta.text) || (welcome.btns || [])[0] || '') : '';
    R('LANG24', N24, ...V(!!welcome && welcome.txt.includes(`رجسٹریشن کا شکریہ، ${name.split(' ')[0]}!`) && /پورٹل کھولیں/.test(btn),
      { welcome: welcome ? welcome.txt.slice(0, 160) : null, button: btn, seen: seen.map((m) => (m.txt || '').slice(0, 80)) }), Date.now() - s24);
  } catch (e) {
    R('LANG23', N23, 'FAIL', { err: String(e.message || e).slice(0, 200) }, Date.now() - s);
    R('LANG24', N24, 'BLOCKED', { reason: 'LANG23 threw before the Flow finished: ' + String(e.message || e).slice(0, 120) }, 0);
  } finally {
    await it.tearDown();
  }
}

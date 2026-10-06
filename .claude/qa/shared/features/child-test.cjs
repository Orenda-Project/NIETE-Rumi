// @mock-lane — mock-capable driver (uses the mock API, not the browser DOM). Its presence enrols this feature in the mock lane; E2E_MOCK_FEATURES is derived from this marker, so there is no hardcoded list.
/* child-test.feature — mock-lane driver (bd-s1oo0.9). The coach's five-minute child test (/egra).
 *
 * SPEC AHEAD OF CODE. The feature is being built in lanes on `childtest-golive` (epic bd-s1oo0):
 * L3 draw/store, L4 conversation, L5 scoring, L6 check Flow. This driver checks, on the COMMIT UNDER
 * TEST (RUN_DIR/src, else this checkout), which lanes' files exist, and records every scenario whose
 * lane has not landed as BLOCKED "pending <lane>" — never a PASS it did not earn. When the code lands
 * the same ids are driven for real; nothing here needs rewriting except copy regexes if L4's
 * strings change (they are grounded in L4's ux-strings childTest* keys, 2026-10-02).
 *
 * DRIVEN once the code is present:
 *  · gate (text):  CT20 flag off (bot restarted without CHILD_TEST_ENABLED) · CT21 teacher denied
 *                  · CT22 region outside ICT
 *  · list (text + list):  CT09 /egra with no visit · CT10 aliases · CT03 list shape · CT11 reopen = same list
 *                  · CT12 absent → alternate promoted · CT29 done child / old button · CT30 no class list
 *  · per child (buttons + Attach → Audio / Photos & videos, fixture media from CHILD_TEST_FIXTURES_DIR):
 *                  CT04 present → Urdu script · CT05 three voice notes · CT06 maths strip photo
 *                  · CT15 photo after the next child started · CT16 no photo → force · CT23 voice in the
 *                  wrong state is not claimed · CT28 /cancel and /menu · CT19 Urdu copy
 *  · marks + check Flow (emulated; needs recorded cassettes for Soniox/OpenRouter and the stored
 *    CHILD_TEST_CHECK_FLOW_ID fixture): CT07 CT08 CT17 CT18 CT27 CT01
 *
 * BLOCKED with a stated reason even when the code is present:
 *  CT02 offer after observe2's brief — needs the observe2 field-form + check Flows walked first; their
 *       fixtures are not stored for the emulator yet.
 *  CT13 returning child — needs a child_test_sessions row ≥ 42 days old seeded for the SIM school.
 *  CT14 fallback cards — the mock cannot tell an album collage from separate images; counts only.
 *  CT24 early voice note — needs a forged WhatsApp timestamp earlier than the prompt.
 *  CT25 failed image send / CT26 DB save failure — needs fault injection on the media send / Supabase.
 *  CT31 no alternate left — consumes 3 extra SIM children per run; driven only with CT_DEEP=1.
 *  CT32 is @no-mock-driver (real pixels, real phone) and is never recorded here.
 *
 * DATA. The driver coach is assigned (leader_schools, school_ext_id `E2E-CT-<driver>`) to the sandbox
 * `SIM —` school seeded by scripts/child-test/seed-sandbox.js (L3), and the row is removed in this
 * file's finally. The draw ledger has no redraw path, so every run consumes SIM children for the
 * quarter — re-seed the SIM school (never a real school) when it runs dry. Children are referred to
 * by roll number in evidence; a child's displayName is never recorded.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const V = (c, ev) => [c ? 'PASS' : 'FAIL', ev];
const B = (reason) => ['BLOCKED', { reason }];

// Spec order; CT32 is @no-mock-driver and deliberately absent.
const SCENARIOS = [
  ['CT01', 'A coach tests five children after an observation, end to end, with timings recorded', 'L6'],
  ['CT02', 'The observe2 brief ends with the child-test offer, carrying the visit', 'L4'],
  ['CT03', "Today's list shows five drawn children by full name, the returning child marked, and two alternates", 'L3'],
  ['CT04', 'Tapping a present child sends the Urdu coach script with the exact cue phrase and waits for one voice note', 'L4'],
  ['CT05', "Each block's voice note is acknowledged at once, stored, scored off the critical path, and moves to the next block", 'L5'],
  ['CT06', 'The maths voice note is followed by the strip-photo ask, and the photo completes the child', 'L5'],
  ['CT07', "When a child's marks are in, a Check button opens a pre-filled check Flow", 'L6'],
  ['CT08', "Submitting the check saves the coach's marks and edits beside the AI marks, which never change", 'L6'],
  ['CT09', "/egra outside an observation opens today's list for the coach's school without asking what it can infer", 'L3'],
  ['CT10', 'The Urdu label and the aliases open the same list as /egra', 'L4'],
  ['CT11', "Reopening today's list shows the same children with their status — the list is never redrawn", 'L3'],
  ['CT12', 'An absent or refused child is recorded with its reason and the first alternate joins the list', 'L3'],
  ['CT13', 'The returning child reads Form B; new children read Form A', 'L3'],
  ['CT14', '"Letters & words" sends the fallback cards for a child who cannot read the first line', 'L4'],
  ['CT15', 'The strip photo can arrive after the next child has started', 'L4'],
  ['CT16', 'A strip photo that never comes is scored with force, written items left for the coach', 'L5'],
  ['CT17', 'Fields the model is not confident about arrive empty and must be answered before the check saves', 'L6'],
  ['CT18', 'The coach can check between children or in one batch at the end', 'L6'],
  ['CT19', "An Urdu coach gets the whole journey in Urdu, every interactive label within WhatsApp's caps", 'L4'],
  ['CT20', 'With the flag off, /egra is inert and falls through as ordinary chat', 'L4'],
  ['CT21', 'A teacher account is told the test is for coaches, and nothing is drawn', 'L4'],
  ['CT22', 'A coach outside the ICT region gets nothing — the command does not exist for them', 'L4'],
  ['CT23', 'A voice note sent when the child test is not waiting for one is not swallowed', 'L4'],
  ['CT24', "A voice note recorded before the next block's card was sent is not filed under that block", 'L4'],
  ['CT25', 'A stimulus image that fails to send falls back to the text version, logged at error', 'L4'],
  ['CT26', 'A save failure is told to the coach plainly, never swallowed', 'L4'],
  ['CT27', 'Scoring that is still running, or failed, is shown as pending — a check is never sent on missing marks', 'L5'],
  ['CT28', '/cancel and /menu work in every child-test state, and cancelling never releases a drawn child', 'L4'],
  ['CT29', 'A child already done cannot be retested, and an old list\'s button is refused politely', 'L4'],
  ['CT30', 'A school with no Grade 3 or Grade 5 class list is told what to do, not shown an empty list', 'L3'],
  ['CT31', 'An absent child with no alternate left is recorded, and the list carries on with fewer children', 'L3'],
  ['CT33', 'The list tells the coach which children to ask the class teacher for, by name in order, and "Send to teacher" sends them', 'L4'],
  ['CT34', 'Strip photos are claimed in list order, any time during the visit or as a batch at the end', 'L4'],
  ['CT35', 'One locked voice note keeps recording through card flips', 'L4'],
  ['CT36', 'Quick sums run for the one configured number of seconds', 'L4'],
  ['CT37', 'Three voice notes sent within seconds fill the three blocks in order, none overwritten', 'L4'],
  ['CT38', 'A fourth voice note for a child whose three notes are in is not stored', 'L4'],
  ['CT39', 'A voice note that fails to save frees its block, and the next voice note fills it first', 'L4'],
  ['CT40', 'A block costs the bot two messages with the printed card', 'L4'],
  ['CT41', 'A voice note saved just before Rumi restarts is still marked, and the check still arrives', 'L4'],
  ['CT42', 'A block that cannot be marked is retried, and after the last try the check still opens', 'L4'],
  ['CT43', 'In assist mode every mark Rumi made arrives filled, and the unsure ones are named', 'L6'],
  ['CT44', 'Kept separate from the observation by default: no offer after observe2, and /egra stands alone', 'L4'],
  ['CT45', 'A drawn child with no roll number is named on the list and through the test, and nothing breaks', 'L4'],
  ['CT46', "Two children with the same name are told apart by the roll, or by the father's name when neither has a roll", 'L4'],
  ['CT47', 'Strip photos sent out of order land on the children whose numbers they carry', 'L4'],
  ['CT48', 'A strip whose number cannot be read goes to the next child in order, and the reply says so', 'L4'],
  ['CT49', 'A number for a child whose strip is already in is not overwritten', 'L4'],
  ['CT50', 'The child number stays the same when a child is absent and an alternate steps in', 'L3'],
  ['CT61', 'The check message states only the numbers the form shows filled in, names the child, and promises two minutes', 'L6'],
  ['CT62', 'Without an observation, "Send to <name>" offers the drawn class\'s class teacher', 'L4'],
  ['CT63', 'A count typed in the check is accepted, in Latin or Urdu digits', 'L6'],
  // L26 (bd-s1oo0.46.2): the coach journey v2, the default since CONTRACT v0.14.
  ['CT80', 'v2 list — one message by classroom with Start and Send to teachers', 'L4'],
  ['CT81', 'v2 Send to teachers — each class teacher gets only their own room, in their own language', 'L4'],
  ['CT82', 'v2 before the first child — the setup picture, once per visit', 'L4'],
  ['CT83', 'v2 presence — "Child n of 5 · <name · class · teacher>" with the greeting to say', 'L4'],
  ['CT84', 'v2 steps — three plain-text messages, no buttons, the words to say in «quotes»', 'L4'],
  ['CT85', 'v2 auto-advance — the next child follows the third note', 'L5'],
  ['CT86', 'v2 end of the visit — minutes, results, one review', 'L5'],
  ['CT87', 'v2 unsent-draft nudge — once, 4 minutes after a step with no note', 'L4'],
  ['CT88', 'v2 resume — /egra mid-child says where the child is', 'L4'],
  // L28 (bd-s1oo0.46.4): the v2 end-of-visit review.
  ['CT90', 'After the last child, one form asks only the answers the recording did not settle', 'L6'],
  ['CT91', 'Submitting the review saves every child\'s marks once', 'L6'],
  ['CT92', 'Sending the review form a second time changes nothing', 'L6'],
  ['CT93', 'Nothing doubtful — no form, the visit is finished at once', 'L6'],
  ['CT94', 'More than 15 doubtful answers — the 15 least certain are asked', 'L6'],
  // L34 (bd-s1oo0.47, CONTRACT §20): ask only the questions the child reached.
  ['CT95', 'A child who read the whole story is asked every question, scored out of those asked', 'L5'],
  ['CT96', 'A child who stops early is asked only the questions they reached', 'L5'],
  ['CT97', 'A question asked beyond what the child read is kept but not scored', 'L5'],
  // L25 (bd-s1oo0.46.1): find the child without rolls — the v2 list, teachers, shift and term set.
  ['CT70', 'Today\'s list is grouped by classroom, each room with its class teacher, and no roll anywhere', 'L4'],
  ['CT71', '"Send to the teachers" sends each class teacher only their own room\'s children', 'L4'],
  ['CT72', 'A room with no reachable class teacher tells the coach to ask the head teacher', 'L4'],
  ['CT73', 'Class labels use the roster\'s own words', 'L4'],
  ['CT74', 'A same-name classmate is resolved by the father\'s name, or flagged with the count in the class', 'L4'],
  ['CT75', 'A school-grade with morning and evening classes is drawn from the morning shift only', 'L3'],
  ['CT76', 'Every child in a term reads the term\'s card set; a returning child never reads a set twice', 'L3'],
  // L36 (bd-s1oo0.50.2, CONTRACT §21.4): battery v3, one step and one voice note per task.
  ['CT51', 'v3 order — eighteen tasks per child, Urdu 5, English 5, Maths 8, one step and one note each', 'L4'],
  ['CT52', 'v3 timed step — practice first, then 🎤, the begin line, stop at 1:00, send at about 1:05', 'L4'],
  ['CT53', 'v3 untimed step — record the whole task, stop after 4 wrong in a row', 'L4'],
  ['CT54', 'v3 skip — "skip" stores the task as skipped by the coach and sends the next step', 'L4'],
  ['CT55', 'v3 gap — a task with no official items is skipped with an honest line', 'L4'],
  ['CT56', 'v3 nudge and resume name the task', 'L4'],
  // L39 (bd-s1oo0.50.5, CONTRACT §21.6): battery v3 results and the paged end-of-visit review.
  ['CT57', 'v3 results — one line per block per child, rates per minute, ≈ for provisional tasks', 'L4'],
  ['CT58', 'v3 review — the unsettled items, child by child, in pages of 15, saved once per task', 'L4'],
];
const NAME = Object.fromEntries(SCENARIOS.map(([id, n]) => [id, n]));

// What each lane puts on the commit (CONTRACT §1). A lane is "landed" when ALL its files exist.
const LANE_FILES = {
  L3: ['bot/shared/services/child-test/draw/index.js', 'bot/shared/services/child-test/store.js'],
  L4: ['bot/shared/handlers/child-test.handler.js', 'bot/shared/services/child-test/conversation/gate.js'],
  L5: ['bot/shared/services/child-test/scoring/index.js'],
  L6: ['bot/shared/routes/child-test-check-endpoint.js', 'docs/flows/child-test-check.json'],
};
// A scenario needs its own lane AND everything upstream of it in the coach's journey.
const NEEDS = { L3: ['L3', 'L4'], L4: ['L3', 'L4'], L5: ['L3', 'L4', 'L5'], L6: ['L3', 'L4', 'L5', 'L6'] };

/** Which lanes are on the commit under test. `root` = the bot's source tree. */
function lanesPresent(root) {
  const out = {};
  for (const [lane, files] of Object.entries(LANE_FILES)) out[lane] = files.every((f) => fs.existsSync(path.join(root, f)));
  return out;
}
function missingFor(lane, present) { return NEEDS[lane].filter((l) => !present[l]); }

// ── copy (L4 ux-strings childTest*, en + ur) ────────────────────────────────
const RX = {
  denyRole: /for coaches and school leaders|کوچ/i,
  list: /picked by the server|cannot be changed|آج کے بچے|Today's children/i,
  listHeader: /Grade\s*[35]|جماعت\s*[35]/,
  presence: /Is the child here|موجود/i,
  urduScript: /Child 1 of \d+ · .+ · Urdu 1\/3|بچہ 1 از \d+/,   // L19: the child's name sits between
  english: /English 2\/3|انگریزی 2\/3/,
  maths: /Maths 3\/3|(?:ریاضی|حساب) 3\/3/,
  ack: /🎧/,
  photoAsk: /strip \(Child no\.|photo of the strip|پٹی/i,
  photoSaved: /📷/,
  allIn: /All three parts|تینوں/i,
  noPhotoAck: /no strip photo|written sums stay blank|تصویر نہیں/i,
  absent: /marked absent|غیر حاضر درج/i,
  promoted: /from the alternates joins|متبادل/i,
  done: /already done today|مکمل/i,
  oldBtn: /older list|پرانی/i,
  closed: /Child test closed|بند/i,
  noClassList: /no Grade 3 or Grade 5 class list|\/roster/i,
  anyChildTest: /\/egra|Child \d+ of|بچوں کا ٹیسٹ|ctst_|Today's children|آج کے بچے/i,
};

exports.SCENARIOS = SCENARIOS;
exports.LANE_FILES = LANE_FILES;
exports.lanesPresent = lanesPresent;

exports.run = async ({ api, rec, stack: stackArg, root: rootArg, env: envArg, want = () => true }) => {
  const env = envArg || process.env;
  const repo = path.resolve(__dirname, '..', '..', '..');
  const root = rootArg || (env.RUN_DIR && fs.existsSync(path.join(env.RUN_DIR, 'src')) ? path.join(env.RUN_DIR, 'src') : repo);
  const present = lanesPresent(root);
  const done = new Set();
  const record = (id, verdict, ev, ms = 0) => { if (done.has(id)) return; done.add(id); rec(id, NAME[id], verdict, ev, ms); };
  const blockRest = (reason) => { for (const [id] of SCENARIOS) if (!done.has(id)) record(id, ...B(reason)); };

  // 1. Pending lanes: honest BLOCKED, nothing driven.
  for (const [id, , lane] of SCENARIOS) {
    const miss = missingFor(lane, present);
    if (miss.length) record(id, ...B(`pending ${miss.join('+')}: child-test code for ${miss.join(', ')} is not on the commit under test (${miss.map((l) => LANE_FILES[l][0]).join(', ')})`));
  }
  if (done.size === SCENARIOS.length) return;

  // 2. Stack + data preconditions. Anything missing blocks the remaining ids with the reason.
  let stack = stackArg;
  if (!stack) { try { stack = require('../stack-control.cjs'); } catch (_) { stack = null; } }
  const sbUrl = env.NIETE_SANDBOX_SUPABASE_URL, sbKey = env.NIETE_SANDBOX_SUPABASE_SERVICE_ROLE_KEY, driver = env.E2E_DRIVER;
  if (!stack || !stack.runDir || !stack.runDir()) return blockRest('no RUN_DIR: the CHILD_TEST_ENABLED switch is flipped with stack-control.restart, which needs a local stack (commit-e2e.sh)');
  if (!sbUrl || !sbKey || !driver) return blockRest('no sandbox creds (NIETE_SANDBOX_SUPABASE_*) or E2E_DRIVER — the SIM-school assignment and the DB assertions need them');
  if (/ihzciabopbttygxxgrkm|jlpenspfdcwxkopaidys/.test(sbUrl)) return blockRest('refused: the Supabase URL is a production project, not sandbox');

  const H = { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json' };
  const get = async (q) => { try { const r = await fetch(`${sbUrl}/rest/v1/${q}`, { headers: H }); return r.ok ? r.json() : []; } catch (_) { return []; } };
  const write = (m, q, body) => fetch(`${sbUrl}/rest/v1/${q}`, { method: m, headers: { ...H, Prefer: 'return=minimal' }, body: body ? JSON.stringify(body) : undefined }).catch(() => null);

  const [me] = await get(`users?select=id,region,preferred_language&phone_number=eq.${driver}`);
  if (!me) return blockRest('driver user not found in sandbox');
  const [sim] = await get(`schools?select=id,name,emis&is_probable_test=eq.true&name=like.SIM*&limit=1`);
  if (!sim) return blockRest('no SIM school in sandbox — run scripts/child-test/seed-sandbox.js (L3) first');
  const simExt = 'E2E-CT-' + driver;
  const assignSim = () => write('POST', 'leader_schools', { leader_user_id: me.id, school_ext_id: simExt, school_id: sim.id, school_name: sim.name, emis: sim.emis, source: 'niete_ict' });
  const unassignSim = () => write('DELETE', `leader_schools?school_ext_id=eq.${simExt}`);

  const fixtures = env.CHILD_TEST_FIXTURES_DIR || '';
  const media = (rel) => (fixtures && fs.existsSync(path.join(fixtures, rel)) ? path.join(fixtures, rel) : null);
  const firstChildDir = () => { try { return fs.readdirSync(path.join(fixtures, 'real')).filter((d) => !d.startsWith('.')).sort()[0] || null; } catch (_) { return null; } };
  const kid = fixtures ? firstChildDir() : null;
  const voice = (block) => (kid ? media(path.join('real', kid, block + '.ogg')) : null);
  const strip = () => { try { const f = fs.readdirSync(path.join(fixtures, 'strips')).filter((x) => /\.(jpe?g|png)$/i.test(x)).sort()[0]; return f ? path.join(fixtures, 'strips', f) : null; } catch (_) { return null; } };

  // One turn: everything the bot sent in reply, joined.
  const turn = async (fn) => { await api.freshReset(); const r = await fn(); const rest = await api.fresh(); return { r, txt: [r && r.txt, ...rest.map((m) => m.txt)].filter(Boolean).join('\n'), list: (r && r.list) || (rest.find((m) => m.list) || {}).list || null, all: [r, ...rest].filter(Boolean) }; };
  const rowsOf = (list) => (list && (list.rows || (list.sections || []).flatMap((s) => s.rows || []))) || [];
  // L19 (CONTRACT §18): the row title is the child's full name; the roll, when the roster has one, leads the description.
  const ROLL = /^(?:Roll|رول)\s*([\d۰-۹]+)/;
  const t = () => Date.now();
  let s;

  try {
    await api.resetFlow();
    // ── gate (text) ──
    if (!done.has('CT20') && want('CT20')) {
      s = t();
      const off = await stack.restart('bot', { CHILD_TEST_ENABLED: '' });
      if (!off || !off.ok) record('CT20', ...B('stack-control.restart(bot) failed: ' + JSON.stringify(off).slice(0, 120)));
      else { await api.setRole('coach'); const r = await turn(() => api.sendWait('/egra')); record('CT20', ...V(!RX.list.test(r.txt) && !RX.denyRole.test(r.txt), { reply: r.txt.slice(0, 160) }), t() - s); }
    }
    const on = await stack.restart('bot', { CHILD_TEST_ENABLED: 'true', CHILD_TEST_DRAW_SECRET: env.CHILD_TEST_DRAW_SECRET || 'e2e-mock-lane-only' });
    if (!on || !on.ok) return blockRest('could not restart the bot with CHILD_TEST_ENABLED=true: ' + JSON.stringify(on).slice(0, 120));

    if (!done.has('CT21') && want('CT21')) {
      s = t(); await api.setRole('teacher');
      const before = (await get(`child_test_draws?select=id&school_id=eq.${sim.id}`)).length;
      const r = await turn(() => api.sendWait('/egra'));
      const after = (await get(`child_test_draws?select=id&school_id=eq.${sim.id}`)).length;
      record('CT21', ...V(RX.denyRole.test(r.txt) && after === before, { reply: r.txt.slice(0, 160), drawsBefore: before, drawsAfter: after }), t() - s);
    }
    if (!done.has('CT22') && want('CT22')) {
      s = t(); await api.setRole('coach'); await api.setUser({ region: 'tanzania' });
      const r = await turn(() => api.sendWait('/egra'));
      await api.setUser({ region: me.region });
      record('CT22', ...V(!RX.list.test(r.txt) && !RX.denyRole.test(r.txt), { reply: r.txt.slice(0, 160) }), t() - s);
    }

    // ── CT30: a school with no class list (the observe roster seed has no classes) ──
    if (!done.has('CT30') && want('CT30')) {
      s = t(); await api.setRole('coach');
      const ro = await api.setRoster();
      if (!ro || !ro.ok) record('CT30', ...B('api.setRoster failed: ' + JSON.stringify(ro).slice(0, 120)));
      else { const r = await turn(() => api.sendWait('/egra')); record('CT30', ...V(RX.noClassList.test(r.txt) && !rowsOf(r.list).length, { reply: r.txt.slice(0, 160) }), t() - s); }
      await api.clearRoster();
    }

    // ── today's list ── everything below is one chain (list → children → marks → check). When the commit
    // selected none of it, stop here; the finally still unassigns the SIM school and restores the driver.
    if (!want(SCENARIOS.map(([id]) => id).filter((id) => !['CT20', 'CT21', 'CT22', 'CT30'].includes(id)))) return;
    await api.setRole('coach'); await unassignSim(); await assignSim();
    s = t();
    const L1 = await turn(() => api.sendWait('/egra'));
    const rows1 = rowsOf(L1.list);
    const main1 = rows1.filter((r) => /^ctst_child:/.test(r.id)), alt1 = rows1.filter((r) => /^ctst_alt:/.test(r.id));
    record('CT09', ...V(!!L1.list && main1.length > 0 && !/Which school/i.test(L1.txt), { rows: rows1.length }), t() - s);
    if (!L1.list) return blockRest('no list arrived for /egra — every list-dependent scenario needs it (reply: ' + L1.txt.slice(0, 120) + ')');
    const drawIds = main1.map((r) => r.id.split(':')[1]);
    const draws = drawIds.length ? await get(`child_test_draws?select=id,list_slot,last_listed_visit_id,draw_rank,status,form,sample_role&id=in.(${drawIds.join(',')})`) : [];
    record('CT03', ...V(main1.length === 5 && alt1.length === 2 && RX.list.test(L1.txt)
      && main1.every((r) => !!r.title && !ROLL.test(r.title) && !/null|undefined/.test(`${r.title} ${r.description || ''}`) && /New|Returning|نیا|دوبارہ/.test(r.description || ''))
      && draws.length === 5 && draws.every((d) => d.list_slot === 'main'),
      { main: main1.length, alternates: alt1.length, rolls: main1.map((r) => (ROLL.exec(r.description || '') || [])[1] || null), roles: draws.map((d) => d.sample_role) }), t() - s);

    s = t();
    const aliasSame = [];
    for (const cmd of ['بچوں کا ٹیسٹ', '/childtest']) { const r = await turn(() => api.sendWait(cmd)); aliasSame.push(JSON.stringify(rowsOf(r.list).map((x) => x.id)) === JSON.stringify(rows1.map((x) => x.id))); }
    record('CT10', ...V(aliasSame.every(Boolean), { aliasSame }), t() - s);

    // ── child 1: present → Urdu → English → maths (voice) → strip photo ──
    const tapChild = (row) => turn(() => api.pickRowAndWait(row.title));
    s = t();
    const c1 = main1[0];
    const p1 = await tapChild(c1);
    const pres = await turn(() => api.tapAndWait(p1.all.some((m) => (m.btns || []).includes('موجود')) ? 'موجود' : 'Present'));
    const [sess1] = await get(`child_test_sessions?select=id,status,timings,form&draw_id=eq.${drawIds[0]}`);
    record('CT04', ...V(RX.presence.test(p1.txt) && RX.urduScript.test(pres.txt) && !!sess1 && sess1.status === 'in_progress',
      { script: pres.txt.slice(0, 160), session: !!sess1 }), t() - s);

    // CT23 — a voice note in the wrong state is not claimed. Only meaningful before child 1's
    // Urdu block opens, so it is driven with the next child instead (see below).
    const v = { urdu: voice('urdu'), english: voice('english'), maths: voice('maths') };
    if (!v.urdu || !v.english || !v.maths) {
      for (const id of ['CT05', 'CT06', 'CT15', 'CT16', 'CT23', 'CT01', 'CT07', 'CT08', 'CT17', 'CT18', 'CT27'])
        record(id, ...B('no fixture voice notes: set CHILD_TEST_FIXTURES_DIR to golive/fixtures (real/<child>/{urdu,english,maths}.ogg); child audio never lives in git'));
    } else {
      s = t();
      const u = await turn(() => api.upload(v.urdu, 'Audio'));
      const e = await turn(() => api.upload(v.english, 'Audio'));
      const m = await turn(() => api.upload(v.maths, 'Audio'));
      const blocks1 = sess1 ? await get(`child_test_blocks?select=block,audio_r2_key,ai_status,ai_marks,ai_reason&session_id=eq.${sess1.id}`) : [];
      const urduRow = blocks1.find((b) => b.block === 'urdu') || {};
      record('CT05', ...V(RX.ack.test(u.txt) && RX.english.test(u.txt) && RX.ack.test(e.txt) && RX.maths.test(e.txt)
        && /\/urdu\.ogg$/.test(urduRow.audio_r2_key || ''), { urduAck: u.txt.slice(0, 80), urduKey: urduRow.audio_r2_key || null, urduStatus: urduRow.ai_status || null }), t() - s);

      const mathsRow = blocks1.find((b) => b.block === 'maths') || {};
      const pic = strip();
      if (!pic) record('CT06', ...B('no strip photo fixture under CHILD_TEST_FIXTURES_DIR/strips'));
      else {
        s = t();
        const ph = await turn(() => api.upload(pic, 'Photos & videos'));
        const [mb] = sess1 ? await get(`child_test_blocks?select=photo_r2_key,ai_status&session_id=eq.${sess1.id}&block=eq.maths`) : [];
        record('CT06', ...V(RX.photoAsk.test(m.txt) && !mathsRow.ai_marks && RX.photoSaved.test(ph.txt) && /maths-strip\.jpg$/.test((mb && mb.photo_r2_key) || ''),
          { ask: m.txt.slice(0, 120), mathsPendingBeforePhoto: mathsRow.ai_reason || mathsRow.ai_status || null, photoKey: (mb && mb.photo_r2_key) || null }), t() - s);
      }

      // child 2: CT23 (voice before the child starts), CT15 (child 1's photo arrives later is covered
      // by CT06 ordering on this lane), CT16 (no photo → force).
      const c2 = main1[1];
      if (c2) {
        s = t();
        const stray = await turn(() => api.upload(v.urdu, 'Audio'));
        const strayClaimed = RX.ack.test(stray.txt) && /Urdu|اردو/.test(stray.txt);
        record('CT23', ...V(!strayClaimed, { reply: stray.txt.slice(0, 160) }), t() - s);
        await api.freshReset();
        record('CT15', ...B('driven as order only: the mock lane sends child 1\'s photo before child 2 starts (CT06); the after-next-child order needs L4\'s per-session photo state exposed — drive on chrome'));
        s = t();
        await tapChild(c2); await turn(() => api.tapAndWait('Present'));
        await turn(() => api.upload(v.urdu, 'Audio')); await turn(() => api.upload(v.english, 'Audio')); await turn(() => api.upload(v.maths, 'Audio'));
        const np = await turn(() => api.tapAndWait('No strip photo'));
        const [sess2] = await get(`child_test_sessions?select=id&draw_id=eq.${drawIds[1]}`);
        const [mb2] = sess2 ? await get(`child_test_blocks?select=ai_status,ai_marks&session_id=eq.${sess2.id}&block=eq.maths`) : [];
        const written = (mb2 && mb2.ai_marks && mb2.ai_marks.maths && mb2.ai_marks.maths.written) || [];
        record('CT16', ...V(RX.noPhotoAck.test(np.txt) && !!mb2 && (mb2.ai_status === 'partial' || mb2.ai_status === 'scoring' || mb2.ai_status === 'pending')
          && written.every((w) => w.verdict === 'unreadable'), { ack: np.txt.slice(0, 120), mathsStatus: mb2 && mb2.ai_status }), t() - s);
      }

      // Marks + check Flow: need recorded vendor answers (Soniox/OpenRouter) and the stored Flow fixture.
      const flowFixture = path.join(repo, '.claude', 'qa', 'fixtures', 'flows', 'CHILD_TEST_CHECK_FLOW_ID.json');
      const scored = sess1 ? (await get(`child_test_blocks?select=ai_status&session_id=eq.${sess1.id}`)).filter((b) => b.ai_status === 'scored' || b.ai_status === 'partial').length : 0;
      if (!fs.existsSync(flowFixture)) {
        const noFlow = B('no stored check Flow: register CHILD_TEST_CHECK_FLOW_ID on the sandbox WABA (L6/L0), then bot/scripts/e2e/flow-inventory.js fetch');
        record('CT07', ...noFlow); record('CT08', ...noFlow); record('CT17', ...noFlow); record('CT18', ...noFlow); record('CT01', ...noFlow);
      }
      if (scored < 3) record('CT27', ...B(`child 1 has ${scored}/3 blocks scored on this lane — the vendor answers are not recorded (commit-e2e.sh --features child-test --record, sandbox only)`));
      if (fs.existsSync(flowFixture) && scored === 3) {
        s = t();
        const op = await api.openFlow('جانچ کریں|Check');
        const probe = op && op.ok ? await api.flowProbe() : { text: '' };
        record('CT07', ...V(!!(op && op.ok) && probe.screen === 'URDU', { open: op && (op.err || 'ok'), screen: probe.screen }), t() - s);
        const walk = B('check-Flow walk (untick a chip, edit a count, answer the empty fields, submit through DONE) is written once L6 publishes the field names to the stored fixture');
        record('CT08', ...walk); record('CT17', ...walk); record('CT18', ...walk); record('CT27', ...walk); record('CT01', ...walk);
      }
    }

    // ── /cancel and /menu never release a drawn child (also clears a child left mid-block) ──
    s = t();
    const statusBefore = await get(`child_test_draws?select=id,status&id=in.(${drawIds.join(',')})&order=id`);
    const cx = await turn(() => api.sendWait('/cancel'));
    const statusAfter = await get(`child_test_draws?select=id,status&id=in.(${drawIds.join(',')})&order=id`);
    record('CT28', ...V(RX.closed.test(cx.txt) && JSON.stringify(statusBefore) === JSON.stringify(statusAfter), { reply: cx.txt.slice(0, 120) }), t() - s);

    // ── reopen = same list, no redraw ──
    s = t();
    const L2 = await turn(() => api.sendWait('/egra'));
    const sameIds = rowsOf(L2.list).filter((r) => /^ctst_(child|alt):/.test(r.id)).map((r) => r.id.split(':')[1]);
    record('CT11', ...V(drawIds.length > 0 && drawIds.every((d) => sameIds.includes(d)), { firstList: drawIds.length, reopened: sameIds.length }), t() - s);

    // ── absent → reason saved, no session, first alternate promoted ──
    const c3 = main1[2], firstAlt = alt1[0];
    if (c3 && firstAlt) {
      s = t();
      await tapChild(c3);
      const ab = await turn(() => api.tapAndWait('Absent'));
      const [d3] = await get(`child_test_draws?select=status,attempts&id=eq.${drawIds[2]}`);
      const [sx] = await get(`child_test_sessions?select=id&draw_id=eq.${drawIds[2]}`);
      record('CT12', ...V(RX.absent.test(ab.txt) && RX.promoted.test(ab.txt) && !!d3 && d3.status === 'absent' && !sx, { reply: ab.txt.slice(0, 160), status: d3 && d3.status }), t() - s);
    } else record('CT12', ...B('the list had fewer than 3 children or no alternate'));

    // ── a done child is not retested; a stale button is refused ──
    const [d1] = await get(`child_test_draws?select=status&id=eq.${drawIds[0]}`);
    const [s1now] = sess1 ? await get(`child_test_sessions?select=status&id=eq.${sess1.id}`) : [];
    if (!(s1now && s1now.status === 'completed')) record('CT29', ...B('child 1 is not completed on this run (needs the fixture voice notes and strip photo), so "already done" cannot be asked'));
    else {
      s = t();
      const again = await tapChild(c1);
      await api.freshReset();
      await api.tapId('button', 'ctst_pres:00000000-0000-0000-0000-000000000000:p', 'Present');
      await new Promise((r) => setTimeout(r, 3000));
      const stale = (await api.fresh()).map((x) => x.txt).join('\n');
      const sessions1 = await get(`child_test_sessions?select=id&draw_id=eq.${drawIds[0]}`);
      record('CT29', ...V(RX.done.test(again.txt) && RX.oldBtn.test(stale) && sessions1.length === 1 && d1 && d1.status === 'tested',
        { again: again.txt.slice(0, 120), stale: stale.slice(0, 120) }), t() - s);
    }

    // ── Urdu coach: copy in Urdu; the mock rejects any over-cap field, so an arriving list proves caps ──
    s = t();
    await api.setUser({ preferred_language: 'ur' });
    const ur = await turn(() => api.sendWait('/egra'));
    record('CT19', ...V(!!ur.list && /[؀-ۿ]/.test(ur.txt) && !/Today's children/.test(ur.txt), { reply: ur.txt.slice(0, 120) }), t() - s);

    record('CT02', ...B('needs the observe2 field-form + check Flows walked to the brief; their fixtures are not stored for the emulator'));
    record('CT13', ...B('needs a child_test_sessions row ≥ 42 days old for the SIM school (no seed helper yet)'));
    record('CT14', ...B('the mock cannot tell an album collage from separate images; the ≤ 3-in-a-row rule is a chrome check'));
    record('CT24', ...B('needs a forged WhatsApp timestamp earlier than the English prompt; the mock stamps inbound messages now'));
    record('CT25', ...B('needs a failing media send; the mock has no fault injection on POST /media'));
    record('CT26', ...B('needs a failing Supabase write; the harness has no DB fault injection'));
    record('CT31', ...B(env.CT_DEEP === '1' ? 'CT_DEEP drive not written yet' : 'consumes 3 extra SIM children per run; set CT_DEEP=1'));
    // Five-minute protocol scenarios (L11): spec'd, drive not written yet — recorded honestly as BLOCKED.
    record('CT33', ...B('drive not written yet: needs the SIM class teacher to be the observed teacher and an outbound send to a second synthetic number'));
    record('CT34', ...B('drive not written yet: needs strip photos sent out of order across two children'));
    record('CT35', ...B('drive not written yet: a 4-minute fixture note per block (the guard is a unit test in tests/child-test/L11)'));
    record('CT36', ...B('drive not written yet: needs CHILD_TEST_QUICK_SUMS_SECONDS set on the local stack'));
    // Claim-before-store and printed-card scenarios (L13): proven on the L13 mock-lane runs and unit tests
    // (tests/child-test/L13); this driver does not send bursts yet — recorded honestly as BLOCKED.
    record('CT37', ...B('drive not written yet: needs three notes sent inside one store window (L13 sim-burst-mode.patch does it outside this driver)'));
    record('CT38', ...B('drive not written yet: needs a fourth note after all three blocks are claimed'));
    record('CT39', ...B('needs a failing R2 upload; the harness has no fault injection on the media store'));
    record('CT40', ...B('drive not written yet: needs per-block outbound send counts from the mock'));
    // Restart recovery and pre-fill modes (L17, L16): proven by tests/child-test/L17 + L16 and the L17 kill/restart mock run.
    record('CT41', ...B('needs the bot killed between audio_saved and scoring; done outside this driver by lanes/L17/killproof.sh'));
    record('CT42', ...B('needs a scorer that keeps failing; the harness has no fault injection on the scorer'));
    record('CT43', ...B('needs the local stack restarted with CHILD_TEST_PREFILL_MODE=assist'));
    // Separation (bd-s1oo0.25): proven by tests/child-test/L3b/machine-visit-key + L4 offer suites.
    record('CT44', ...B('needs the observe2 Flows stored for the emulator (as CT02) to drive the brief end'));
    // Names first (L19, CONTRACT §18): proven by tests/child-test/L19 on L3's real draw with roll-less rows.
    record('CT45', ...B('needs a SIM class seeded with roll-less register lines (seed-sandbox.js gives every child a roll)'));
    record('CT46', ...B('needs two SIM children with one name; the seeded placeholder names are unique'));
    // Child number on the strip (L20, bd-s1oo0.38): proven by tests/child-test/L20 (out-of-order batch, fallback,
    // no overwrite, stable numbers). The mock lane needs child-numbered strip fixtures (golive/fixtures/strips-childno)
    // mapped to the run's drawn children and a recorded OpenRouter cassette for the quick read.
    record('CT47', ...B('drive not written yet: needs strips-childno fixtures matched to the drawn children and an OpenRouter cassette for the child-number read'));
    record('CT48', ...B('drive not written yet: needs an empty-box strip fixture and an OpenRouter cassette'));
    record('CT49', ...B('drive not written yet: needs a second photo of a saved strip and an OpenRouter cassette'));
    record('CT50', ...B(env.CT_DEEP === '1' ? 'CT_DEEP drive not written yet' : 'consumes an alternate per run; set CT_DEEP=1'));
    // L21 (bd-s1oo0.27/.28): proven by tests/child-test/L21 (check-message, teacher-offer).
    record('CT61', ...B('needs recorded vendor answers and the stored check Flow fixture, as CT07'));
    record('CT62', ...B('drive not written yet: needs a SIM class_teachers row and an outbound send to a second synthetic number, as CT33'));
    // bd-s1oo0.43: proven by tests/child-test/L0/check-count-inputs.test.js; the client-side check needs a real WhatsApp client.
    record('CT63', ...B('client-side Flow validation only runs in a real WhatsApp client (Chrome lane); the endpoint half is jest-proven'));
    // L26 (bd-s1oo0.46.2): v2 is proven by tests/child-test/L26 (journey-v2 + integration-l3-v2). The v1
    // scenarios above are driven with CHILD_TEST_BATTERY=v1 on the stack; a v2 drive is not written yet.
    record('CT80', ...B('v2 drive not written yet: proven by tests/child-test/L26 (journey-v2, integration-l3-v2)'));
    record('CT81', ...B('v2 drive not written yet: proven by tests/child-test/L26 (journey-v2, integration-l3-v2)'));
    record('CT82', ...B('v2 drive not written yet: proven by tests/child-test/L26 (journey-v2, integration-l3-v2)'));
    record('CT83', ...B('v2 drive not written yet: proven by tests/child-test/L26 (journey-v2, integration-l3-v2)'));
    record('CT84', ...B('v2 drive not written yet: proven by tests/child-test/L26 (journey-v2, integration-l3-v2)'));
    record('CT85', ...B('v2 drive not written yet: proven by tests/child-test/L26 (journey-v2, integration-l3-v2)'));
    record('CT86', ...B('v2 drive not written yet: proven by tests/child-test/L26 (journey-v2, integration-l3-v2)'));
    record('CT87', ...B('v2 drive not written yet: proven by tests/child-test/L26 (journey-v2, integration-l3-v2)'));
    record('CT88', ...B('v2 drive not written yet: proven by tests/child-test/L26 (journey-v2, integration-l3-v2)'));
    // L28 (bd-s1oo0.46.4): proven by tests/child-test/L28 (review.test.js). The drive needs L26's end-of-visit
    // call to sendReview and the review Flow PUBLISHED on sandbox (CHILD_TEST_REVIEW_FLOW_ID); its submit is an nfm_reply.
    record('CT90', ...B('drive not written yet: needs L26 wiring and the review Flow published on sandbox; jest-proven in tests/child-test/L28'));
    record('CT91', ...B('drive not written yet: needs L26 wiring and the review Flow published on sandbox; jest-proven in tests/child-test/L28'));
    record('CT92', ...B('drive not written yet: needs L26 wiring and the review Flow published on sandbox; jest-proven in tests/child-test/L28'));
    record('CT93', ...B('drive not written yet: needs L26 wiring and the review Flow published on sandbox; jest-proven in tests/child-test/L28'));
    record('CT94', ...B('drive not written yet: needs L26 wiring and the review Flow published on sandbox; jest-proven in tests/child-test/L28'));
    // L34 (bd-s1oo0.47, CONTRACT §20): proven by tests/child-test/L34 (reach, comprehension-reach, step-reach,
    // coach-card-reach, review-reach). The drive needs fixtures of a child stopping before a question's line.
    record('CT95', ...B('drive not written yet: needs a full-story reader fixture and the review Flow on sandbox; jest-proven in tests/child-test/L34'));
    record('CT96', ...B('drive not written yet: needs an early-stop reader fixture and the review Flow on sandbox; jest-proven in tests/child-test/L34'));
    record('CT97', ...B('drive not written yet: needs an early-stop reader fixture with all 3 questions asked; jest-proven in tests/child-test/L34'));
    // L36 (bd-s1oo0.50.2): proven by tests/child-test/L36 (journey-v3). The drive needs the bot restarted with
    // CHILD_TEST_BATTERY=v3, L35's bank and V1.6.1 on sandbox, and 18 fixture notes per child (L39's synthetic_v3).
    record('CT51', ...B('v3 drive not written yet: needs CHILD_TEST_BATTERY=v3 on the stack and synthetic_v3 notes; jest-proven in tests/child-test/L36'));
    record('CT52', ...B('v3 drive not written yet: needs CHILD_TEST_BATTERY=v3 on the stack and synthetic_v3 notes; jest-proven in tests/child-test/L36'));
    record('CT53', ...B('v3 drive not written yet: needs CHILD_TEST_BATTERY=v3 on the stack and synthetic_v3 notes; jest-proven in tests/child-test/L36'));
    record('CT54', ...B('v3 drive not written yet: needs CHILD_TEST_BATTERY=v3 on the stack and synthetic_v3 notes; jest-proven in tests/child-test/L36'));
    record('CT55', ...B('v3 drive not written yet: needs CHILD_TEST_BATTERY=v3 on the stack and a bank with a gap task; jest-proven in tests/child-test/L36'));
    record('CT56', ...B('v3 drive not written yet: needs CHILD_TEST_BATTERY=v3 on the stack and a 4-minute wait; jest-proven in tests/child-test/L36'));
    record('CT57', ...B('v3 drive not written yet: needs CHILD_TEST_BATTERY=v3 and V1.6.1 on the stack and synthetic_v3 notes (coach.js --battery v3); jest-proven in tests/child-test/L39 + tests/e2e-mock/child-test-v3-visit'));
    record('CT58', ...B('v3 drive not written yet: needs CHILD_TEST_BATTERY=v3, V1.6.1 and CHILD_TEST_REVIEW_FLOW_ID on the stack; jest-proven in tests/child-test/L39 + tests/e2e-mock/child-test-v3-visit'));
// L25 (bd-s1oo0.46.1): proven by tests/child-test/L25 (draw-v2, list-identity, no-roll). The drive needs a SIM
    // roster with two sections, two class teachers, an evening class and a namesake pair.
    record('CT70', ...B('drive not written yet: needs a two-room SIM roster with class teachers, an evening class and a namesake pair; jest-proven in tests/child-test/L25'));
    record('CT71', ...B('drive not written yet: needs a two-room SIM roster with class teachers, an evening class and a namesake pair; jest-proven in tests/child-test/L25'));
    record('CT72', ...B('drive not written yet: needs a two-room SIM roster with class teachers, an evening class and a namesake pair; jest-proven in tests/child-test/L25'));
    record('CT73', ...B('drive not written yet: needs a two-room SIM roster with class teachers, an evening class and a namesake pair; jest-proven in tests/child-test/L25'));
    record('CT74', ...B('drive not written yet: needs a two-room SIM roster with class teachers, an evening class and a namesake pair; jest-proven in tests/child-test/L25'));
    record('CT75', ...B('drive not written yet: needs a two-room SIM roster with class teachers, an evening class and a namesake pair; jest-proven in tests/child-test/L25'));
    record('CT76', ...B('drive not written yet: needs a two-room SIM roster with class teachers, an evening class and a namesake pair; jest-proven in tests/child-test/L25'));
} finally {
    await unassignSim();
    try { await api.setUser({ preferred_language: me.preferred_language, region: me.region }); } catch (_) {}
    blockRest('not reached: an earlier step stopped the run');
  }
};

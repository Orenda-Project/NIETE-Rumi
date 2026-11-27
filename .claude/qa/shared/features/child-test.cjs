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
 * VOICE NOTES AND PHOTOS (bd-q8wt5e.6.1). Child speech never lives in git and is never recorded into a cassette. With
 * CHILD_TEST_FIXTURES_DIR unset, the notes and the strip photo are a synthetic stand-in (a tone, a blank card:
 * fixtures/whatsapp/niete/media/child-test/make-stand-in-fixtures.sh) and every scoring call for them is a scripted
 * vendor FAILURE (E2E_CASSETTE_FAULTS), never an invented transcript. So the conversation is driven for real (acks, the
 * next step, the stored keys, the photo landing, done, the visit end) and a scenario whose Thens include the marks
 * records its conversation half and stays BLOCKED on MARKS — a FAIL in that half is still a FAIL.
 *
 * v2 AND v3 (bd-q8wt5e.6.1). Each runs on its own synthetic coach (local database only): the visit key carries the
 * coach, so each gets a fresh draw at the SIM school. v2 (defaults, CHILD_TEST_STEP_NUDGE_MS=15000): CT81–CT88.
 * v3 (CHILD_TEST_BATTERY=v3): child 1 one note per task (CT51–CT53, CT56), child 2 the skip words (CT54).
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
  ['CT80', 'v2 list — one message by classroom with Start and Send to the teachers', 'L4'],
  ['CT81', 'v2 Send to the teachers — each class teacher gets only their own room, in their own language', 'L4'],
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
  // Any school (sa_any_school): the coach app's Learning assessment, not WhatsApp — never driven here, so always BLOCKED
  // (blockRest); driven in a browser on sandbox/staging, unit-tested in bot/tests/child-test/sa-any-school.test.js.
  ['CT98', 'A user on sa_any_school sees every live school with its EMIS and sector, and opens today\'s list at one they are not linked to', 'L4'],
  ['CT99', 'Without sa_any_school, or at a test or closed school, nothing changes', 'L4'],
  // Round 7b (27 Oct tester list): the coach app's assessment page and its results dashboard — browser pages, never
  // WhatsApp, so the mock lane records them BLOCKED (APP_ONLY below). CT108–CT114 were second copies of
  // CT101–CT104 until bd-q8wt5e.2 gave each its own id.
  ['CT100', 'Every skip and stop is one event record on the session', 'L4'],
  ['CT101', 'With sa_dash_filters on, the results dashboard\'s read carries each session\'s mode, coach and stops', 'L4'],
  ['CT102', 'With sa_dash_filters on, each session says whether its child came from the random draw or was added', 'L4'],
  ['CT108', 'Back on the item screens, in RDF auto and RDF manual, replaces the answer', 'L4'],
  ['CT110', 'Next waits until Jugnu has finished the instructions', 'L4'],
  ['CT103', 'The instructions say "say it, then press Next" (or Done), in Urdu and English', 'L4'],
  ['CT104', 'The story shows a down arrow while more of it is below', 'L4'],
  ['CT105', 'Missing number (typed): the instructions say to press the tick', 'L4'],
  ['CT106', 'The English letter sound of T is "ta"', 'L4'],
  ['CT109', 'The coach\'s End test is a tap and a question, and the ended child can be restarted', 'L4'],
  ['CT111', 'Coach-led End this section skips to the next section', 'L4'],
  ['CT112', 'RDF auto, no voice heard on a read-aloud part: a reminder and one repeat', 'L4'],
  ['CT113', 'RDF auto, a part the child does not finish: move on to the next subject', 'L4'],
  ['CT114', 'RDF auto, a finished part, a coach\'s stop, or the switch off: no move-on', 'L4'],
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
  // v2 default list (L25 list.buildListMessage): one buttons message, rooms with their class teacher, alternates last.
  listV2Head: /Grade\s*[35]\s*·\s*5 children/,
  listV2Room: /\*Grade\s*[35][^*]*\*\s*·\s*(?:Teacher:|ask the head teacher)/,
  listV2Alt: /Only if someone is absent:/,
  roll: /\bRoll\b|رول/,
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

/** Run scripts/child-test/seed-sandbox.js against the run's LOCAL database (idempotent; the seeder refuses
 *  production refs itself). Uses the run checkout's own copy and node_modules, so it seeds what the commit
 *  under test expects. */
function seedSimSchoolLocally(runDir, url, key) {
  const path = require('path'), fs = require('fs'), { execFileSync } = require('child_process');
  const src = path.join(runDir, 'src');
  const script = [path.join(src, 'scripts/child-test/seed-sandbox.js'), path.resolve(__dirname, '../../../../scripts/child-test/seed-sandbox.js')].find((f) => fs.existsSync(f));
  if (!script) return { ok: false, err: 'scripts/child-test/seed-sandbox.js not found' };
  try {
    execFileSync(process.execPath, [script, '--yes-write'], {
      cwd: src, timeout: 120000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key, DATABASE_URL: '',
             NODE_PATH: [path.join(src, 'bot/node_modules'), path.join(src, 'node_modules')].join(path.delimiter) },
    });
    return { ok: true };
  } catch (e) { return { ok: false, err: String((e.stderr || e.message || '')).trim().split('\n').slice(-1)[0].slice(0, 200) }; }
}

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
  // The coach app's assessment page and results dashboard (any-school picker, Round 7b): browser pages the mock lane
  // never opens — it drives the bot over WhatsApp. Recorded BLOCKED by name so each stays visible in every run.
  const APP_ONLY = 'the coach app\'s Learning assessment page / results dashboard, not WhatsApp: the mock lane never opens it — drive it in a browser on sandbox; unit-tested under dashboard/tests (sa-*)';
  record('CT98', ...B(APP_ONLY)); record('CT99', ...B(APP_ONLY));
  record('CT100', ...B(APP_ONLY)); record('CT101', ...B(APP_ONLY)); record('CT102', ...B(APP_ONLY));
  record('CT103', ...B(APP_ONLY)); record('CT104', ...B(APP_ONLY)); record('CT105', ...B(APP_ONLY)); record('CT106', ...B(APP_ONLY));
  record('CT108', ...B(APP_ONLY)); record('CT109', ...B(APP_ONLY)); record('CT110', ...B(APP_ONLY)); record('CT111', ...B(APP_ONLY));
  record('CT112', ...B(APP_ONLY)); record('CT113', ...B(APP_ONLY)); record('CT114', ...B(APP_ONLY));
  if (done.size === SCENARIOS.length) return;

  // 2. Stack + data preconditions. Anything missing blocks the remaining ids with the reason.
  let stack = stackArg;
  if (!stack) { try { stack = require(path.join(__dirname, '..', '..', 'engine', 'bin', 'stack-control.cjs')); } catch (_) { stack = null; } }
  const { url: sbUrl, key: sbKey } = require(path.join(__dirname, '..', '..', 'engine', 'bin', 'db-target.cjs')).dbCreds(env), driver = env.E2E_DRIVER;
  if (!stack || !stack.runDir || !stack.runDir()) return blockRest('no RUN_DIR: the CHILD_TEST_ENABLED switch is flipped with stack-control.restart, which needs a local stack (commit-e2e.sh)');
  if (!sbUrl || !sbKey || !driver) return blockRest('no sandbox creds (NIETE_SANDBOX_SUPABASE_*) or E2E_DRIVER — the SIM-school assignment and the DB assertions need them');
  if (/ihzciabopbttygxxgrkm|jlpenspfdcwxkopaidys/.test(sbUrl)) return blockRest('refused: the Supabase URL is a production project, not sandbox');

  const H = { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json' };
  const get = async (q) => { try { const r = await fetch(`${sbUrl}/rest/v1/${q}`, { headers: H }); return r.ok ? r.json() : []; } catch (_) { return []; } };
  const write = (m, q, body) => fetch(`${sbUrl}/rest/v1/${q}`, { method: m, headers: { ...H, Prefer: 'return=minimal' }, body: body ? JSON.stringify(body) : undefined }).catch(() => null);

  const [me] = await get(`users?select=id,region,preferred_language&phone_number=eq.${driver}`);
  if (!me) return blockRest('driver user not found in sandbox');
  let [sim] = await get(`schools?select=id,name,emis&is_probable_test=eq.true&name=like.SIM*&limit=1`);
  // On the local lane the database is this run's own, so the run seeds the SIM school itself with the same
  // seeder the sandbox was seeded with (bd-z3ze4.2). On the shared sandbox it stays an operator step.
  if (!sim && require(path.join(__dirname, '..', '..', 'engine', 'bin', 'db-target.cjs')).dbCreds(env).kind === 'local') {
    const seeded = seedSimSchoolLocally(stack.runDir(), sbUrl, sbKey);
    if (!seeded.ok) return blockRest('could not seed the SIM school on the local database: ' + seeded.err);
    [sim] = await get(`schools?select=id,name,emis&is_probable_test=eq.true&name=like.SIM*&limit=1`);
  }
  if (!sim) return blockRest('no SIM school in sandbox — run scripts/child-test/seed-sandbox.js (L3) first');
  const simExt = 'E2E-CT-' + driver;
  const assignSim = () => write('POST', 'leader_schools', { leader_user_id: me.id, school_ext_id: simExt, school_id: sim.id, school_name: sim.name, emis: sim.emis, source: 'niete_ict' });
  const unassignSim = () => write('DELETE', `leader_schools?school_ext_id=eq.${simExt}`);

  const fixtures = env.CHILD_TEST_FIXTURES_DIR || '';
  const media = (rel) => (fixtures && fs.existsSync(path.join(fixtures, rel)) ? path.join(fixtures, rel) : null);
  const firstChildDir = () => { try { return fs.readdirSync(path.join(fixtures, 'real')).filter((d) => !d.startsWith('.')).sort()[0] || null; } catch (_) { return null; } };
  const kid = fixtures ? firstChildDir() : null;
  // Without CHILD_TEST_FIXTURES_DIR the conversation scenarios ride a synthetic stand-in (a tone, a blank card;
  // fixtures/whatsapp/niete/media/child-test/make-stand-in-fixtures.sh): they check what the bot does with a note or a
  // photo, never the marks. Its scoring is answered by a scripted vendor failure (STAND_IN_FAULTS), never a transcript.
  const STAND_IN = path.resolve(__dirname, '..', '..', 'fixtures', 'whatsapp', 'niete', 'media', 'child-test');
  const standIn = (f) => (fs.existsSync(path.join(STAND_IN, f)) ? path.join(STAND_IN, f) : null);
  const voice = (block) => (kid ? media(path.join('real', kid, block + '.ogg')) : standIn('stand-in-note.ogg'));
  const strip = () => { try { const f = fs.readdirSync(path.join(fixtures, 'strips')).filter((x) => /\.(jpe?g|png)$/i.test(x)).sort()[0]; return f ? path.join(fixtures, 'strips', f) : standIn('stand-in-strip.jpg'); } catch (_) { return standIn('stand-in-strip.jpg'); } };
  const usingStandIn = !kid;
  // Child speech is never recorded into a cassette (sim-stack runs E2E_CASSETTE=off for it), so on this lane every
  // scoring call for the stand-in is a scripted vendor FAILURE: the product's own "could not mark" path, and no
  // E2E_CASSETTE_MISS. The scenarios that need real marks stay BLOCKED by name (MARKS below).
  const STAND_IN_FAULTS = [
    { kind: 'asr', match: '/./', times: 999, throw: 'e2e mock lane: child-test stand-in audio, scoring vendor answer is scripted to fail (child speech is never recorded)' },
    { kind: 'llm', match: '/child|strip|Child no|maths/i', times: 999, throw: 'e2e mock lane: child-test stand-in, scoring vendor answer is scripted to fail' },
  ];
  const MARKS = 'needs real marks: child speech is never recorded into a cassette, so on this lane every scoring call for the stand-in note is a scripted vendor failure — drive on sandbox with sim-stack.sh (E2E_CASSETTE=off, real models); jest-proven';

  // One turn: everything the bot sent in reply, joined.
  const turn = async (fn, a = api) => { await a.freshReset(); const r = await fn(); const rest = await a.fresh(); return { r, txt: [r && r.txt, ...rest.map((m) => m.txt)].filter(Boolean).join('\n'), list: (r && r.list) || (rest.find((m) => m.list) || {}).list || null, all: [r, ...rest].filter(Boolean), items: rest }; };
  const rowsOf = (list) => (list && (list.rows || (list.sections || []).flatMap((s) => s.rows || []))) || [];
  // L19 (CONTRACT §18): the row title is the child's full name; the roll, when the roster has one, leads the description.
  const ROLL = /^(?:Roll|رول)\s*([\d۰-۹]+)/;
  const t = () => Date.now();
  // The SIM school's class teachers (classes → class_teachers → users), whose numbers the bot messages on "Send to …".
  const simTeachers = async () => {
    const cls = await get(`classes?select=id&school_id=eq.${sim.id}`);
    if (!cls.length) return [];
    const ct = await get(`class_teachers?select=teacher_user_id&is_active=eq.true&class_id=in.(${cls.map((c) => c.id).join(',')})`);
    const ids = [...new Set(ct.map((x) => x.teacher_user_id))];
    return ids.length ? get(`users?select=id,phone_number,preferred_language&id=in.(${ids.join(',')})`) : [];
  };
  let s;
  const clones = [];   // synthetic coaches made for the v2/v3 visits (local database only); unassigned in finally

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

    // ── the default list (v2, CT80/CT09) ── v2 is the default journey since bd-s1oo0.46.2 (switches.js journeyV2):
    // /egra answers with ONE buttons message by classroom, never list rows. Driven first, on the stack's defaults.
    s = t();
    const L0 = await turn(() => api.sendWait('/egra'));
    const v2msg = L0.all.find((m) => RX.listV2Head.test(m.txt || '')) || null;
    const v2btns = (v2msg && v2msg.btns) || [];
    record('CT09', ...V(!!v2msg && RX.listV2Room.test(v2msg.txt) && !/Which school/i.test(L0.txt), { reply: L0.txt.slice(0, 120) }), t() - s);
    record('CT80', ...V(!!v2msg && RX.listV2Room.test(v2msg.txt) && RX.listV2Alt.test(v2msg.txt)
      && v2btns.length === 2 && v2btns[0] === 'Start' && /^Send to (?:the )?teachers$/.test(v2btns[1])
      && !rowsOf(L0.list).length && !RX.roll.test(L0.txt), { header: v2msg && v2msg.txt.split('\n')[0], buttons: v2btns, listRows: rowsOf(L0.list).length }), t() - s);

    // ── today's list, v1 ── every scenario from here on (CT03…CT30) is the v1 conversation: list rows, one-line
    // prompts, the strip photo. The spec brings it back with CHILD_TEST_BATTERY=v1 + CHILD_TEST_MATHS_MODE=strip
    // (child-test.feature, L26 header). The draw is never redrawn, so the v1 list shows the same children.
    const V1 = { CHILD_TEST_ENABLED: 'true', CHILD_TEST_DRAW_SECRET: env.CHILD_TEST_DRAW_SECRET || 'e2e-mock-lane-only', CHILD_TEST_BATTERY: 'v1', CHILD_TEST_MATHS_MODE: 'strip' };
    const v1 = await stack.restart('bot', V1);
    if (!v1 || !v1.ok) return blockRest('could not restart the bot with the v1 switches (CHILD_TEST_BATTERY=v1, CHILD_TEST_MATHS_MODE=strip): ' + JSON.stringify(v1).slice(0, 120));
    await stack.restart('worker', V1);   // the scorer reads the same switches; a worker that cannot restart is caught by CT05/CT16
    s = t();
    const L1 = await turn(() => api.sendWait('/egra'));
    const rows1 = rowsOf(L1.list);
    const main1 = rows1.filter((r) => /^ctst_child:/.test(r.id)), alt1 = rows1.filter((r) => /^ctst_alt:/.test(r.id));
    if (!L1.list) return blockRest('no v1 list arrived for /egra with CHILD_TEST_BATTERY=v1 + CHILD_TEST_MATHS_MODE=strip — every v1 list scenario needs it (reply: ' + L1.txt.slice(0, 120) + ')');
    const drawIds = main1.map((r) => r.id.split(':')[1]);
    const draws = drawIds.length ? await get(`child_test_draws?select=id,list_slot,last_listed_visit_id,draw_rank,status,form,sample_role&id=in.(${drawIds.join(',')})`) : [];
    record('CT03', ...V(main1.length === 5 && alt1.length === 2 && RX.list.test(L1.txt)
      && main1.every((r) => !!r.title && !ROLL.test(r.title) && !/null|undefined/.test(`${r.title} ${r.description || ''}`) && /New|Returning|نیا|دوبارہ/.test(r.description || ''))
      && draws.length === 5 && draws.every((d) => d.list_slot === 'main'),
      { main: main1.length, alternates: alt1.length, rolls: main1.map((r) => (ROLL.exec(r.description || '') || [])[1] || null), roles: draws.map((d) => d.sample_role) }), t() - s);

    s = t();
    const aliasSame = [];
    const aliasTurns = [];
    for (const cmd of ['بچوں کا ٹیسٹ', '/childtest']) { const r = await turn(() => api.sendWait(cmd)); aliasTurns.push(r); aliasSame.push(JSON.stringify(rowsOf(r.list).map((x) => x.id)) === JSON.stringify(rows1.map((x) => x.id))); }
    record('CT10', ...V(aliasSame.every(Boolean), { aliasSame }), t() - s);

    // ── CT62: no observation (CHILD_TEST_OBSERVE_LINK unset) → the drawn class's teacher is offered under the first list,
    // once (the alias reopens above sent no second offer); the tap sends that teacher ONE message in list order.
    s = t();
    const offerOf = (r) => r.items.find((m) => (m.btns || []).some((x) => /^Send to /.test(x))) || null;
    const offer = offerOf(L1);
    if (!offer) record('CT62', 'FAIL', { reason: 'no "Send to <name>" offer under the first list', after: L1.items.map((m) => String(m.txt || '').slice(0, 60)) }, t() - s);
    else {
      const reoffers = aliasTurns.filter((r) => !!offerOf(r)).length;
      const sendBtn = offer.btns.find((x) => /^Send to /.test(x));
      const sent = await turn(() => api.tapAndWait(sendBtn));
      const inbox = [];
      for (const tc of await simTeachers()) { const got = await api.as(tc.phone_number).fresh(); if (got.length) inbox.push({ lang: tc.preferred_language, msgs: got.map((m) => m.txt || '') }); }
      const names = main1.map((r) => String(r.title || '').replace(/\s*\(\d+ in this class\)\s*$/, ''));
      const body = (inbox[0] && inbox[0].msgs[0]) || '';
      const at = names.map((n) => body.indexOf(n));
      record('CT62', ...V(/^Send to \S+/.test(sendBtn) && reoffers === 0 && inbox.length === 1 && inbox[0].msgs.length === 1
        && at.every((x) => x >= 0) && at.every((x, i) => i === 0 || x > at[i - 1]) && /^Sent the order to .+\.$/m.test(sent.txt),
        { button: sendBtn, offer: String(offer.txt || '').slice(0, 120), reoffersOnAliasReopen: reoffers, teachersMessaged: inbox.length, messages: inbox[0] && inbox[0].msgs.length, inOrder: at, reply: sent.txt.slice(0, 120) }), t() - s);
    }

    // ── child 1: present → Urdu → English → maths (voice) → strip photo ──
    // By id: the list card can be many bubbles back by the time a later child is tapped (pickRowAndWait reads the last reply).
    const tapChild = (row) => turn(async () => { await api.tapId('list', row.id, row.title); await api.sleep(4000); return null; });
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
    // A scenario whose Thens include the marks: its conversation half is checked here; a FAIL there is a FAIL, and
    // when it holds the scenario stays BLOCKED on the marks (MARKS) with the conversation evidence beside the reason.
    const half = (id, ok, ev, ms) => (ok ? record(id, 'BLOCKED', { reason: MARKS, conversationHalf: 'held', ...ev }, ms) : record(id, 'FAIL', ev, ms));
    const isImg = (m) => !!(m && (m.img || m.type === 'image' || /image/.test(m.type || '')
      || (m.raw && m.raw.interactive && m.raw.interactive.header && m.raw.interactive.header.type === 'image')));
    // The list and presence lines flag a child whose first name the class shares with "(<n> in this class)" (L25);
    // the steps, the done line and the resume line name the child without it.
    const base = (n) => String(n || '').replace(/\s*\(\d+ in this class\)\s*$/, '').trim();
    if (!v.urdu || !v.english || !v.maths) {
      for (const id of ['CT05', 'CT06', 'CT14', 'CT15', 'CT16', 'CT23', 'CT40', 'CT01', 'CT07', 'CT08', 'CT17', 'CT18', 'CT27'])
        record(id, ...B('no voice-note fixture: neither CHILD_TEST_FIXTURES_DIR nor the stand-in under fixtures/whatsapp/niete/media/child-test (make-stand-in-fixtures.sh)'));
    } else {
      if (usingStandIn) { const f = await stack.faults(STAND_IN_FAULTS); if (!f || !f.ok) console.error('child-test: faults not written: ' + JSON.stringify(f)); }
      // ── CT14: "No printed card" on child 1's Urdu block — ≤ 3 card images, then the count line; the next tap the next 3
      s = t();
      const fb1 = await turn(() => api.tapAndWait('No printed card'));
      const fb2 = await turn(() => api.tapAndWait('No printed card'));
      const imgs1 = fb1.items.filter(isImg).length, imgs2 = fb2.items.filter(isImg).length;
      const cards1 = /Cards\s*1[–-]3 of (\d+)/.exec(fb1.txt), cards2 = /Cards\s*4[–-]6 of (\d+)|Cards\s*\d+[–-]\d+ of (\d+)/.exec(fb2.txt);
      const [ub0] = sess1 ? await get(`child_test_blocks?select=audio_r2_key&session_id=eq.${sess1.id}&block=eq.urdu`) : [];
      record('CT14', ...V(imgs1 >= 1 && imgs1 <= 3 && !!cards1 && imgs2 >= 1 && imgs2 <= 3 && !!cards2 && cards2[0] !== cards1[0] && !(ub0 && ub0.audio_r2_key),
        { tap1: { images: imgs1, line: cards1 && cards1[0] }, tap2: { images: imgs2, line: cards2 && cards2[0] }, urduAudioBeforeNote: (ub0 && ub0.audio_r2_key) || null, reply1: fb1.txt.slice(0, 120) }), t() - s);

      s = t();
      const u = await turn(() => api.upload(v.urdu, 'Audio'));
      // CT40: with the printed card (CHILD_TEST_INCHAT_CARDS not on), a block costs two messages: the ack and the next line.
      record('CT40', ...V(u.items.length === 2 && RX.ack.test(u.items[0].txt || '') && RX.english.test(u.items[1].txt || ''),
        { messages: u.items.length, texts: u.items.map((x) => String(x.txt || '').slice(0, 60)) }), t() - s);
      const e = await turn(() => api.upload(v.english, 'Audio'));
      const m = await turn(() => api.upload(v.maths, 'Audio'));
      await new Promise((r) => setTimeout(r, 2500));
      const blocks1 = sess1 ? await get(`child_test_blocks?select=block,audio_r2_key,ai_status,ai_marks,ai_reason&session_id=eq.${sess1.id}`) : [];
      const urduRow = blocks1.find((b) => b.block === 'urdu') || {};
      const mathsRow = blocks1.find((b) => b.block === 'maths') || {};
      const ev5 = { urduAck: u.txt.slice(0, 80), urduKey: urduRow.audio_r2_key || null, urduStatus: urduRow.ai_status || null, urduReason: urduRow.ai_reason || null };
      const ok5 = RX.ack.test(u.txt) && RX.english.test(u.txt) && RX.ack.test(e.txt) && RX.maths.test(e.txt) && /\/urdu\.ogg$/.test(urduRow.audio_r2_key || '');
      if (usingStandIn) half('CT05', ok5, ev5, t() - s); else record('CT05', ...V(ok5 && ['scored', 'partial'].includes(urduRow.ai_status), ev5), t() - s);

      // child 2 starts BEFORE child 1's strip photo: CT23 (a note while nothing waits for one), CT15 (child 1's photo
      // after child 2's Urdu note lands on child 1), CT06 (the ask, then the photo completes child 1), CT16 (no photo).
      const c2 = main1[1];
      const pic = strip();
      if (!c2 || !pic) {
        for (const id of ['CT06', 'CT15', 'CT16', 'CT23']) record(id, ...B(!c2 ? 'the list had fewer than 2 children' : 'no strip photo fixture (CHILD_TEST_FIXTURES_DIR/strips or the stand-in)'));
      } else {
        s = t();
        const stray = await turn(() => api.upload(v.urdu, 'Audio'));
        const strayClaimed = RX.ack.test(stray.txt) && /Urdu|اردو/.test(stray.txt);
        const keysAfterStray = sess1 ? (await get(`child_test_blocks?select=block,audio_r2_key&session_id=eq.${sess1.id}`)).map((b) => b.block + ':' + (b.audio_r2_key || '')).sort() : [];
        record('CT23', ...V(!strayClaimed && JSON.stringify(keysAfterStray) === JSON.stringify(blocks1.map((b) => b.block + ':' + (b.audio_r2_key || '')).sort()),
          { reply: stray.txt.slice(0, 160), child1KeysUnchanged: true }), t() - s);
        await api.freshReset();
        s = t();
        await tapChild(c2); await turn(() => api.tapAndWait('Present'));
        const u2 = await turn(() => api.upload(v.urdu, 'Audio'));
        const ph = await turn(() => api.upload(pic, 'Photos & videos'));
        await new Promise((r) => setTimeout(r, 1500));
        const [sess2] = await get(`child_test_sessions?select=id&draw_id=eq.${drawIds[1]}`);
        const [mb] = sess1 ? await get(`child_test_blocks?select=photo_r2_key,ai_status&session_id=eq.${sess1.id}&block=eq.maths`) : [];
        const b2 = sess2 ? await get(`child_test_blocks?select=block,audio_r2_key,photo_r2_key&session_id=eq.${sess2.id}`) : [];
        const c2photo = b2.some((b) => !!b.photo_r2_key), c2english = b2.find((b) => b.block === 'english');
        const ok15 = RX.ack.test(u2.txt) && RX.english.test(u2.txt) && /maths-strip\.jpg$/.test((mb && mb.photo_r2_key) || '') && !c2photo && !(c2english && c2english.audio_r2_key);
        const ev15 = { photoReply: ph.txt.slice(0, 200), child1PhotoKey: (mb && mb.photo_r2_key) || null, child2Photo: c2photo, child2EnglishAudio: !!(c2english && c2english.audio_r2_key) };
        // "📷 Strip no. 1 saved for <child 1>" needs a strip whose child number is READ; the blank stand-in has none, so
        // the read fails and the photo takes the next child in order (CT48's line). Where it lands is checked either way.
        if (usingStandIn && !/📷\s*Strip no\.\s*1\b/.test(ph.txt)) record('CT15', ...(ok15 ? ['BLOCKED', { reason: 'needs a strip photo whose child number can be read (CT47\'s strips-childno fixtures + an OpenRouter cassette): the blank stand-in has none, so the reply is the unreadable-number line; the photo did land on child 1 with child 2 still on English', ...ev15 }] : ['FAIL', ev15]), t() - s);
        else record('CT15', ...V(ok15 && /📷\s*Strip no\.\s*1\b/.test(ph.txt), ev15), t() - s);
        const ok6 = RX.photoAsk.test(m.txt) && !mathsRow.ai_marks && mathsRow.ai_status === 'pending' && [null, 'awaiting_photo'].includes(mathsRow.ai_reason || null) && RX.photoSaved.test(ph.txt) && RX.allIn.test(ph.txt)
          && /maths-strip\.jpg$/.test((mb && mb.photo_r2_key) || '');
        const ev6 = { ask: m.txt.slice(0, 160), mathsBeforePhoto: { status: mathsRow.ai_status || null, reason: mathsRow.ai_reason || null }, photoReply: ph.txt.slice(0, 160), photoKey: (mb && mb.photo_r2_key) || null };
        if (usingStandIn) half('CT06', ok6, ev6, t() - s); else record('CT06', ...V(ok6, ev6), t() - s);

        s = t();
        await turn(() => api.upload(v.english, 'Audio')); await turn(() => api.upload(v.maths, 'Audio'));
        const np = await turn(() => api.tapAndWait('No strip photo'));
        await new Promise((r) => setTimeout(r, 2500));
        const [mb2] = sess2 ? await get(`child_test_blocks?select=ai_status,ai_marks,ai_reason&session_id=eq.${sess2.id}&block=eq.maths`) : [];
        const written = (mb2 && mb2.ai_marks && mb2.ai_marks.maths && mb2.ai_marks.maths.written) || [];
        const ev16 = { ack: np.txt.slice(0, 120), mathsStatus: mb2 && mb2.ai_status, mathsReason: mb2 && mb2.ai_reason };
        if (usingStandIn) half('CT16', RX.noPhotoAck.test(np.txt) && !!mb2 && mb2.ai_reason !== 'awaiting_photo', ev16, t() - s);
        else record('CT16', ...V(RX.noPhotoAck.test(np.txt) && !!mb2 && mb2.ai_status === 'partial' && written.every((w) => w.verdict === 'unreadable'), ev16), t() - s);
      }

      // Marks + check Flow: need real marks and the stored Flow fixture.
      const flowFixture = path.join(repo, '.claude', 'qa', 'fixtures', 'flows', 'CHILD_TEST_CHECK_FLOW_ID.json');
      const scored = sess1 ? (await get(`child_test_blocks?select=ai_status&session_id=eq.${sess1.id}`)).filter((b) => b.ai_status === 'scored' || b.ai_status === 'partial').length : 0;
      if (!fs.existsSync(flowFixture)) {
        const noFlow = B('no stored check Flow: register CHILD_TEST_CHECK_FLOW_ID on the sandbox WABA (L6/L0), then bot/scripts/e2e/flow-inventory.js fetch');
        record('CT07', ...noFlow); record('CT08', ...noFlow); record('CT17', ...noFlow); record('CT18', ...noFlow); record('CT01', ...noFlow);
      }
      if (scored < 3) record('CT27', ...B(usingStandIn ? MARKS : `child 1 has ${scored}/3 blocks scored on this lane — the vendor answers are not recorded (commit-e2e.sh --features child-test --record, sandbox only)`));
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
    // CT28 is driven in its "Urdu block waiting" row (the state the known finding bd-q8wt5e.12 is about): with the voice
    // notes now driven, no child is left mid-block here, so child 4 is put on its Urdu block first.
    const c4 = main1[3];
    if (c4) { await tapChild(c4); await turn(() => api.tapAndWait('Present')); }
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

    await api.setUser({ preferred_language: me.preferred_language || 'en' });

    // ── the v2 journey (CT81–CT88) and battery v3 (CT51–CT56) ── each on its OWN synthetic coach: the visit key is
    // day:<coach>:<school>:<date>, so a second coach at the SIM school gets a fresh draw of 5 + 2 alternates while the
    // driver's v1 draw above stays as its scenarios left it. Created only on the run's own local database.
    const V2_IDS = ['CT81', 'CT82', 'CT83', 'CT84', 'CT85', 'CT86', 'CT87', 'CT88'];
    const V3_IDS = ['CT51', 'CT52', 'CT53', 'CT54', 'CT55', 'CT56'];
    const isLocal = require(path.join(__dirname, '..', '..', 'engine', 'bin', 'db-target.cjs')).dbCreds(env).kind === 'local';
    const cloneCoach = async (tag) => {
      const [row] = await get(`users?select=*&id=eq.${me.id}`);
      if (!row) return { err: 'driver row unreadable' };
      const phone = '9239' + String(Date.now()).slice(-7) + tag;
      const body = { ...row, phone_number: phone, preferred_language: 'en' };
      for (const k of ['id', 'created_at', 'updated_at']) delete body[k];
      const r = await fetch(`${sbUrl}/rest/v1/users`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(body) }).catch((e) => ({ ok: false, text: async () => e.message }));
      if (!r.ok) return { err: 'users insert: ' + String(await r.text()).slice(0, 160) };
      const [u] = await r.json();
      const ext = 'E2E-CT-' + phone;
      await write('POST', 'leader_schools', { leader_user_id: u.id, school_ext_id: ext, school_id: sim.id, school_name: sim.name, emis: sim.emis, source: 'niete_ict' });
      clones.push({ id: u.id, ext });
      return { user: u, phone, api: api.as(phone) };
    };
    const waitFor = async (a, re, ms) => { const end = Date.now() + ms; const seen = []; while (Date.now() < end) { await a.sleep(Math.min(15000, end - Date.now())); for (const m of await a.fresh()) { seen.push(m); if (re.test(m.txt || '')) return { hit: m, seen }; } } return { hit: null, seen }; };
    const noteOf = (a) => turn(() => a.upload(voice('urdu'), 'Audio'), a);
    const tapB = (a, label) => turn(() => a.tapAndWait(label), a);
    const sayB = (a, text) => turn(() => a.sendWait(text), a);

    if (want(V2_IDS)) {
      if (!isLocal) for (const id of V2_IDS) record(id, ...B('needs a second synthetic coach (a fresh visit and draw); created only on the run\'s own local database, never on the shared sandbox'));
      else if (!voice('urdu')) for (const id of V2_IDS) record(id, ...B('no voice-note fixture (stand-in missing)'));
      else {
        const V2 = { CHILD_TEST_ENABLED: 'true', CHILD_TEST_DRAW_SECRET: env.CHILD_TEST_DRAW_SECRET || 'e2e-mock-lane-only', CHILD_TEST_STEP_NUDGE_MS: '15000' };
        const r2 = await stack.restart('bot', V2); await stack.restart('worker', V2);
        const cb = r2 && r2.ok ? await cloneCoach('b') : { err: 'bot restart on the v2 defaults failed: ' + JSON.stringify(r2).slice(0, 100) };
        if (cb.err) for (const id of V2_IDS) record(id, ...B('could not set up the v2 coach: ' + cb.err));
        else {
          const b = cb.api;
          if (usingStandIn) await stack.faults(STAND_IN_FAULTS);
          const L = await sayB(b, '/egra');
          const listMsg = L.items.find((m) => RX.listV2Head.test(m.txt || '')) || {};
          const rooms = (String(listMsg.txt || '').match(/^\*[^*\n]+\*\s*·\s*(?:Teacher:|ask the head teacher)/gm) || []);
          const names = (String(listMsg.txt || '').match(/^\d+\.\s+(.+)$/gm) || []).map((x) => x.replace(/^\d+\.\s+/, '').replace(/\s*\(\d+ in this class\)$/, ''));
          const sawCheck = [];   // CT86: no per-child check during the visit
          const noteCheck = (r) => { for (const m of r.items) if (m.flow || /\bCheck\b|جانچ/.test((m.btns || []).join(' '))) sawCheck.push(String(m.txt || '').slice(0, 60)); return r; };

          // CT81 — Send to the teachers
          s = t();
          const teachers = await simTeachers();
          const tApis = teachers.map((tc) => ({ tc, ta: api.as(tc.phone_number) }));
          for (const { ta } of tApis) await ta.freshReset();   // CT62 already messaged the Grade 3 teacher
          const st = await tapB(b, 'Send to the teachers');
          const got = [];
          for (const { tc, ta } of tApis) { const out = await ta.fresh(); if (out.length) got.push({ teacher: tc.id, lang: tc.preferred_language, messages: out.length, children: (out[0].txt.match(/^\s*[\d۰-۹]+[.۔)]\s*(.+)$/gm) || []).length, ur: /[؀-ۿ]/.test(out[0].txt) }); }
          const ev81 = { reply: st.txt.slice(0, 120), rooms: rooms.length, teachersMessaged: got };
          const ok81 = /^Sent to .+\.$/m.test(st.txt) && got.length === rooms.length && got.every((g) => g.messages === 1 && g.ur === (g.lang !== 'en'));
          if (rooms.length < 2) record('CT81', 'BLOCKED', { reason: 'the SIM school seeds one classroom per grade (seed-sandbox.js), so the two-room Given is not met; the one-room send is in the evidence', oneRoomHeld: ok81, ...ev81 }, t() - s);
          else record('CT81', ...V(ok81, ev81), t() - s);

          // CT82 — Start: the setup picture once, "Start with <first name>"
          s = t();
          const sp = noteCheck(await tapB(b, 'Start'));
          const pic = sp.items.find(isImg) || sp.items.find((m) => /You need the \*/.test(m.txt || '')) || {};
          const startWith = (pic.btns || [])[0] || '';
          const okPic = isImg(pic) && /You need the \*(?:🟩 Green Grade 3|🟦 Blue Grade 5|Grade \d)\* cards/.test(pic.txt || '') && /^Start with \S+/.test(startWith) && (pic.btns || []).length === 1;
          // CT83 — presence: "Child 1 of 5 · <name · class · teacher>", the greeting, three buttons; Absent → reason, alternate, next prompt
          const pr = noteCheck(await tapB(b, startWith || 'Start with'));
          const presRe = /^\*Child (\d+) of (\d+) · (.+) · (.+) · Teacher: (.+)\*\nBefore recording, say:\n.*«.+»/m;
          const p1m = pr.items.find((m) => presRe.test(m.txt || '')) || {};
          const presOk = (m) => presRe.test(m.txt || '') && JSON.stringify(m.btns || []) === JSON.stringify(['Here, start', 'Absent', "Doesn't want to"]);
          const firstName = base((presRe.exec(p1m.txt || '') || [])[3]);
          const ab = noteCheck(await tapB(b, 'Absent'));
          const abTxt = ab.items.map((m) => m.txt || '').join('\n');
          const p2m = ab.items.find((m) => presRe.test(m.txt || '')) || {};
          record('CT83', ...V(presOk(p1m) && startWith === 'Start with ' + firstName.split(/\s+/)[0] && new RegExp(`${firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: absent\\.`).test(abTxt)
            && /joins today's children\./.test(abTxt) && presOk(p2m) && /^\*Child 1 of/.test(p2m.txt || '') && !ab.items.some((m) => m.list),
            { prompt: String(p1m.txt || '').split('\n')[0], buttons: p1m.btns, afterAbsent: abTxt.slice(0, 200) }), t() - s);

          // CT84 / CT88 / CT87 / CT85 — child 1 (the promoted line-up's first): three plain steps, resume mid-child, the nudge, auto-advance
          s = t();
          const childName = base((presRe.exec(p2m.txt || '') || [])[3]);
          const stepRe = (bn, part) => new RegExp(`^\\*${bn}\\/3 ${part} · ${childName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\*`, 'm');
          const plain = (m) => !(m.btns || []).length && !m.list && !m.flow;
          const banned = /\broll\b|child no\.|\bForm [AB]\b|\bstrip\b|\bphoto\b/i;
          const h = noteCheck(await tapB(b, 'Here, start'));
          const s1 = h.items.find((m) => stepRe(1, 'Urdu story').test(m.txt || '')) || {};
          const n1 = noteCheck(await noteOf(b));
          const s2 = n1.items.find((m) => stepRe(2, 'English story').test(m.txt || '')) || {};
          // CT88 — /egra on part 2: where the child is, Continue / Stop this child; Continue re-sends the English step
          const t88 = t();
          const rs = noteCheck(await sayB(b, '/egra'));
          const rsm = rs.items.find((m) => /is on part 2\/3 \(English/.test(m.txt || '')) || {};
          const co = noteCheck(await tapB(b, 'Continue'));
          const last = co.items[co.items.length - 1] || {};
          record('CT88', ...V(new RegExp(`^${childName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} is on part 2\\/3 \\(English`).test(rsm.txt || '') && JSON.stringify(rsm.btns || []) === JSON.stringify(['Continue', 'Stop this child'])
            && stepRe(2, 'English story').test(last.txt || '') && plain(last), { resume: rsm.txt || rs.txt.slice(0, 120), buttons: rsm.btns, resent: String(last.txt || '').split('\n')[0] }), t() - t88);
          const n2 = noteCheck(await noteOf(b));
          const s3 = n2.items.find((m) => stepRe(3, 'Maths').test(m.txt || '')) || {};
          const steps3 = [s1, s2, s3];
          record('CT84', ...V(steps3.every((m) => m.txt && plain(m) && !banned.test(m.txt)) && /«.+»/.test(s1.txt || '') && /«.+»/.test(s2.txt || '')
            && /pair \*A–D\*/.test(s3.txt || '') && /sum \*1–4\*/.test(s3.txt || '') && /word problem/i.test(s3.txt || '') && /🎧 Got it · Urdu/.test(n1.txt) && /🎧 Got it · English/.test(n2.txt),
            { titles: steps3.map((m) => String(m.txt || '').split('\n')[0]), buttons: steps3.map((m) => (m.btns || []).length), banned: steps3.map((m) => (banned.exec(m.txt || '') || [])[0] || null) }), t() - s);
          // CT87 — the maths step is the last bubble and no note comes: one nudge after CHILD_TEST_STEP_NUDGE_MS (15 s here), never repeated
          s = t();
          await b.freshReset();
          const nd = await waitFor(b, /Did the recording stop\?/, 80000);
          const again = await waitFor(b, /Did the recording stop\?/, 40000);
          record('CT87', ...V(!!nd.hit && stepRe(3, 'Maths').test(nd.hit.txt || '') && /Look for an unsent voice note above the keyboard and press send\. If it's gone, record this part again\./.test(nd.hit.txt || '') && !again.hit,
            { nudge: nd.hit && nd.hit.txt, repeated: !!again.hit, nudgeMs: 15000 }), t() - s);
          // CT85 — the maths note: scored at once, no photo; "✅ <name> done. Thank the child." above the next prompt
          s = t();
          const n3 = noteCheck(await noteOf(b));
          await new Promise((r) => setTimeout(r, 2000));
          const drawB = (await get(`child_test_sessions?select=id,status,draw_id&coach_user_id=eq.${cb.user.id}&order=created_at`));
          const sessB = drawB[0];
          const [mB] = sessB ? await get(`child_test_blocks?select=ai_status,ai_reason,photo_r2_key&session_id=eq.${sessB.id}&block=eq.maths`) : [];
          const doneMsg = n3.items.find((m) => /^✅ .+ done\. Thank the child\./.test(m.txt || '')) || {};
          record('CT85', ...V(!!mB && mB.ai_reason !== 'awaiting_photo' && mB.ai_status !== 'pending' && !/strip|photo/i.test(n3.txt) && n3.items.length === 1
            && new RegExp(`^✅ ${childName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} done\\. Thank the child\\.\\n\\n\\*Child 2 of`).test(doneMsg.txt || '') && presOk(doneMsg),
            { reply: String(doneMsg.txt || n3.txt).slice(0, 160), messages: n3.items.length, maths: mB || null, session: sessB && sessB.status }), t() - s);
          // CT82 (second half) — Start again later in the visit: no picture, the next child's prompt
          const sp2 = noteCheck(await turn(async () => { await b.tapId('button', 'ctst_start', 'Start'); await b.sleep(4000); return null; }, b));
          record('CT82', ...V(okPic && !sp2.items.some(isImg) && sp2.items.some((m) => presOk(m) && /^\*Child 2 of/.test(m.txt || '')),
            { caption: String(pic.txt || '').split('\n')[0], image: isImg(pic), button: startWith, secondStart: sp2.items.map((m) => String(m.txt || '').split('\n')[0]) }), t() - s);
          // CT86 — the rest of the visit: every child here, three notes each; the visit end once, no per-child check
          s = t();
          let endMsg = null, kids = 1;
          for (let k = 0; k < 6 && !endMsg; k++) {
            const hs = noteCheck(await tapB(b, 'Here, start'));
            if (!hs.items.some((m) => /^\*1\/3 /.test(m.txt || ''))) break;
            noteCheck(await noteOf(b)); noteCheck(await noteOf(b));
            const fin = noteCheck(await noteOf(b));
            kids += 1;
            endMsg = fin.items.find((m) => /^🎉 All \d+ children done \(\d+ min\)\. Thank the teachers\./.test(m.txt || '')) || null;
          }
          // the summary waits (off the critical path) for every child's marks; on this lane the stand-in's scoring fails
          // and is retried to its terminal state, so the summary comes after the retries (≤ ~3 min)
          const tail = endMsg ? await waitFor(b, /not scored|Results:|answers need your ear|—/, 240000) : { hit: null, seen: [] };
          const ev86 = { end: endMsg && endMsg.txt, children: kids, perChildChecks: sawCheck, summary: tail.hit ? String(tail.hit.txt).slice(0, 200) : null, after: tail.seen.length };
          if (!endMsg || sawCheck.length) record('CT86', 'FAIL', ev86, t() - s);
          else record('CT86', 'BLOCKED', { reason: MARKS + ' (the summary "once the marks are in" and the review need real marks)', conversationHalf: 'held', ...ev86 }, t() - s);
        }
      }
    }

    if (want(V3_IDS)) {
      if (!isLocal) for (const id of V3_IDS) record(id, ...B('needs a third synthetic coach (a fresh visit and draw); created only on the run\'s own local database, never on the shared sandbox'));
      else if (!voice('urdu')) for (const id of V3_IDS) record(id, ...B('no voice-note fixture (stand-in missing)'));
      else {
        const V3 = { CHILD_TEST_ENABLED: 'true', CHILD_TEST_DRAW_SECRET: env.CHILD_TEST_DRAW_SECRET || 'e2e-mock-lane-only', CHILD_TEST_BATTERY: 'v3', CHILD_TEST_STEP_NUDGE_MS: '15000' };
        const r3 = await stack.restart('bot', V3); await stack.restart('worker', V3);
        const cc = r3 && r3.ok ? await cloneCoach('c') : { err: 'bot restart with CHILD_TEST_BATTERY=v3 failed: ' + JSON.stringify(r3).slice(0, 100) };
        if (cc.err) for (const id of V3_IDS) record(id, ...B('could not set up the v3 coach: ' + cc.err));
        else {
          const c = cc.api;
          if (usingStandIn) await stack.faults(STAND_IN_FAULTS);
          await sayB(c, '/egra');
          const sp = await tapB(c, 'Start');
          const sw = ((sp.items.find((m) => (m.btns || []).some((x) => /^Start with /.test(x))) || {}).btns || [])[0];
          const pr = await tapB(c, sw || 'Start with');
          const presRe = /^\*Child (\d+) of (\d+) · (.+?) · /m;
          const pm = pr.items.find((m) => presRe.test(m.txt || '')) || {};
          const nm = base((presRe.exec(pm.txt || '') || [])[3]);
          const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const head = (blk, k, n, title, who = nm) => new RegExp(`^\\*${esc(who)}\\* · ${blk} ${k} of ${n} · ${esc(title)}`, 'm');
          const headOf = (m) => (m && /^\*.+?\* · ((?:Urdu|English|Maths) \d+ of \d+) · ([^\n]+)/m.exec(m.txt)) || null;
          const HARDER_ADD = /^(?:Harder addition|Addition, harder)$/;   // the step's title is the bank's ("Addition, harder")
          /** One child through the v3 battery. `act(title)` → null (send a note) or the text to type instead. */
          const runChild = async (who, act, onStep = async () => {}) => {
            const stepOf = (r) => r.items.filter((m) => new RegExp(`^\\*${esc(who)}\\* · (Urdu|English|Maths) \\d+ of \\d+ · `, 'm').test(m.txt || '') && !/Did the recording stop\?/.test(m.txt || '')).pop() || null;
            const o = { order: [], acks: [], gaps: [], typed: [], steps: {}, first: null, done: null, next: null };
            let cur = stepOf(await tapB(c, 'Here, start'));
            o.first = cur;
            for (let i = 0; i < 24 && cur; i++) {
              const hd = headOf(cur); if (!hd) break;
              o.order.push(hd[1] + ' · ' + hd[2]);
              if (!o.steps[hd[2]]) o.steps[hd[2]] = cur;
              await onStep(hd, cur);
              const typed = act(hd[2]);
              const nx = typed ? await sayB(c, typed) : await noteOf(c);
              const txt = nx.items.map((m) => m.txt || '').join('\n');
              if (typed) o.typed.push({ word: typed, title: hd[2], replies: nx.items.length, first: (nx.items[0] || {}).txt || '' });
              else o.acks.push({ task: hd[2], ok: new RegExp(`🎧 Got it · ${esc(hd[2])}`).test(txt), last: false });
              for (const g of txt.match(/⏭️ [^\n]+: not part of this test yet, so it is skipped\./g) || []) o.gaps.push(g);
              o.done = nx.items.find((m) => new RegExp(`^✅ ${esc(who)} done\\. Thank the child\\.`).test(m.txt || '')) || null;
              if (o.done) { if (!typed && o.acks.length) o.acks[o.acks.length - 1].last = true; o.next = base((presRe.exec(o.done.txt) || [])[3]) || null; }
              cur = o.done ? null : stepOf(nx);
            }
            return o;
          };
          // child 1: one note per step (CT51), the timed and untimed steps (CT52, CT53), the nudge and resume at Letters (CT56)
          let resume = null, nudge = null;
          const k1 = await runChild(nm, () => null, async (hd) => {
            if (hd[2] !== 'Letters' || !/^Urdu/.test(hd[1]) || nudge !== null) return;
            await c.freshReset();
            const nd = await waitFor(c, /Did the recording stop\?/, 80000);
            const rs = await sayB(c, '/egra');
            const co = await tapB(c, 'Continue');
            nudge = nd.hit || false;
            resume = { line: (rs.items.find((m) => /is on Urdu \d+ of \d+ \(Letters\)/.test(m.txt || '')) || {}), resent: co.items[co.items.length - 1] || {} };
          });
          const { order, acks, gaps, first, done } = k1;
          const letters = k1.steps.Letters || null;
          const bigger = k1.steps['Which is bigger'] || null;
          // child 2 (CT54): "skip" with no step open is not the child test's; «چھوڑیں», "next", «اگلا» on Urdu 1–3; "skip" at harder addition
          let k2 = null, idle = null;
          const k2seen = new Set();   // child 2 types each alias once: on Urdu 1–3 only, not on English's same-named tasks
          if (k1.next) {
            idle = await sayB(c, 'skip');
            const words = { Listening: 'چھوڑیں', Letters: 'next', 'Made-up words': 'اگلا' };
            k2 = await runChild(k1.next, (title) => (HARDER_ADD.test(title) ? 'skip' : (words[title] && !k2seen.has(title) ? (k2seen.add(title), words[title]) : null)));
          }
          const sessC = (await get(`child_test_sessions?select=id&coach_user_id=eq.${cc.user.id}&order=created_at&limit=1`))[0];
          const rowsC = sessC ? await get(`child_test_blocks?select=block,audio_r2_key,ai_status,ai_marks&session_id=eq.${sessC.id}`) : [];
          const want18 = [...Array(5)].map((_, i) => `Urdu ${i + 1} of 5`).concat([...Array(5)].map((_, i) => `English ${i + 1} of 5`), [...Array(8)].map((_, i) => `Maths ${i + 1} of 8`));
          const seenPos = order.map((o) => o.split(' · ')[0]);
          const gapCount = gaps.length;
          // CT51: every position in order (a gap task is named by its line instead of a step), one note each, the done line
          record('CT51', ...V(!!first && head('Urdu', 1, 5, 'Listening').test(first.txt || '') && !(first.btns || []).length
            && want18.filter((x) => seenPos.includes(x)).join('|') === seenPos.join('|') && seenPos.length + gapCount === 18 && acks.filter((a) => !a.last).every((a) => a.ok)
            && rowsC.filter((r) => r.audio_r2_key).length === seenPos.length && rowsC.filter((r) => r.audio_r2_key).every((r) => r.ai_status && r.ai_status !== 'pending') && !!done,
            { order, gaps, acks: acks.filter((a) => a.ok).length + '/' + acks.filter((a) => !a.last).length, scoringStarted: rowsC.filter((r) => r.audio_r2_key && r.ai_status !== 'pending').length, rows: rowsC.length, withAudio: rowsC.filter((r) => r.audio_r2_key).length, done: done && done.txt.split('\n')[0] }), 0);
          // CT52: the Urdu letters step (timed). The words to the child come verbatim from the item bank's script (spec,
          // L36 header), so the lines are read from the bank on the commit under test, not copied into this driver.
          const L52 = String((letters && letters.txt) || '').replace(/[\u2066-\u2069]/g, '');
          let sc = {}, practice = [];
          try { const bk = JSON.parse(fs.readFileSync(path.join(root, 'bot/shared/data/child-test/item-bank.v3.json'), 'utf8')); const ls = bk.sets.A.reading.ur.letters; sc = Object.fromEntries(Object.entries(ls.script || {}).map(([k, x]) => [k, (x && x.ur) || x])); practice = ls.practice || []; } catch (_) { sc = {}; }
          const q = (x) => `«${x}»`;
          record('CT52', ...V(!!sc.begin && /📖 Urdu booklet, page 1: letters/.test(L52) && L52.includes(`Before recording, say:\n   ${q(sc.intro)}`) && L52.includes(q(sc.instructions))
            && (!practice.length || /Practice row first \(not recorded\)/.test(L52)) && /Tap 🎤 and slide up to lock\./.test(L52) && L52.includes(q(sc.begin))
            && L52.includes(`Stuck for 3 seconds? Point to the next one and say:\n   ${q(sc.go_on)}`) && L52.includes(`At *1:00* on the mic, say:\n   ${q(sc.stop)}`)
            && /Send ➤ at about \*1:05\*\./.test(L52) && L52.includes(`_Nothing right in the first row? Say ${q(sc.early_stop || sc.stop)} and send._`),
            { bank: { begin: sc.begin, go_on: sc.go_on, stop: sc.stop, early_stop: sc.early_stop, practice: practice.length }, step: L52.slice(0, 900) }), 0);
          // CT53: which is bigger (untimed)
          const L53 = (bigger && bigger.txt) || '';
          record('CT53', ...V(/Maths 2 of 8 · Which is bigger/.test(L53) && /📖 Maths booklet Grade \d, page 2/.test(L53) && /Record the whole task\./.test(L53)
            && /«اگلا»/.test(L53) && /Stop after 4 wrong in a row/.test(L53) && !/1:00|1:05/.test(L53) && L53.indexOf('Practice') > -1 && L53.indexOf('Practice') < L53.indexOf('Record the whole task'),
            { step: L53.slice(0, 600) }), 0);
          // CT54: skip — "skip" at harder addition (child 2), the three aliases, and "skip" with no step open
          const sessC2 = k2 ? (await get(`child_test_sessions?select=id&coach_user_id=eq.${cc.user.id}&order=created_at&offset=1&limit=1`))[0] : null;
          const rows2 = sessC2 ? await get(`child_test_blocks?select=block,audio_r2_key,ai_status,ai_marks&session_id=eq.${sessC2.id}`) : [];
          const sk = k2 && k2.typed.find((x) => x.word === 'skip');
          const aliases = k2 ? k2.typed.filter((x) => x.word !== 'skip') : [];
          const skRow = rows2.find((r) => r.block === 'ma.add2') || {};
          const skippedRows = rows2.filter((r) => r.ai_marks && r.ai_marks.skipped_by_coach === true && !r.audio_r2_key).map((r) => r.block);
          if (!k2) record('CT54', ...B('child 1 did not finish on this run, so there was no next child to skip on'));
          else record('CT54', ...V(!!sk && new RegExp(`^⏭️ Skipped: ${esc(sk.title)}\\.\\n\\*${esc(k1.next)}\\* · Maths 7 of 8 · `).test(sk.first) && sk.replies === 1
            && !skRow.audio_r2_key && !!(skRow.ai_marks && skRow.ai_marks.skipped_by_coach)
            && aliases.length === 3 && aliases.every((x) => new RegExp(`^⏭️ Skipped: ${esc(x.title)}\\.\\n`).test(x.first) && x.replies === 1)
            && ['ur.listening', 'ur.letters', 'ur.nonwords'].every((b2) => skippedRows.includes(b2)) && !!idle && !/⏭️/.test(idle.txt),
            { skip: sk && sk.first.split('\n').slice(0, 2), aliases: aliases.map((x) => x.word + ' → ' + x.first.split('\n')[0]), idleSkip: idle && idle.txt.slice(0, 120),
              row: { block: skRow.block, audio: !!skRow.audio_r2_key, aiStatus: skRow.ai_status || null, marks: skRow.ai_marks || null }, skippedRows }), 0);
          // CT55: a gap task (only when the bank on this commit marks one)
          if (!gapCount) record('CT55', ...B('the item bank on this commit marks no v3 task as a gap, so there is nothing to skip'));
          else {
            const gRows = rowsC.filter((r) => r.ai_marks && r.ai_marks.gap);
            record('CT55', ...V(gRows.length === gapCount && gRows.every((r) => r.ai_marks.skipped_by_coach === true && !r.audio_r2_key), { gaps, rows: gRows.map((r) => r.block) }), 0);
          }
          // CT56
          const rl = (resume && resume.line && resume.line.txt) || '';
          record('CT56', ...V(!!nudge && head('Urdu', 2, 5, 'Letters').test(nudge.txt || '') && /Did the recording stop\?/.test(nudge.txt || '')
            && new RegExp(`^${esc(nm)} is on Urdu 2 of 5 \\(Letters\\)\\.`).test(rl) && JSON.stringify((resume.line && resume.line.btns) || []) === JSON.stringify(['Continue', 'Stop this child'])
            && head('Urdu', 2, 5, 'Letters').test((resume.resent && resume.resent.txt) || ''), { nudge: nudge && nudge.txt.split('\n')[0], resume: rl, resent: String((resume && resume.resent && resume.resent.txt) || '').split('\n')[0] }), 0);
        }
      }
    }

    record('CT02', ...B('needs the observe2 field-form + check Flows walked to the brief; their fixtures are not stored for the emulator'));
    record('CT13', ...B('needs a child_test_sessions row ≥ 42 days old for the SIM school (no seed helper yet)'));
    record('CT24', ...B('needs a forged WhatsApp timestamp earlier than the English prompt; the mock stamps inbound messages now'));
    record('CT25', ...B('needs a failing media send; the mock has no fault injection on POST /media'));
    record('CT26', ...B('needs a failing Supabase write; the harness has no DB fault injection'));
    record('CT31', ...B(env.CT_DEEP === '1' ? 'CT_DEEP drive not written yet' : 'consumes 3 extra SIM children per run; set CT_DEEP=1'));
    // Five-minute protocol scenarios (L11): spec'd, drive not written yet — recorded honestly as BLOCKED.
    record('CT33', ...B('needs an observe2 visit of the drawn class\'s teacher with CHILD_TEST_OBSERVE_LINK=true; the observe2 field-form and check Flows are not stored for the emulator (as CT02). The no-observation send is CT62'));
    record('CT34', ...B('drive not written yet: needs strip photos sent out of order across two children'));
    record('CT35', ...B('drive not written yet: a 4-minute fixture note per block (the guard is a unit test in tests/child-test/L11)'));
    record('CT36', ...B('drive not written yet: needs CHILD_TEST_QUICK_SUMS_SECONDS set on the local stack'));
    // Claim-before-store and printed-card scenarios (L13): proven on the L13 mock-lane runs and unit tests
    // (tests/child-test/L13); this driver does not send bursts yet — recorded honestly as BLOCKED.
    record('CT37', ...B('drive not written yet: needs three notes sent inside one store window (L13 sim-burst-mode.patch does it outside this driver)'));
    record('CT38', ...B('drive not written yet: needs a fourth note after all three blocks are claimed'));
    record('CT39', ...B('needs a failing R2 upload; the harness has no fault injection on the media store'));
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
    // bd-s1oo0.43: proven by tests/child-test/L0/check-count-inputs.test.js; the client-side check needs a real WhatsApp client.
    record('CT63', ...B('client-side Flow validation only runs in a real WhatsApp client (Chrome lane); the endpoint half is jest-proven'));
    // L28 (bd-s1oo0.46.4): proven by tests/child-test/L28 (review.test.js). The drive needs L26's end-of-visit
    // call to sendReview and the review Flow PUBLISHED on sandbox (CHILD_TEST_REVIEW_FLOW_ID); its submit is an nfm_reply.
    record('CT90', ...B('needs real marks — which answers are doubtful comes from the scorer, and child speech is never recorded into a cassette — and the review Flow stored for the emulator (no fixtures/flows/CHILD_TEST_REVIEW_FLOW_ID.json); the v2 visit end is driven in CT86; jest-proven in tests/child-test/L28'));
    record('CT91', ...B('needs real marks — which answers are doubtful comes from the scorer, and child speech is never recorded into a cassette — and the review Flow stored for the emulator (no fixtures/flows/CHILD_TEST_REVIEW_FLOW_ID.json); the v2 visit end is driven in CT86; jest-proven in tests/child-test/L28'));
    record('CT92', ...B('needs real marks — which answers are doubtful comes from the scorer, and child speech is never recorded into a cassette — and the review Flow stored for the emulator (no fixtures/flows/CHILD_TEST_REVIEW_FLOW_ID.json); the v2 visit end is driven in CT86; jest-proven in tests/child-test/L28'));
    record('CT93', ...B('needs real marks above every confidence bar; on this lane the stand-in\'s scoring is a scripted failure, so its parts read "not scored" (CT86 evidence); jest-proven in tests/child-test/L28'));
    record('CT94', ...B('needs real marks — which answers are doubtful comes from the scorer, and child speech is never recorded into a cassette — and the review Flow stored for the emulator (no fixtures/flows/CHILD_TEST_REVIEW_FLOW_ID.json); the v2 visit end is driven in CT86; jest-proven in tests/child-test/L28'));
    // L34 (bd-s1oo0.47, CONTRACT §20): proven by tests/child-test/L34 (reach, comprehension-reach, step-reach,
    // coach-card-reach, review-reach). The drive needs fixtures of a child stopping before a question's line.
    record('CT95', ...B('needs real marks — reach and the comprehension answers are read off the transcript, and child speech is never recorded into a cassette — plus a reader stopping before a question\'s line; jest-proven in tests/child-test/L34'));
    record('CT96', ...B('needs real marks — reach and the comprehension answers are read off the transcript, and child speech is never recorded into a cassette — plus a reader stopping before a question\'s line; jest-proven in tests/child-test/L34'));
    record('CT97', ...B('needs real marks — reach and the comprehension answers are read off the transcript, and child speech is never recorded into a cassette — plus a reader stopping before a question\'s line; jest-proven in tests/child-test/L34'));
    // L36/L39 (bd-s1oo0.50.2, .50.5): the v3 visit is driven above (CT51–CT56); the results and the review need marks.
    record('CT57', ...B('needs real marks for every task (rates, ≈ provisional, answers asked); on this lane the stand-in\'s scoring is a scripted failure; the v3 visit itself is driven in CT51–CT56; jest-proven in tests/child-test/L39 + tests/e2e-mock/child-test-v3-visit'));
    record('CT58', ...B('needs real marks (the unsettled items come from the scorer) and the review Flow stored for the emulator (no fixtures/flows/CHILD_TEST_REVIEW_FLOW_ID.json); jest-proven in tests/child-test/L39 + tests/e2e-mock/child-test-v3-visit'));
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
    for (const c of clones) await write('DELETE', `leader_schools?school_ext_id=eq.${c.ext}`);
    try { await api.setUser({ preferred_language: me.preferred_language, region: me.region }); } catch (_) {}
    blockRest('not reached: an earlier step stopped the run');
  }
};

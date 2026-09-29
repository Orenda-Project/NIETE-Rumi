#!/usr/bin/env node
/* language.cjs survives an Urdu account and an unreadable DB, on both lanes (bd-lu2p4, bd-7fsb6).
 *
 * Three defects, one trigger — the driver account being Urdu:
 *   · enterAskAnything() navigated with the English labels ('See what I do' → 'Ask Anything'). Once LANG03
 *     switches the account to Urdu the bot renders the menu in Urdu, so the mock lane threw "no list row
 *     titled Ask Anything" on every run and 16 of 22 scenarios never ran (bd-lu2p4).
 *   · The picker was opened with the English 'Languages' button. On an Urdu account the button is
 *     'زبانیں', so the live openList found no dialog, pickRowAndWait came back with no txt, and LANG02's
 *     r.txt.includes(...) threw (bd-7fsb6) — and the end-of-run restore to English could never succeed.
 *   · When the DB lookup is unreadable the baseline is '(not found)': the restore then picked Urdu
 *     (anything not 'en' → 'اردو'), left the shared driver in Urdu for the next run, and still recorded
 *     LANG-restore PASS because '(not found)' === '(not found)'.
 *
 * The feature's own run() executes end to end. Only its boundary — the `api` the runner hands it — is
 * faked, with each lane's real semantics: the live openList taps the opener by exact label and a failed
 * pick returns {ok:false} with no txt (feature-runner.cjs); the mock pickRowAndWait throws on a missing
 * row (mock-api.cjs). Labels come from the bot's own catalog, as the bot renders them.
 *
 * Run: node .claude/qa/shared/test_language_feature.js
 */
'use strict';
const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const { UX_STRINGS: UX } = require(path.join(ROOT, 'bot/shared/config/ux-strings.js'));
const feature = require(path.join(__dirname, 'features', 'language.cjs'));

const CONFIRM = {
  en: 'Language set to English. I will now respond in English.',
  ur: 'زبان اردو میں تبدیل ہو گئی۔ اب میں اردو میں جواب دوں گی۔',
};

function fakeBot({ lane, start, dbReadable }) {
  const st = { lang: start, list: null, dialog: null, calls: [] };
  const pickerTxt = () => (st.lang === 'ur'
    ? 'زبان منتخب کریں / Select Language\nکسی بھی وقت تبدیل کریں / change anytime'
    : 'Select Language / زبان منتخب کریں\nchange anytime / کسی بھی وقت تبدیل کریں');
  const reply = (txt, btns = []) => ({ ok: true, waitedMs: 1, txt, btns });
  const api = {
    st,
    async resetFlow() { st.list = null; st.dialog = null; },
    resetConversation() {},
    async closeDialog() { st.dialog = null; return true; },
    async sleep() {},
    db(action) {
      if (action !== 'lookup' || !dbReadable) return { ok: false, err: 'no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY for env=sandbox.' };
      return { ok: true, out: '', user: 'USER: ' + JSON.stringify([{ preferred_language: st.lang, language_locked: 'true' }], null, 1) };
    },
    async sendWait(text) {
      st.calls.push(text);
      const t = String(text).trim().toLowerCase();
      if (t === '/language') {
        st.list = { opener: UX.languagePickerButton[st.lang], rows: ['اردو', 'English'], kind: 'language' };
        return reply(pickerTxt(), [UX.languagePickerButton[st.lang]]);
      }
      if (t === '/menu') {
        st.list = { opener: UX.menuButton[st.lang], rows: [UX.menuRowOtherTitle[st.lang]], kind: 'menu' };
        return reply(st.lang === 'ur' ? 'میں یہ سب کر سکتی ہوں' : 'Here is what I can do', [UX.menuButton[st.lang]]);
      }
      return reply(st.lang === 'ur' ? 'یہ ایک تفصیلی اردو جواب ہے جو چالیس حروف سے زیادہ لمبا ہے تاکہ جانچ ہو سکے' : 'Sorry, I can help with teaching questions in English.');
    },
    async openList(opener) {
      const l = st.list;
      if (!l) return { ok: false, err: 'NO_DIALOG', tap: { ok: false, opener } };
      if (lane === 'live' && opener !== l.opener) return { ok: false, err: 'NO_DIALOG', tap: { ok: false, opener } };
      st.dialog = l;
      return { ok: true, rows: l.rows.slice(), all: l.rows.join('\n') };
    },
    async pickRowAndWait(row) {
      const l = lane === 'live' ? st.dialog : st.list;
      if (!l || !l.rows.includes(row)) {
        if (lane === 'mock') throw new Error(`HARNESS mock-api: no list row titled ${JSON.stringify(row)} on any recent reply (rows=${JSON.stringify(l && l.rows)})`);
        return { ok: false, err: 'NO_SEND_ICON', picked: false };
      }
      st.dialog = null;
      if (l.kind === 'language') { st.lang = row === 'English' ? 'en' : 'ur'; return reply(CONFIRM[st.lang]); }
      return reply(st.lang === 'ur' ? 'کچھ بھی پوچھیں' : 'Ask me anything');
    },
    async openFlow() { return { ok: false, err: 'NO_FRESH_CTA' }; },
    async flowProbe() { return { text: '' }; },
  };
  return api;
}

async function drive(opts) {
  const api = fakeBot(opts);
  const recs = {};
  const rec = (id, name, verdict, evidence) => { recs[id] = { verdict, evidence }; };
  let error = null;
  try { await feature.run({ api, rec, sleep: async () => {} }); } catch (e) { error = e; }
  return { recs, error, finalLang: api.st.lang };
}

const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test('mock lane, English start: the Urdu half of the suite runs (no throw at Ask Anything) and restores English', async () => {
  const r = await drive({ lane: 'mock', start: 'en', dbReadable: true });
  assert.strictEqual(r.error, null, 'run threw: ' + (r.error && r.error.message));
  for (const id of ['LANG03', 'LANG10', 'LANG12', 'LANG-restore']) assert.ok(r.recs[id], id + ' never recorded');
  assert.strictEqual(r.recs['LANG-restore'].verdict, 'PASS');
  assert.strictEqual(r.finalLang, 'en');
});

test('live lane, English start, DB readable: the restore reaches English from an Urdu account', async () => {
  const r = await drive({ lane: 'live', start: 'en', dbReadable: true });
  assert.strictEqual(r.error, null, 'run threw: ' + (r.error && r.error.message));
  assert.strictEqual(r.finalLang, 'en', 'driver left in ' + r.finalLang);
  assert.strictEqual(r.recs['LANG-restore'].verdict, 'PASS');
});

test('live lane, Urdu start (left over by a previous run): no TypeError, LANG02 is recorded', async () => {
  const r = await drive({ lane: 'live', start: 'ur', dbReadable: true });
  assert.strictEqual(r.error, null, 'run threw: ' + (r.error && r.error.message));
  assert.ok(r.recs.LANG02, 'LANG02 never recorded');
});

test('DB unreadable: the restore never guesses a language and never reports PASS', async () => {
  for (const lane of ['live', 'mock']) {
    const r = await drive({ lane, start: 'en', dbReadable: false });
    assert.strictEqual(r.error, null, lane + ' run threw: ' + (r.error && r.error.message));
    assert.ok(r.recs['LANG-restore'], lane + ': LANG-restore never recorded');
    assert.notStrictEqual(r.recs['LANG-restore'].verdict, 'PASS', lane + ': an unknown baseline was reported as restored');
    const tail = r.recs['LANG-restore'].evidence || {};
    assert.ok(/unknown|unreadable|lookup/i.test(JSON.stringify(tail)), lane + ': LANG-restore does not say the baseline was unknown: ' + JSON.stringify(tail));
  }
});

(async () => {
  let failed = 0;
  for (const [name, fn] of cases) {
    try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); }
  }
  console.log(failed ? `${failed} of ${cases.length} FAILED` : `all ${cases.length} passed`);
  process.exit(failed ? 1 : 0);
})();
